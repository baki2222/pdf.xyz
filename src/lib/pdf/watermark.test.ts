// @native-canvas
import { PDFDocument, PageSizes, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  addWatermark,
  validateWatermarkText,
  watermarkPdf,
  watermarkedOutputName,
} from "./watermark";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return doc.save();
}

describe("watermark", () => {
  it("rejects empty watermark text", () => {
    expect(() => validateWatermarkText("   ")).toThrow(PdfEngineError);
    expect(() => validateWatermarkText("")).toThrow(/watermark/i);
  });

  it("stamps every page while preserving the page count", async () => {
    const input = await blankPdf(2);
    const output = await addWatermark(input, "CONFIDENTIAL");
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(2);
    expect(output.byteLength).toBeGreaterThan(input.byteLength);
  });

  it("stamps our creator metadata", async () => {
    const output = await addWatermark(await blankPdf(1), "DRAFT");
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("accepts custom opacity and rotation without throwing", async () => {
    const input = await blankPdf(1);
    const output = await addWatermark(input, "SAMPLE", {
      opacity: 0.35,
      rotation: -30,
      fontSize: 48,
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(1);
  });

  it("names the download from the source", () => {
    expect(watermarkedOutputName("invoice.pdf")).toBe(
      "invoice-watermarked.pdf",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Does the WHOLE watermark land on the page a reader sees?
 *
 * Until this block existed the watermark was drawn at a fixed point size with
 * nothing comparing its width to the page. "Property of Acme Corporation" is
 * ~860pt wide at the default 60pt; an A4 page is 595pt wide. The first and last
 * letters were drawn off the page — clipped by every viewer — under a success
 * panel that said "Stamped on all N pages". The e2e proof had met it and
 * enlarged its FIXTURE instead (e2e/client-proof/cases.ts, watermark case).
 *
 * Every assertion here reads the SAVED bytes back through pdfjs, the reader
 * this product ships: its text layer omits glyphs outside the page's visible
 * box (`page.view`, the CropBox clipped to the MediaBox), so "the whole string
 * comes back" is a consumer-side statement that the geometry-only fit could not
 * make about itself.
 * ---------------------------------------------------------------------------
 */

interface DrawnRun {
  str: string;
  /** Baseline start, user space. */
  start: [number, number];
  /** Baseline end, user space. */
  end: [number, number];
  /** Rendered font size: the scale of pdfjs's text transform. */
  size: number;
}

interface DrawnPage {
  /** The box a reader sees: [x0, y0, x1, y1]. */
  view: [number, number, number, number];
  runs: DrawnRun[];
  text: string;
}

async function drawnPages(bytes: Uint8Array): Promise<DrawnPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  try {
    const doc = await task.promise;
    const pages: DrawnPage[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const runs: DrawnRun[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        const [a, b, , , e, f] = item.transform as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        const size = Math.hypot(a, b);
        const end: [number, number] = [
          e + (item.width * a) / size,
          f + (item.width * b) / size,
        ];
        runs.push({ str: item.str, start: [e, f], end, size });
      }
      pages.push({
        view: page.view as [number, number, number, number],
        runs,
        text: runs
          .map((run) => run.str)
          .join("")
          .replace(/\s+/g, " "),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

function inside(
  [x, y]: [number, number],
  [x0, y0, x1, y1]: [number, number, number, number],
): boolean {
  const eps = 0.5;
  return x >= x0 - eps && x <= x1 + eps && y >= y0 - eps && y <= y1 + eps;
}

/**
 * The page sizes pdf-lib itself defines — ISO A/B/C, US, and the rest — rather
 * than a list typed here. They run from A10 (26×37pt) to 4A0 (4768×6741pt), so
 * the sweep spans "must shrink hard" to "never shrinks".
 */
const PAGE_SIZES = Object.entries(PageSizes) as [string, [number, number]][];

async function sweepPdf(rotate: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [, size] of PAGE_SIZES) {
    doc.addPage(size).setRotation(degrees(rotate));
  }
  return doc.save();
}

const LONG_TEXT = "Property of Acme Corporation";

describe("the whole watermark is on every page a reader sees", () => {
  it("the sweep's corpus is the real one (health check)", async () => {
    // A sweep over an empty or collapsed set would pass everything.
    expect(PAGE_SIZES.length).toBeGreaterThanOrEqual(40);
    const names = PAGE_SIZES.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining(["A4", "A6", "A10", "Letter", "4A0"]),
    );
    // And the text genuinely overflows A4 at the requested size — without
    // that, "it fits" below would prove nothing.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    expect(font.widthOfTextAtSize(LONG_TEXT, 60)).toBeGreaterThan(
      PageSizes.A4[0],
    );
  });

  it.each([0, 90, 180, 270])(
    "every pdf-lib page size, /Rotate %i, tilts -90…90: whole text, both baseline ends inside the visible box",
    async (rotate) => {
      const source = await sweepPdf(rotate);
      for (const tilt of [-90, -45, 0, 30, 45, 90]) {
        const out = await addWatermark(source, LONG_TEXT, {
          fontSize: 60,
          rotation: tilt,
        });
        const pages = await drawnPages(out);
        expect(pages).toHaveLength(PAGE_SIZES.length);
        for (const [index, page] of pages.entries()) {
          const where = `${PAGE_SIZES[index]![0]} /Rotate ${rotate} tilt ${tilt}`;
          expect(page.text, where).toBe(LONG_TEXT);
          for (const run of page.runs) {
            expect(inside(run.start, page.view), `${where} start`).toBe(true);
            expect(inside(run.end, page.view), `${where} end`).toBe(true);
          }
        }
      }
    },
    60_000,
  );

  it("A4 + 'Property of Acme Corporation' at 0° and 45°: the finding's own case", async () => {
    const doc = await PDFDocument.create();
    doc.addPage(PageSizes.A4);
    const source = await doc.save();
    for (const tilt of [0, 45]) {
      const [page] = await drawnPages(
        await addWatermark(source, LONG_TEXT, { rotation: tilt }),
      );
      expect(page!.text).toBe(LONG_TEXT);
      expect(inside(page!.runs[0]!.start, page!.view)).toBe(true);
      expect(inside(page!.runs[0]!.end, page!.view)).toBe(true);
    }
  });

  it("a /Rotate 90 page is fitted in the frame the reader sees, not the stored one", async () => {
    // Portrait A4 stored, landscape on screen. Tilt 90 in the READER's frame
    // runs the text up the short (595pt) side. Fitting with the tilt alone —
    // ignoring /Rotate — measures it against the stored 842pt side, lets the
    // 674pt string through at full size, and clips it.
    const doc = await PDFDocument.create();
    doc.addPage(PageSizes.A4).setRotation(degrees(90));
    const text = "DRAFT - DO NOT COPY";
    const [page] = await drawnPages(
      await addWatermark(await doc.save(), text, { rotation: 90 }),
    );
    expect(page!.text).toBe(text);
    const run = page!.runs[0]!;
    expect(inside(run.start, page!.view)).toBe(true);
    expect(inside(run.end, page!.view)).toBe(true);
  });

  it("a cropped page is fitted to, and centred on, its CropBox — what a viewer shows", async () => {
    // MediaBox 600×800, but only the top-right quarter is visible. Centring on
    // the MediaBox puts the middle of the text on the crop's corner.
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setCropBox(300, 400, 300, 400);
    const [drawn] = await drawnPages(
      await addWatermark(await doc.save(), "CONFIDENTIAL", { rotation: 30 }),
    );
    expect(drawn!.view).toEqual([300, 400, 600, 800]);
    expect(drawn!.text).toBe("CONFIDENTIAL");
    const run = drawn!.runs[0]!;
    expect(inside(run.start, drawn!.view)).toBe(true);
    expect(inside(run.end, drawn!.view)).toBe(true);
    // Centred: the baseline midpoint sits near the crop's centre (450, 600).
    const mid = [
      (run.start[0] + run.end[0]) / 2,
      (run.start[1] + run.end[1]) / 2,
    ];
    expect(Math.hypot(mid[0]! - 450, mid[1]! - 600)).toBeLessThan(40);
  });

  it("a MediaBox that does not start at the origin is still centred on what is shown", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.setMediaBox(1000, 2000, 600, 800);
    const [drawn] = await drawnPages(
      await addWatermark(await doc.save(), "DRAFT", { rotation: 0 }),
    );
    expect(drawn!.view).toEqual([1000, 2000, 1600, 2800]);
    expect(drawn!.text).toBe("DRAFT");
    expect(inside(drawn!.runs[0]!.start, drawn!.view)).toBe(true);
    expect(inside(drawn!.runs[0]!.end, drawn!.view)).toBe(true);
  });

  it("positive control: text that fits is drawn at EXACTLY the requested size, and nothing is reported shrunk", async () => {
    // Guards against a "fix" that shrinks everything: the runner's defaults
    // (60pt CONFIDENTIAL at 45°) on LETTER and A4 must be untouched.
    const doc = await PDFDocument.create();
    doc.addPage(PageSizes.Letter);
    doc.addPage(PageSizes.A4);
    const report = await watermarkPdf(await doc.save(), "CONFIDENTIAL");
    expect(report.pages).toBe(2);
    expect(report.shrunkPages).toBe(0);
    for (const page of await drawnPages(report.bytes)) {
      expect(page.text).toBe("CONFIDENTIAL");
      expect(page.runs[0]!.size).toBeCloseTo(60, 3);
    }
  });

  it("the reported shrunk count is the count a reader would measure, page by page", async () => {
    // Mixed sizes: the same 60pt fits A3 and does not fit A6 or a receipt.
    const doc = await PDFDocument.create();
    doc.addPage(PageSizes.A3);
    doc.addPage(PageSizes.A6);
    doc.addPage(PageSizes.A3).setRotation(degrees(270));
    doc.addPage([226, 600]); // 80mm receipt roll
    const report = await watermarkPdf(await doc.save(), "DRAFT - DO NOT COPY");
    const pages = await drawnPages(report.bytes);
    const measuredShrunk = pages.filter(
      (page) => page.runs[0]!.size < 60 - 1e-3,
    ).length;
    expect(report.pages).toBe(4);
    expect(report.shrunkPages).toBe(measuredShrunk);
    // And the partition is the one the geometry predicts — not 0, not all.
    expect(pages.map((page) => page.runs[0]!.size < 60 - 1e-3)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(report.smallestFontSize).toBeCloseTo(
      Math.min(...pages.map((page) => page.runs[0]!.size)),
      3,
    );
  });
});
