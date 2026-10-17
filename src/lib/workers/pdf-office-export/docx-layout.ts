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
 * the PDF's first page when that page is portrait, with an inch of margin
 * (a tenth of the shorter side on a page under five inches); a LANDSCAPE
 * first page — a slide, a printout — gets A4 portrait instead. A Word
 * document flows down its page, and on a landscape one each slide's picture
 * and the text under it break across pages: measured 2026-10-17 in Word 16
 * on the owner's 33-page 4:3 tutorial, 84 Word pages on its own 720 × 540
 * page (60 with half-inch margins), 33 on a portrait page.
 */
import type { FlowBox, PdfFlowText } from "../pdf-text/flow";
import type {
  PdfPageScan,
  ScannedMedia,
  ScannedPage,
  ScannedPicture,
  ScannedTextLine,
} from "./page-scan";

export interface DocxTextBlock {
  kind: "text";
  /** One cell is a paragraph; two or more a tab-separated table row. */
  cells: readonly string[];
  /** Every line of it is drawn in a bold face ({@link paragraphStyle}). */
  bold?: true;
  /** Every line of it is drawn in an italic face. */
  italic?: true;
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

/** A4 portrait, points (11,906 × 16,838 twips, Word's own A4). */
export const A4_PORTRAIT = { width: 595.3, height: 841.9 } as const;

/**
 * The Word page for a PDF whose first page is `width` × `height` points:
 * that page, or A4 upright when it is landscape — scaled, its shape kept,
 * into Word's limits when it is larger (or smaller) than Word allows. Until
 * the review of 2026-10-17 each side was clamped on its own, and an A0
 * poster's page came out a 22-inch square.
 */
export function docxPageOf(width: number, height: number): DocxPage {
  const finite = (v: number) => (Number.isFinite(v) && v > 0 ? v : 612);
  const clamp = (v: number) => Math.min(PAGE_MAX_PT, Math.max(PAGE_MIN_PT, v));
  const landscape = finite(width) > finite(height);
  let w = landscape ? A4_PORTRAIT.width : finite(width);
  let h = landscape ? A4_PORTRAIT.height : finite(height);
  const down = Math.min(1, PAGE_MAX_PT / Math.max(w, h));
  w *= down;
  h *= down;
  const up = Math.max(1, PAGE_MIN_PT / Math.min(w, h));
  // A shape too extreme for both limits keeps the long side's.
  w = clamp(w * up);
  h = clamp(h * up);
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

/**
 * Bold and italic for one paragraph, from the page reader's fonts: bold when
 * EVERY visible run of every line the reader drew inside the paragraph's
 * box is in a bold face, italic likewise; nothing when the reader drew no
 * visible line there. A whole paragraph or none: a bold word inside a
 * sentence is not carried, since poppler's words and pdf.js's runs are not
 * matched one to one. A title, a heading, a caption set in bold — what a
 * slide-like PDF is mostly made of — is. Lines are matched by their centre,
 * mapped into poppler's frame (`mediaFrame`).
 */
export function paragraphStyle(
  box: FlowBox | undefined,
  page: ScannedPage | undefined,
): { bold?: true; italic?: true } {
  if (!box || !page) return {};
  const lines = page.items.filter(
    (i): i is ScannedTextLine => i.kind === "text",
  );
  const runs = lines
    .filter((l) => {
      const [x0, y0, x1, y1] = mapBox(page.mediaFrame, [
        l.x,
        l.y,
        l.x + l.width,
        l.y + l.height,
      ]);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      return (
        cx >= box[0] - 1 &&
        cx <= box[2] + 1 &&
        cy >= box[1] - 1 &&
        cy <= box[3] + 1
      );
    })
    .flatMap((l) => l.runs)
    .filter((r) => !r.invisible && r.text.trim());
  if (runs.length === 0) return {};
  return {
    ...(runs.every((r) => r.bold) ? { bold: true as const } : {}),
    ...(runs.every((r) => r.italic) ? { italic: true as const } : {}),
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
        blocks.push({
          kind: "text",
          cells: paragraphs[i]!,
          ...paragraphStyle(boxes[i], scanned),
        });
    }
    pages.push(blocks);
  }
  return { page, pages };
}
