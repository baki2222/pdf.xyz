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
import {
  clip,
  degrees,
  endPath,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setTextRenderingMode,
  StandardFonts,
  TextRenderingMode,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
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

function image(page: PDFPage, img: PDFImage, at: Rect): void {
  page.drawImage(img, {
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

async function fonts(doc: PDFDocument) {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
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
  const f = await fonts(doc);
  const page = doc.addPage([720, 540]);
  const rec = emptyPage(720, 540);
  const W = 480;
  const H = 300;
  const photo = await doc.embedPng(png(W, H, "rgb8", gradientPixels(W, H)));
  const shown: Rect = { x: 120, y: 120, width: W, height: H };
  image(page, photo, shown);
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
  const jpg = await doc.embedJpg(JPEG_30X20);
  const thumb: Rect = { x: 620, y: 40, width: 60, height: 40 };
  image(page, jpg, thumb);
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
  image(page, photo, clipped);
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
  const f = await fonts(doc);
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
  const scan = await doc.embedPng(png(W, H, "gray8", scanPixels(W, H)));
  const shown: Rect = { x: 0, y: 0, width: 612, height: 792 };
  image(page, scan, shown);
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
  const f = await fonts(doc);
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
  const photo = await doc.embedPng(png(W, H, "rgb8", gradientPixels(W, H)));
  const shown: Rect = { x: 100, y: 120, width: W, height: H };
  image(page, photo, shown);
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
  const badge = await doc.embedPng(png(96, 96, "rgba8", badgePixels(96)));
  const badgeAt: Rect = { x: 40, y: 30, width: 64, height: 64 };
  image(page, badge, badgeAt);
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
 * Four pages, four shapes: 4:3 landscape (the deck takes its size from this
 * first page), A4 portrait, US Letter landscape, and a portrait page turned
 * by /Rotate 90 so it displays landscape.
 */
export async function mixedSizesPdf(): Promise<PptxFixture> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc);
  const pages: FixturePage[] = [];
  const W = 240;
  const H = 160;
  const photo = await doc.embedPng(png(W, H, "rgb8", gradientPixels(W, H)));
  const sizes: [number, number, number][] = [
    [720, 540, 0],
    [595, 842, 0],
    [792, 612, 0],
    [612, 792, 90],
  ];
  sizes.forEach(([w, h, rotate], i) => {
    const page = doc.addPage([w, h]);
    const rec = emptyPage(w, h);
    if (rotate) {
      page.setRotation(degrees(rotate));
      rec.displayed = { width: h, height: w };
    }
    const band: Rect = { x: 40, y: 40, width: w - 80, height: 60 };
    box(page, band, [0.2, 0.55, 0.35]);
    const shown: Rect = { x: 60, y: 160, width: W, height: H };
    image(page, photo, shown);
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
  });
  return { name: "mixedSizesPdf", pdf: await doc.save(), pages };
}

/** Every fixture, for tests that sweep them all. */
export const PPTX_FIDELITY_FIXTURES = [
  imageCaptionPdf,
  vectorShapesPdf,
  scannedPdf,
  paintOrderPdf,
  mixedSizesPdf,
] as const;

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
