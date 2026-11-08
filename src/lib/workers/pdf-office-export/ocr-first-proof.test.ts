// @vitest-environment node
// @native-canvas
/**
 * The OCR-first deployment verdicts (`./ocr-first-proof`) held to their
 * controls, on files made by the product's own writers (`./pptx-package`,
 * `./docx-package`). Each verdict passes the shape a wave-3 worker returns
 * and FAILS the shape the worker before it returned (the option ignored),
 * and each health check fails a file that is missing the thing judged, so
 * no "every word is …" can pass over nothing.
 */
import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import {
  DESKEW_SENTINEL,
  FIXTURE_SKEW_DEGREES,
  greyOf,
  skewedBarsPage,
} from "../ocr-deskew-proof";
import { UPRIGHT_SENTINEL } from "../ocr-rotate-proof";
import { SCANNED_LINE } from "@/tests/word-ocr-proof-fixtures";
import { renderPdfPages } from "@/tests/pdf-render";
import { nodeAssetOptions } from "@/tests/pdf-image-decode";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { docxPackage } from "./docx-package";
import { encodePngImage } from "./png-encode";
import { pptxPackage, type PptxRun, type PptxShape } from "./pptx-package";
import {
  STALE_LAYER_TEXT,
  deskewDocxVerdict,
  pptxOcrVerdict,
  redoDocxVerdict,
  slideRuns,
  uprightDocxVerdict,
  withStaleTextLayer,
} from "./ocr-first-proof";

const PNG = encodePngImage(4, 4, "gray8", new Uint8Array(16).fill(128));
const media = (bytes: Uint8Array) => ({
  key: `m${bytes.byteLength}`,
  bytes,
  ext: "png" as const,
  pixelWidth: 4,
  pixelHeight: 4,
  passthrough: false,
});

/* ------------------------------ PPTX ------------------------------ */

const run = (text: string, invisible: boolean): PptxRun => ({
  text,
  typeface: "Arial",
  pitchFamily: 34,
  sz: 1400,
  bold: false,
  italic: false,
  color: null,
  ...(invisible ? { invisible: true } : {}),
});

async function deck(opts: {
  picture: boolean;
  lines?: { text: string; invisible: boolean }[];
}): Promise<Uint8Array> {
  const shapes: PptxShape[] = [];
  if (opts.picture)
    shapes.push({
      kind: "picture",
      name: "Picture 1",
      media: { key: "scan", bytes: PNG, ext: "png" },
      xfrm: { x: 0, y: 0, cx: 7_556_500, cy: 10_693_400 },
    });
  for (const [i, line] of (opts.lines ?? []).entries())
    shapes.push({
      kind: "text",
      name: `Text ${i + 1}`,
      xfrm: {
        x: 508_000,
        y: 1_270_000 + i * 400_000,
        cx: 6_000_000,
        cy: 300_000,
      },
      paragraphs: [
        line.text
          .split(" ")
          .map((w, k, all) =>
            run(k < all.length - 1 ? `${w} ` : w, line.invisible),
          ),
      ],
    });
  return pptxPackage({
    width: 7_556_500,
    height: 10_693_400,
    slides: [{ name: "Page 1", shapes }],
  });
}

describe("pptxOcrVerdict (PDF to PowerPoint, OCR on an image-only scan)", () => {
  it("positive: the scan as a picture and its words in unfilled runs", async () => {
    const v = await pptxOcrVerdict(
      await deck({
        picture: true,
        lines: [{ text: SCANNED_LINE, invisible: true }],
      }),
      SCANNED_LINE,
      "ocr text",
    );
    expect(v.ok, v.detail).toBe(true);
  });

  it("negative (the defect: OCR ignored): the picture and no words fails 'ocr text', and is exactly the control", async () => {
    const old = await deck({ picture: true });
    const on = await pptxOcrVerdict(old, SCANNED_LINE, "ocr text");
    expect(on.ok).toBe(false);
    expect(on.detail).toContain("0 of 7 scan words in unfilled runs");
    const off = await pptxOcrVerdict(old, SCANNED_LINE, "pictures only");
    expect(off.ok, off.detail).toBe(true);
  });

  it("negative: the words painted over the picture (no noFill) fail both ways", async () => {
    const painted = await deck({
      picture: true,
      lines: [{ text: SCANNED_LINE, invisible: false }],
    });
    expect((await pptxOcrVerdict(painted, SCANNED_LINE, "ocr text")).ok).toBe(
      false,
    );
    expect(
      (await pptxOcrVerdict(painted, SCANNED_LINE, "pictures only")).ok,
    ).toBe(false);
  });

  it("negative: the words unfilled AND painted again over the picture fail 'ocr text'", async () => {
    const twice = await deck({
      picture: true,
      lines: [
        { text: SCANNED_LINE, invisible: true },
        { text: SCANNED_LINE, invisible: false },
      ],
    });
    expect((await pptxOcrVerdict(twice, SCANNED_LINE, "ocr text")).ok).toBe(
      false,
    );
  });

  it("negative: a partial reading (one word missing) fails 'ocr text'", async () => {
    const partial = SCANNED_LINE.replace("4718 ", "");
    const v = await pptxOcrVerdict(
      await deck({
        picture: true,
        lines: [{ text: partial, invisible: true }],
      }),
      SCANNED_LINE,
      "ocr text",
    );
    expect(v.ok).toBe(false);
  });

  it("health: a slide without the scan's picture fails, even with every word", async () => {
    const noPicture = await deck({
      picture: false,
      lines: [{ text: SCANNED_LINE, invisible: true }],
    });
    const v = await pptxOcrVerdict(noPicture, SCANNED_LINE, "ocr text");
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/no picture/);
    expect(
      (await pptxOcrVerdict(noPicture, SCANNED_LINE, "pictures only")).ok,
    ).toBe(false);
  });

  it("health: not a ZIP fails", async () => {
    const v = await pptxOcrVerdict(
      new TextEncoder().encode("%PDF-1.7"),
      SCANNED_LINE,
      "pictures only",
    );
    expect(v.ok).toBe(false);
  });

  it("reads the writer's own run shape: text, and noFill only for invisible runs", async () => {
    // Positive control for the run reader itself: a reader that never saw
    // noFill, or never saw a run, would make every verdict above vacuous.
    const xml = `<a:r><a:rPr lang="en-US" sz="1400"><a:noFill/></a:rPr><a:t>a &amp; b</a:t></a:r><a:r><a:rPr lang="en-US" sz="1400"><a:solidFill/></a:rPr><a:t>c</a:t></a:r>`;
    expect(slideRuns(xml)).toEqual([
      { text: "a & b", invisible: true },
      { text: "c", invisible: false },
    ]);
  });
});

/* ------------------------------ DOCX ------------------------------ */

async function docx(opts: {
  lines: string[];
  picture?: Uint8Array | null;
}): Promise<Uint8Array> {
  const blocks = [
    ...(opts.picture
      ? [
          {
            kind: "picture" as const,
            media: media(opts.picture),
            width: 400,
            height: 500,
            rotation: 0,
            flipH: false,
            flipV: false,
          },
        ]
      : []),
    ...opts.lines.map((text) => ({ kind: "text" as const, cells: [text] })),
  ];
  return (
    await docxPackage({
      page: { width: 595, height: 842, margin: 72 },
      pages: [blocks],
    })
  ).bytes;
}

describe("uprightDocxVerdict (PDF to Word, Turn pages upright)", () => {
  it("positive: every sentinel word is text in the DOCX", async () => {
    const v = await uprightDocxVerdict(
      await docx({ picture: PNG, lines: [UPRIGHT_SENTINEL, "body text"] }),
      "read",
    );
    expect(v.ok, v.detail).toBe(true);
  });

  it("negative (the defect: the page read as it lay): garbage text fails 'read' and is the control", async () => {
    const lay = await docx({ picture: PNG, lines: ["ldoɹd ʇɥƃıɹdn 2419 wn"] });
    expect((await uprightDocxVerdict(lay, "read")).ok).toBe(false);
    const off = await uprightDocxVerdict(lay, "unread");
    expect(off.ok, off.detail).toBe(true);
  });

  it("health: no picture, or no text at all, fails both ways", async () => {
    const noPicture = await docx({ lines: [UPRIGHT_SENTINEL] });
    expect((await uprightDocxVerdict(noPicture, "read")).ok).toBe(false);
    const empty = await docx({ picture: PNG, lines: [] });
    // An 'unread' that passed on an empty DOCX would be vacuous.
    expect((await uprightDocxVerdict(empty, "unread")).ok).toBe(false);
    expect(
      (await uprightDocxVerdict(new Uint8Array([1, 2, 3]), "unread")).ok,
    ).toBe(false);
  });
});

describe("withStaleTextLayer (the Redo existing OCR fixture)", () => {
  it("adds the stale words as INVISIBLE text (render mode 3), which --redo-ocr strips", async () => {
    const base = encodePngImage(2, 2, "gray8", new Uint8Array(4).fill(255));
    const { PDFDocument } = await import("pdf-lib");
    const scan = await PDFDocument.create();
    const img = await scan.embedPng(base);
    scan
      .addPage([595, 842])
      .drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    const out = Buffer.from(await withStaleTextLayer(await scan.save()));
    // Every content stream, inflated: the layer is drawn after `3 Tr`.
    const streams = [...out.toString("latin1").matchAll(/stream\r?\n/g)].map(
      (m) => {
        const start = m.index! + m[0].length;
        const end = out.indexOf("endstream", start);
        try {
          return inflateSync(out.subarray(start, end)).toString("latin1");
        } catch {
          return out.subarray(start, end).toString("latin1");
        }
      },
    );
    // The text-showing stream sets render mode 3 before it shows glyphs.
    const content = streams.find((s) => /\bT[jJ]\b/.test(s));
    expect(content, "a content stream shows text").toBeDefined();
    const mode = content!.search(/\b3 Tr\b/);
    expect(mode).toBeGreaterThanOrEqual(0);
    expect(mode).toBeLessThan(content!.search(/\bT[jJ]\b/));
    // And a reader extracts exactly the stale words: the layer --skip-text
    // keeps and a DOCX would carry.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(out),
      ...PDFJS_DOCUMENT_DEFAULTS,
      ...nodeAssetOptions(),
    }).promise;
    const text = await (await doc.getPage(1)).getTextContent();
    const read = text.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(read.replace(/\s+/g, " ").trim()).toBe(STALE_LAYER_TEXT);
  });
});

describe("redoDocxVerdict (PDF to Word, Redo existing OCR)", () => {
  it("positive: the scan's words, none of the stale layer's", async () => {
    const v = await redoDocxVerdict(
      await docx({ picture: PNG, lines: [SCANNED_LINE] }),
      SCANNED_LINE,
      "replaced",
    );
    expect(v.ok, v.detail).toBe(true);
  });

  it("negative (the defect: --skip-text kept the stale layer): fails 'replaced' and is the control", async () => {
    const kept = await docx({ picture: PNG, lines: [STALE_LAYER_TEXT] });
    expect((await redoDocxVerdict(kept, SCANNED_LINE, "replaced")).ok).toBe(
      false,
    );
    const off = await redoDocxVerdict(kept, SCANNED_LINE, "kept");
    expect(off.ok, off.detail).toBe(true);
  });

  it("negative: a second layer ADDED beside the stale one fails 'replaced'", async () => {
    const both = await docx({
      picture: PNG,
      lines: [STALE_LAYER_TEXT, SCANNED_LINE],
    });
    expect((await redoDocxVerdict(both, SCANNED_LINE, "replaced")).ok).toBe(
      false,
    );
    expect((await redoDocxVerdict(both, SCANNED_LINE, "kept")).ok).toBe(false);
  });

  it("health: no picture fails", async () => {
    const v = await redoDocxVerdict(
      await docx({ lines: [SCANNED_LINE] }),
      SCANNED_LINE,
      "replaced",
    );
    expect(v.ok).toBe(false);
  });
});

/** The deskew proof's bars page at `angle`, as the grey PNG a scan carries. */
async function barsPicture(angle: number): Promise<Uint8Array> {
  const [page] = await renderPdfPages(await skewedBarsPage(angle), 1100, {
    standardFonts: true,
  });
  const grey = greyOf(page!);
  return encodePngImage(grey.width, grey.height, "gray8", grey.grey);
}

describe("deskewDocxVerdict (PDF to Word, Straighten)", () => {
  const rasterise = (pdf: Uint8Array, longSide: number) =>
    renderPdfPages(pdf, longSide);

  it("positive: a level picture and the sentinel as text", async () => {
    const v = await deskewDocxVerdict(
      await docx({ picture: await barsPicture(0), lines: [DESKEW_SENTINEL] }),
      "straight",
      rasterise,
    );
    expect(v.ok, v.detail).toBe(true);
  });

  it("negative (the defect: straighten ignored): the crooked picture fails 'straight' and is the control", async () => {
    const crooked = await docx({
      picture: await barsPicture(FIXTURE_SKEW_DEGREES),
      lines: [DESKEW_SENTINEL],
    });
    const on = await deskewDocxVerdict(crooked, "straight", rasterise);
    expect(on.ok).toBe(false);
    const off = await deskewDocxVerdict(crooked, "crooked", rasterise);
    expect(off.ok, off.detail).toBe(true);
  });

  it("negative: level but unread (no sentinel) fails", async () => {
    const v = await deskewDocxVerdict(
      await docx({ picture: await barsPicture(0), lines: ["something else"] }),
      "straight",
      rasterise,
    );
    expect(v.ok).toBe(false);
  });

  it("health: a picture the instrument cannot measure fails, never reads as level", async () => {
    const v = await deskewDocxVerdict(
      await docx({ picture: PNG, lines: [DESKEW_SENTINEL] }),
      "straight",
      rasterise,
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/instrument/);
  });
});
