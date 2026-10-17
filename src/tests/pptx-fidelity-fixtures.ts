/**
 * Generated PDFs for PDF to PowerPoint's faithful export, each with what it
 * draws written down beside it — so a test can ask the DECK where a picture or
 * a line of text landed, and the round-trip instrument can ask the PIXELS.
 *
 * Built with pdf-lib from synthetic pixels and standard fonts. Nothing here is
 * derived from a user's document: the owner's sample (a 33-page tutorial) was
 * measured locally and stays out of the repository; these reproduce the SHAPES
 * it exercises — a large picture with a caption, vector arrows and boxes
 * painted OVER a picture, text painted UNDER one, a picture with transparency,
 * a page that is only a scan, pages of different sizes.
 *
 * Positions are recorded in the deck's frame: page points, origin at the TOP
 * left of the page as displayed (pdf-lib draws from the bottom left).
 */
import { deflateSync } from "node:zlib";
import {
  appendBezierCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  degrees,
  drawObject,
  endPath,
  moveTo,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setTextRenderingMode,
  TextRenderingMode,
  type PDFOperator,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { encodePngImage } from "@/lib/workers/pdf-office-export/png-encode";
import { JPEG_30X20, JPEG_HEIGHT, JPEG_WIDTH } from "./jpeg-fixtures";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FixtureText {
  text: string;
  /** Left of the first glyph, page points from the left edge. */
  x: number;
  /** Baseline, page points from the TOP edge. */
  baseline: number;
  size: number;
  bold: boolean;
  /** "RRGGBB" */
  color: string;
  /** Drawn with render mode 3: present, selectable, not shown. */
  invisible?: boolean;
  /**
   * Clockwise turn of the line as displayed, when it is not 0. `x` and
   * `baseline` are then the first glyph's origin in the displayed frame.
   */
  rotation?: number;
}

export interface FixtureImage {
  /** Where the picture shows on the page (after any clip). */
  shown: Rect;
  pixelWidth: number;
  pixelHeight: number;
  /** "jpeg" when the PDF holds a plain DCT stream the deck can copy. */
  source: "jpeg" | "png";
  alpha: boolean;
  /** Fractions of the source the page's clip hides, when it hides any. */
  crop?: { left: number; top: number; right: number; bottom: number };
}

export interface FixtureShape {
  /** The shape's own box, page points from the top left. */
  box: Rect;
  /** Painted after (over) every picture on the page that it overlaps. */
  overPicture: boolean;
}

export interface FixturePage {
  width: number;
  height: number;
  /** As the page is displayed (its /Rotate applied). */
  displayed: { width: number; height: number };
  texts: FixtureText[];
  images: FixtureImage[];
  shapes: FixtureShape[];
  /** Text painted BEFORE an opaque picture that covers it: hidden in the PDF. */
  hiddenTexts: FixtureText[];
}

export interface PptxFixture {
  name: string;
  pdf: Uint8Array;
  pages: FixturePage[];
}

/* ------------------------------------------------------------------ *
 *  Synthetic pixels
 * ------------------------------------------------------------------ */

/**
 * A picture with the structure of a screenshot: a soft background gradient,
 * a dark title bar, rows of "type" (short dark bars), a coloured panel and a
 * soft disc. Edges a few pixels wide, as an interface has: a picture that
 * moved, or went missing, changes many pixels, not a smooth few.
 */
export function gradientPixels(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  const cx = width * 0.7;
  const cy = height * 0.62;
  const r = Math.min(width, height) * 0.2;
  const set = (x: number, y: number, c: [number, number, number]) => {
    const p = (y * width + x) * 3;
    out[p] = c[0];
    out[p + 1] = c[1];
    out[p + 2] = c[2];
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const d = Math.hypot(x - cx, y - cy) / r;
      const disc = d < 1 ? (1 - d * d) * 0.8 : 0;
      set(x, y, [
        Math.round(225 - 40 * v * (1 - disc) - 120 * disc),
        Math.round(232 - 30 * u * (1 - disc) - 40 * disc),
        Math.round(240 - 20 * u * v * (1 - disc) + 10 * disc),
      ]);
    }
  const bar = Math.max(6, Math.round(height * 0.09));
  for (let y = 0; y < bar; y++)
    for (let x = 0; x < width; x++) set(x, y, [40, 55, 90]);
  const panel = [Math.round(width * 0.06), Math.round(height * 0.22)];
  const panelW = Math.round(width * 0.4);
  const panelH = Math.round(height * 0.62);
  for (let y = panel[1]!; y < panel[1]! + panelH && y < height; y++)
    for (let x = panel[0]!; x < panel[0]! + panelW && x < width; x++)
      set(x, y, [250, 250, 250]);
  const row = Math.max(3, Math.round(height * 0.02));
  for (let line = 0; line < 12; line++) {
    const top = panel[1]! + Math.round(row * 1.5) + line * row * 3;
    if (top + row >= panel[1]! + panelH) break;
    const len = Math.round(panelW * (0.55 + 0.35 * (((line * 7) % 5) / 4)));
    for (let y = top; y < top + row; y++)
      for (let x = panel[0]! + row * 2; x < panel[0]! + len; x++)
        if ((x - panel[0]!) % (row * 9) < row * 7) set(x, y, [55, 60, 70]);
  }
  return out;
}

/** A "scanned" page: grey paper with dark bars where lines of type would be. */
export function scanPixels(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  out.fill(236);
  const margin = Math.round(width * 0.11);
  for (let line = 0; line < 22; line++) {
    const top = Math.round(height * 0.1) + line * Math.round(height * 0.036);
    const length = width - 2 * margin - ((line * 37) % 160);
    for (let y = top; y < top + Math.round(height * 0.014); y++)
      for (let x = margin; x < margin + length; x++)
        if ((x - margin) % 47 < 41) out[y * width + x] = 38;
  }
  return out;
}

/** A badge with a transparent surround (needs PNG, and alpha, in the deck). */
export function badgePixels(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4;
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      out[p] = 20;
      out[p + 1] = 150;
      out[p + 2] = 60;
      out[p + 3] =
        d < 0.8 ? 255 : d < 0.95 ? Math.round(255 * (0.95 - d) * 6.6) : 0;
    }
  return out;
}

const png = (
  width: number,
  height: number,
  layout: "rgb8" | "gray8" | "rgba8",
  samples: Uint8Array,
) => encodePngImage(width, height, layout, samples);

/* ------------------------------------------------------------------ *
 *  Drawing helpers that record what they drew
 * ------------------------------------------------------------------ */

function hex(r: number, g: number, b: number): string {
  return [r, g, b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

function text(
  page: PDFPage,
  rec: FixtureText[],
  s: string,
  x: number,
  baseline: number,
  size: number,
  font: PDFFont,
  bold: boolean,
  color: [number, number, number] = [0, 0, 0],
): void {
  page.drawText(s, {
    x,
    y: page.getHeight() - baseline,
    size,
    font,
    color: rgb(...color),
  });
  rec.push({ text: s, x, baseline, size, bold, color: hex(...color) });
}

/**
 * Draw `img` into `at` (top-left frame). Through the repository's one raster
 * boundary (`@/lib/pdf/pdf-lib`), like every other PDF this codebase builds:
 * `raster-embedder-boundary.test.ts` and `raster-draw-boundary.test.ts` hold
 * fixture builders to it too.
 */
function image(page: PDFPage, img: PDFImage, at: Rect): Promise<void> {
  return drawRasterImage(page, img, {
    x: at.x,
    y: page.getHeight() - at.y - at.height,
    width: at.width,
    height: at.height,
  });
}

function box(
  page: PDFPage,
  at: Rect,
  color: [number, number, number],
  border?: [number, number, number],
): void {
  page.drawRectangle({
    x: at.x,
    y: page.getHeight() - at.y - at.height,
    width: at.width,
    height: at.height,
    color: rgb(...color),
    ...(border ? { borderColor: rgb(...border), borderWidth: 2 } : {}),
  });
}

function emptyPage(width: number, height: number): FixturePage {
  return {
    width,
    height,
    displayed: { width, height },
    texts: [],
    images: [],
    shapes: [],
    hiddenTexts: [],
  };
}

/**
 * The fixture's faces, from the one font chooser (`embedDrawingFont`), given
 * every string the fixture will draw: Latin text gets the standard faces,
 * which pdf-lib does not embed, as most real PDFs' do not.
 */
async function fonts(doc: PDFDocument, strings: readonly string[]) {
  return {
    regular: await embedDrawingFont(doc, strings, "sans"),
    bold: await embedDrawingFont(doc, strings, "sans-bold"),
  };
}

/* ------------------------------------------------------------------ *
 *  The fixtures
 * ------------------------------------------------------------------ */

/**
 * A 4:3 page in the shape of the owner's sample: a large picture under a
 * bold two-colour caption, a small JPEG the deck can copy byte for byte, and a
 * second picture shown through a clip (so only part of it shows).
 */
export async function imageCaptionPdf(): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, [
    "Open the portal",
    "and sign in",
    "Step 1 of 3: the home page",
  ]);
  const page = doc.addPage([720, 540]);
  const rec = emptyPage(720, 540);
  const W = 480;
  const H = 300;
  const photo = await embedRasterImage(
    doc,
    png(W, H, "rgb8", gradientPixels(W, H)),
    "png",
  );
  const shown: Rect = { x: 120, y: 120, width: W, height: H };
  await image(page, photo, shown);
  rec.images.push({
    shown,
    pixelWidth: W,
    pixelHeight: H,
    source: "png",
    alpha: false,
  });
  text(
    page,
    rec.texts,
    "Open the portal",
    60,
    70,
    30,
    f.bold,
    true,
    [0.88, 0.06, 0.06],
  );
  text(
    page,
    rec.texts,
    "and sign in",
    330,
    70,
    30,
    f.bold,
    true,
    [0, 0.43, 0.75],
  );
  text(
    page,
    rec.texts,
    "Step 1 of 3: the home page",
    120,
    470,
    18,
    f.regular,
    false,
  );
  const jpg = await embedRasterImage(doc, JPEG_30X20, "jpg");
  const thumb: Rect = { x: 620, y: 40, width: 60, height: 40 };
  await image(page, jpg, thumb);
  rec.images.push({
    shown: thumb,
    pixelWidth: JPEG_WIDTH,
    pixelHeight: JPEG_HEIGHT,
    source: "jpeg",
    alpha: false,
  });
  // The same picture again, through a clip that shows its left half only.
  const clipped: Rect = { x: 610, y: 440, width: 90, height: 60 };
  page.pushOperators(
    pushGraphicsState(),
    rectangle(clipped.x, 540 - clipped.y - clipped.height, 45, clipped.height),
    clip(),
    endPath(),
  );
  await image(page, photo, clipped);
  page.pushOperators(popGraphicsState());
  rec.images.push({
    shown: { ...clipped, width: 45 },
    pixelWidth: W,
    pixelHeight: H,
    source: "png",
    alpha: false,
    crop: { left: 0, top: 0, right: 0.5, bottom: 0 },
  });
  return { name: "imageCaptionPdf", pdf: await doc.save(), pages: [rec] };
}

/**
 * Vector art and no pictures at all: filled and outlined boxes, a rule, a
 * disc, an arrow, and labels over them.
 */
export async function vectorShapesPdf(): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, ["Quarterly plan", "Revenue", "Costs"]);
  const page = doc.addPage([720, 540]);
  const rec = emptyPage(720, 540);
  const shapes: [Rect, [number, number, number], [number, number, number]?][] =
    [
      [{ x: 60, y: 110, width: 260, height: 150 }, [0.95, 0.82, 0.25]],
      [
        { x: 380, y: 110, width: 280, height: 150 },
        [0.2, 0.45, 0.85],
        [0.05, 0.1, 0.3],
      ],
      [{ x: 60, y: 300, width: 600, height: 6 }, [0.15, 0.15, 0.15]],
    ];
  for (const [at, color, border] of shapes) {
    box(page, at, color, border);
    rec.shapes.push({ box: at, overPicture: false });
  }
  page.drawEllipse({
    x: 190,
    y: 540 - 410,
    xScale: 70,
    yScale: 50,
    color: rgb(0.85, 0.2, 0.3),
  });
  rec.shapes.push({
    box: { x: 120, y: 360, width: 140, height: 100 },
    overPicture: false,
  });
  page.drawSvgPath(
    "M 0 20 L 120 20 L 120 0 L 170 35 L 120 70 L 120 50 L 0 50 Z",
    {
      x: 420,
      y: 540 - 370,
      color: rgb(0.9, 0.1, 0.1),
    },
  );
  rec.shapes.push({
    box: { x: 420, y: 370, width: 170, height: 70 },
    overPicture: false,
  });
  text(
    page,
    rec.texts,
    "Quarterly plan",
    60,
    70,
    34,
    f.bold,
    true,
    [0.1, 0.1, 0.35],
  );
  text(page, rec.texts, "Revenue", 90, 195, 26, f.bold, true);
  text(page, rec.texts, "Costs", 410, 195, 26, f.bold, true, [1, 1, 1]);
  return { name: "vectorShapesPdf", pdf: await doc.save(), pages: [rec] };
}

/** A page that is one scanned picture and has no text at all. */
export async function scannedPdf(): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const rec = emptyPage(612, 792);
  const W = 612;
  const H = 792;
  const scan = await embedRasterImage(
    doc,
    png(W, H, "gray8", scanPixels(W, H)),
    "png",
  );
  const shown: Rect = { x: 0, y: 0, width: 612, height: 792 };
  await image(page, scan, shown);
  rec.images.push({
    shown,
    pixelWidth: W,
    pixelHeight: H,
    source: "png",
    alpha: false,
  });
  return { name: "scannedPdf", pdf: await doc.save(), pages: [rec] };
}

/**
 * Paint order that hides things: a line of text under an opaque picture, a
 * white box and a red frame painted OVER the picture, a transparent badge,
 * and an invisible text layer (render mode 3, what OCR adds over a scan).
 */
export async function paintOrderPdf(): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, [
    "PRIVATE NAME UNDER THE PICTURE",
    "Paint order",
    "searchable but not shown",
  ]);
  const page = doc.addPage([720, 540]);
  const rec = emptyPage(720, 540);
  // Painted first, then covered by the picture: hidden in the PDF.
  const hidden: FixtureText[] = [];
  text(
    page,
    hidden,
    "PRIVATE NAME UNDER THE PICTURE",
    140,
    260,
    16,
    f.bold,
    true,
  );
  rec.hiddenTexts.push(...hidden);
  const W = 520;
  const H = 320;
  const photo = await embedRasterImage(
    doc,
    png(W, H, "rgb8", gradientPixels(W, H)),
    "png",
  );
  const shown: Rect = { x: 100, y: 120, width: W, height: H };
  await image(page, photo, shown);
  rec.images.push({
    shown,
    pixelWidth: W,
    pixelHeight: H,
    source: "png",
    alpha: false,
  });
  // Painted after it: a white cover box and a red frame, both over the picture.
  const cover: Rect = { x: 300, y: 180, width: 180, height: 50 };
  box(page, cover, [1, 1, 1]);
  rec.shapes.push({ box: cover, overPicture: true });
  page.drawRectangle({
    x: 150,
    y: 540 - 400,
    width: 120,
    height: 60,
    borderColor: rgb(0.9, 0, 0),
    borderWidth: 3,
  });
  rec.shapes.push({
    box: { x: 150, y: 340, width: 120, height: 60 },
    overPicture: true,
  });
  const badge = await embedRasterImage(
    doc,
    png(96, 96, "rgba8", badgePixels(96)),
    "png",
  );
  const badgeAt: Rect = { x: 40, y: 30, width: 64, height: 64 };
  await image(page, badge, badgeAt);
  rec.images.push({
    shown: badgeAt,
    pixelWidth: 96,
    pixelHeight: 96,
    source: "png",
    alpha: true,
  });
  text(
    page,
    rec.texts,
    "Paint order",
    130,
    75,
    32,
    f.bold,
    true,
    [0.88, 0.06, 0.06],
  );
  // An invisible text layer, as OCR leaves over a scan.
  page.pushOperators(
    pushGraphicsState(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  );
  page.drawText("searchable but not shown", {
    x: 120,
    y: 540 - 480,
    size: 14,
    font: f.regular,
  });
  page.pushOperators(popGraphicsState());
  rec.texts.push({
    text: "searchable but not shown",
    x: 120,
    baseline: 480,
    size: 14,
    bold: false,
    color: "000000",
    invisible: true,
  });
  return { name: "paintOrderPdf", pdf: await doc.save(), pages: [rec] };
}

/**
 * How a deck can get ONE picture wrong while every other thing on the page
 * is right: the defects a fidelity bound must not license. Each is drawn the
 * way the round trip would show it — `crop15` as a slide picture whose
 * srcRect cuts 15% off its right side: the remaining 85% stretched over the
 * box.
 */
export type PictureAlteration = "move18pt" | "stretch10" | "crop15";

/**
 * Four pages, four shapes: 4:3 landscape (the deck takes its size from this
 * first page), A4 portrait, US Letter landscape, and a portrait page turned
 * by /Rotate 90 so it displays landscape.
 *
 * With `alter`, page `alter.page`'s picture is drawn wrong in that one way
 * and nothing else changes: the fidelity instrument's partial controls
 * (`fidelity.test.ts`). The record still describes the RIGHT page.
 */
export async function mixedSizesPdf(alter?: {
  page: number;
  kind: PictureAlteration;
}): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, [
    ...[1, 2, 3, 4].map((n) => `Page ${n} heading`),
    "A line of body text under the picture.",
  ]);
  const pages: FixturePage[] = [];
  const W = 240;
  const H = 160;
  const photo = await embedRasterImage(
    doc,
    png(W, H, "rgb8", gradientPixels(W, H)),
    "png",
  );
  const sizes: [number, number, number][] = [
    [720, 540, 0],
    [595, 842, 0],
    [792, 612, 0],
    [612, 792, 90],
  ];
  for (const [i, [w, h, rotate]] of sizes.entries()) {
    const page = doc.addPage([w, h]);
    const rec = emptyPage(w, h);
    if (rotate) {
      page.setRotation(degrees(rotate));
      rec.displayed = { width: h, height: w };
    }
    const band: Rect = { x: 40, y: 40, width: w - 80, height: 60 };
    box(page, band, [0.2, 0.55, 0.35]);
    const shown: Rect = { x: 60, y: 160, width: W, height: H };
    if (alter?.page === i + 1)
      await alteredImage(page, photo, shown, alter.kind);
    else await image(page, photo, shown);
    text(page, rec.texts, `Page ${i + 1} heading`, 60, 140, 26, f.bold, true);
    text(
      page,
      rec.texts,
      "A line of body text under the picture.",
      60,
      360,
      16,
      f.regular,
      false,
    );
    if (!rotate) {
      rec.shapes.push({ box: band, overPicture: false });
      rec.images.push({
        shown,
        pixelWidth: W,
        pixelHeight: H,
        source: "png",
        alpha: false,
      });
    } else {
      // Recorded in the DISPLAYED frame: /Rotate 90 turns the page clockwise,
      // so unrotated (x, y from the top) lands at (h - y - height, x).
      const turn = (r: Rect): Rect => ({
        x: h - r.y - r.height,
        y: r.x,
        width: r.height,
        height: r.width,
      });
      rec.shapes.push({ box: turn(band), overPicture: false });
      rec.images.push({
        shown: turn(shown),
        pixelWidth: W,
        pixelHeight: H,
        source: "png",
        alpha: false,
      });
      // Text on a turned page reads top to bottom; the structure tests ask
      // for its words, the round trip for its pixels.
      rec.texts = rec.texts.map((t) => ({
        ...t,
        x: h - t.baseline,
        baseline: t.x,
        rotation: 90,
      }));
    }
    pages.push(rec);
  }
  return { name: "mixedSizesPdf", pdf: await doc.save(), pages };
}

/**
 * A plain document: each page a list of lines of 18 pt Helvetica (an empty
 * list is a blank page), and, with `picture`, one picture on page 1. For
 * tests that need the real page reader over pages of known text — what the
 * copy guards hold the served page to — rather than one of the shapes above.
 */
export async function linesPdf(
  pages: readonly (readonly string[])[],
  { picture = false }: { picture?: boolean } = {},
): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, pages.flat());
  const recs: FixturePage[] = [];
  for (const [index, lines] of pages.entries()) {
    const page = doc.addPage([720, 540]);
    const rec = emptyPage(720, 540);
    lines.forEach((line, k) =>
      text(page, rec.texts, line, 72, 90 + k * 30, 18, f.regular, false),
    );
    if (picture && index === 0) {
      const W = 240;
      const H = 150;
      const photo = await embedRasterImage(
        doc,
        png(W, H, "rgb8", gradientPixels(W, H)),
        "png",
      );
      const shown: Rect = { x: 400, y: 300, width: W, height: H };
      await image(page, photo, shown);
      rec.images.push({
        shown,
        pixelWidth: W,
        pixelHeight: H,
        source: "png",
        alpha: false,
      });
    }
    recs.push(rec);
  }
  return { name: "linesPdf", pdf: await doc.save(), pages: recs };
}

/** `img` drawn into `at` the wrong way `kind` says (see PictureAlteration). */
async function alteredImage(
  page: PDFPage,
  img: PDFImage,
  at: Rect,
  kind: PictureAlteration,
): Promise<void> {
  if (kind === "move18pt") return image(page, img, { ...at, x: at.x + 18 });
  if (kind === "stretch10")
    return image(page, img, { ...at, width: at.width * 1.1 });
  page.pushOperators(
    pushGraphicsState(),
    rectangle(at.x, page.getHeight() - at.y - at.height, at.width, at.height),
    clip(),
    endPath(),
  );
  await image(page, img, { ...at, width: at.width / 0.85 });
  page.pushOperators(popGraphicsState());
}

/* ------------------------------------------------------------------ *
 *  Raw image XObjects: what `embedRasterImage` cannot make
 * ------------------------------------------------------------------ */

/**
 * An image XObject from raw samples deflated here: a 1-bit scan, a picture
 * larger than any PNG the boundary would take, or a stream that is not an
 * image at all. Drawn with {@link drawXObject}, which is operators, not
 * pdf-lib's `drawImage` (`raster-draw-boundary.test.ts` holds that one).
 */
function rawImageXObject(
  doc: PDFDocument,
  dict: Record<string, string | number>,
  contents: Uint8Array,
): PDFRef {
  return doc.context.register(
    doc.context.stream(contents, {
      Type: "XObject",
      Subtype: "Image",
      ...dict,
    }),
  );
}

/**
 * Paint XObject `ref` so its unit square fills `at` (top-left frame), turned
 * `turn` degrees clockwise about the box's centre, through `clipOps` (path
 * operators ending in a clip, in PDF space) when given.
 */
function drawXObject(
  page: PDFPage,
  ref: PDFRef,
  at: Rect,
  { turn = 0, clipOps = [] }: { turn?: number; clipOps?: PDFOperator[] } = {},
): void {
  const name = page.node.newXObject("Im", ref);
  const cx = at.x + at.width / 2;
  const cy = page.getHeight() - at.y - at.height / 2;
  const a = (-turn * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  page.pushOperators(
    pushGraphicsState(),
    ...clipOps,
    concatTransformationMatrix(1, 0, 0, 1, cx, cy),
    concatTransformationMatrix(c, s, -s, c, 0, 0),
    concatTransformationMatrix(
      at.width,
      0,
      0,
      at.height,
      -at.width / 2,
      -at.height / 2,
    ),
    drawObject(name),
    popGraphicsState(),
  );
}

/**
 * A bilevel engineering drawing: a grid, a filled block and a frame, as 1-bit
 * rows (a set bit is white, as /DeviceGray 1-bit reads by default).
 *
 * Its lines are about 3 pt wide on the page, not hairlines: both round-trip
 * routes downsample a picture when they write the deck back out as a PDF
 * (PowerPoint wrote this one's 3,600-px picture at 1,366 px), and a
 * hairline's grey then depends on the route's resampler rather than on the
 * deck — measured 2026-10-11, 0.99 "points out of place" for 0.5-pt lines on
 * a deck whose picture was right.
 */
export function drawingBits(width: number, height: number): Uint8Array {
  const rowBytes = (width + 7) >> 3;
  const out = new Uint8Array(rowBytes * height).fill(0xff);
  const step = Math.round(width / 10);
  const thick = Math.max(2, Math.round(width / 160));
  for (let y = 0; y < height; y++) {
    const onRow = y % step < thick || y >= height - thick;
    const blockRow = y > height * 0.35 && y < height * 0.6;
    for (let x = 0; x < width; x++) {
      const block = blockRow && x > width * 0.3 && x < width * 0.55;
      if (onRow || x % step < thick || x >= width - thick || block) {
        const i = y * rowBytes + (x >> 3);
        out[i] = out[i]! & ~(0x80 >> (x & 7));
      }
    }
  }
  return out;
}

/**
 * A scanned drawing whose ONE picture is over 64 megapixels: 8,200 × 8,000
 * pixels at 1,200 dpi, 1 bit a pixel (8.2 MB as pdf.js holds it). pdf.js's
 * old per-image ceiling (64,000,000 px) removed it without a word, and the
 * deck was a blank slide said to have "nothing on it". No text.
 */
export async function oversizeScanPdf(): Promise<PptxFixture> {
  const W = 8200;
  const H = 8000;
  const doc = await PDFDocument.create();
  const wPt = (W / 1200) * 72;
  const hPt = (H / 1200) * 72;
  const page = doc.addPage([wPt, hPt]);
  const rec = emptyPage(wPt, hPt);
  const ref = rawImageXObject(
    doc,
    {
      Width: W,
      Height: H,
      BitsPerComponent: 1,
      ColorSpace: "DeviceGray",
      Filter: "FlateDecode",
    },
    deflateSync(drawingBits(W, H)),
  );
  const shown: Rect = { x: 0, y: 0, width: wPt, height: hPt };
  drawXObject(page, ref, shown);
  rec.images.push({
    shown,
    pixelWidth: W,
    pixelHeight: H,
    source: "png",
    alpha: false,
  });
  return { name: "oversizeScanPdf", pdf: await doc.save(), pages: [rec] };
}

/** Closed circle path operators (four Béziers), PDF space. */
function circleOps(cx: number, cy: number, r: number): PDFOperator[] {
  const k = 0.5523 * r;
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
    appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
    appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
    appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
    closePath(),
  ];
}

/** Where a clip lets a picture show, page points from the top left. */
export type FixtureClip =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "rect"; box: Rect };

export interface ClippedPicturePage extends FixturePage {
  /** The picture's whole box before the clip, and its clockwise turn. */
  photo: { box: Rect; turn: number; pixelWidth: number; pixelHeight: number };
  clip: FixtureClip;
}

/** The photo the clip fixtures show, so a test can know its pixels. */
export const CLIP_PHOTO_SIDE = 600;

/**
 * A profile photo: a square picture shown through a CIRCLE, as a page lays
 * out a person's portrait. The corners are hidden by the PDF, and a deck
 * that places the whole square shows them.
 */
export async function circleClipPdf(): Promise<
  Omit<PptxFixture, "pages"> & { pages: ClippedPicturePage[] }
> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, ["Our team"]);
  const page = doc.addPage([720, 540]);
  const ref = rawImageXObject(
    doc,
    {
      Width: CLIP_PHOTO_SIDE,
      Height: CLIP_PHOTO_SIDE,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
      Filter: "FlateDecode",
    },
    deflateSync(gradientPixels(CLIP_PHOTO_SIDE, CLIP_PHOTO_SIDE)),
  );
  const photo: Rect = { x: 210, y: 120, width: 300, height: 300 };
  const circle = { cx: 360, cy: 270, r: 130 };
  drawXObject(page, ref, photo, {
    clipOps: [
      ...circleOps(circle.cx, 540 - circle.cy, circle.r),
      clip(),
      endPath(),
    ],
  });
  const rec: ClippedPicturePage = {
    ...emptyPage(720, 540),
    photo: {
      box: photo,
      turn: 0,
      pixelWidth: CLIP_PHOTO_SIDE,
      pixelHeight: CLIP_PHOTO_SIDE,
    },
    clip: { kind: "circle", ...circle },
  };
  text(page, rec.texts, "Our team", 60, 70, 30, f.bold, true, [0.1, 0.1, 0.3]);
  return { name: "circleClipPdf", pdf: await doc.save(), pages: [rec] };
}

/**
 * A photo turned 20° and shown through an upright square frame, the frame
 * stroked over it, a title above: the turned photo's corners overhang the
 * frame, and the PDF hides them.
 */
export async function rotatedFramePdf(): Promise<
  Omit<PptxFixture, "pages"> & { pages: ClippedPicturePage[] }
> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, ["A photo in a frame"]);
  const page = doc.addPage([720, 540]);
  const ref = rawImageXObject(
    doc,
    {
      Width: CLIP_PHOTO_SIDE,
      Height: CLIP_PHOTO_SIDE,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
      Filter: "FlateDecode",
    },
    deflateSync(gradientPixels(CLIP_PHOTO_SIDE, CLIP_PHOTO_SIDE)),
  );
  const frame: Rect = { x: 220, y: 140, width: 280, height: 280 };
  const photo: Rect = { x: 190, y: 110, width: 340, height: 340 };
  drawXObject(page, ref, photo, {
    turn: 20,
    clipOps: [
      rectangle(
        frame.x,
        540 - frame.y - frame.height,
        frame.width,
        frame.height,
      ),
      clip(),
      endPath(),
    ],
  });
  page.drawRectangle({
    x: frame.x,
    y: 540 - frame.y - frame.height,
    width: frame.width,
    height: frame.height,
    borderColor: rgb(0.1, 0.1, 0.1),
    borderWidth: 3,
  });
  const rec: ClippedPicturePage = {
    ...emptyPage(720, 540),
    photo: {
      box: photo,
      turn: 20,
      pixelWidth: CLIP_PHOTO_SIDE,
      pixelHeight: CLIP_PHOTO_SIDE,
    },
    clip: { kind: "rect", box: frame },
  };
  rec.shapes.push({ box: frame, overPicture: true });
  text(
    page,
    rec.texts,
    "A photo in a frame",
    60,
    70,
    30,
    f.bold,
    true,
    [0.1, 0.1, 0.3],
  );
  return { name: "rotatedFramePdf", pdf: await doc.save(), pages: [rec] };
}

/** Every fixture, for tests that sweep them all. */
export const PPTX_FIDELITY_FIXTURES = [
  imageCaptionPdf,
  vectorShapesPdf,
  scannedPdf,
  paintOrderPdf,
  mixedSizesPdf,
  oversizeScanPdf,
  circleClipPdf,
  rotatedFramePdf,
] as const;

/* ------------------------------------------------------------------ *
 *  Fixtures for what a page costs, not how it looks
 * ------------------------------------------------------------------ */

/**
 * Three pages: a typed one, one whose only content is a picture whose data
 * is not an image (a DCT stream of noise, which pdf.js cannot decode and
 * resolves to nothing), and a blank one. Before 2026-10-11 the panel said
 * the middle page had "nothing on it", like the blank one.
 */
export async function undecodablePicturePdf(): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, ["The report"]);
  const typed = doc.addPage([720, 540]);
  const rec1 = emptyPage(720, 540);
  text(typed, rec1.texts, "The report", 60, 80, 28, f.bold, true);
  const page = doc.addPage([720, 540]);
  const noise = new Uint8Array(4096);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + 13) & 0xff;
  const ref = rawImageXObject(
    doc,
    {
      Width: 320,
      Height: 200,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
      Filter: "DCTDecode",
    },
    noise,
  );
  drawXObject(page, ref, { x: 200, y: 170, width: 320, height: 200 });
  doc.addPage([720, 540]);
  return {
    name: "undecodablePicturePdf",
    pdf: await doc.save(),
    pages: [rec1, emptyPage(720, 540), emptyPage(720, 540)],
  };
}

let flatSamples: { side: number; bytes: Uint8Array } | null = null;

/**
 * One page with `count` DISTINCT `side` × `side` RGB photos of one flat
 * colour, each drawn small, and a caption. Flate packs each into a few
 * hundred kilobytes, and pdf.js decodes each to `side² × 3` bytes: six at
 * 8,000 px are a 2 MB upload and over a gigabyte of pixels on one page.
 */
export async function bigPhotosPdf(
  count: number,
  side = 8000,
): Promise<PptxFixture> {
  if (!flatSamples || flatSamples.side !== side)
    flatSamples = {
      side,
      bytes: deflateSync(Buffer.alloc(side * side * 3, 0xc8), { level: 9 }),
    };
  const doc = await PDFDocument.create();
  const f = await fonts(doc, ["Six photos"]);
  const page = doc.addPage([720, 540]);
  const rec = emptyPage(720, 540);
  for (let i = 0; i < count; i++) {
    const ref = rawImageXObject(
      doc,
      {
        Width: side,
        Height: side,
        BitsPerComponent: 8,
        ColorSpace: "DeviceRGB",
        Filter: "FlateDecode",
      },
      flatSamples.bytes,
    );
    const at: Rect = {
      x: 40 + (i % 3) * 220,
      y: 120 + Math.floor(i / 3) * 200,
      width: 180,
      height: 180,
    };
    drawXObject(page, ref, at);
    rec.images.push({
      shown: at,
      pixelWidth: side,
      pixelHeight: side,
      source: "png",
      alpha: false,
    });
  }
  text(page, rec.texts, "Six photos", 60, 70, 28, f.bold, true);
  return { name: "bigPhotosPdf", pdf: await doc.save(), pages: [rec] };
}

/**
 * A grid of `cells` cells, each a number and THEN its border, as some report
 * generators paint a table: every border overlaps the text painted before
 * it, so keeping paint order takes a layer per cell. 1,440 such cells took
 * 17 s on one page before layers were capped. The record holds the first
 * three cells' text.
 */
export async function cellGridPdf(cells: number): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc, ["0123456789"]);
  const cols = Math.ceil(Math.sqrt(cells * 1.5));
  const rows = Math.ceil(cells / cols);
  const cw = 40;
  const ch = 18;
  const width = cols * cw + 80;
  const height = rows * ch + 80;
  const page = doc.addPage([width, height]);
  const rec = emptyPage(width, height);
  for (let k = 0; k < cells; k++) {
    const x = 40 + (k % cols) * cw;
    const y = 40 + Math.floor(k / cols) * ch;
    const label = String((k * 37) % 1000);
    page.drawText(label, {
      x: x + 4,
      y: height - y - 13,
      size: 10,
      font: f.regular,
    });
    page.drawRectangle({
      x,
      y: height - y - ch,
      width: cw,
      height: ch,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1,
    });
    if (k < 3)
      rec.texts.push({
        text: label,
        x: x + 4,
        baseline: y + 13,
        size: 10,
        bold: false,
        color: "000000",
      });
  }
  return { name: "cellGridPdf", pdf: await doc.save(), pages: [rec] };
}

/** Paint the XObject `name` (in the page's resources) so it fills `at`. */
function drawNamed(page: PDFPage, name: string, at: Rect): void {
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
 * Hang every page of `doc` off ONE /Resources dictionary, as some generators
 * write a document: every font the pages already use, and `xobjects` by
 * name. Call it after the pages' text is drawn (pdf-lib gives each page its
 * own dictionary as it draws) and before their XObjects are painted.
 */
function shareResources(
  doc: PDFDocument,
  pages: readonly PDFPage[],
  xobjects: ReadonlyMap<string, PDFRef>,
): void {
  const fontsDict = doc.context.obj({});
  for (const p of pages) {
    const own = p.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
    for (const [k, v] of own?.entries() ?? []) fontsDict.set(k, v);
  }
  const xobjectDict = doc.context.obj({});
  for (const [name, ref] of xobjects) xobjectDict.set(PDFName.of(name), ref);
  const shared = doc.context.register(
    doc.context.obj({ Font: fontsDict, XObject: xobjectDict }),
  );
  for (const p of pages) p.node.set(PDFName.of("Resources"), shared);
}

const flatPhotos = new Map<string, Uint8Array>();

/**
 * `count` pages under ONE /Resources dictionary that names every page's
 * photo; each page paints its own `width` × `height` RGB photo, one flat
 * colour per page (`colours[i]`, so a slide showing another page's photo is
 * caught), under a caption. Every page DECLARES all `count` photos and
 * DECODES one: a reader that cannot read the pages' content, and charges
 * each page for what the dictionary declares, charges it for the book.
 *
 * Built for the encrypted owner-password files whose pages the page reader
 * cannot read ahead (see `./encrypted-pdf`): until 2026-10-11 such a file
 * lost every photo to the decode budget, and its note blamed their size.
 */
export async function sharedPhotosPdf(
  count = 6,
  width = 4000,
  height = 3000,
): Promise<PptxFixture & { colours: [number, number, number][] }> {
  const doc = await PDFDocument.create();
  const captions = Array.from(
    { length: count },
    (_, i) => `Photo ${i + 1} of ${count}`,
  );
  const f = await fonts(doc, captions);
  const pages: PDFPage[] = [];
  const recs: FixturePage[] = [];
  const colours: [number, number, number][] = [];
  const xobjects = new Map<string, PDFRef>();
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([720, 540]);
    const rec = emptyPage(720, 540);
    text(page, rec.texts, captions[i]!, 60, 60, 24, f.bold, true);
    const colour: [number, number, number] = [
      (40 + 37 * i) & 0xff,
      (200 - 29 * i) & 0xff,
      (90 + 53 * i) & 0xff,
    ];
    const key = `${width}x${height}:${colour.join(",")}`;
    let packed = flatPhotos.get(key);
    if (!packed) {
      const raw = Buffer.alloc(width * height * 3);
      for (let p = 0; p < raw.length; p += 3) {
        raw[p] = colour[0];
        raw[p + 1] = colour[1];
        raw[p + 2] = colour[2];
      }
      packed = deflateSync(raw, { level: 1 });
      flatPhotos.set(key, packed);
    }
    xobjects.set(
      `Photo${i + 1}`,
      rawImageXObject(
        doc,
        {
          Width: width,
          Height: height,
          BitsPerComponent: 8,
          ColorSpace: "DeviceRGB",
          Filter: "FlateDecode",
        },
        packed,
      ),
    );
    pages.push(page);
    recs.push(rec);
    colours.push(colour);
  }
  shareResources(doc, pages, xobjects);
  pages.forEach((page, i) => {
    const shown: Rect = { x: 120, y: 100, width: 480, height: 360 };
    drawNamed(page, `Photo${i + 1}`, shown);
    recs[i]!.images.push({
      shown,
      pixelWidth: width,
      pixelHeight: height,
      source: "png",
      alpha: false,
    });
  });
  return {
    name: "sharedPhotosPdf",
    pdf: await doc.save({ useObjectStreams: false }),
    pages: recs,
    colours,
  };
}

/**
 * Two pages under ONE /Resources dictionary that declares two RGB pictures
 * 8,000 px wide: one of exactly `pixels` pixels, one a row taller. Page 1
 * paints the first, page 2 the second, and nothing else is on either page.
 * Their data is DCT noise, so no pixels are ever held: a picture pdf.js
 * tries to decode fails at once (it counts as undecodable), and one over
 * pdf.js's ceiling is removed before it is read. So the pair shows, from
 * both sides of `pixels`, which pictures the result can still name.
 */
export async function ceilingPairPdf(pixels: number): Promise<PptxFixture> {
  const W = 8000;
  if (!Number.isInteger(pixels / W) || pixels <= 0)
    throw new Error(`ceilingPairPdf: ${pixels} is not a whole number of rows`);
  const doc = await PDFDocument.create();
  const noise = new Uint8Array(4096);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + 13) & 0xff;
  const pages = [doc.addPage([720, 540]), doc.addPage([720, 540])];
  const recs = [emptyPage(720, 540), emptyPage(720, 540)];
  const xobjects = new Map<string, PDFRef>();
  [pixels / W, pixels / W + 1].forEach((h, i) =>
    xobjects.set(
      `Pic${i + 1}`,
      rawImageXObject(
        doc,
        {
          Width: W,
          Height: h,
          BitsPerComponent: 8,
          ColorSpace: "DeviceRGB",
          Filter: "DCTDecode",
        },
        noise,
      ),
    ),
  );
  shareResources(doc, pages, xobjects);
  pages.forEach((page, i) => {
    const shown: Rect = { x: 160, y: 120, width: 400, height: 300 };
    drawNamed(page, `Pic${i + 1}`, shown);
    recs[i]!.images.push({
      shown,
      pixelWidth: W,
      pixelHeight: pixels / W + i,
      source: "jpeg",
      alpha: false,
    });
  });
  return {
    name: "ceilingPairPdf",
    pdf: await doc.save({ useObjectStreams: false }),
    pages: recs,
  };
}

/**
 * `pdf` with the zlib checksum of every page's content stream broken (its
 * last byte flipped): the shape of a damaged file, and of a hostile one.
 * pdf.js ignores the checksum and draws the page exactly as before; the page
 * reader's inflate refuses the stream, so it cannot know what the page
 * paints before pdf.js decodes it (`exact: false` in `./page-inventory`).
 * Callers check the first half against pdf.js themselves.
 *
 * Built for the second re-review of 2026-10-11: such a page was given no
 * decode bound at all, and one page of six 8000² photos decoded 2.2 GB in a
 * file that was not even encrypted.
 */
export async function damageContentStreams(
  pdf: Uint8Array,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  let damaged = 0;
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of("Contents"));
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of refs) {
      if (!(ref instanceof PDFRef)) continue;
      const stream = doc.context.lookup(ref);
      if (
        !(stream instanceof PDFRawStream) ||
        stream.dict.lookup(PDFName.of("Filter")) !== PDFName.of("FlateDecode")
      )
        continue;
      const bytes = stream.contents.slice();
      bytes[bytes.length - 1]! ^= 0xff;
      doc.context.assign(ref, PDFRawStream.of(stream.dict, bytes));
      damaged++;
    }
  }
  // Health: a fixture with nothing damaged is the undamaged file.
  if (damaged === 0) throw new Error("damageContentStreams: nothing to damage");
  return doc.save({ useObjectStreams: false });
}

/**
 * What makes pdf-lib refuse a file pdf.js still reads: an object after
 * `%%EOF` that never reaches `endobj`. pdf-lib parses the body front to back
 * and throws at the end; pdf.js finds the cross-reference table from the
 * file's end and never looks at the tail. Twenty-five bytes.
 */
export const UNTERMINATED_TAIL = "\n999 0 obj\n<< /Type /Junk\n";

/**
 * `pdf` with {@link UNTERMINATED_TAIL} appended: a damaged file pdf-lib cannot
 * load at all. Found by the second re-review of 2026-10-11, when the page
 * scan met such a file with no decode bound and one page of six 8000² photos
 * decoded 2.2 GB. Callers check both halves (pdf-lib refuses, pdf.js reads).
 */
export function junkAfterEofPdf(pdf: Uint8Array): Uint8Array {
  const tail = new TextEncoder().encode(UNTERMINATED_TAIL);
  const out = new Uint8Array(pdf.length + tail.length);
  out.set(pdf);
  out.set(tail, pdf.length);
  return out;
}

/**
 * A stand-in for qpdf's rewrite of exactly the damage
 * {@link junkAfterEofPdf} does: the file up to its last `%%EOF`. Null when
 * there is none — the stand-in, like qpdf, cannot rebuild every file. For
 * tests where qpdf is not installed; the worker image's proof
 * (`pnpm worker:pptx-fidelity-proof`) runs the real one.
 */
export async function repairStandIn(
  pdf: Uint8Array,
): Promise<Uint8Array | null> {
  const text = new TextDecoder("latin1").decode(pdf);
  const at = text.lastIndexOf("%%EOF");
  return at < 0 ? null : pdf.slice(0, at + "%%EOF".length + 1);
}

/**
 * `pdf` with its LAST page dictionary's `/Type /Page` blanked out (the same
 * byte count, spaces): pdf-lib walks the page tree and skips a kid that is
 * not typed a page, while pdf.js takes an untyped kid with no /Kids for a
 * page and opens it. So pdf.js reads one page more than the page inventory
 * knows — the page tree of a damaged file, and on 2026-10-11 a page the scan
 * would have decoded with no bound. Callers check both counts.
 */
export async function typelessLastPagePdf(
  pdf: Uint8Array,
): Promise<Uint8Array> {
  // Every object in the clear first: a page dictionary packed into an object
  // stream has no bytes here to blank.
  const classic = await (
    await PDFDocument.load(pdf, { updateMetadata: false })
  ).save({ useObjectStreams: false });
  const text = new TextDecoder("latin1").decode(classic);
  const re = /\/Type\s*\/Page(?![s\w])/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) last = m;
  if (!last) throw new Error("typelessLastPagePdf: no page dictionary found");
  const out = classic.slice();
  out.fill(0x20, last.index, last.index + last[0].length);
  return out;
}

/**
 * What `pdftotext -layout` would say about a fixture, for tests that run the
 * engine where poppler is not installed: the page count, and each page's
 * VISIBLE and invisible text, one line per drawn string. The engine reads it
 * only to classify a refusal and to cross-check the page count.
 */
export function pdftotextStandIn(fixture: PptxFixture) {
  const pages = fixture.pages.map((p, i) => {
    const t = [...p.texts, ...p.hiddenTexts].map((x) => x.text).join("\n");
    return { pageNumber: i + 1, text: t, characterCount: t.length };
  });
  const all = pages.map((p) => p.text).join("\n\n");
  return {
    pageCount: pages.length,
    pages,
    text: all,
    characterCount: all.length,
    hasText: all.trim().length > 0,
  };
}
