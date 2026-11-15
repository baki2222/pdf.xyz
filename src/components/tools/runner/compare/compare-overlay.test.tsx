// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapturePagesOptions, CapturedPage } from "@/lib/pdf/render";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import type { ComparablePdfText } from "@/lib/pdf/compare-pdf";
import { pageImagesTooLargeMessage } from "@/lib/pdf/pdfjs-guard";
import { CompareOverlay } from "./compare-overlay";
import {
  CompareChanges,
  compareExtractedPdfText,
  type ComparePages,
} from "./compare-result";
import { NO_VISIBLE_DIFFERENCE } from "./visual-claim";
import { visualRender } from "./visual-pairs";

/**
 * The Overlay as a reader meets it (S3, 2026-11-15), drawn from a FAKE
 * `capturePdfPages` behind its seam (`visualRender`), never `vi.mock`. Each
 * state that must not reach "No differences visible at this resolution"
 * shows its own sentence, and the phrase is absent; the clean state shows
 * the phrase. Keys move between differences without reaching the changes
 * region's own n/j handler. Check all announces itself busy and stops.
 */

const W = 120;
const H = 90;

type Content = "ink" | "three" | "blank";

interface FakeSide {
  numPages: number;
  content?: (k: number) => Content;
  size?: [number, number];
  points?: [number, number];
  failPages?: number[];
  undecoded?: number[];
  rejectAt?: { page: number; error: Error };
  /** Draw this slowly, so a scan can be stopped mid-way. */
  delayMs?: number;
}

const sides = new Map<Uint8Array, FakeSide>();
const signals: AbortSignal[] = [];
const original = visualRender.capture;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  visualRender.capture = original;
  sides.clear();
  signals.length = 0;
  vi.restoreAllMocks();
});

function rgba(content: Content, w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const block = (x0: number, y0: number, bw: number, bh: number) => {
    for (let y = y0; y < y0 + bh; y++)
      for (let x = x0; x < x0 + bw; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  };
  if (content === "blank") return data;
  block(40, 40, 30, 10); // the page's own ink, in the middle
  if (content === "three") {
    block(4, 4, 10, 10); // top left
    block(100, 4, 10, 10); // top right
    block(55, 75, 10, 10); // bottom middle
  }
  return data;
}

async function fakeCapture<T>(
  bytes: Uint8Array,
  o: CapturePagesOptions<T>,
): Promise<CapturedPage<T>[]> {
  const cfg = sides.get(bytes)!;
  if (o.signal) signals.push(o.signal);
  const [w, h] = cfg.size ?? [W, H];
  const [pw, ph] = cfg.points ?? [612, 792];
  const order = (o.pages ?? []).filter((i) => i >= 0 && i < cfg.numPages);
  const out: CapturedPage<T>[] = [];
  for (const i of order) {
    if (o.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, cfg.delayMs ?? 0));
    if (o.signal?.aborted) break;
    if (cfg.rejectAt?.page === i) throw cfg.rejectAt.error;
    if (cfg.failPages?.includes(i)) {
      o.onPageFailed?.({ index: i, message: "x" });
      continue;
    }
    const pixels = rgba(cfg.content?.(i) ?? "ink", w, h);
    const canvas = {
      width: w,
      height: h,
      getContext: () => ({ getImageData: () => ({ data: pixels }) }),
    } as unknown as HTMLCanvasElement;
    const info = {
      index: i,
      width: w,
      height: h,
      pageWidth: pw,
      pageHeight: ph,
    };
    const captured = await o.capture(canvas, info);
    if (o.signal?.aborted) break;
    const page = {
      ...info,
      data: captured as T,
      dpi: 150,
      dpiCapped: false,
      undecodedImages: cfg.undecoded?.includes(i) ? 1 : 0,
    };
    out.push(page);
    o.onPage?.(page);
  }
  return out;
}

function extracted(n: number, text = "Some text") {
  const pages = Array.from({ length: n }, (_, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  return {
    pageCount: n,
    pages,
    text: pages.map((p) => p.text).join("\n\n"),
    characterCount: n * text.length,
    hasText: text.length > 0,
  };
}

function setup(
  left: FakeSide,
  right: FakeSide,
  text = "Some text",
): ComparePages {
  const l = new Uint8Array([1]);
  const r = new Uint8Array([2]);
  sides.set(l, left);
  sides.set(r, right);
  visualRender.capture = fakeCapture as typeof visualRender.capture;
  return {
    left: { bytes: l, extracted: extracted(left.numPages, text) },
    right: { bytes: r, extracted: extracted(right.numPages, text) },
  };
}

const PHRASE = new RegExp(NO_VISIBLE_DIFFERENCE, "i");
const text = () => document.body.textContent ?? "";
const liveLine = () =>
  [...document.querySelectorAll('[role="status"][aria-live="polite"]')][0]
    ?.textContent ?? "";

async function drawn() {
  await waitFor(() => expect(text()).not.toMatch(/Drawing page/), {
    timeout: 3000,
  });
}

describe("the Overlay's one page", () => {
  it("positive control: a clean pair says the gated sentence, with its dpi", async () => {
    render(<CompareOverlay pages={setup({ numPages: 2 }, { numPages: 2 })} />);
    await waitFor(() => expect(text()).toMatch(PHRASE), { timeout: 3000 });
    expect(text()).toContain(
      `${NO_VISIBLE_DIFFERENCE} (about 150 dpi, in grayscale).`,
    );
    expect(text()).toContain(
      "Pages are compared by number: page 1 with page 1.",
    );
  });

  const cases: {
    name: string;
    left?: Partial<FakeSide>;
    right?: Partial<FakeSide>;
    text?: string;
    says: string;
  }[] = [
    {
      name: "a page past the page budget",
      right: {
        rejectAt: {
          page: 0,
          error: new PdfEngineError(pageImagesTooLargeMessage(1)),
        },
      },
      says: `PDF 2 could not be compared visually: ${pageImagesTooLargeMessage(1)} So this page is not compared.`,
    },
    {
      name: "out of memory",
      left: { rejectAt: { page: 0, error: new RangeError("oom") } },
      says: "Your browser ran out of memory drawing page 1, so it is not compared.",
    },
    {
      name: "a page pdf.js could not draw",
      right: { failPages: [0] },
      says: "Page 1 could not be drawn, so it is not compared.",
    },
    {
      name: "an undecoded image",
      left: { undecoded: [0] },
      says: "An image on this page could not be decoded, so this page is not compared.",
    },
    {
      name: "both pages blank while the text layer has text",
      left: { content: () => "blank" },
      right: { content: () => "blank" },
      says: "This page drew blank although it has text, so it is not compared.",
    },
    {
      name: "a page count mismatch",
      right: { numPages: 3 },
      says: "PDF 2 has 1 more page (3); it has nothing to compare with.",
    },
    {
      name: "pages of different sizes",
      right: { size: [90, 120], points: [792, 612] },
      says: "PDF 2's page is turned: 792 × 612 pt against PDF 1's 612 × 792 pt.",
    },
    {
      name: "differing ink",
      right: { content: () => "three" },
      says: "3 differences on this page",
    },
  ];
  for (const c of cases)
    it(`${c.name}: says so, and never the phrase`, async () => {
      render(
        <CompareOverlay
          pages={setup(
            { numPages: 2, ...c.left },
            { numPages: 2, ...c.right },
            c.text,
          )}
        />,
      );
      await drawn();
      await waitFor(() => expect(text()).toContain(c.says), { timeout: 3000 });
      expect(text()).not.toMatch(PHRASE);
    });

  it("steps through differences by button and by key, and the region's keys never hear them", async () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <CompareOverlay
          pages={setup(
            { numPages: 1 },
            { numPages: 1, content: () => "three" },
          )}
        />
      </div>,
    );
    await waitFor(
      () =>
        expect(liveLine()).toBe(
          "Difference 1 of 3, only in PDF 2, near the top left",
        ),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Next difference" }));
    expect(liveLine()).toBe(
      "Difference 2 of 3, only in PDF 2, near the top right",
    );
    const target = document.querySelector("[data-chunk]") as HTMLElement;
    fireEvent.keyDown(target, { key: "n" });
    expect(liveLine()).toBe(
      "Difference 3 of 3, only in PDF 2, near the bottom",
    );
    fireEvent.keyDown(target, { key: "k" });
    fireEvent.keyDown(target, { key: "N", shiftKey: true });
    expect(liveLine()).toBe(
      "Difference 1 of 3, only in PDF 2, near the top left",
    );
    fireEvent.keyDown(target, { key: "j" });
    expect(liveLine()).toMatch(/^Difference 2 of 3/);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe("Check all pages", () => {
  it("a clean document says the all-pages sentence", async () => {
    render(<CompareOverlay pages={setup({ numPages: 3 }, { numPages: 3 })} />);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Check all pages" }));
    await waitFor(
      () =>
        expect(text()).toContain(
          `${NO_VISIBLE_DIFFERENCE} on any of the 3 pages (about 150 dpi, in grayscale).`,
        ),
      { timeout: 3000 },
    );
  });

  it("is busy while it runs, Stop stops it, and a stopped scan claims nothing", async () => {
    const pages = setup(
      { numPages: 30, delayMs: 5 },
      { numPages: 30, delayMs: 5 },
    );
    render(<CompareOverlay pages={pages} />);
    await drawn();
    const section = document.querySelector("[data-chunk]")!;
    fireEvent.click(screen.getByRole("button", { name: "Check all pages" }));
    expect(section.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(
      () => expect(text()).toMatch(/Checked \d+ of 30 pages; stopped\./),
      {
        timeout: 3000,
      },
    );
    expect(section.getAttribute("aria-busy")).toBeNull();
    expect(text()).not.toMatch(PHRASE);
  });

  it("a page past the budget refuses the whole scan, with no pages checked", async () => {
    const pages = setup(
      { numPages: 4 },
      {
        numPages: 4,
        // Single pages draw; the scan's call meets page 3 and refuses.
        rejectAt: {
          page: 2,
          error: new PdfEngineError(pageImagesTooLargeMessage(3)),
        },
      },
    );
    render(<CompareOverlay pages={pages} />);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Check all pages" }));
    await waitFor(
      () =>
        expect(text()).toContain(
          "No pages were checked. Compare the other pages one at a time.",
        ),
      { timeout: 3000 },
    );
    expect(text()).not.toMatch(PHRASE);
  });

  it("an encrypted file asks before Check all draws it, and Cancel draws nothing", async () => {
    const pages = setup({ numPages: 3 }, { numPages: 3 });
    // The same fake document, its bytes now naming /Encrypt.
    const encrypted = new TextEncoder().encode("trailer << /Encrypt 9 0 R >>");
    sides.set(encrypted, sides.get(pages.right.bytes)!);
    const withEncrypted = {
      ...pages,
      right: { ...pages.right, bytes: encrypted },
    };
    render(<CompareOverlay pages={withEncrypted} />);
    await drawn();
    const before = signals.length;
    fireEvent.click(screen.getByRole("button", { name: "Check all pages" }));
    expect(text()).toContain(
      "This file is encrypted, so very large pages are not caught before they are drawn",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signals.length).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Check all pages" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Check all pages anyway" }),
    );
    await waitFor(() => expect(text()).toMatch(/on any of the 3 pages/), {
      timeout: 3000,
    });
    // Control: an unencrypted pair starts at once, with no question.
    cleanup();
    render(<CompareOverlay pages={setup({ numPages: 2 }, { numPages: 2 })} />);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Check all pages" }));
    expect(text()).not.toContain("This file is encrypted");
  });

  it("unmounting stops a running scan", async () => {
    const pages = setup(
      { numPages: 30, delayMs: 5 },
      { numPages: 30, delayMs: 5 },
    );
    const view = render(<CompareOverlay pages={pages} />);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Check all pages" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const running = signals.at(-1)!;
    expect(running.aborted).toBe(false);
    view.unmount();
    expect(running.aborted).toBe(true);
  });
});

describe("the Overlay in the comparison", () => {
  function doc(name: string, pages: string[]): ComparablePdfText {
    return {
      name,
      size: 10,
      extracted: {
        pageCount: pages.length,
        pages: pages.map((t, i) => ({
          pageNumber: i + 1,
          text: t,
          characterCount: t.length,
        })),
        text: pages.join("\n\n"),
        characterCount: 10,
        hasText: true,
      },
    };
  }

  it("is offered with identical text, and leaves no canvas after Show the list", async () => {
    const a = doc("a.pdf", ["Same words", "More words"]);
    const b = doc("b.pdf", ["Same words", "More words"]);
    const result = compareExtractedPdfText(a, b);
    expect(result.hunks).toHaveLength(0);
    const fake = setup(
      { numPages: 2 },
      { numPages: 2, content: () => "three" },
    );
    render(
      <CompareChanges
        result={result}
        options={{}}
        onOptions={() => {}}
        pages={{
          left: { bytes: fake.left.bytes, extracted: a.extracted },
          right: { bytes: fake.right.bytes, extracted: b.extracted },
        }}
      />,
    );
    // The page view needs changes to mark; the Overlay does not.
    expect(
      screen.queryByRole("button", { name: "Show changes on the pages" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Overlay pages" }));
    await waitFor(
      () => expect(document.querySelectorAll("canvas").length).toBe(1),
      {
        timeout: 5000,
      },
    );
    // Previous/Next change step the list, not the Overlay: hidden.
    expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the list" }));
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
    expect(
      document.querySelector("[data-chunk='pdfxyz:lazy:compare-overlay']"),
    ).toBeNull();
  });

  it("a partly scanned file gets a line, and Compare pages visually opens the Overlay at that page", async () => {
    const a = doc("a.pdf", ["Words", "", "Words"]);
    const b = doc("b.pdf", ["Words", "", "Words"]);
    const result = compareExtractedPdfText(a, b);
    const fake = setup({ numPages: 3 }, { numPages: 3 });
    render(
      <CompareChanges
        result={result}
        options={{}}
        onOptions={() => {}}
        pages={{
          left: { bytes: fake.left.bytes, extracted: a.extracted },
          right: { bytes: fake.right.bytes, extracted: b.extracted },
        }}
      />,
    );
    expect(text()).toContain(
      "1 page of PDF 1 and 1 page of PDF 2 have no selectable text, so their text was not compared.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Compare pages visually" }),
    );
    await waitFor(
      () =>
        expect(text()).toContain(
          "Pages are compared by number: page 2 with page 2.",
        ),
      { timeout: 5000 },
    );
  });
});
