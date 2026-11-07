// @vitest-environment jsdom
// @native-canvas
/**
 * Annotate PDF driven the way a person drives it, in jsdom, down to the
 * bytes "Apply & download" hands the browser (review of audit
 * annotate-pdf#3/#4/#5, 2026-11-08).
 *
 * `src/lib/pdf/editor-export-markup.test.ts` proves the writer: hand it a
 * markup with quads, a highlighter stroke, an author, and the PDF is right.
 * Every one of those inputs is made by the editor UI, and three one-line
 * mutations of the UI — runs never read for the text-markup tools, the
 * Highlighter pen styled as the plain pen, the typed name never handed to
 * the export — left all of those tests green. This file reads the
 * DOWNLOADED file, so it sees what a reader receives:
 *
 *   1. Underline dragged across words → /Underline whose /QuadPoints start
 *      at the first word's left edge and end at the last word's right edge,
 *      not at the drag's ends.
 *   2. A Comment, and a name typed in "Your name on comments (optional)" →
 *      /Text + /Popup, /T the typed name.
 *   3. A Highlighter stroke → /Ink whose appearance blends with Multiply,
 *      and flattened, the black under it stays black.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  PDFString,
  PDFHexString,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { withAppRouter } from "@/tests/app-router";
import { renderPdfPages, regionMean } from "@/tests/pdf-render";
import {
  COMMENT_AUTHOR_KEY,
  COMMENT_AUTHOR_LABEL,
  STICKY_LABEL,
  STICKY_STAYS_COMMENT,
} from "@/lib/pdf/editor/sticky";
import { HIGHLIGHTER_LABEL, TEXT_MARKUP_LABEL } from "@/lib/pdf/editor/markup";
import { AnnotateRunner } from "./annotate-runner";

const W = 612;
const H = 792;
/** The fixture's words: Helvetica 20 pt, baseline at PDF y 600 (viewer 192). */
const TEXT = "alpha beta gamma delta";
const TEXT_X = 100;
const SIZE = 20;
const BASELINE = H - 600;
/** A black bar the highlighter is drawn over, viewer y 300..312. */
const BAR = { x: 140, y: 300, width: 220, height: 12 };

let downloads: Blob[] = [];

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    downloads.push(blob);
    return "blob:annotate-test";
  });
  URL.revokeObjectURL = vi.fn();
  // jsdom has no layout: anchors' click() would try to navigate.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    localStorage.removeItem(COMMENT_AUTHOR_KEY);
  } catch {
    /* no storage */
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function fixture(): Promise<{
  file: File;
  word: (w: string) => [number, number];
}> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([W, H]);
  p.drawText(TEXT, { x: TEXT_X, y: H - BASELINE, size: SIZE, font });
  p.drawRectangle({
    x: BAR.x,
    y: H - BAR.y - BAR.height,
    width: BAR.width,
    height: BAR.height,
    color: rgb(0, 0, 0),
  });
  const bytes = await doc.save();
  // A word's left and right edges, viewer x, from the font's real widths.
  const word = (w: string): [number, number] => {
    const at = TEXT.indexOf(w);
    const x0 = TEXT_X + font.widthOfTextAtSize(TEXT.slice(0, at), SIZE);
    return [x0, x0 + font.widthOfTextAtSize(w, SIZE)];
  };
  return {
    file: new File([bytes.slice().buffer], "notes.pdf", {
      type: "application/pdf",
    }),
    word,
  };
}

async function open(file: File) {
  const { container } = render(withAppRouter(<AnnotateRunner />));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone's file input").not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
  await waitFor(
    () =>
      expect(
        container.querySelector('[data-editor-page="0"]'),
        "the editor drew page 1",
      ).not.toBeNull(),
    { timeout: 8000 },
  );
  const sheet = container.querySelector<HTMLElement>('[data-editor-page="0"]')!;
  // Screen pixels per point: jsdom lays nothing out, so a sheet's box is
  // at 0,0 and its width is the one the editor set.
  const scale = parseFloat(sheet.style.width) / W;
  expect(scale, "the sheet has a width").toBeGreaterThan(0);
  const at = (x: number, y: number) => ({
    clientX: x * scale,
    clientY: y * scale,
  });
  return { container, sheet, at };
}

function drag(
  sheet: HTMLElement,
  points: { clientX: number; clientY: number }[],
) {
  const [first, ...rest] = points;
  act(() => {
    fireEvent.pointerDown(sheet, { button: 0, pointerId: 1, ...first });
  });
  for (const p of rest) {
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, ...p });
    });
  }
  act(() => {
    fireEvent.pointerUp(window, { pointerId: 1, ...rest[rest.length - 1]! });
  });
}

async function applyAndRead(): Promise<PDFDocument> {
  fireEvent.click(screen.getByRole("button", { name: /Apply & download/ }));
  await waitFor(() => expect(downloads.length).toBe(1), { timeout: 15000 });
  return PDFDocument.load(new Uint8Array(await downloads[0]!.arrayBuffer()));
}

async function downloadedBytes(): Promise<Uint8Array> {
  return new Uint8Array(await downloads[0]!.arrayBuffer());
}

function annots(doc: PDFDocument): PDFDict[] {
  const arr = doc.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!arr) return [];
  return arr.asArray().map((_, i) => arr.lookup(i, PDFDict));
}

const subtype = (a: PDFDict) => String(a.get(PDFName.of("Subtype")));

function text(v: unknown): string | undefined {
  return v instanceof PDFString || v instanceof PDFHexString
    ? v.decodeText()
    : undefined;
}

function chooseComments() {
  fireEvent.click(
    screen.getByLabelText(/Save markups as comments/, { selector: "input" }),
  );
}

describe("Annotate PDF, through the editor to the downloaded file", () => {
  it("Underline dragged across words is an /Underline over those words, not over the drag", async () => {
    const { file, word } = await fixture();
    const { sheet, at } = await open(file);
    fireEvent.click(
      screen.getByRole("button", { name: TEXT_MARKUP_LABEL.underline }),
    );
    // The text-markup tools read the page's words. Waited on only as a
    // courtesy: if they are never read, the assertions below say so.
    await waitFor(
      () => expect(sheet.getAttribute("data-runs-read")).not.toBeNull(),
      { timeout: 6000 },
    ).catch(() => {});

    const [betaL, betaR] = word("beta");
    const [gammaL, gammaR] = word("gamma");
    // Press in the middle of "beta", release in the middle of "gamma",
    // a little lower: the drag's box starts and ends mid-word.
    const y = BASELINE - 6;
    drag(sheet, [
      at((betaL + betaR) / 2, y),
      at(gammaL + 4, y + 1),
      at((gammaL + gammaR) / 2, y + 2),
    ]);
    await waitFor(() =>
      expect(
        sheet.querySelector('[data-object-kind="highlight"]'),
      ).not.toBeNull(),
    );
    // No Comment placed: no word about one beside the flatten choice.
    expect(document.querySelector("[data-sticky-hint]")).toBeNull();
    chooseComments();
    const doc = await applyAndRead();
    const list = annots(doc);
    expect(list.map(subtype)).toEqual(["/Underline"]);
    const q = list[0]!
      .lookup(PDFName.of("QuadPoints"), PDFArray)
      .asArray()
      .map((n) => Number(String(n)));
    expect(q.length, "one line selected: one quad").toBe(8);
    const xs = [q[0]!, q[2]!, q[4]!, q[6]!];
    // From the first selected word's left edge to the last one's right
    // edge (the drag's own box would start and end mid-word, ~12 pt in).
    expect(Math.min(...xs)).toBeCloseTo(betaL, 0);
    expect(Math.max(...xs)).toBeCloseTo(gammaR, 0);
    // On the text line: the words' box, ascent to descent, PDF space.
    const ys = [q[1]!, q[3]!, q[5]!, q[7]!];
    expect(Math.max(...ys)).toBeGreaterThan(600 + SIZE * 0.8);
    expect(Math.min(...ys)).toBeLessThan(600 - SIZE * 0.1);
  }, 40000);

  it("a Comment with a typed name is a /Text with a /Popup, and /T is that name", async () => {
    const { file } = await fixture();
    const { sheet, at } = await open(file);
    fireEvent.click(screen.getByRole("button", { name: STICKY_LABEL }));
    drag(sheet, [at(400, 500), at(400, 500)]);
    const box = await screen.findByLabelText("Note text");
    fireEvent.change(box, { target: { value: "Check this figure" } });
    act(() => {
      fireEvent.blur(box);
    });
    fireEvent.change(await screen.findByLabelText(COMMENT_AUTHOR_LABEL), {
      target: { value: "Ada Lovelace" },
    });
    // Flatten is still chosen, and the run bar says the Comment will be a
    // comment anyway (the review of 62aa1808).
    expect(
      document.querySelector("[data-sticky-hint]")?.textContent?.trim(),
    ).toBe(STICKY_STAYS_COMMENT);
    const doc = await applyAndRead();
    const list = annots(doc);
    expect(list.map(subtype).sort()).toEqual(["/Popup", "/Text"]);
    const note = list.find((a) => subtype(a) === "/Text")!;
    expect(text(note.lookup(PDFName.of("Contents")))).toBe("Check this figure");
    expect(text(note.lookup(PDFName.of("T")))).toBe("Ada Lovelace");
    const popup = list.find((a) => subtype(a) === "/Popup")!;
    expect(popup.get(PDFName.of("Parent"))).toBe(
      doc
        .getPage(0)
        .node.lookup(PDFName.of("Annots"), PDFArray)
        .get(list.indexOf(note)),
    );
  }, 40000);

  async function highlighterStroke() {
    const { file } = await fixture();
    const { sheet, at } = await open(file);
    fireEvent.click(screen.getByRole("button", { name: HIGHLIGHTER_LABEL }));
    const y = BAR.y + BAR.height / 2;
    drag(sheet, [
      at(BAR.x - 50, y),
      at(BAR.x + 40, y),
      at(BAR.x + 120, y),
      at(BAR.x + BAR.width + 40, y),
    ]);
    await waitFor(() =>
      expect(sheet.querySelector('[data-object-kind="ink"]')).not.toBeNull(),
    );
  }

  it("a Highlighter stroke saved as a comment is /Ink drawn with the Multiply blend", async () => {
    await highlighterStroke();
    chooseComments();
    const doc = await applyAndRead();
    const list = annots(doc);
    expect(list.map(subtype)).toEqual(["/Ink"]);
    const ap = list[0]!
      .lookup(PDFName.of("AP"), PDFDict)
      .lookup(PDFName.of("N")) as PDFStream;
    const res = ap.dict
      .lookup(PDFName.of("Resources"), PDFDict)
      .lookup(PDFName.of("ExtGState"), PDFDict);
    const states = res.keys().map((k) => res.lookup(k, PDFDict));
    expect(states.map((s) => String(s.get(PDFName.of("BM"))))).toContain(
      "/Multiply",
    );
  }, 40000);

  it("a Highlighter stroke flattened leaves the black under it black, and tints the paper", async () => {
    await highlighterStroke();
    await applyAndRead();
    const [img] = await renderPdfPages(await downloadedBytes(), W);
    const onBar = regionMean(
      img!,
      (BAR.x + 20) / W,
      (BAR.y + 3) / H,
      (BAR.x + 100) / W,
      (BAR.y + 9) / H,
    );
    const onPaper = regionMean(
      img!,
      (BAR.x - 40) / W,
      (BAR.y + 3) / H,
      (BAR.x - 10) / W,
      (BAR.y + 9) / H,
    );
    // Positive control: the stroke is there — the paper beside the bar
    // turned yellow (blue well under red and green).
    expect(onPaper[0] - onPaper[2]).toBeGreaterThan(60);
    // Multiplied, the bar stays black; painted over, it would turn yellow.
    expect(Math.max(...onBar)).toBeLessThan(60);
  }, 40000);
});
