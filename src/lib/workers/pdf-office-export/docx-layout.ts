/**
 * Where each picture of a page goes among the page's paragraphs, for PDF to
 * Word: the reading-order paragraphs poppler gives (`../pdf-text/flow`) and
 * the pictures the page reader finds (`./page-scan`, pictures only), merged
 * into one sequence per page.
 *
 * ── THE RULE, and why it does not move the text ─────────────────────────────
 *
 * The text keeps poppler's reading order exactly; pictures are inserted into
 * it, never the other way round. A picture taking part in the column cut
 * would change the TEXT's order: a figure across both columns of a page
 * removes the gutter that lets the page be read a column at a time, and the
 * left column's sentence would then continue in the right column. So for
 * each picture, by the paragraphs' bounds:
 *
 *  1. before the first paragraph, in reading order, that starts at or below
 *     the picture's top and overlaps it across the page — the text under it,
 *     in its own column (a label printed ON a screenshot counts: it follows
 *     the screenshot);
 *  2. else after the last such paragraph above it — a picture at the foot of
 *     its column;
 *  3. else (no paragraph shares its column — a picture in a margin, beside a
 *     title) before the first paragraph that starts at or below its top;
 *  4. else at the end of the page.
 *
 * Pictures that land at the same place keep the page's order: top to
 * bottom, then left to right. A page with no paragraphs (a scan) holds its
 * pictures in that order. Where the paragraphs carry no bounds (a reading
 * built by hand, not from a layout), every picture goes after the page's
 * text: a stated fallback, not a guess.
 *
 * ── THE FRAME ───────────────────────────────────────────────────────────────
 *
 * The page reader's boxes are pdf.js's: the crop box, as displayed. poppler's
 * are the media box's. Each picture's box is mapped through the page's
 * `mediaFrame` (`./page-inventory`, `mediaFrames`) before it is compared, so
 * a page whose crop box is inset from its media box (a scanned book page, a
 * trimmed print file) does not put its pictures a margin too high.
 *
 * ── SIZE ────────────────────────────────────────────────────────────────────
 *
 * Each picture keeps the size the page shows it at, unless that is wider or
 * taller than the Word page's text area ({@link docxPageOf}), in which case
 * it is scaled down — both sides by one factor — until it fits. The page is
 * the PDF's first page: its size and orientation, with an inch of margin
 * (a tenth of the shorter side on a page under five inches).
 */
import type { FlowBox, PdfFlowText } from "../pdf-text/flow";
import type {
  PdfPageScan,
  ScannedMedia,
  ScannedPage,
  ScannedPicture,
} from "./page-scan";

export interface DocxTextBlock {
  kind: "text";
  /** One cell is a paragraph; two or more a tab-separated table row. */
  cells: readonly string[];
}

export interface DocxPictureBlock {
  kind: "picture";
  media: ScannedMedia;
  /** Its extent in the document, points: the shown size, fitted. */
  width: number;
  height: number;
  /** Fractions of the media cut from each side (`a:srcRect`). */
  crop?: { left: number; top: number; right: number; bottom: number };
  /** Clockwise degrees about its centre; 0 upright. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export type DocxBlock = DocxTextBlock | DocxPictureBlock;

/** The Word page: its size and its text area, points. */
export interface DocxPage {
  width: number;
  height: number;
  margin: number;
}

export interface DocxDocument {
  page: DocxPage;
  /** One entry per PDF page, in order; an empty one adds nothing. */
  pages: DocxBlock[][];
}

/** Word's own page-size limits: 0.1 to 22 inches a side. */
const PAGE_MIN_PT = 7.2;
const PAGE_MAX_PT = 1584;
/** An inch of margin, or a tenth of the shorter side on a small page. */
const MARGIN_PT = 72;
const SMALL_PAGE_PT = 360;

/** The Word page for a PDF whose first page is `width` × `height` points. */
export function docxPageOf(width: number, height: number): DocxPage {
  const clamp = (v: number) =>
    Math.min(PAGE_MAX_PT, Math.max(PAGE_MIN_PT, Number.isFinite(v) ? v : 612));
  const w = clamp(width);
  const h = clamp(height);
  const shorter = Math.min(w, h);
  return {
    width: w,
    height: h,
    margin: shorter >= SMALL_PAGE_PT ? MARGIN_PT : shorter / 10,
  };
}

/** The factor that fits `width` × `height` inside the text area, at most 1. */
export function fitToText(
  page: DocxPage,
  width: number,
  height: number,
): number {
  const textW = page.width - 2 * page.margin;
  const textH = page.height - 2 * page.margin;
  return Math.min(
    1,
    textW / Math.max(width, 1e-9),
    textH / Math.max(height, 1e-9),
  );
}

type Box = readonly [number, number, number, number];

/** `box` through the affine map `m`, as an axis-aligned box. */
function mapBox(m: readonly number[] | undefined, box: Box): Box {
  if (!m) return box;
  const pts = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ].map(([x, y]) => [
    m[0]! * x! + m[2]! * y! + m[4]!,
    m[1]! * x! + m[3]! * y! + m[5]!,
  ]);
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Where each picture box goes: the index of the paragraph it is placed
 * BEFORE (`paragraphs.length` for the end), by the rule in the docblock.
 */
export function insertionPoints(
  paragraphs: readonly (FlowBox | undefined)[],
  pictures: readonly Box[],
): number[] {
  const overlaps = (q: FlowBox, p: Box) =>
    Math.min(q[2], p[2]) - Math.max(q[0], p[0]) > 1;
  return pictures.map((p) => {
    const boxes = paragraphs.map((q, i) => ({ q, i }));
    if (boxes.some(({ q }) => !q)) return paragraphs.length;
    const below = boxes.find(({ q }) => overlaps(q!, p) && q![1] >= p[1] - 0.5);
    if (below) return below.i;
    const above = boxes.filter(({ q }) => overlaps(q!, p) && q![1] < p[1]);
    if (above.length) return above[above.length - 1]!.i + 1;
    const lower = boxes.find(({ q }) => q![1] >= p[1] - 0.5);
    return lower ? lower.i : paragraphs.length;
  });
}

function pictureBlock(page: DocxPage, pic: ScannedPicture): DocxPictureBlock {
  // A turned picture's extent is its own, unturned size: Word turns it.
  const s = fitToText(page, pic.width, pic.height);
  return {
    kind: "picture",
    media: pic.media,
    width: pic.width * s,
    height: pic.height * s,
    ...(pic.crop ? { crop: pic.crop } : {}),
    rotation:
      Math.min(pic.rotation, 360 - pic.rotation) < 0.01 ? 0 : pic.rotation,
    flipH: pic.flipH,
    flipV: pic.flipV,
  };
}

/** The pictures a page reader found on `page`, in the order placed. */
export function scannedPictures(
  page: ScannedPage | undefined,
): ScannedPicture[] {
  return (page?.items ?? []).filter(
    (i): i is ScannedPicture => i.kind === "picture" && i.role === "image",
  );
}

/**
 * The document: every PDF page's paragraphs in poppler's order, with the
 * page's pictures placed among them by {@link insertionPoints}.
 */
export function docxDocumentOf(
  flow: PdfFlowText,
  scan: PdfPageScan,
): DocxDocument {
  const first = scan.pages[0];
  const page = docxPageOf(first?.width ?? 612, first?.height ?? 792);
  const count = Math.max(flow.pageCount, scan.pageCount);
  const pages: DocxBlock[][] = [];
  for (let n = 1; n <= count; n++) {
    const text = flow.pages.find((p) => p.pageNumber === n);
    const scanned = scan.pages.find((p) => p.pageNumber === n);
    const paragraphs = text?.paragraphs ?? [];
    const boxes = paragraphs.map((_, i) => text?.boxes?.[i]);
    const pictures = scannedPictures(scanned)
      .map((pic) => ({
        pic,
        box: mapBox(scanned?.mediaFrame, [
          pic.x,
          pic.y,
          pic.x + pic.width,
          pic.y + pic.height,
        ]),
      }))
      .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
    const at = insertionPoints(
      boxes,
      pictures.map((p) => p.box),
    );
    const blocks: DocxBlock[] = [];
    for (let i = 0; i <= paragraphs.length; i++) {
      pictures.forEach((p, k) => {
        if (at[k] === i) blocks.push(pictureBlock(page, p.pic));
      });
      if (i < paragraphs.length)
        blocks.push({ kind: "text", cells: paragraphs[i]! });
    }
    pages.push(blocks);
  }
  return { page, pages };
}
