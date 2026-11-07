// @native-canvas
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { renderPdfPages, regionMean } from "@/tests/pdf-render";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import { awaitPdfjsDocument } from "./pdfjs";
import { exportEditedPdf } from "./editor-export";
import type { EditorObject, Rect } from "./editor/model";
import annotate from "@/lib/tools/content/annotate-pdf";
import editPdf from "@/lib/tools/content/edit-pdf";
import {
  TEXT_MARKUPS,
  TEXT_MARKUP_LABEL,
  TEXT_MARKUP_SUBTYPE,
  markupStroke,
  type TextMarkup,
} from "./editor/markup";

/**
 * Text markup (audit annotate-pdf#2 / edit-pdf#3, 2026-11-08): underline,
 * strikethrough and squiggly beside highlight, read back the way a READER
 * receives them — pdf.js's `getAnnotations()` for what a comment panel
 * lists, its renderer for what a flattened page paints.
 */

const TOL = 1;

async function page(rotate = 0, text?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  if (text) {
    p.drawText(text, {
      x: 100,
      y: 600,
      size: 20,
      font: await doc.embedFont(StandardFonts.Helvetica),
    });
  }
  p.setRotation(degrees(rotate));
  return doc.save();
}

interface Read {
  subtype: string;
  quads: Rect[];
  color: number[] | null;
  hasAppearance: boolean;
}

async function annotations(bytes: Uint8Array): Promise<Read[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  const doc = await awaitPdfjsDocument(task);
  try {
    const pg = await doc.getPage(1);
    const vp = pg.getViewport({ scale: 1 });
    const raw = (await pg.getAnnotations()) as Record<string, unknown>[];
    return raw.map((a) => {
      const q = a.quadPoints as ArrayLike<number> | undefined;
      const quads: Rect[] = [];
      if (q)
        for (let i = 0; i + 8 <= q.length; i += 8) {
          const pts = [0, 2, 4, 6].map((k) =>
            vp.convertToViewportPoint(q[i + k]!, q[i + k + 1]!),
          );
          const xs = pts.map((p) => p[0]!);
          const ys = pts.map((p) => p[1]!);
          quads.push({
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          });
        }
      const c = a.color as ArrayLike<number> | null;
      return {
        subtype: String(a.subtype),
        quads,
        color: c ? [c[0]!, c[1]!, c[2]!] : null,
        hasAppearance: a.hasAppearance === true,
      };
    });
  } finally {
    await task.destroy();
  }
}

const mark = (
  id: string,
  markup: TextMarkup,
  box: Rect,
  color = "#dc2626",
  opacity = 1,
): EditorObject => ({
  id,
  kind: "highlight",
  markup,
  page: 0,
  ...box,
  color,
  opacity,
});

// "SNAP THIS LINE" at y 600 from the bottom, size 20: on the displayed page
// its run spans about y 172..197 (top-left origin), x 100 onward.
const OVER_LINE = { x: 90, y: 160, width: 120, height: 50 };

describe("text markup saved as comments", () => {
  it.each(TEXT_MARKUPS.filter((m) => m !== "highlight"))(
    "%s is written as its own annotation subtype, snapped to the line, with an appearance",
    async (markup) => {
      const out = await exportEditedPdf(
        await page(0, "SNAP THIS LINE"),
        [mark("m", markup, OVER_LINE)],
        undefined,
        { markups: "comments" },
      );
      expect(out.comments).toBe(1);
      const [a, ...rest] = await annotations(out.bytes);
      expect(rest).toEqual([]);
      expect(a!.subtype).toBe(TEXT_MARKUP_SUBTYPE[markup]);
      expect(a!.hasAppearance).toBe(true);
      expect(a!.color).toEqual([220, 38, 38]);
      // Snapped to the line: one quad, the line's height, not the 50 pt box.
      expect(a!.quads).toHaveLength(1);
      const q = a!.quads[0]!;
      expect(Math.abs(q.x - 100)).toBeLessThanOrEqual(TOL);
      expect(q.height).toBeLessThan(30);
      expect(q.y).toBeGreaterThan(165);
    },
  );

  it("the four subtypes are four different annotations (a positive control on the mapping)", () => {
    expect(new Set(Object.values(TEXT_MARKUP_SUBTYPE)).size).toBe(4);
    expect(TEXT_MARKUP_SUBTYPE.strikeout).toBe("StrikeOut");
  });

  it("a highlight with no markup (an object from before) is still a /Highlight", async () => {
    const legacy: EditorObject = {
      id: "h",
      kind: "highlight",
      page: 0,
      ...OVER_LINE,
      color: "#facc15",
      opacity: 0.4,
    };
    const out = await exportEditedPdf(
      await page(0, "SNAP THIS LINE"),
      [legacy],
      undefined,
      { markups: "comments" },
    );
    expect((await annotations(out.bytes)).map((a) => a.subtype)).toEqual([
      "Highlight",
    ]);
  });

  it("the appearance strokes the line in the colour (not a filled box), opacity in /CA", async () => {
    const out = await exportEditedPdf(
      await page(),
      [
        mark(
          "u",
          "underline",
          { x: 100, y: 300, width: 200, height: 20 },
          "#2563eb",
          0.8,
        ),
      ],
      undefined,
      { markups: "comments" },
    );
    const doc = await PDFDocument.load(out.bytes);
    const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const a = annots.lookup(0, PDFDict);
    expect(String(a.get(PDFName.of("Subtype")))).toBe("/Underline");
    expect(a.lookup(PDFName.of("CA"), PDFNumber).asNumber()).toBeCloseTo(0.8);
  });
});

describe("what the pages say about it", () => {
  it("Annotate PDF's FAQ answers yes and names every Style the menu offers", () => {
    const faq = annotate.faqs.find((f) => /underline or strike/i.test(f.q));
    expect(faq, "no underline FAQ").toBeDefined();
    expect(faq!.a).toMatch(/^Yes\./);
    for (const m of TEXT_MARKUPS)
      expect(faq!.a).toContain(TEXT_MARKUP_LABEL[m]);
  });
});

describe("what Edit PDF says about it (audit edit-pdf#3)", () => {
  it("its FAQ answers yes to striking through and underlining, naming every Style", () => {
    const faq = editPdf.faqs.find((f) =>
      /strike through or underline/i.test(f.q),
    );
    expect(faq, "no strike-through FAQ on Edit PDF").toBeDefined();
    expect(faq!.a).toMatch(/^Yes\./);
    for (const m of TEXT_MARKUPS)
      expect(faq!.a).toContain(TEXT_MARKUP_LABEL[m]);
    expect(faq!.a).toMatch(/Save markups as comments/);
  });

  it("its intro and its tool step name the Underline and Strikethrough buttons", () => {
    const step = editPdf.steps.find((s) => /Pick a tool/.test(s.title))!.body;
    for (const text of [editPdf.intro[0]!, step]) {
      expect(text.toLowerCase()).toContain(
        TEXT_MARKUP_LABEL.underline.toLowerCase(),
      );
      expect(text.toLowerCase()).toContain(
        TEXT_MARKUP_LABEL.strikeout.toLowerCase(),
      );
    }
  });
});

describe("text markup flattened into the page", () => {
  // A blank page and a 20 pt box at y 300: the underline sits near the
  // box's bottom, the strike-out across its middle — read from the render.
  const BOX = { x: 100, y: 300, width: 200, height: 20 };
  const W = 612;
  const H = 792;

  async function bands(markup: TextMarkup, rotate = 0) {
    const out = await exportEditedPdf(await page(rotate), [
      mark("m", markup, BOX),
    ]);
    expect(out.comments).toBe(0);
    expect(await annotations(out.bytes)).toEqual([]);
    const [img] = await renderPdfPages(out.bytes, rotate === 90 ? H : W);
    const PW = rotate === 90 ? H : W;
    const PH = rotate === 90 ? W : H;
    const at = (y: number) =>
      regionMean(img!, 140 / PW, (y - 0.6) / PH, 260 / PW, (y + 0.6) / PH);
    const line = markupStroke(BOX, markup)!;
    return {
      line: at(line.points[0]!.y),
      // The other line's place, and the box's top: paper.
      top: at(BOX.y + 2),
    };
  }

  it.each([0, 90])(
    "an underline paints a red line near the bottom and nothing at the top (/Rotate %i)",
    async (rotate) => {
      const { line, top } = await bands("underline", rotate);
      expect(line[0]).toBeGreaterThan(line[2] + 60);
      expect(Math.min(...top)).toBeGreaterThan(245);
    },
  );

  it("a strikethrough paints across the middle", async () => {
    const { line, top } = await bands("strikeout");
    const mid = markupStroke(BOX, "strikeout")!.points[0]!.y;
    expect(mid).toBeGreaterThan(BOX.y + 5);
    expect(mid).toBeLessThan(BOX.y + 15);
    expect(line[0]).toBeGreaterThan(line[2] + 60);
    expect(Math.min(...top)).toBeGreaterThan(245);
  });

  it("CONTROL: a highlight fills the box, top included", async () => {
    const out = await exportEditedPdf(await page(), [
      mark("h", "highlight", BOX, "#dc2626", 1),
    ]);
    const [img] = await renderPdfPages(out.bytes, W);
    const top = regionMean(img!, 140 / W, 301 / H, 260 / W, 303 / H);
    expect(top[0]).toBeGreaterThan(top[2] + 60);
  });
});

describe("text selected to mark (audit annotate-pdf#3)", () => {
  // Two lines' worth of selected text, as the editor stores it: the quads
  // the selection covered, the box around them.
  const QUADS: Rect[] = [
    { x: 200, y: 300, width: 150, height: 20 },
    { x: 72, y: 324, width: 90, height: 20 },
  ];
  const selected = (markup: TextMarkup): EditorObject => ({
    id: "s",
    kind: "highlight",
    markup,
    page: 0,
    x: 72,
    y: 300,
    width: 278,
    height: 44,
    quads: QUADS,
    color: "#dc2626",
    opacity: 1,
  });

  it("saved as a comment, the quads are the selection's, not the box", async () => {
    const out = await exportEditedPdf(
      await page(),
      [selected("highlight")],
      undefined,
      { markups: "comments" },
    );
    const [a] = await annotations(out.bytes);
    expect(a!.subtype).toBe("Highlight");
    expect(a!.quads).toHaveLength(2);
    a!.quads.forEach((q, i) => {
      const want = QUADS[i]!;
      expect(Math.abs(q.x - want.x)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(q.y - want.y)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(q.width - want.width)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(q.height - want.height)).toBeLessThanOrEqual(TOL);
    });
  });

  it.each([0, 90])(
    "flattened, only the selected lines are painted — the box's empty corner stays paper (/Rotate %i)",
    async (rotate) => {
      const out = await exportEditedPdf(await page(rotate), [
        selected("highlight"),
      ]);
      const PW = rotate === 90 ? 792 : 612;
      const PH = rotate === 90 ? 612 : 792;
      const [img] = await renderPdfPages(out.bytes, PW);
      const at = (x: number, y: number) =>
        regionMean(img!, x / PW, y / PH, (x + 20) / PW, (y + 8) / PH);
      // Inside each quad: red.
      const first = at(250, 306);
      const second = at(100, 330);
      expect(first[0]).toBeGreaterThan(first[2] + 60);
      expect(second[0]).toBeGreaterThan(second[2] + 60);
      // The box's top-left corner (left of the first line's selection)
      // and its bottom-right (right of the second's): no paint.
      expect(Math.min(...at(90, 306))).toBeGreaterThan(245);
      expect(Math.min(...at(250, 330))).toBeGreaterThan(245);
    },
  );

  it("an underline of selected text runs under each selected line only", async () => {
    const out = await exportEditedPdf(await page(), [selected("underline")]);
    const [img] = await renderPdfPages(out.bytes, 612);
    const y = markupStroke(QUADS[1]!, "underline")!.points[0]!.y;
    const band = (x: number) =>
      regionMean(
        img!,
        x / 612,
        (y - 0.6) / 792,
        (x + 20) / 612,
        (y + 0.6) / 792,
      );
    expect(band(100)[0]).toBeGreaterThan(band(100)[2] + 60);
    // Same height, right of the second line's selection: paper.
    expect(Math.min(...band(250))).toBeGreaterThan(245);
  });
});
