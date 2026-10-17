/**
 * Generated PDFs for PDF to Word's pictures, each with what it draws written
 * down beside it: every picture (where the page shows it, its pixels, whether
 * the PDF holds it as a plain JPEG), and, page by page, what a reader of the
 * .docx must meet in order — paragraphs by their text, pictures as `#n`, the
 * n-th picture the document paints (1-based, in paint order).
 *
 * Built with pdf-lib from synthetic pixels and standard fonts. Nothing here
 * is derived from a user's document: the owner's 33-page tutorial, which
 * production returned with no pictures on 2026-10-17, was measured locally
 * and stays out of the repository. These reproduce its shapes — a picture
 * between the text above and below it, a caption under a screenshot, a page
 * that is only a scan — and the edges around them: a picture wider than the
 * Word page's text, one over the 64-megapixel ceiling, a page whose crop box
 * is not its media box (where poppler's frame and pdf.js's differ).
 *
 * Positions are in the frame the page is displayed in: points, origin at the
 * TOP left (pdf-lib draws from the bottom left of the media box).
 */
import { deflateSync } from "node:zlib";
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setTextRenderingMode,
  TextRenderingMode,
  type PDFFont,
  type PDFName,
  type PDFPage,
  type PDFRef,
} from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { encodePngImage } from "@/lib/workers/pdf-office-export/png-encode";
import {
  JPEG_30X20,
  JPEG_30X20_EXIF6,
  JPEG_HEIGHT,
  JPEG_WIDTH,
} from "./jpeg-fixtures";
import {
  drawingBits,
  gradientPixels,
  scanPixels,
  type Rect,
} from "./pptx-fidelity-fixtures";

export interface DocxFixturePicture {
  /** 1-based page number. */
  page: number;
  /** Where the page shows it, displayed frame. */
  shown: Rect;
  pixelWidth: number;
  pixelHeight: number;
  /** "jpeg": the PDF holds a plain DCT stream, which the .docx can copy. */
  source: "jpeg" | "png";
  /** The JPEG's own bytes, when `source` is "jpeg". */
  jpeg?: Uint8Array;
  /**
   * The picture as a file — the PNG of its samples, or the JPEG — for a
   * .docx built by hand (`./docx-hand-built`). Absent where that file would
   * be needlessly large (the 65-megapixel drawing).
   */
  file?: { bytes: Uint8Array; ext: "png" | "jpeg" };
}

export interface DocxFixture {
  name: string;
  pdf: Uint8Array;
  pictures: DocxFixturePicture[];
  /** Per page with anything on it: paragraphs (their text) and `#n` pictures. */
  sequence: string[][];
  /** The first page as displayed, points: the .docx page follows it. */
  firstPage: { width: number; height: number };
}

/**
 * A second synthetic picture, as unlike {@link gradientPixels} as one can
 * be: diagonal stripes in two warm colours with a dark block at the lower
 * right. Two pictures that look alike would let a shuffled .docx pass.
 */
export function stripePixels(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      const block = x > width * 0.62 && y > height * 0.55;
      const band = Math.floor((x + y) / Math.max(6, width / 16)) % 2 === 0;
      const c: [number, number, number] = block
        ? [30, 30, 40]
        : band
          ? [240, 160, 40]
          : [200, 60, 50];
      out[p] = c[0];
      out[p + 1] = c[1];
      out[p + 2] = c[2];
    }
  return out;
}

const png = (
  width: number,
  height: number,
  layout: "rgb8" | "gray8",
  samples: Uint8Array,
) => encodePngImage(width, height, layout, samples);

async function fonts(doc: PDFDocument, strings: readonly string[]) {
  return {
    regular: await embedDrawingFont(doc, strings, "sans"),
    bold: await embedDrawingFont(doc, strings, "sans-bold"),
  };
}

/** Draw `s` with its baseline `baseline` points below the displayed top. */
function line(
  page: PDFPage,
  s: string,
  x: number,
  baseline: number,
  size: number,
  font: PDFFont,
  top = page.getHeight(),
): void {
  page.drawText(s, { x, y: top - baseline, size, font, color: rgb(0, 0, 0) });
}

/**
 * Two pages. Page 1: a title, a sentence, a screenshot-like picture, a
 * sentence, a striped picture, a closing sentence. Page 2: a heading, a
 * small plain JPEG (copied byte for byte), its caption.
 */
export async function captionedPicturesPdf(): Promise<DocxFixture> {
  const texts = [
    "Setting up the portal",
    "The first picture shows the sign-in page.",
    "The second picture shows the settings page.",
    "That is all for the first page.",
    "A second page",
    "A small photograph, copied as it is.",
  ];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const p1 = doc.addPage([595, 842]);
  line(p1, texts[0]!, 72, 80, 20, f.bold);
  line(p1, texts[1]!, 72, 120, 12, f.regular);
  const one: Rect = { x: 72, y: 140, width: 300, height: 180 };
  const onePng = png(300, 180, "rgb8", gradientPixels(300, 180));
  await drawRasterImage(p1, await embedRasterImage(doc, onePng, "png"), {
    x: one.x,
    y: 842 - one.y - one.height,
    width: one.width,
    height: one.height,
  });
  line(p1, texts[2]!, 72, 350, 12, f.regular);
  const two: Rect = { x: 72, y: 370, width: 240, height: 160 };
  const twoPng = png(240, 160, "rgb8", stripePixels(240, 160));
  await drawRasterImage(p1, await embedRasterImage(doc, twoPng, "png"), {
    x: two.x,
    y: 842 - two.y - two.height,
    width: two.width,
    height: two.height,
  });
  line(p1, texts[3]!, 72, 560, 12, f.regular);
  const p2 = doc.addPage([595, 842]);
  line(p2, texts[4]!, 72, 80, 20, f.bold);
  const three: Rect = { x: 72, y: 100, width: 120, height: 80 };
  await drawRasterImage(p2, await embedRasterImage(doc, JPEG_30X20, "jpg"), {
    x: three.x,
    y: 842 - three.y - three.height,
    width: three.width,
    height: three.height,
  });
  line(p2, texts[5]!, 72, 205, 12, f.regular);
  return {
    name: "captionedPicturesPdf",
    pdf: await doc.save(),
    firstPage: { width: 595, height: 842 },
    pictures: [
      {
        page: 1,
        shown: one,
        pixelWidth: 300,
        pixelHeight: 180,
        source: "png",
        file: { bytes: onePng, ext: "png" },
      },
      {
        page: 1,
        shown: two,
        pixelWidth: 240,
        pixelHeight: 160,
        source: "png",
        file: { bytes: twoPng, ext: "png" },
      },
      {
        page: 2,
        shown: three,
        pixelWidth: JPEG_WIDTH,
        pixelHeight: JPEG_HEIGHT,
        source: "jpeg",
        jpeg: JPEG_30X20,
        file: { bytes: JPEG_30X20, ext: "jpeg" },
      },
    ],
    sequence: [
      [texts[0]!, texts[1]!, "#1", texts[2]!, "#2", texts[3]!],
      [texts[4]!, "#3", texts[5]!],
    ],
  };
}

/**
 * Three pages, the middle one a scan with no text at all: its picture must
 * come through on its own page of the document, between the other two.
 */
export async function scanBetweenPagesPdf(): Promise<DocxFixture> {
  const texts = ["Before the scan", "After the scan"];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const p1 = doc.addPage([612, 792]);
  line(p1, texts[0]!, 72, 100, 14, f.regular);
  const p2 = doc.addPage([612, 792]);
  const W = 612;
  const H = 792;
  const scan = png(W, H, "gray8", scanPixels(W, H));
  await drawRasterImage(p2, await embedRasterImage(doc, scan, "png"), {
    x: 0,
    y: 0,
    width: 612,
    height: 792,
  });
  const p3 = doc.addPage([612, 792]);
  line(p3, texts[1]!, 72, 100, 14, f.regular);
  return {
    name: "scanBetweenPagesPdf",
    pdf: await doc.save(),
    firstPage: { width: 612, height: 792 },
    pictures: [
      {
        page: 2,
        shown: { x: 0, y: 0, width: 612, height: 792 },
        pixelWidth: W,
        pixelHeight: H,
        source: "png",
        file: { bytes: scan, ext: "png" },
      },
    ],
    sequence: [[texts[0]!], ["#1"], [texts[1]!]],
  };
}

/**
 * A US Letter page whose drawing is wider than a Word page's text (492 pt
 * against 468) AND over pdf.js's 64-megapixel per-image ceiling: 8,200 ×
 * 8,000 pixels, 1 bit a pixel, at 1,200 dpi. The .docx must carry it scaled
 * down to the text width, its pixels scaled down to the bilevel side limit.
 */
export async function wideDrawingPdf(): Promise<DocxFixture> {
  const texts = ["Site plan", "Drawing 4 of 9, scale 1:200"];
  const W = 8200;
  const H = 8000;
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const page = doc.addPage([612, 792]);
  line(page, texts[0]!, 60, 70, 18, f.bold);
  const shown: Rect = {
    x: 60,
    y: 90,
    width: (W / 1200) * 72,
    height: (H / 1200) * 72,
  };
  const ref = doc.context.register(
    doc.context.stream(deflateSync(drawingBits(W, H)), {
      Type: "XObject",
      Subtype: "Image",
      Width: W,
      Height: H,
      BitsPerComponent: 1,
      ColorSpace: "DeviceGray",
      Filter: "FlateDecode",
    }),
  );
  const name = page.node.newXObject("Im", ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      shown.width,
      0,
      0,
      shown.height,
      shown.x,
      792 - shown.y - shown.height,
    ),
    drawObject(name),
    popGraphicsState(),
  );
  line(page, texts[1]!, 60, shown.y + shown.height + 30, 12, f.regular);
  return {
    name: "wideDrawingPdf",
    pdf: await doc.save(),
    firstPage: { width: 612, height: 792 },
    pictures: [
      { page: 1, shown, pixelWidth: W, pixelHeight: H, source: "png" },
    ],
    sequence: [[texts[0]!, "#1", texts[1]!]],
  };
}

/**
 * A page whose crop box is 72 points in from its media box on the left and
 * the top: pdf.js measures from the crop box, poppler's `-bbox-layout` from
 * the media box. Read in the wrong frame, the picture lands 72 points too
 * high against the text, above the title.
 */
export async function croppedPagePdf(): Promise<DocxFixture> {
  const texts = ["Cropped page title", "The caption under the picture."];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const page = doc.addPage([612, 792]);
  // Crop box: x 72–540, y 144–720 (PDF space), so the displayed top is 720.
  page.setCropBox(72, 144, 468, 576);
  const top = 720;
  const left = 72;
  line(page, texts[0]!, left + 36, 50, 18, f.bold, top);
  const shown: Rect = { x: 36, y: 90, width: 260, height: 160 };
  const stripes = png(260, 160, "rgb8", stripePixels(260, 160));
  await drawRasterImage(page, await embedRasterImage(doc, stripes, "png"), {
    x: left + shown.x,
    y: top - shown.y - shown.height,
    width: shown.width,
    height: shown.height,
  });
  line(page, texts[1]!, left + 36, 285, 12, f.regular, top);
  return {
    name: "croppedPagePdf",
    pdf: await doc.save(),
    firstPage: { width: 468, height: 576 },
    pictures: [
      {
        page: 1,
        shown,
        pixelWidth: 260,
        pixelHeight: 160,
        source: "png",
        file: { bytes: stripes, ext: "png" },
      },
    ],
    sequence: [[texts[0]!, "#1", texts[1]!]],
  };
}

/** Every Word picture fixture, for the proofs that run them all. */
export const DOCX_PICTURE_FIXTURES = [
  captionedPicturesPdf,
  scanBetweenPagesPdf,
  wideDrawingPdf,
  croppedPagePdf,
  ocrdScanPdf,
  // The review of 2026-10-17: a box painted over a name, pictures pdf.js
  // merges into one op, a stencil, a JPEG with an orientation tag.
  coveredPicturePdf,
  repeatedPicturesPdf,
  inlineImagesPdf,
  stencilPicturePdf,
  exifJpegPdf,
  // Found on the owner's tutorial while painting covers in: a labelled
  // callout with a clear margin, and two look-alike screenshots.
  labelledCalloutPdf,
  twinScreenshotsPdf,
] as const;

/**
 * One US Letter page of four paragraphs: a heading in a bold face, an aside
 * in an italic one, a sentence in a regular face that ENDS in bold words
 * (two runs on one line), and a regular sentence. No picture. PDF to Word
 * keeps bold or italics only where a whole paragraph is set in them.
 */
export async function boldItalicPdf(): Promise<{
  pdf: Uint8Array;
  paragraph: { bold: string; italic: string; mixed: string; regular: string };
}> {
  const paragraph = {
    bold: "A heading set in bold",
    italic: "An aside set in italics",
    mixed: "Regular words with a bold ending",
    regular: "A plain closing sentence.",
  };
  const start = "Regular words with";
  const end = "a bold ending";
  const doc = await PDFDocument.create();
  const all = [...Object.values(paragraph), start, end];
  const regular = await embedDrawingFont(doc, all, "sans");
  const bold = await embedDrawingFont(doc, all, "sans-bold");
  const italic = await embedDrawingFont(doc, all, "serif-italic");
  const page = doc.addPage([612, 792]);
  line(page, paragraph.bold, 72, 90, 20, bold);
  line(page, paragraph.italic, 72, 150, 12, italic);
  line(page, start, 72, 210, 12, regular);
  line(
    page,
    end,
    72 + regular.widthOfTextAtSize(`${start} `, 12),
    210,
    12,
    bold,
  );
  line(page, paragraph.regular, 72, 270, 12, regular);
  return { pdf: await doc.save(), paragraph };
}

/**
 * A scanned page after OCR: the scan as one full-page picture, and the
 * recognised words over it in INVISIBLE text (render mode 3), as OCR PDF
 * leaves them. PDF to Word must give the scan as a picture, then its words.
 */
export async function ocrdScanPdf(): Promise<DocxFixture> {
  const texts = ["Recognised first line", "Recognised second line"];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const page = doc.addPage([612, 792]);
  const scan = png(612, 792, "gray8", scanPixels(612, 792));
  await drawRasterImage(page, await embedRasterImage(doc, scan, "png"), {
    x: 0,
    y: 0,
    width: 612,
    height: 792,
  });
  page.pushOperators(
    pushGraphicsState(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  );
  line(page, texts[0]!, 72, 100, 14, f.regular);
  line(page, texts[1]!, 72, 130, 14, f.regular);
  page.pushOperators(popGraphicsState());
  return {
    name: "ocrdScanPdf",
    pdf: await doc.save(),
    firstPage: { width: 612, height: 792 },
    pictures: [
      {
        page: 1,
        shown: { x: 0, y: 0, width: 612, height: 792 },
        pixelWidth: 612,
        pixelHeight: 792,
        source: "png",
        file: { bytes: scan, ext: "png" },
      },
    ],
    sequence: [["#1", texts[0]!, texts[1]!]],
  };
}

/* ------------------------------------------------------------------ *
 *  The review of 2026-10-17: what PDF to Word lost, and what it showed
 * ------------------------------------------------------------------ */

/** The magenta a covered fixture hides: exactly this RGB, nowhere else. */
export const HIDDEN_MAGENTA = [255, 0, 255] as const;

/**
 * A screenshot with a magenta block in it (80 × 50 px = 4,000 pixels), and a
 * WHITE BOX the page paints over that block afterwards — how an author hides
 * a name in a screenshot. The page never shows magenta. A .docx that carries
 * the screenshot's raw pixels shows all 4,000.
 */
export async function coveredPicturePdf(): Promise<
  DocxFixture & {
    hidden: { x: number; y: number; width: number; height: number };
  }
> {
  const texts = ["A screenshot with a name covered", "The caption under it."];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const page = doc.addPage([595, 842]);
  line(page, texts[0]!, 72, 80, 16, f.bold);
  const W = 300;
  const H = 200;
  const samples = gradientPixels(W, H);
  const hidden = { x: 100, y: 60, width: 80, height: 50 };
  for (let y = hidden.y; y < hidden.y + hidden.height; y++)
    for (let x = hidden.x; x < hidden.x + hidden.width; x++)
      samples.set(HIDDEN_MAGENTA, (y * W + x) * 3);
  const shot = png(W, H, "rgb8", samples);
  const shown: Rect = { x: 72, y: 120, width: W, height: H };
  await drawRasterImage(page, await embedRasterImage(doc, shot, "png"), {
    x: shown.x,
    y: 842 - shown.y - shown.height,
    width: W,
    height: H,
  });
  // One point per pixel, so the box covers the block exactly, and a point
  // more on every side.
  page.drawRectangle({
    x: shown.x + hidden.x - 1,
    y: 842 - (shown.y + hidden.y + hidden.height + 1),
    width: hidden.width + 2,
    height: hidden.height + 2,
    color: rgb(1, 1, 1),
  });
  line(page, texts[1]!, 72, 350, 12, f.regular);
  return {
    name: "coveredPicturePdf",
    pdf: await doc.save(),
    firstPage: { width: 595, height: 842 },
    pictures: [
      {
        page: 1,
        shown,
        pixelWidth: W,
        pixelHeight: H,
        source: "png",
        file: { bytes: shot, ext: "png" },
      },
    ],
    sequence: [[texts[0]!, "#1", texts[1]!]],
    hidden,
  };
}

/** Paint the XObject `name` into `at` (top-left frame) with q cm Do Q. */
function paintXObject(page: PDFPage, name: PDFName, at: Rect): void {
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      at.width,
      0,
      0,
      at.height,
      at.x,
      page.getHeight() - at.y - at.height,
    ),
    drawObject(name),
    popGraphicsState(),
  );
}

/**
 * One picture drawn FOUR times in a row at one size, then another picture
 * four times at another: 60 × 45 pt, then 120 × 90 pt. pdf.js merges three
 * or more back-to-back draws of one image at one scale into a single
 * `paintImageXObjectRepeat` (its first draw stays apart, behind a dependency
 * op), and PDF to Word's reading skipped that op with the drawing: 4 draws
 * gave 1 picture.
 */
export async function repeatedPicturesPdf(): Promise<DocxFixture> {
  const texts = [
    "Four small copies of one picture",
    "Four larger copies of another",
    "That is all.",
  ];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const page = doc.addPage([612, 792]);
  const small = png(64, 48, "rgb8", stripePixels(64, 48));
  const large = png(96, 72, "rgb8", gradientPixels(96, 72));
  const smallName = page.node.newXObject(
    "Rep",
    (await embedRasterImage(doc, small, "png")).ref,
  );
  const largeName = page.node.newXObject(
    "Rep",
    (await embedRasterImage(doc, large, "png")).ref,
  );
  line(page, texts[0]!, 40, 60, 14, f.bold);
  const pictures: DocxFixturePicture[] = [];
  const row = (
    name: PDFName,
    file: Uint8Array,
    w: number,
    h: number,
    y: number,
    px: [number, number],
  ) => {
    for (let k = 0; k < 4; k++) {
      const at: Rect = { x: 40 + k * (w + 10), y, width: w, height: h };
      paintXObject(page, name, at);
      pictures.push({
        page: 1,
        shown: at,
        pixelWidth: px[0],
        pixelHeight: px[1],
        source: "png",
        file: { bytes: file, ext: "png" },
      });
    }
  };
  row(smallName, small, 60, 45, 80, [64, 48]);
  line(page, texts[1]!, 40, 170, 14, f.bold);
  row(largeName, large, 120, 90, 190, [96, 72]);
  line(page, texts[2]!, 40, 320, 12, f.regular);
  return {
    name: "repeatedPicturesPdf",
    pdf: await doc.save(),
    firstPage: { width: 612, height: 792 },
    pictures,
    sequence: [
      [
        texts[0]!,
        "#1",
        "#2",
        "#3",
        "#4",
        texts[1]!,
        "#5",
        "#6",
        "#7",
        "#8",
        texts[2]!,
      ],
    ],
  };
}

/**
 * Twelve DISTINCT 8 × 8 pictures written INLINE in the content stream (BI
 * … ID … EI), in a row under a heading. pdf.js packs ten or more small
 * inline images in a row into one `paintInlineImageXObjectGroup`, which PDF
 * to Word's reading skipped: 12 gave 0.
 */
export async function inlineImagesPdf(): Promise<DocxFixture> {
  const texts = ["Twelve small inline pictures"];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const page = doc.addPage([612, 792]);
  line(page, texts[0]!, 40, 60, 14, f.bold);
  const pictures: DocxFixturePicture[] = [];
  const ops: string[] = [];
  const hex = (b: Uint8Array) =>
    [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
  for (let k = 0; k < 12; k++) {
    const px = new Uint8Array(8 * 8 * 3);
    for (let p = 0; p < 64; p++) {
      const on = ((p >> 3) + (p & 7) + k) % 3 === 0;
      px.set(
        on
          ? [(k * 20) % 256, 40 + k * 15, 200 - k * 12]
          : [240, 240 - k * 8, 30 + k * 10],
        p * 3,
      );
    }
    const at: Rect = { x: 40 + k * 40, y: 90, width: 30, height: 30 };
    ops.push(
      `q 30 0 0 30 ${at.x} ${792 - at.y - at.height} cm BI /W 8 /H 8 /CS /RGB /BPC 8 /F /AHx ID ${hex(px)}> EI Q`,
    );
    pictures.push({
      page: 1,
      shown: at,
      pixelWidth: 8,
      pixelHeight: 8,
      source: "png",
      file: { bytes: png(8, 8, "rgb8", px), ext: "png" },
    });
  }
  page.node.addContentStream(
    doc.context.register(
      doc.context.stream(new TextEncoder().encode(ops.join("\n"))),
    ),
  );
  return {
    name: "inlineImagesPdf",
    pdf: await doc.save(),
    firstPage: { width: 612, height: 792 },
    pictures,
    sequence: [[texts[0]!, ...pictures.map((_, k) => `#${k + 1}`)]],
  };
}

/** A 1-bit stencil (`/ImageMask true`): clear bits are painted. */
function stencilRef(
  doc: PDFDocument,
  w: number,
  h: number,
  bits: Uint8Array,
): PDFRef {
  return doc.context.register(
    doc.context.flateStream(bits, {
      Type: "XObject",
      Subtype: "Image",
      Width: w,
      Height: h,
      ImageMask: true,
      BitsPerComponent: 1,
    }),
  );
}

/** Scan-like stencil bits: bars where lines of type would be. */
export function stencilScanBits(w: number, h: number): Uint8Array {
  const rowBytes = (w + 7) >> 3;
  const bits = new Uint8Array(rowBytes * h).fill(0xff);
  for (let row = 0; row < 20; row++) {
    const top = Math.round(h * 0.1) + row * Math.round(h * 0.04);
    const bottom = top + Math.max(2, Math.round(h * 0.015));
    const right = w - Math.round(w * 0.1) - ((row * 31) % 90);
    for (let y = top; y < bottom && y < h; y++)
      for (let x = Math.round(w * 0.1); x < right; x++)
        if (x % 37 < 31) {
          const i = y * rowBytes + (x >> 3);
          bits[i] = bits[i]! & ~(0x80 >> (x & 7));
        }
  }
  return bits;
}

/**
 * A heading, then a STENCIL picture: a 1-bit `/ImageMask` painted in dark
 * blue — a one-colour picture, and how many scanners store a page. PDF to
 * Word's reading left stencils with the drawing, uncounted.
 */
export async function stencilPicturePdf(): Promise<DocxFixture> {
  const texts = ["A page with a stencil picture", "Its caption."];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const page = doc.addPage([612, 792]);
  line(page, texts[0]!, 72, 80, 16, f.bold);
  const W = 200;
  const H = 120;
  const name = page.node.newXObject(
    "Mask",
    stencilRef(doc, W, H, stencilScanBits(W, H)),
  );
  const shown: Rect = { x: 72, y: 110, width: 200, height: 120 };
  page.pushOperators(pushGraphicsState(), setFillingRgbColor(0.1, 0.15, 0.5));
  paintXObject(page, name, shown);
  page.pushOperators(popGraphicsState());
  line(page, texts[1]!, 72, 260, 12, f.regular);
  return {
    name: "stencilPicturePdf",
    pdf: await doc.save(),
    firstPage: { width: 612, height: 792 },
    pictures: [
      { page: 1, shown, pixelWidth: W, pixelHeight: H, source: "png" },
    ],
    sequence: [[texts[0]!, "#1", texts[1]!]],
  };
}

/**
 * Four pages for the note beside a Word download: (1) typed text, (2) a
 * picture whose data cannot be decoded and nothing else, (3) a stencil scan
 * and nothing else, (4) nothing at all. Only page 4 has "no picture"; the
 * note said it of pages 2 and 3 too.
 */
export async function notePagesPdf(): Promise<Uint8Array> {
  const sentence = "A page of typed text that has a full sentence on it.";
  const doc = await PDFDocument.create();
  const f = await fonts(doc, [sentence]);
  const p1 = doc.addPage([612, 792]);
  line(p1, sentence, 72, 100, 12, f.regular);
  const p2 = doc.addPage([612, 792]);
  const noise = new Uint8Array(4096);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + 13) & 0xff;
  const broken = doc.context.register(
    doc.context.stream(noise, {
      Type: "XObject",
      Subtype: "Image",
      Width: 320,
      Height: 200,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
      Filter: "DCTDecode",
    }),
  );
  paintXObject(p2, p2.node.newXObject("Bad", broken), {
    x: 100,
    y: 200,
    width: 320,
    height: 200,
  });
  const p3 = doc.addPage([612, 792]);
  const scan = stencilRef(doc, 612, 792, stencilScanBits(612, 792));
  p3.pushOperators(pushGraphicsState(), setFillingRgbColor(0.1, 0.1, 0.1));
  paintXObject(p3, p3.node.newXObject("Scan", scan), {
    x: 0,
    y: 0,
    width: 612,
    height: 792,
  });
  p3.pushOperators(popGraphicsState());
  doc.addPage([612, 792]);
  return doc.save();
}

/**
 * A plain JPEG carrying an EXIF Orientation of 6 ("turn me a quarter"),
 * painted RAW, as a PDF does: pdf.js and the PDF show its stored pixels,
 * 30 × 20. A .docx that passes it through with the tag lets any reader that
 * honours EXIF turn it.
 */
export async function exifJpegPdf(): Promise<DocxFixture> {
  const texts = ["A photograph with an orientation tag", "Its caption."];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const page = doc.addPage([612, 792]);
  line(page, texts[0]!, 72, 80, 16, f.bold);
  const ref = doc.context.register(
    doc.context.stream(JPEG_30X20_EXIF6, {
      Type: "XObject",
      Subtype: "Image",
      Width: JPEG_WIDTH,
      Height: JPEG_HEIGHT,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
      Filter: "DCTDecode",
    }),
  );
  const shown: Rect = { x: 72, y: 100, width: 150, height: 100 };
  paintXObject(page, page.node.newXObject("Exif", ref), shown);
  line(page, texts[1]!, 72, 230, 12, f.regular);
  return {
    name: "exifJpegPdf",
    pdf: await doc.save(),
    firstPage: { width: 612, height: 792 },
    pictures: [
      {
        page: 1,
        shown,
        pixelWidth: JPEG_WIDTH,
        pixelHeight: JPEG_HEIGHT,
        source: "jpeg",
        jpeg: JPEG_30X20_EXIF6,
      },
    ],
    sequence: [[texts[0]!, "#1", texts[1]!]],
  };
}

/**
 * A dark screenshot with a CALLOUT over it — a light green box inside a
 * fully transparent six-point margin (a PNG with alpha, as presentation
 * software exports one) — and a black label the page writes over the
 * callout AFTERWARDS. The page shows the label on the callout; the callout's
 * own pixels do not hold it, and through its margin the page shows the dark
 * screenshot. The owner's tutorial has three of these (2026-10-17).
 */
export async function labelledCalloutPdf(): Promise<
  DocxFixture & { label: string }
> {
  const label = "Click here";
  const texts = ["A screenshot with a callout on it", "The caption under it."];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, [...texts, label]);
  const page = doc.addPage([595, 842]);
  line(page, texts[0]!, 72, 80, 16, f.bold);
  const W = 300;
  const H = 200;
  const dark = new Uint8Array(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    const x = p % W;
    const v = 18 + ((x >> 3) % 2) * 10;
    dark.set([v, v + 2, v + 6], p * 3);
  }
  const shot = png(W, H, "rgb8", dark);
  const shotAt: Rect = { x: 72, y: 120, width: W, height: H };
  await drawRasterImage(page, await embedRasterImage(doc, shot, "png"), {
    x: shotAt.x,
    y: 842 - shotAt.y - H,
    width: W,
    height: H,
  });
  const CW = 160;
  const CH = 48;
  const M = 6;
  const callout = new Uint8Array(CW * CH * 4);
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++) {
      const inside = x >= M && x < CW - M && y >= M && y < CH - M;
      callout.set(
        inside ? [150, 215, 140, 255] : [0, 0, 0, 0],
        (y * CW + x) * 4,
      );
    }
  const calloutPng = encodePngImage(CW, CH, "rgba8", callout);
  const calloutAt: Rect = { x: 140, y: 200, width: CW, height: CH };
  await drawRasterImage(page, await embedRasterImage(doc, calloutPng, "png"), {
    x: calloutAt.x,
    y: 842 - calloutAt.y - CH,
    width: CW,
    height: CH,
  });
  line(page, label, calloutAt.x + 20, calloutAt.y + 31, 18, f.bold);
  line(page, texts[1]!, 72, 350, 12, f.regular);
  return {
    name: "labelledCalloutPdf",
    pdf: await doc.save(),
    firstPage: { width: 595, height: 842 },
    pictures: [
      {
        page: 1,
        shown: shotAt,
        pixelWidth: W,
        pixelHeight: H,
        source: "png",
        file: { bytes: shot, ext: "png" },
      },
      {
        page: 1,
        shown: calloutAt,
        pixelWidth: CW,
        pixelHeight: CH,
        source: "png",
        file: { bytes: calloutPng, ext: "png" },
      },
    ],
    // The callout starts above its label, so it comes first.
    sequence: [[texts[0]!, "#1", "#2", label, texts[1]!]],
    label,
  };
}

/**
 * Two pages, each a heading and ONE screenshot: the same pixels, shown at
 * 300 × 200 points on page 1 and at 300 × 180 on page 2 — two steps of a
 * tutorial that look alike. A matcher that goes by pixels alone cannot tell
 * them apart; their size and their page can.
 */
export async function twinScreenshotsPdf(): Promise<DocxFixture> {
  const texts = ["Step one", "Step two"];
  const doc = await PDFDocument.create();
  const f = await fonts(doc, texts);
  const W = 240;
  const H = 160;
  const shot = png(W, H, "rgb8", gradientPixels(W, H));
  const image = await embedRasterImage(doc, shot, "png");
  const pictures: DocxFixturePicture[] = [];
  [200, 180].forEach((height, k) => {
    const page = doc.addPage([595, 842]);
    line(page, texts[k]!, 72, 80, 16, f.bold);
    const shown: Rect = { x: 72, y: 110, width: 300, height };
    paintXObject(page, page.node.newXObject("Shot", image.ref), shown);
    pictures.push({
      page: k + 1,
      shown,
      pixelWidth: W,
      pixelHeight: H,
      source: "png",
      file: { bytes: shot, ext: "png" },
    });
  });
  return {
    name: "twinScreenshotsPdf",
    pdf: await doc.save(),
    firstPage: { width: 595, height: 842 },
    pictures,
    sequence: [
      [texts[0]!, "#1"],
      [texts[1]!, "#2"],
    ],
  };
}

/**
 * `pages` pages, each a heading and ONE picture of noise (`width` × `height`
 * pixels, RGB, which no PNG encoder can shrink much): a document whose
 * pictures, and not its text, decide how large its .docx is.
 */
export async function noisePagesPdf(
  pages: number,
  width = 400,
  height = 300,
): Promise<{ pdf: Uint8Array; headings: string[] }> {
  const headings = Array.from(
    { length: pages },
    (_, k) => `Photograph number ${k + 1} of the survey`,
  );
  const doc = await PDFDocument.create();
  const f = await fonts(doc, headings);
  let seed = 7;
  for (let k = 0; k < pages; k++) {
    const page = doc.addPage([612, 792]);
    line(page, headings[k]!, 72, 80, 16, f.bold);
    const samples = new Uint8Array(width * height * 3);
    for (let i = 0; i < samples.length; i++) {
      // Math.imul: a float product of two 32-bit numbers loses its low bits,
      // and the "noise" came out as a 3 KB pattern.
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      samples[i] = seed >>> 24;
    }
    await drawRasterImage(
      page,
      await embedRasterImage(doc, png(width, height, "rgb8", samples), "png"),
      { x: 72, y: 792 - 110 - 300, width: 400, height: 300 },
    );
  }
  return { pdf: await doc.save(), headings };
}

/**
 * One page with a heading and `count` tiny DISTINCT inline pictures (2 × 2
 * pixels each, in a grid of 3-point cells): a small PDF that paints more
 * pictures than one Word document should hold. The shape of the review's
 * 205 KB PDF that became a 22.3 MB .docx of 20,000 media parts.
 */
export async function manyPicturesPdf(count: number): Promise<Uint8Array> {
  const heading = "A page of very many small pictures";
  const doc = await PDFDocument.create();
  const f = await fonts(doc, [heading]);
  const page = doc.addPage([612, 792]);
  line(page, heading, 40, 40, 14, f.bold);
  const ops: string[] = [];
  const hex2 = (v: number) => v.toString(16).padStart(2, "0");
  const perRow = 170;
  for (let k = 0; k < count; k++) {
    const x = 20 + (k % perRow) * 3.4;
    const y = 792 - 60 - Math.floor(k / perRow) * 3.4 - 3;
    // Four pixels whose colours spell k: no two pictures are alike.
    const px = [k & 255, (k >> 8) & 255, 128, 255 - (k & 255)];
    const data = [...px, ...px.reverse(), ...px, 0, 0, 0, 9, 9, 9]
      .slice(0, 12)
      .map(hex2)
      .join("");
    ops.push(
      `q 3 0 0 3 ${x.toFixed(2)} ${y.toFixed(2)} cm BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID ${data}> EI Q`,
    );
  }
  page.node.addContentStream(
    doc.context.register(
      doc.context.stream(new TextEncoder().encode(ops.join("\n"))),
    ),
  );
  return doc.save();
}
