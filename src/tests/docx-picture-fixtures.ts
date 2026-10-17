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
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { encodePngImage } from "@/lib/workers/pdf-office-export/png-encode";
import { JPEG_30X20, JPEG_HEIGHT, JPEG_WIDTH } from "./jpeg-fixtures";
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
] as const;
