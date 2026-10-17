/**
 * Read a PDF the way a renderer does, for PDF to PowerPoint: every page's
 * size, every line of text with where it is drawn and in what font, size and
 * colour, every raster picture with where it is painted, and the page's other
 * ink (vector art, fills, rules, backgrounds) as transparent pictures — all in
 * the order the page paints them.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Until 2026-10-10 the export read `pdftotext -layout`, which reports text and
 * nothing else, so every slide was one unpositioned text box on a 16:9 slide:
 * a 33-page slide-style tutorial (a screenshot and a caption on each page)
 * came back as 80 KB of text with no pictures, while a competitor's export of
 * the same file kept each screenshot where it was. The owner reported it with
 * both files.
 *
 * ── WHAT IT READS, AND FROM WHERE ───────────────────────────────────────────
 *
 * pdf.js builds an operator list per page and paints it. This module walks
 * THE SAME list the painter executes — taken from a render that executes only
 * its dependency loads — keeping the painter's state (transform, clip, text
 * state, colours) the way `CanvasGraphics` does. That is why a picture's
 * position is the one a viewer draws it at, and why the layers it renders with
 * an `operationsFilter` are indexed against the list it read. (Not
 * `getOperatorList()`: that one is built WITHOUT the optimizer the painter
 * uses, its indices differ, and a filter keyed on it drops the wrong ops.)
 *
 *   text        every glyph's origin, advance, size, font and fill colour,
 *               grouped into lines; invisible text (render mode 3, an OCR
 *               layer) is kept as invisible text
 *   pictures    `paintImageXObject` / `paintInlineImageXObject`, each its own
 *               picture at its CTM; upright under an upright rectangular
 *               clip, cropped by srcRect (a plain DCT JPEG then goes in byte
 *               for byte); turned, or under any other clip, CUT to the
 *               clip's shape (`./picture-pixels`); anything not copied is
 *               re-encoded from pdf.js's decoded pixels, capped in size
 *   other ink   every remaining painting op, rendered by pdf.js into
 *               transparent layers, omitted when blank
 *
 * ── WHAT IT WILL NOT DECODE, AND SAYS SO ────────────────────────────────────
 *
 * Before pdf.js touches a page, `./page-inventory` reads from the file what
 * the page will make it decode, and {@link decodeBudgetPlan} admits the
 * page's images up to {@link PAGE_DECODE_BUDGET_BYTES}. What it leaves out,
 * pdf.js never decodes, and the page COUNTS (`picturesTooLarge`), as it
 * counts an image pdf.js could not decode (`picturesUndecoded`) and a raster
 * too large for pdf.js to paint ({@link PAINT_BUDGET_BYTES}). Until
 * 2026-10-11 the first and last were silent, and a page holding only a
 * 124 MP scan was reported as having "nothing on it". A page whose drawing
 * would need more than {@link MAX_LAYERS_PER_PAGE} layers is drawn once, as
 * one picture, with its text in invisible boxes (`flattened`).
 *
 * An encrypted page is read like any other: `./page-inventory` decrypts it
 * as a viewer does with no password (`./standard-security`).
 *
 * A file it cannot plan at all — pdf-lib cannot load it, or pdf.js finds a
 * page the page tree does not hold — it does not scan
 * ({@link PageScanUnreadableError}); the engine rebuilds it the way Repair
 * PDF does, or refuses it.
 *
 * What it cannot count it does not count, and it bounds it all the same. A
 * page whose content the inventory still cannot read (a damaged stream) is
 * known only by what it DECLARES — an upper bound on what it paints — so it
 * is held to the page budget over all of that, and nothing is counted
 * against it; a picture over its ceiling can then be removed by pdf.js
 * unseen, so such a page is `picturesUnverified` and is never called empty.
 * The tool's page states that exception, and `claims-vs-capability.test.ts`
 * holds it to a run. Until the second re-review of 2026-10-11 such a page
 * had no bound at all (a ceiling "never below the floor", 64 MP, as many
 * times as it painted one), and one locked page of six 8000² photos decoded
 * 2.2 GB: `page-scan.rss.test.ts`.
 *
 * ── PAINT ORDER IS PRIVACY, NOT POLISH ──────────────────────────────────────
 *
 * Authors hide things by painting over them: a white box over a name in a
 * screenshot, a screenshot over a line of text. A deck that put all vector art
 * under all pictures, or all text on top, would UNHIDE them. So nothing here is
 * stacked by kind: items are emitted in paint order, and the vector ink is cut
 * into a new layer exactly when a later shape overlaps a picture or a line of
 * text painted before it (`planLayers`).
 *
 * ── LIMITS ──────────────────────────────────────────────────────────────────
 *
 * A shape filled AND used as a clip by one path keeps its clip only in its own
 * layer. Text used as a clip (render modes 4–7) clips nothing in the layers or
 * pictures. Image masks, repeated and grouped inline images are drawn into the
 * layers, not placed as pictures (PowerPoint; PDF to Word, which draws no
 * layers, places each of them as a picture: `picturesOnly`). A line of TEXT
 * is placed whole even where a clip cuts it. Right-to-left text is written
 * in the order it is painted.
 * Vertical text is approximated. Each is a rendering difference, not a loss
 * of content.
 */
import { PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";
import { PdfEncryptedError, PdfEngineError } from "@/lib/pdf/engine";
import { uprightJpeg } from "@/lib/pdf/jpeg-orientation";
import { PdfTextOpenError } from "../pdf-text/errors";
import {
  canvasFactoryOf,
  MAX_DECODED_IMAGE_PIXELS,
  openNodePdf,
  type NodeCanvasAndContext,
  type NodeCanvasFactory,
  type NodePdfjs,
  type NodePdfPage,
} from "./pdfjs-node";
import {
  documentImages,
  mediaFrames,
  readInventory,
  unlockObjectStreams,
  type PageInventory,
} from "./page-inventory";
import {
  MAX_BILEVEL_PICTURE_SIDE,
  MAX_LAYERS_PER_PAGE,
  MAX_PICTURE_SIDE,
} from "./picture-limits";
import { encodePngImage } from "./png-encode";
import {
  applyClipCoverage,
  asAxisRect,
  containsRect,
  fitWithin,
  flattenPath,
  isDecodedImage,
  mapShape,
  pngOf,
  polysBox,
  resampleImage,
  type ClipShape,
  type DecodedImage,
} from "./picture-pixels";

/* ------------------------------------------------------------------ *
 *  What a scan returns
 * ------------------------------------------------------------------ */

export type FontClass = "sans" | "serif" | "mono";

export interface ScannedRun {
  text: string;
  /** Family as the PDF names it, cleaned of its subset prefix and style suffix. */
  family: string;
  /** serif / sans / mono, from the font's own flags. */
  fontClass: FontClass;
  bold: boolean;
  italic: boolean;
  /** Em size in page points. */
  size: number;
  /** "RRGGBB", or null when the PDF fills with a pattern or shading. */
  color: string | null;
  /** Fill opacity, 0–1. */
  alpha: number;
  /** Drawn invisibly (an OCR layer): kept, selectable, not shown. */
  invisible: boolean;
  /**
   * Points the PDF adds after each character beyond the font's own advance
   * widths (its character, word and kerning adjustments), averaged over the
   * run: what a deck drawn in the SAME font must add (DrawingML `spc`) for
   * the next run to start where the PDF starts it. 0 when none.
   */
  spacing: number;
}

/** Page-point geometry, origin top-left of the page as displayed. */
export interface Placement {
  /** Left and top of the unrotated box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise, in degrees, about the box's centre. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface ScannedTextLine extends Placement {
  kind: "text";
  /** Baseline offset from the box's top, in page points. */
  baseline: number;
  runs: ScannedRun[];
}

export interface ScannedMedia {
  /** Identical keys are one media part. */
  key: string;
  bytes: Uint8Array;
  ext: "jpeg" | "png";
  pixelWidth: number;
  pixelHeight: number;
  /** True when the PDF's own JPEG stream was copied without re-encoding. */
  passthrough: boolean;
}

export interface ScannedPicture extends Placement {
  kind: "picture";
  /** `image`: a raster the PDF placed. `layer`: other ink, rendered by pdf.js. */
  role: "image" | "layer";
  media: ScannedMedia;
  /** Fractions of the source cut from each side (srcRect), 0–1. */
  crop?: { left: number; top: number; right: number; bottom: number };
}

export type ScannedItem = ScannedTextLine | ScannedPicture;

export interface ScannedPage {
  pageNumber: number;
  /** As displayed: rotation and crop box applied. */
  width: number;
  height: number;
  /** In paint order: the first item is at the bottom of the slide. */
  items: ScannedItem[];
  /**
   * Pictures the page paints that are NOT on its slide because they were too
   * large to decode or draw within the worker's memory budget
   * ({@link decodeBudgetPlan}, {@link PAINT_BUDGET_BYTES}). The result says
   * so; until 2026-10-11 they vanished and the page read as empty.
   */
  picturesTooLarge: number;
  /** Pictures the page paints that pdf.js could not decode (damaged data). */
  picturesUndecoded: number;
  /**
   * pdf.js may have removed a picture this page paints, and nothing here
   * could count it: the page's content could not be read (a damaged file),
   * and a picture it can reach is over its ceiling
   * ({@link PageDecodePlan.unverified}). Such a page is never reported as
   * having nothing on it.
   */
  picturesUnverified: boolean;
  /**
   * PDF to Word only (`picturesOnly`): pictures the page paints that were
   * left out to keep the document inside the worker's budgets — its size
   * (`maxMediaBytes`), its picture count (`maxPictures`), its decoding
   * ({@link DOCUMENT_DECODE_BUDGET_BYTES}) or its time (`deadline`). Until
   * the review of 2026-10-17 a document over any of them was refused whole,
   * text and all, where it had converted (as text) the week before.
   */
  picturesOverBudget?: number;
  /**
   * The page's drawing needed more than {@link MAX_LAYERS_PER_PAGE} separate
   * layers to keep its paint order, so its slide is ONE picture of the page,
   * with its text in invisible text boxes over it (selectable, not shown).
   */
  flattened: boolean;
  /**
   * From this page's displayed points (the frame every item above is in) to
   * the frame poppler's `pdftotext -bbox-layout` reports in, as an affine
   * matrix (`./page-inventory`, `mediaFrames`): PDF to Word places these
   * pictures among poppler's paragraphs. Absent when the page tree could
   * not be read, and then taken as the identity.
   */
  mediaFrame?: [number, number, number, number, number, number];
}

export interface PdfPageScan {
  pageCount: number;
  pages: ScannedPage[];
  /** Images pdf.js could not decode (it resolves them to null), all pages. */
  undecodedImages: number;
  /** Pictures left out as too large, all pages. */
  tooLargeImages: number;
}

export interface PageScanOptions {
  /** Epoch ms after which the scan gives up. */
  deadline?: number;
  /** Total media bytes allowed before the scan stops as too large. */
  maxMediaBytes?: number;
  /**
   * The per-page decode budget, when not {@link PAGE_DECODE_BUDGET_BYTES}:
   * for tests that need a picture over it without decoding a gigabyte.
   */
  pageDecodeBudgetBytes?: number;
  /**
   * PDF to Word's reading: the pictures and the text, and no drawing. The
   * page's vector ink (fills, rules, boxes) is not rendered into layers, and
   * no page is drawn as one picture: a Word document flows its text, and a
   * picture of a page's rules behind that text would be noise, not the page.
   *
   * Every PICTURE is read, though, including the ones pdf.js paints in one
   * merged op — a run of repeats, a run of small inline images — and the
   * stencils (`/ImageMask`), which pdf.js paints in their colour. Anything
   * the page paints LATER over a picture (a white box over a name, an
   * arrow, a label) is painted into it, at its own resolution: what the page
   * covers stays covered (`PAINT ORDER IS PRIVACY`, above). Until the review
   * of 2026-10-17 neither was so: a repeated picture came through once, a
   * run of inline images not at all, and a box drawn over a screenshot was
   * left out with the screenshot's pixels under it intact.
   *
   * The bounds are best effort here, never a refusal: a picture past the
   * media budget, the picture count, the document's decode budget or the
   * deadline is left out and counted (`picturesOverBudget`), and the scan
   * goes on. A picture that would have to be painted with something it
   * cannot paint (over {@link PAINT_BUDGET_BYTES}) is left out and counted
   * as too large, never delivered uncovered.
   */
  picturesOnly?: boolean;
  /** With `picturesOnly`: the most pictures the document may carry. */
  maxPictures?: number;
  /**
   * The document's decode budget, when not {@link
   * DOCUMENT_DECODE_BUDGET_BYTES}: for tests, as `pageDecodeBudgetBytes`.
   */
  documentDecodeBudgetBytes?: number;
  /**
   * With `picturesOnly` and `maxMediaBytes`: bytes each picture adds to the
   * file besides its media (its XML, its relationship, its zip entry), so
   * the budget bounds the FILE, not only its media. See `./docx-package`.
   */
  pictureOverheadBytes?: number;
}

/** A picture past `maxMediaBytes` in a best-effort scan: left out, counted. */
class MediaOverBudget extends Error {
  constructor() {
    super("picture past the media budget");
    this.name = "MediaOverBudget";
  }
}

/**
 * A scan that could not finish in time. Retryable, like a pdftotext timeout.
 * Its message is for the log: the engine reports its own sentence.
 */
export class PageScanTimeoutError extends Error {
  constructor() {
    super("page scan passed its deadline");
    this.name = "PageScanTimeoutError";
  }
}
/**
 * The page reader cannot know, before pdf.js decodes a page, what that page
 * will decode — so it does not scan the file at all. Thrown before pdf.js
 * opens a page: pdf-lib cannot load the file, its objects cannot be walked,
 * or pdf.js finds a page the page tree pdf-lib walks does not hold. A file
 * like that is damaged, and the engine rebuilds it (the way Repair PDF does)
 * or refuses it; until 2026-10-11 the scan drew such pages at pdf.js's floor
 * ceiling with no bound, and one page of six 8000² photos decoded 2.2 GB.
 * Deterministic; its message is the log's.
 */
export class PageScanUnreadableError extends Error {
  constructor(readonly reason: string) {
    super(`the page reader cannot read this file ahead: ${reason}`);
    this.name = "PageScanUnreadableError";
  }
}
/**
 * The pictures alone would exceed the output ceiling. Deterministic. The
 * engine answers `too_large` with its own sentence; this message is the log's.
 */
export class PageScanTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`page scan media passed ${limitBytes} bytes`);
    this.name = "PageScanTooLargeError";
  }
}

export type PdfPageScanner = (
  bytes: Uint8Array,
  options?: PageScanOptions,
) => Promise<PdfPageScan>;

/* ------------------------------------------------------------------ *
 *  Size bounds
 * ------------------------------------------------------------------ */

export { MAX_BILEVEL_PICTURE_SIDE, MAX_PICTURE_SIDE };
/** Rendered layers: this resolution, unless the page would pass the cap. */
export const LAYER_DPI = 200;
/** JPEG quality for re-encoded photographs. */
export const JPEG_QUALITY = 90;

/**
 * The bytes pdf.js may hold for ONE page's decoded images (as
 * `./page-inventory` estimates them, buffers it decodes through included).
 * A page whose images need more keeps the smallest that fit; the rest are
 * left out BEFORE pdf.js decodes them, and the result counts them
 * (`picturesTooLarge`). 512 MiB admits one 8000 × 8000 Flate RGB photo
 * (384 MiB as pdf.js decodes it), a 70 MP A3 colour scan, and a 124 MP
 * bilevel drawing (24 MiB) easily; it does not admit two of the photos. The
 * estimates are calibrated against measured peaks in `./page-inventory`, and
 * `page-scan.rss.test.ts` holds a fresh process's peak to this bound.
 */
export const PAGE_DECODE_BUDGET_BYTES = 512 * 1024 * 1024;
/**
 * The bytes all pages' admitted images may come to. Decoding is the slow
 * part of a scan: measured 2026-10-11 on a desktop (Node 24, Windows), pdf.js
 * decoded about 150 MB a second of this estimate for DCT photos and 400–500
 * for Flate. At this many bytes even that machine could not finish inside
 * the scan's 120 s deadline, and a timeout is retryable — three attempts at
 * a job that can only time out. Past it the job is refused up front, as too
 * large, which is not retried. A document under it can still time out on a
 * slower worker; this catches only the ones that cannot finish anywhere.
 *
 * PDF to Word (`picturesOnly`) is not refused for it: its pages are decoded
 * in page order while the budget holds, and the pictures of the pages past
 * it are counted (`picturesOverBudget`), its text being poppler's. Until the
 * review of 2026-10-17 a 350-page colour scan was refused whole here.
 */
export const DOCUMENT_DECODE_BUDGET_BYTES = 16 * 1024 * 1024 * 1024;
/**
 * The canvas memory pdf.js may use to PAINT one raster itself — a stencil
 * mask, a repeated image, or any picture on a page drawn as one picture. It
 * paints at the raster's own resolution (4 bytes a pixel, plus the halving
 * chain it scales down through), so a raster over this is left out of the
 * drawing and counted, not painted.
 */
export const PAINT_BUDGET_BYTES = 256 * 1024 * 1024;
/** Bytes a pdf.js raster paint costs per source pixel (see above). */
const PAINT_BYTES_PER_PIXEL = 6;
/**
 * pdf.js keeps an image used on two or more pages in the document's shared
 * pool until the document is cleaned up. Past this many bytes there, the scan
 * cleans the document up between pages.
 */
export const SHARED_IMAGE_BYTES = 64 * 1024 * 1024;
/** Render passes (layers) one page may take: see `./picture-limits`. */
export { MAX_LAYERS_PER_PAGE };

/* ------------------------------------------------------------------ *
 *  Geometry
 * ------------------------------------------------------------------ */

type Matrix = [number, number, number, number, number, number];
type Box = [number, number, number, number]; // x0, y0, x1, y1

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m · n, the order canvas `transform` composes in (n applies first). */
function mul(m: readonly number[], n: readonly number[]): Matrix {
  return [
    m[0]! * n[0]! + m[2]! * n[1]!,
    m[1]! * n[0]! + m[3]! * n[1]!,
    m[0]! * n[2]! + m[2]! * n[3]!,
    m[1]! * n[2]! + m[3]! * n[3]!,
    m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
    m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
  ];
}
function apply(m: readonly number[], x: number, y: number): [number, number] {
  return [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
}
function boxOf(m: readonly number[], b: readonly number[]): Box {
  const pts = [
    apply(m, b[0]!, b[1]!),
    apply(m, b[2]!, b[1]!),
    apply(m, b[0]!, b[3]!),
    apply(m, b[2]!, b[3]!),
  ];
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ];
}
function intersect(a: Box, b: Box): Box | null {
  const r: Box = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  return r[2] > r[0] && r[3] > r[1] ? r : null;
}
/** Overlap with half a point of slack, so shapes that merely touch do not. */
function overlaps(a: Box, b: Box): boolean {
  const s = 0.5;
  return (
    a[0] < b[2] - s && b[0] < a[2] - s && a[1] < b[3] - s && b[1] < a[3] - s
  );
}
function grow(b: Box, by: number): Box {
  return [b[0] - by, b[1] - by, b[2] + by, b[3] + by];
}

/**
 * The PowerPoint placement of a unit square drawn under `m` (device space,
 * y down): an unrotated box, a clockwise rotation about its centre, and flips.
 */
function placementOf(m: Matrix): Placement {
  // Image space has (0,0) at the bottom-left and its first row at v = 1.
  const tl = apply(m, 0, 1);
  const tr = apply(m, 1, 1);
  const bl = apply(m, 0, 0);
  const w: [number, number] = [tr[0] - tl[0], tr[1] - tl[1]];
  const h: [number, number] = [bl[0] - tl[0], bl[1] - tl[1]];
  const width = Math.hypot(w[0], w[1]);
  const height = Math.hypot(h[0], h[1]);
  let rotation = (Math.atan2(w[1], w[0]) * 180) / Math.PI;
  // In y-down space an unflipped picture's rows run clockwise of its columns.
  const flipV = w[0] * h[1] - w[1] * h[0] < 0;
  rotation = ((rotation % 360) + 360) % 360;
  if (Math.abs(rotation - 360) < 1e-6) rotation = 0;
  const cx = tl[0] + (w[0] + h[0]) / 2;
  const cy = tl[1] + (w[1] + h[1]) / 2;
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    rotation,
    flipH: false,
    flipV,
  };
}

function isAxisAligned(p: Placement): boolean {
  return Math.min(p.rotation, 360 - p.rotation) < 0.01;
}

/* ------------------------------------------------------------------ *
 *  The painter's state
 * ------------------------------------------------------------------ */

interface FontLike {
  name?: string;
  loadedName?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
  fallbackName?: string;
  fontMatrix?: number[];
  vertical?: boolean;
  isType3Font?: boolean;
  ascent?: number;
  descent?: number;
  defaultVMetrics?: number[];
}

interface GlyphLike {
  unicode?: string;
  width?: number;
  isSpace?: boolean;
  vmetric?: number[] | null;
}

interface State {
  ctm: Matrix;
  /** The clip's bounds, device space. Exact when `clipShapes` is empty. */
  clip: Box;
  /**
   * Every clip in force that is NOT an axis-aligned rectangle on the page —
   * a curve, a polygon, a rectangle turned with its form — as its own shape.
   * The bounds above are only their box; a picture under one of these is cut
   * to its shape (`./picture-pixels`), not to the box.
   */
  clipShapes: readonly ClipShape[];
  fill: string | null;
  stroke: string | null;
  fillAlpha: number;
  strokeAlpha: number;
  lineWidth: number;
  font: FontLike | null;
  fontSize: number;
  fontDirection: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  renderMode: number;
  textMatrix: Matrix | null;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
}

function initialState(base: Matrix, page: Box): State {
  return {
    ctm: base,
    clip: page,
    clipShapes: [],
    fill: "000000",
    stroke: "000000",
    fillAlpha: 1,
    strokeAlpha: 1,
    lineWidth: 1,
    font: null,
    fontSize: 0,
    fontDirection: 1,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
    textMatrix: null,
    x: 0,
    y: 0,
    lineX: 0,
    lineY: 0,
  };
}

/** "#rrggbb" (pdf.js's colour arg) → "RRGGBB", or null. */
function hexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return m ? m[1]!.toUpperCase() : null;
}

/* ------------------------------------------------------------------ *
 *  Fonts
 * ------------------------------------------------------------------ */

const STYLE_WORDS =
  /(?:[-,_ ]?(?:Bold|Black|Heavy|ExtraBold|SemiBold|Semibold|DemiBold|Demi|Medium|Light|ExtraLight|Thin|Book|Regular|Italic|Oblique|It|Inclined|Condensed|Cond|Narrow|PSMT|PS|MT))+$/;

/** "ABCDEF+Calibri-Bold" → "Calibri"; "TimesNewRomanPSMT" → "Times New Roman". */
export function familyOf(pdfName: string): string {
  let name = pdfName.replace(/^[A-Z]{6}\+/, "");
  const comma = name.indexOf(",");
  if (comma > 0) name = name.slice(0, comma);
  const hyphen = name.indexOf("-");
  if (hyphen > 0) name = name.slice(0, hyphen);
  name = name.replace(STYLE_WORDS, "");
  if (!name) name = pdfName.replace(/^[A-Z]{6}\+/, "");
  // CamelCase PostScript names: "TimesNewRoman" → "Times New Roman".
  if (!/\s/.test(name))
    name = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return name.trim() || "Arial";
}

function fontClassOf(font: FontLike): FontClass {
  if (font.fallbackName === "monospace") return "mono";
  if (font.fallbackName === "serif") return "serif";
  return "sans";
}

function isBold(font: FontLike): boolean {
  if (font.bold || font.black) return true;
  return /bold|black|heavy|semibold|demibold/i.test(font.name ?? "");
}
function isItalic(font: FontLike): boolean {
  if (font.italic) return true;
  return /italic|oblique|-it$/i.test(font.name ?? "");
}

/* ------------------------------------------------------------------ *
 *  Text: glyphs to lines
 * ------------------------------------------------------------------ */

interface Glyph {
  op: number;
  ox: number;
  oy: number;
  /** Unit advance direction, device space. */
  dx: number;
  dy: number;
  /** Advance length along (dx, dy). */
  advance: number;
  size: number;
  unicode: string;
  isSpace: boolean;
  ascent: number;
  descent: number;
  run: Omit<ScannedRun, "text">;
}

interface LineBuild {
  op: number;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  /** Along-baseline end of the last glyph. */
  end: number;
  maxSize: number;
  ascent: number;
  descent: number;
  glyphs: { g: Glyph; spaceBefore: boolean }[];
}

/** A word gap: wider than this many ems and no space glyph between. */
const SPACE_GAP_EM = 0.18;
/** A column gap: wider than this, the line ends and a new box starts. */
const SPLIT_GAP_EM = 1.6;
/** Off the baseline by more than this many ems: a new line. */
const BASELINE_EM = 0.35;

function runKey(r: Omit<ScannedRun, "text">): string {
  return `${r.family}|${r.bold}|${r.italic}|${r.size.toFixed(1)}|${r.color}|${r.alpha.toFixed(2)}|${r.invisible}|${r.fontClass}`;
}

/** Symbol and dingbat faces, whose glyphs pdf.js maps to real characters. */
export const SYMBOL_FAMILY =
  /^(?:symbol|wingdings(?: [23])?|webdings|(?:itc )?zapf ?dingbats|dingbats)$/i;

function lineAccepts(line: LineBuild, g: Glyph): boolean {
  if (g.run.invisible !== line.glyphs[0]!.g.run.invisible) return false;
  // A symbol glyph (an arrow in Wingdings) is drawn in another face by the
  // deck, with another width, and everything after it on the line would
  // drift by the difference. It gets its own box, and so does what follows.
  const prev = line.glyphs.at(-1)!.g;
  if (SYMBOL_FAMILY.test(prev.run.family) !== SYMBOL_FAMILY.test(g.run.family))
    return false;
  if (line.dx * g.dx + line.dy * g.dy < 0.9995) return false;
  const rx = g.ox - line.ox;
  const ry = g.oy - line.oy;
  const along = rx * line.dx + ry * line.dy;
  const across = -rx * line.dy + ry * line.dx;
  const em = Math.max(line.maxSize, g.size);
  if (Math.abs(across) > BASELINE_EM * em) return false;
  const gap = along - line.end;
  return gap > -0.5 * em && gap < SPLIT_GAP_EM * em;
}

function addToLine(line: LineBuild, g: Glyph): void {
  const rx = g.ox - line.ox;
  const ry = g.oy - line.oy;
  const along = rx * line.dx + ry * line.dy;
  const gap = along - line.end;
  const prev = line.glyphs.at(-1)?.g;
  const em = Math.max(line.maxSize, g.size);
  const spaceBefore =
    !!prev &&
    !prev.isSpace &&
    !g.isSpace &&
    !/\s$/.test(prev.unicode) &&
    gap > SPACE_GAP_EM * em;
  line.glyphs.push({ g, spaceBefore });
  line.end = Math.max(line.end, along + g.advance);
  line.maxSize = Math.max(line.maxSize, g.size);
  line.ascent = Math.max(line.ascent, g.ascent * g.size);
  line.descent = Math.max(line.descent, g.descent * g.size);
}

function startLine(g: Glyph): LineBuild {
  return {
    op: g.op,
    ox: g.ox,
    oy: g.oy,
    dx: g.dx,
    dy: g.dy,
    end: g.advance,
    maxSize: g.size,
    ascent: g.ascent * g.size,
    descent: g.descent * g.size,
    glyphs: [{ g, spaceBefore: false }],
  };
}

/** Alphabetic Presentation Forms (U+FB00–U+FB4F): ligatures such as fi. */
const LIGATURES = new RegExp(
  `[${String.fromCharCode(0xfb00)}-${String.fromCharCode(0xfb4f)}]`,
);

/** Ligatures and other compatibility forms a font maps one glyph to. */
function displayText(unicode: string): string {
  return LIGATURES.test(unicode) ? unicode.normalize("NFKC") : unicode;
}

const blank = (g: Glyph) => g.isSpace || g.unicode.trim() === "";

function finishLine(line: LineBuild): ScannedTextLine | null {
  // The box spans the line's first to last VISIBLE glyph: a leading space
  // (a word space drawn in another font, say) must not move where the
  // words start.
  const first = line.glyphs.findIndex(({ g }) => !blank(g));
  if (first < 0) return null;
  let last = line.glyphs.length - 1;
  while (blank(line.glyphs[last]!.g)) last--;
  const kept = line.glyphs.slice(first, last + 1);
  const o = kept[0]!.g;
  const along = (g: Glyph) => (g.ox - o.ox) * line.dx + (g.oy - o.oy) * line.dy;
  const runs: ScannedRun[] = [];
  // Per run: where it starts along the baseline, and the width its glyphs
  // would take in the PDF's own font with no added spacing.
  const starts: number[] = [];
  const natural: number[] = [];
  let maxSize = 0;
  let ascentPt = 0;
  let descentPt = 0;
  let end = 0;
  kept.forEach(({ g, spaceBefore }, k) => {
    maxSize = Math.max(maxSize, g.size);
    ascentPt = Math.max(ascentPt, g.ascent * g.size);
    descentPt = Math.max(descentPt, g.descent * g.size);
    end = Math.max(end, along(g) + g.advance);
    const space = k > 0 && spaceBefore;
    // An inserted space has no glyph; a quarter em is a typical one.
    const spaceWidth = 0.25 * g.size;
    const text = (space ? " " : "") + displayText(g.unicode);
    const prev = runs.at(-1);
    if (prev && runKey(prev) === runKey(g.run)) {
      prev.text += text;
      natural[natural.length - 1]! += g.advance + (space ? spaceWidth : 0);
    } else if (prev && space) {
      prev.text += " ";
      natural[natural.length - 1]! += spaceWidth;
      runs.push({ ...g.run, text: displayText(g.unicode) });
      starts.push(along(g));
      natural.push(g.advance);
    } else {
      runs.push({ ...g.run, text });
      starts.push(along(g) - (space ? spaceWidth : 0));
      natural.push(g.advance + (space ? spaceWidth : 0));
    }
  });
  runs.forEach((run, r) => {
    const span = (starts[r + 1] ?? end) - starts[r]!;
    const chars = [...run.text].length;
    const extra = chars > 0 ? (span - natural[r]!) / chars : 0;
    // Bounded: an odd PDF must not spread a word across the slide.
    run.spacing = Math.max(-0.2 * run.size, Math.min(0.2 * run.size, extra));
  });
  const ascent = Math.max(ascentPt, 0.6 * maxSize);
  const descent = Math.max(descentPt, 0.15 * maxSize);
  const width = Math.max(end, 0.5 * maxSize);
  const height = ascent + descent;
  // Local frame: origin on the baseline at the first glyph, u along the
  // baseline, v down (perpendicular, clockwise of u in y-down space).
  const ux = line.dx;
  const uy = line.dy;
  const vx = -uy;
  const vy = ux;
  const cx = o.ox + ux * (width / 2) + vx * ((descent - ascent) / 2);
  const cy = o.oy + uy * (width / 2) + vy * ((descent - ascent) / 2);
  let rotation = (Math.atan2(uy, ux) * 180) / Math.PI;
  rotation = ((rotation % 360) + 360) % 360;
  if (Math.min(rotation, 360 - rotation) < 0.05) rotation = 0;
  return {
    kind: "text",
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    rotation,
    flipH: false,
    flipV: false,
    baseline: ascent,
    runs,
  };
}

/* ------------------------------------------------------------------ *
 *  The walk
 * ------------------------------------------------------------------ */

interface OpList {
  fnArray: number[];
  argsArray: unknown[][];
}

interface ImageElement {
  kind: "image";
  op: number;
  /**
   * Which of the op's pictures this is. pdf.js merges a run of one image
   * painted again and again into ONE op (`paintImageXObjectRepeat`), and a
   * run of small inline images into one (`paintInlineImageXObjectGroup`);
   * PDF to Word reads each picture out of them (`expandMerged`). 0 for an
   * op that paints one picture.
   */
  copy: number;
  m: Matrix;
  clip: Box;
  clipShapes: readonly ClipShape[];
  box: Box;
  objId: string | null;
  inline: unknown;
  /**
   * A stencil (`/ImageMask`): one colour through a one-bit shape, which only
   * pdf.js's painter can show (in the fill colour of the moment). Its own
   * pixel size, for the resolution it is painted at.
   */
  stencil?: { width: number; height: number };
}
interface TextElement {
  kind: "text";
  op: number;
  box: Box;
  line: ScannedTextLine;
}
interface VectorElement {
  kind: "vector";
  op: number;
  box: Box;
}
type Element = ImageElement | TextElement | VectorElement;

interface OpTables {
  TEXT: Set<number>;
  PICTURE: Set<number>;
  VECTOR_IMAGE: Set<number>;
  PATH_PAINT: Set<number>;
  PAINT_OP_IN_PATH: Set<number>;
}

function opTables(OPS: NodePdfjs["OPS"]): OpTables {
  const o = OPS as unknown as Record<string, number>;
  const ids = (...names: string[]) =>
    new Set(names.map((n) => o[n]).filter((v): v is number => v !== undefined));
  const paints = [
    "stroke",
    "closeStroke",
    "fill",
    "eoFill",
    "fillStroke",
    "eoFillStroke",
    "closeFillStroke",
    "closeEOFillStroke",
  ];
  return {
    TEXT: ids(
      "showText",
      "showSpacedText",
      "nextLineShowText",
      "nextLineSetSpacingShowText",
    ),
    PICTURE: ids("paintImageXObject", "paintInlineImageXObject"),
    VECTOR_IMAGE: ids(
      "paintImageMaskXObject",
      "paintImageMaskXObjectGroup",
      "paintImageMaskXObjectRepeat",
      "paintSolidColorImageMask",
      "paintInlineImageXObjectGroup",
      "paintImageXObjectRepeat",
      "shadingFill",
    ),
    PATH_PAINT: ids(...paints),
    PAINT_OP_IN_PATH: ids(...paints),
  };
}

/**
 * One inline image out of the atlas pdf.js packs a run of them into
 * (`paintInlineImageXObjectGroup`: RGBA rows, each image at `x`, `y`, padded
 * by a pixel), as an image of its own. Null when the atlas is not RGBA rows
 * (a browser's bitmap; never under Node).
 */
function atlasPart(
  atlas: DecodedImage,
  e: { x: number; y: number; w: number; h: number },
): DecodedImage | null {
  const RGBA_32BPP = 3;
  if (
    atlas.kind !== RGBA_32BPP ||
    e.w < 1 ||
    e.h < 1 ||
    e.x + e.w > atlas.width ||
    e.y + e.h > atlas.height
  )
    return null;
  const data = new Uint8ClampedArray(e.w * e.h * 4);
  for (let r = 0; r < e.h; r++) {
    const from = ((e.y + r) * atlas.width + e.x) * 4;
    data.set(atlas.data.subarray(from, from + e.w * 4), r * e.w * 4);
  }
  return { width: e.w, height: e.h, kind: RGBA_32BPP, data };
}

/** Is op `i` one that puts ink on the page (as opposed to setting state)? */
function isPaint(t: OpTables, OPS: NodePdfjs["OPS"], ol: OpList, i: number) {
  const fn = ol.fnArray[i]!;
  if (t.TEXT.has(fn) || t.PICTURE.has(fn) || t.VECTOR_IMAGE.has(fn))
    return true;
  if (t.PATH_PAINT.has(fn)) return true;
  if (fn === OPS.constructPath)
    return t.PAINT_OP_IN_PATH.has((ol.argsArray[i] ?? [])[0] as number);
  return false;
}

function walkPage(
  pdfjs: NodePdfjs,
  page: NodePdfPage,
  ol: OpList,
  base: Matrix,
  pageBox: Box,
  isVisible: (props: unknown) => boolean,
  tables: OpTables,
  /**
   * PDF to Word: every picture a merged op paints is its own image element
   * (repeats, runs of inline images, stencils), not drawing. PowerPoint
   * draws those ops into its layers, which show them where the page does.
   */
  expandMerged = false,
): Element[] {
  const { OPS } = pdfjs;
  const commonObjs = page.commonObjs as unknown as {
    has(id: string): boolean;
    get(id: string): unknown;
  };
  const elements: Element[] = [];
  const glyphs: Glyph[] = [];
  let st = initialState(base, pageBox);
  const stack: State[] = [];
  const marked: boolean[] = [];
  let visible = true;
  let pendingClip: "nonzero" | "evenodd" | null = null;
  const save = () => {
    stack.push(st);
    st = { ...st };
  };
  const restore = () => {
    st = stack.pop() ?? st;
    pendingClip = null;
  };
  /** Clip to the unit-free box `b` under `m`: exact when it stays upright. */
  const clipToBox = (m: Matrix, b: readonly number[]) => {
    const upright =
      (Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9) ||
      (Math.abs(m[0]) < 1e-9 && Math.abs(m[3]) < 1e-9);
    st.clip = intersect(st.clip, boxOf(m, b)) ?? [0, 0, 0, 0];
    if (!upright) {
      const corners = [
        apply(m, b[0]!, b[1]!),
        apply(m, b[2]!, b[1]!),
        apply(m, b[2]!, b[3]!),
        apply(m, b[0]!, b[3]!),
      ];
      st.clipShapes = [
        ...st.clipShapes,
        { polys: [corners.flat()], evenOdd: false },
      ];
    }
  };
  const vector = (op: number, box: Box | null) => {
    const clipped = box ? intersect(box, st.clip) : st.clip;
    if (clipped) elements.push({ kind: "vector", op, box: clipped });
  };
  /** One picture: the unit square under `m`, seen through the clip. */
  const picture = (
    op: number,
    copy: number,
    m: Matrix,
    source: Pick<ImageElement, "objId" | "inline" | "stencil">,
  ) => {
    const box = intersect(boxOf(m, [0, 0, 1, 1]), st.clip);
    if (!box) return;
    elements.push({
      kind: "image",
      op,
      copy,
      m,
      clip: st.clip,
      clipShapes: st.clipShapes,
      box,
      ...source,
    });
  };
  const dims = (v: unknown) => {
    const o = (v ?? {}) as { width?: unknown; height?: unknown };
    return {
      width: typeof o.width === "number" ? o.width : 1,
      height: typeof o.height === "number" ? o.height : 1,
    };
  };
  /**
   * The pictures one merged op paints, each at its own place — read from the
   * op's arguments exactly as pdf.js's canvas paints them. False for an op
   * that is not one of them.
   */
  const merged = (i: number, fn: number, args: unknown[]): boolean => {
    const none = { objId: null, inline: null } as const;
    switch (fn) {
      case OPS.paintImageXObjectRepeat: {
        // (objId, scaleX, scaleY, positions): one image, many places.
        const [objId, sx, sy, positions] = args as [
          unknown,
          number,
          number,
          ArrayLike<number>,
        ];
        for (let k = 0; k + 1 < (positions?.length ?? 0); k += 2)
          picture(
            i,
            k / 2,
            mul(st.ctm, [sx, 0, 0, sy, positions[k]!, positions[k + 1]!]),
            {
              objId: String(objId),
              inline: null,
            },
          );
        return true;
      }
      case OPS.paintInlineImageXObjectGroup: {
        // (atlas, map): small inline images packed into one, each entry a
        // part of it under its own transform.
        const [atlas, map] = args as [
          unknown,
          { transform: number[]; x: number; y: number; w: number; h: number }[],
        ];
        (map ?? []).forEach((entry, k) =>
          picture(i, k, mul(st.ctm, entry.transform), {
            objId: null,
            inline: isDecodedImage(atlas) ? atlasPart(atlas, entry) : null,
          }),
        );
        return true;
      }
      case OPS.paintImageMaskXObject:
        picture(i, 0, st.ctm, { ...none, stencil: dims(args[0]) });
        return true;
      case OPS.paintSolidColorImageMask:
        picture(i, 0, st.ctm, { ...none, stencil: { width: 1, height: 1 } });
        return true;
      case OPS.paintImageMaskXObjectRepeat: {
        // (mask, scaleX, skewX, skewY, scaleY, positions).
        const [mask, sx, kx, ky, sy, positions] = args as [
          unknown,
          number,
          number,
          number,
          number,
          ArrayLike<number>,
        ];
        for (let k = 0; k + 1 < (positions?.length ?? 0); k += 2)
          picture(
            i,
            k / 2,
            mul(st.ctm, [
              sx,
              kx ?? 0,
              ky ?? 0,
              sy,
              positions[k]!,
              positions[k + 1]!,
            ]),
            { ...none, stencil: dims(mask) },
          );
        return true;
      }
      case OPS.paintImageMaskXObjectGroup:
        ((args[0] ?? []) as { transform?: number[] }[]).forEach((mask, k) =>
          picture(i, k, mul(st.ctm, mask.transform ?? IDENTITY), {
            ...none,
            stencil: dims(mask),
          }),
        );
        return true;
      default:
        return false;
    }
  };
  const fontObject = (id: string): FontLike | null => {
    try {
      return commonObjs.has(id) ? (commonObjs.get(id) as FontLike) : null;
    } catch {
      return null;
    }
  };

  const showText = (op: number, glyphList: unknown[]) => {
    const font = st.font;
    if (!font || st.fontSize === 0) return;
    const fm = font.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0];
    const fontSize = st.fontSize;
    const widthScale = fontSize * (fm[0] ?? 0.001);
    const hScale = st.hScale * st.fontDirection;
    const vertical = !!font.vertical;
    const spacingDir = vertical ? 1 : -1;
    const t = mul(st.ctm, st.textMatrix ?? IDENTITY);
    const emScale = Math.abs(fm[3] ?? 0.001) * 1000;
    const size = fontSize * emScale * Math.hypot(t[2], t[3]);
    const dir = vertical
      ? [-t[2], -t[3]]
      : [t[0] * Math.sign(hScale || 1), t[1] * Math.sign(hScale || 1)];
    const len = Math.hypot(dir[0]!, dir[1]!);
    if (!(len > 0) || !(size > 0) || !Number.isFinite(size)) return;
    const dx = dir[0]! / len;
    const dy = dir[1]! / len;
    const mode = st.renderMode & 3;
    const invisible = mode === 3;
    const color = mode === 1 ? st.stroke : st.fill;
    const run: Omit<ScannedRun, "text"> = {
      family: familyOf(font.name ?? font.loadedName ?? "Arial"),
      fontClass: fontClassOf(font),
      bold: isBold(font),
      italic: isItalic(font),
      size,
      color,
      alpha: mode === 1 ? st.strokeAlpha : st.fillAlpha,
      invisible,
      spacing: 0,
    };
    // Finite, not merely present: pdf.js gives a non-embedded standard Times
    // or Courier face an ascent of NaN, and `Math.max(NaN, 0.5)` is NaN —
    // until 2026-10-17 every such line was placed at NaN, and its slide
    // carried `<a:off x="NaN"…/>`, which PowerPoint refuses.
    const finite = (v: number | undefined, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : fallback;
    const ascent = Math.min(Math.max(finite(font.ascent, 0.8), 0.5), 1.2);
    const descent = Math.min(Math.max(-finite(font.descent, -0.2), 0.05), 0.6);
    let x = 0;
    for (const raw of glyphList) {
      if (typeof raw === "number") {
        x += (spacingDir * raw * fontSize) / 1000;
        continue;
      }
      const g = raw as GlyphLike;
      const spacing = (g.isSpace ? st.wordSpacing : 0) + st.charSpacing;
      let width = (g.width ?? 0) * widthScale;
      let start: [number, number];
      let end: [number, number];
      if (vertical) {
        const vm = g.vmetric ?? font.defaultVMetrics;
        if (vm && vm[0] !== undefined) width = -vm[0] * widthScale;
        start = apply(t, st.x, st.y - x);
        end = apply(t, st.x, st.y - x - width);
      } else {
        start = apply(t, st.x + x * hScale, st.y + st.rise);
        end = apply(t, st.x + (x + width) * hScale, st.y + st.rise);
      }
      const unicode = typeof g.unicode === "string" ? g.unicode : "";
      if (unicode.length > 0)
        glyphs.push({
          op,
          ox: start[0],
          oy: start[1],
          dx,
          dy,
          advance: Math.hypot(end[0] - start[0], end[1] - start[1]),
          size,
          unicode,
          isSpace: !!g.isSpace || /^\s+$/.test(unicode),
          ascent,
          descent,
          run,
        });
      x += vertical
        ? width - spacing * st.fontDirection
        : width + spacing * st.fontDirection;
    }
    if (vertical) st.y -= x;
    else st.x += x * hScale;
  };

  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i]!;
    const args = ol.argsArray[i] ?? [];
    switch (fn) {
      case OPS.save:
        save();
        break;
      case OPS.restore:
        restore();
        break;
      case OPS.transform:
        st.ctm = mul(st.ctm, args as number[]);
        break;
      case OPS.paintFormXObjectBegin: {
        if (!visible) break;
        save();
        const [matrix, bbox] = args as [number[] | null, number[] | null];
        if (matrix) st.ctm = mul(st.ctm, matrix);
        if (bbox) clipToBox(st.ctm, bbox);
        break;
      }
      case OPS.paintFormXObjectEnd:
        if (visible) restore();
        break;
      case OPS.beginGroup: {
        if (!visible) break;
        save();
        const group = (args[0] ?? {}) as {
          bbox?: number[];
          matrix?: number[];
        };
        if (group.bbox)
          clipToBox(
            group.matrix ? mul(st.ctm, group.matrix) : st.ctm,
            group.bbox,
          );
        break;
      }
      case OPS.endGroup:
        if (visible) restore();
        break;
      case OPS.beginAnnotation: {
        // pdf.js restarts from the page's initial state for each annotation.
        stack.length = 0;
        st = initialState(base, pageBox);
        save();
        const [, rect, transform, matrix] = args as [
          unknown,
          number[] | null,
          number[],
          number[],
        ];
        if (rect) st.clip = intersect(pageBox, boxOf(base, rect)) ?? pageBox;
        st.ctm = mul(mul(base, transform ?? IDENTITY), matrix ?? IDENTITY);
        break;
      }
      case OPS.endAnnotation:
        break;
      case OPS.beginMarkedContent:
        marked.push(true);
        break;
      case OPS.beginMarkedContentProps:
        marked.push(args[0] === "OC" ? isVisible(args[1]) : true);
        visible = marked.every(Boolean);
        break;
      case OPS.endMarkedContent:
        marked.pop();
        visible = marked.every(Boolean);
        break;
      case OPS.setGState:
        for (const [key, value] of (args[0] ?? []) as [string, unknown][]) {
          if (key === "ca" && typeof value === "number") st.fillAlpha = value;
          else if (key === "CA" && typeof value === "number")
            st.strokeAlpha = value;
          else if (key === "LW" && typeof value === "number")
            st.lineWidth = value;
          else if (key === "Font" && Array.isArray(value)) {
            st.font = fontObject(String(value[0]));
            st.fontSize = Math.abs(Number(value[1]) || 0);
            st.fontDirection = Number(value[1]) < 0 ? -1 : 1;
          }
        }
        break;
      case OPS.setLineWidth:
        st.lineWidth = Number(args[0]) || 0;
        break;
      case OPS.setFillRGBColor:
        st.fill = hexColor(args[0]);
        break;
      case OPS.setStrokeRGBColor:
        st.stroke = hexColor(args[0]);
        break;
      case OPS.setFillColorN:
      case OPS.setFillTransparent:
        st.fill = null;
        break;
      case OPS.setStrokeColorN:
      case OPS.setStrokeTransparent:
        st.stroke = null;
        break;
      case OPS.clip:
        pendingClip = "nonzero";
        break;
      case OPS.eoClip:
        pendingClip = "evenodd";
        break;
      case OPS.endPath:
        pendingClip = null;
        break;
      case OPS.constructPath: {
        const paintOp = args[0] as number;
        const minMax = args[2] as ArrayLike<number> | null | undefined;
        const local =
          minMax && minMax.length >= 4
            ? boxOf(st.ctm, [minMax[0]!, minMax[1]!, minMax[2]!, minMax[3]!])
            : null;
        if (visible && tables.PAINT_OP_IN_PATH.has(paintOp)) {
          const stroked =
            paintOp !== OPS.fill && paintOp !== OPS.eoFill
              ? Math.max(st.lineWidth, 1) *
                Math.hypot(st.ctm[0], st.ctm[1]) *
                0.5
              : 0;
          vector(i, local ? grow(local, stroked + 0.5) : null);
        }
        if (pendingClip) {
          const data = (args[1] as unknown[] | undefined)?.[0];
          const polys =
            data && typeof (data as ArrayLike<number>).length === "number"
              ? flattenPath(data as ArrayLike<number>, st.ctm)
              : [];
          if (local) st.clip = intersect(st.clip, local) ?? [0, 0, 0, 0];
          // A rectangle on the page is all its box says; anything else is
          // kept as its shape for the pictures it cuts.
          if (polys.length > 0 && !asAxisRect(polys))
            st.clipShapes = [
              ...st.clipShapes,
              { polys, evenOdd: pendingClip === "evenodd" },
            ];
          pendingClip = null;
        }
        break;
      }
      case OPS.beginText:
        st.textMatrix = null;
        st.x = st.lineX = 0;
        st.y = st.lineY = 0;
        break;
      case OPS.setCharSpacing:
        st.charSpacing = Number(args[0]) || 0;
        break;
      case OPS.setWordSpacing:
        st.wordSpacing = Number(args[0]) || 0;
        break;
      case OPS.setHScale:
        st.hScale = (Number(args[0]) || 100) / 100;
        break;
      case OPS.setLeading:
        st.leading = -(Number(args[0]) || 0);
        break;
      case OPS.setFont: {
        st.font = fontObject(String(args[0]));
        const size = Number(args[1]) || 0;
        st.fontSize = Math.abs(size);
        st.fontDirection = size < 0 ? -1 : 1;
        break;
      }
      case OPS.setTextRenderingMode:
        st.renderMode = Number(args[0]) || 0;
        break;
      case OPS.setTextRise:
        st.rise = Number(args[0]) || 0;
        break;
      case OPS.moveText:
        st.x = st.lineX += Number(args[0]) || 0;
        st.y = st.lineY += Number(args[1]) || 0;
        break;
      case OPS.setLeadingMoveText:
        st.leading = Number(args[1]) || 0;
        st.x = st.lineX += Number(args[0]) || 0;
        st.y = st.lineY += Number(args[1]) || 0;
        break;
      case OPS.setTextMatrix: {
        const m = (
          Array.isArray(args[0]) || ArrayBuffer.isView(args[0])
            ? Array.from(args[0] as ArrayLike<number>)
            : args
        ) as number[];
        st.textMatrix = [m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!];
        st.x = st.lineX = 0;
        st.y = st.lineY = 0;
        break;
      }
      case OPS.nextLine:
        st.x = st.lineX;
        st.y = st.lineY += st.leading;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        if (visible) showText(i, (args[0] ?? []) as unknown[]);
        break;
      case OPS.nextLineShowText:
        st.x = st.lineX;
        st.y = st.lineY += st.leading;
        if (visible) showText(i, (args[0] ?? []) as unknown[]);
        break;
      case OPS.nextLineSetSpacingShowText:
        st.wordSpacing = Number(args[0]) || 0;
        st.charSpacing = Number(args[1]) || 0;
        st.x = st.lineX;
        st.y = st.lineY += st.leading;
        if (visible) showText(i, (args[2] ?? []) as unknown[]);
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject: {
        if (!visible) break;
        picture(i, 0, st.ctm, {
          objId: fn === OPS.paintImageXObject ? String(args[0]) : null,
          inline: fn === OPS.paintInlineImageXObject ? args[0] : null,
        });
        break;
      }
      default:
        if (!visible) break;
        if (expandMerged && merged(i, fn, args)) break;
        if (tables.PATH_PAINT.has(fn)) vector(i, null);
        else if (tables.VECTOR_IMAGE.has(fn)) {
          const unit =
            fn === OPS.paintImageMaskXObject ||
            fn === OPS.paintSolidColorImageMask
              ? boxOf(st.ctm, [0, 0, 1, 1])
              : null;
          vector(i, unit);
        }
        break;
    }
  }

  // Glyphs → lines, in paint order.
  let line: LineBuild | null = null;
  const flush = () => {
    if (!line) return;
    const done = finishLine(line);
    if (done) {
      const corners = [
        [done.x, done.y],
        [done.x + done.width, done.y + done.height],
      ];
      const box: Box =
        done.rotation === 0
          ? [corners[0]![0]!, corners[0]![1]!, corners[1]![0]!, corners[1]![1]!]
          : rotatedBox(done);
      elements.push({ kind: "text", op: line.op, box, line: done });
    }
    line = null;
  };
  for (const g of glyphs) {
    if (line && lineAccepts(line, g)) addToLine(line, g);
    else {
      flush();
      line = startLine(g);
    }
  }
  flush();
  return elements.sort((a, b) => a.op - b.op);
}

function rotatedBox(p: Placement): Box {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  const r = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const pts = [
    [-p.width / 2, -p.height / 2],
    [p.width / 2, -p.height / 2],
    [-p.width / 2, p.height / 2],
    [p.width / 2, p.height / 2],
  ].map(([u, v]) => [cx + u! * cos - v! * sin, cy + u! * sin + v! * cos]);
  return [
    Math.min(...pts.map((q) => q[0]!)),
    Math.min(...pts.map((q) => q[1]!)),
    Math.max(...pts.map((q) => q[0]!)),
    Math.max(...pts.map((q) => q[1]!)),
  ];
}

/* ------------------------------------------------------------------ *
 *  Paint order → layers
 * ------------------------------------------------------------------ */

export type PlanStep =
  | { kind: "layer"; ops: number[] }
  | { kind: "image"; element: number }
  | { kind: "text"; element: number };

/**
 * Cut the page's vector ink into as few layers as paint order allows.
 *
 * Walking in paint order, pictures and text lines are lifted above the layer
 * being collected — correct while nothing painted LATER in that layer
 * overlaps them. The first later shape that does closes the layer: the lifted
 * items are committed above it and the shape starts a new one. So a cover box
 * over a screenshot stays over it, a screenshot over a line of text stays over
 * it, and a page with no such overlap has one layer at the bottom.
 *
 * Exported for its tests: the ordering is the privacy property.
 */
export function planLayers(
  elements: readonly { kind: Element["kind"]; box: Box }[],
): PlanStep[] {
  const steps: PlanStep[] = [];
  let ops: number[] = [];
  let lifted: PlanStep[] = [];
  let liftedBoxes: Box[] = [];
  const commit = () => {
    if (ops.length > 0) steps.push({ kind: "layer", ops });
    steps.push(...lifted);
    ops = [];
    lifted = [];
    liftedBoxes = [];
  };
  elements.forEach((e, index) => {
    if (e.kind === "vector") {
      if (liftedBoxes.some((b) => overlaps(b, e.box))) commit();
      ops.push(index);
    } else {
      lifted.push({ kind: e.kind, element: index });
      liftedBoxes.push(e.box);
    }
  });
  commit();
  return steps;
}

/* ------------------------------------------------------------------ *
 *  Pictures: pixels to media
 * ------------------------------------------------------------------ */

/** The JPEG's SOF: its size and component count, or null if it has none. */
function jpegFrame(
  bytes: Uint8Array,
): { width: number; height: number; components: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const len = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    )
      return {
        height: (bytes[p + 5]! << 8) | bytes[p + 6]!,
        width: (bytes[p + 7]! << 8) | bytes[p + 8]!,
        components: bytes[p + 9]!,
      };
    p += 2 + len;
  }
  return null;
}

/**
 * The PDF's own JPEG for `ref`, when copying it byte for byte shows exactly
 * what the PDF shows: a DCT-only stream, 8-bit, grey or RGB (or ICC-based of
 * those), no Decode array, no soft or hard mask, no encryption. Anything else
 * is re-encoded from the pixels pdf.js decoded.
 */
interface RawImageSource {
  jpeg(ref: string, width: number, height: number): Promise<Uint8Array | null>;
  filterOf(ref: string): Promise<string | null>;
}

/** `bytes` parsed by pdf-lib once, shared by the inventory and the JPEG copy. */
function pdfLibLoader(
  bytes: Uint8Array,
): () => Promise<import("pdf-lib").PDFDocument | null> {
  let doc: Promise<import("pdf-lib").PDFDocument | null> | undefined;
  return () => {
    doc ??= import("pdf-lib")
      .then(({ PDFDocument }) =>
        PDFDocument.load(bytes, {
          ignoreEncryption: true,
          updateMetadata: false,
          throwOnInvalidObject: false,
        }),
      )
      .catch(() => null);
    return doc;
  };
}

function rawImageSource(
  load: () => Promise<import("pdf-lib").PDFDocument | null>,
): RawImageSource {
  const stream = async (ref: string): Promise<PDFRawStream | null> => {
    const m = /^(\d+)R(\d*)$/.exec(ref);
    if (!m) return null;
    const d = await load();
    // An encrypted file's streams are ciphertext here: nothing is copied raw.
    if (!d || d.isEncrypted) return null;
    try {
      const obj = d.context.lookup(PDFRef.of(Number(m[1]), Number(m[2] || 0)));
      return obj instanceof PDFRawStream ? obj : null;
    } catch {
      return null;
    }
  };
  const filters = (dict: PDFDict): string[] => {
    const f = dict.get(PDFName.of("Filter"));
    if (f instanceof PDFName) return [f.asString()];
    if (f && "asArray" in f && typeof f.asArray === "function")
      return (f.asArray() as unknown[]).map((v) => String(v));
    return [];
  };
  return {
    async filterOf(ref) {
      const s = await stream(ref);
      return s ? (filters(s.dict).at(-1) ?? null) : null;
    },
    async jpeg(ref, width, height) {
      const s = await stream(ref);
      if (!s) return null;
      const dict = s.dict;
      const f = filters(dict);
      if (f.length !== 1 || f[0] !== "/DCTDecode") return null;
      for (const key of ["SMask", "Mask", "Decode", "ImageMask"])
        if (dict.has(PDFName.of(key))) return null;
      const bpc = dict.get(PDFName.of("BitsPerComponent"));
      if (bpc instanceof PDFNumber && bpc.asNumber() !== 8) return null;
      const cs = dict.lookup(PDFName.of("ColorSpace"));
      const csName =
        cs instanceof PDFName
          ? cs.asString()
          : cs && "asArray" in cs && typeof cs.asArray === "function"
            ? String((cs.asArray() as unknown[])[0])
            : "";
      if (!["/DeviceRGB", "/DeviceGray", "/ICCBased"].includes(csName))
        return null;
      const raw = s.contents;
      const frame = jpegFrame(raw);
      if (
        !frame ||
        (frame.components !== 1 && frame.components !== 3) ||
        frame.width !== width ||
        frame.height !== height
      )
        return null;
      return raw;
    },
  };
}

interface CanvasTools {
  factory: NodeCanvasFactory;
}

function canvasFrom(
  tools: CanvasTools,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): NodeCanvasAndContext {
  const cc = tools.factory.create(width, height);
  const image = cc.context.createImageData(width, height);
  image.data.set(rgba);
  cc.context.putImageData(image, 0, 0);
  return cc;
}

/**
 * Encode a decoded picture, or the part `region` of it (whole pixels), at
 * most {@link MAX_PICTURE_SIDE} on its long side ({@link
 * MAX_BILEVEL_PICTURE_SIDE} for a bilevel scan): PNG for anything with
 * transparency, flat colour or two tones; JPEG for photographs (a lossy
 * source, or a PNG that came out heavier than four bits a pixel). With
 * `clips` (in the region's own pixels at full resolution), every pixel a clip
 * hides is made transparent, and the result is always a PNG.
 */
async function encodePicture(
  tools: CanvasTools,
  img: DecodedImage,
  sourceFilter: string | null,
  region: readonly [number, number, number, number] = [
    0,
    0,
    img.width,
    img.height,
  ],
  clips: readonly ClipShape[] = [],
): Promise<Omit<ScannedMedia, "key" | "passthrough">> {
  const bilevel = img.kind === 1;
  const rw = region[2] - region[0];
  const rh = region[3] - region[1];
  const [w, h] = fitWithin(
    rw,
    rh,
    bilevel ? MAX_BILEVEL_PICTURE_SIDE : MAX_PICTURE_SIDE,
  );
  const whole =
    rw === img.width && rh === img.height && region[0] === 0 && region[1] === 0;
  if (bilevel && whole && clips.length === 0 && w === rw && h === rh) {
    // pdf.js packs these 1 bit a pixel, set bit = white: a PNG's own
    // 1-bit grey layout, so the rows go in untouched.
    return {
      bytes: encodePngImage(w, h, "gray1", img.data),
      ext: "png",
      pixelWidth: w,
      pixelHeight: h,
    };
  }
  const rgba = resampleImage(img, region, w, h);
  if (clips.length > 0) {
    const sx = w / rw;
    const sy = h / rh;
    applyClipCoverage(
      rgba,
      w,
      h,
      clips.map((c) => mapShape(c, [sx, 0, 0, sy, 0, 0])),
    );
    return {
      bytes: pngOf(rgba, w, h),
      ext: "png",
      pixelWidth: w,
      pixelHeight: h,
    };
  }
  let opaque = true;
  for (let q = 3; q < rgba.length; q += 4)
    if (rgba[q]! < 255) {
      opaque = false;
      break;
    }
  const lossySource =
    sourceFilter === "/DCTDecode" || sourceFilter === "/JPXDecode";
  // JPEG only ever for opaque pixels, where the canvas's alpha handling
  // (see `resampleImage`) has nothing to get wrong.
  const jpeg = () => {
    const cc = canvasFrom(tools, rgba, w, h);
    const bytes = cc.canvas.toBuffer("image/jpeg", JPEG_QUALITY);
    tools.factory.destroy(cc);
    return { bytes: new Uint8Array(bytes), ext: "jpeg" as const };
  };
  if (opaque && lossySource)
    return { ...jpeg(), pixelWidth: w, pixelHeight: h };
  const png = pngOf(rgba, w, h);
  if (opaque && png.length > (w * h) / 2) {
    const j = jpeg();
    if (j.bytes.length < png.length)
      return { ...j, pixelWidth: w, pixelHeight: h };
  }
  return { bytes: png, ext: "png", pixelWidth: w, pixelHeight: h };
}

/* ------------------------------------------------------------------ *
 *  Layers: render, find the ink, crop
 * ------------------------------------------------------------------ */

/**
 * The ink of a rendered layer: its bounding box in pixels, or null when blank.
 * At the bottom of the slide a pixel counts only if it would show over white
 * (a full-page white fill is how many PDFs start, and it is invisible); above
 * a picture any painted pixel counts, white included — a white box over a
 * name in a screenshot is exactly what must not be lost.
 */
export function inkBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  overWhite: boolean,
): [number, number, number, number] | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    let p = y * width * 4;
    for (let x = 0; x < width; x++, p += 4) {
      const a = data[p + 3]!;
      if (a <= 8) continue;
      // Over white, a pixel within 8 levels of white is not ink: composited
      // it is c·a + 255·(1 − a), which stays above 247 exactly when
      // (255 − c)·a stays under 8·255 for every channel.
      if (
        overWhite &&
        (255 - data[p]!) * a < 2040 &&
        (255 - data[p + 1]!) * a < 2040 &&
        (255 - data[p + 2]!) * a < 2040
      )
        continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/* ------------------------------------------------------------------ *
 *  The scanner
 * ------------------------------------------------------------------ */

function checkDeadline(deadline: number | undefined) {
  if (deadline !== undefined && Date.now() > deadline)
    throw new PageScanTimeoutError();
}

/** The operator list the painter runs, loaded by a render that paints nothing. */
async function painterOpList(
  pdfjs: NodePdfjs,
  page: NodePdfPage,
  factory: NodeCanvasFactory,
): Promise<OpList> {
  const viewport = page.getViewport({ scale: 1 });
  const cc = factory.create(1, 1);
  const holder: { list?: OpList } = {};
  const task = page.render({
    canvas: cc.canvas as unknown as HTMLCanvasElement,
    canvasContext: cc.context as unknown as CanvasRenderingContext2D,
    viewport,
    // Execute only the dependency loads: every font and image the page uses
    // is then resolved, and nothing is drawn.
    operationsFilter: (i: number) =>
      holder.list?.fnArray[i] === pdfjs.OPS.dependency,
  });
  holder.list = (
    task as unknown as { _internalRenderTask: { operatorList: OpList } }
  )._internalRenderTask.operatorList;
  await task.promise;
  factory.destroy(cc);
  if (!holder.list || !Array.isArray(holder.list.fnArray))
    // For the log; the engine reports its own sentence for any throw here.
    throw new Error("pdf.js exposed no painted operator list");
  return holder.list;
}

/**
 * Render ONE layer: the page's state ops and this layer's painting ops, onto
 * a transparent canvas covering only `region` (page points) — the union of
 * the layer's own ink boxes, outside which it cannot paint. A small arrow
 * over a screenshot is a few hundred pixels, not a page.
 */
async function renderLayer(
  pdfjs: NodePdfjs,
  page: NodePdfPage,
  factory: NodeCanvasFactory,
  ol: OpList,
  tables: OpTables,
  keep: Set<number>,
  scale: number,
  region: Box,
): Promise<{
  data: Uint8ClampedArray;
  cc: NodeCanvasAndContext;
  width: number;
  height: number;
  /** The canvas's top-left, in pixels at `scale` from the page's. */
  originX: number;
  originY: number;
}> {
  const viewport = page.getViewport({ scale });
  const originX = Math.max(0, Math.floor(region[0] * scale));
  const originY = Math.max(0, Math.floor(region[1] * scale));
  const width = Math.max(
    1,
    Math.min(Math.ceil(viewport.width), Math.ceil(region[2] * scale)) - originX,
  );
  const height = Math.max(
    1,
    Math.min(Math.ceil(viewport.height), Math.ceil(region[3] * scale)) -
      originY,
  );
  const cc = factory.create(width, height);
  const task = page.render({
    canvas: cc.canvas as unknown as HTMLCanvasElement,
    canvasContext: cc.context as unknown as CanvasRenderingContext2D,
    viewport,
    transform: [1, 0, 0, 1, -originX, -originY],
    background: "rgba(0,0,0,0)",
    operationsFilter: (i: number) =>
      keep.has(i) || !isPaint(tables, pdfjs.OPS, ol, i),
  });
  await task.promise;
  return {
    data: cc.context.getImageData(0, 0, width, height).data,
    cc,
    width,
    height,
    originX,
    originY,
  };
}

/** The RGBA pixels inside `box`, copied out of a full layer. */
function cropRgba(
  data: Uint8ClampedArray,
  width: number,
  [x0, y0, x1, y1]: [number, number, number, number],
): Uint8ClampedArray {
  const w = x1 - x0;
  const out = new Uint8ClampedArray(w * (y1 - y0) * 4);
  for (let y = y0; y < y1; y++)
    out.set(
      data.subarray((y * width + x0) * 4, (y * width + x1) * 4),
      (y - y0) * w * 4,
    );
  return out;
}

/* ------------------------------------------------------------------ *
 *  The decode budget
 * ------------------------------------------------------------------ */

/** One page's share of the budget. */
export interface PageDecodePlan {
  /**
   * pdf.js's `maxImageSize` for this page: images of more pixels are left
   * out by pdf.js before it decodes them. Never below the floor for images
   * the inventory did not see, unless the page needs it lower.
   */
  cap: number;
  /** Images the page uses that the cap leaves out: too large to carry. */
  tooLarge: number;
  /**
   * Bytes of the images it admits: of the images it USES on an exact page,
   * of the ones it merely declares (an upper bound) on an inexact one.
   */
  bytes: number;
  /**
   * The page's content could not be read, and an image it can reach is over
   * `cap`: pdf.js removes that image if the page paints it, and nothing can
   * say whether it does. Not counted in `tooLarge` (the page may not paint
   * it); the page may not be called empty either.
   */
  unverified: boolean;
}

/**
 * Each page's pixel ceiling, from a BYTE budget over what it will decode.
 *
 * pdf.js has one knob — a pixel ceiling per document — and it removes larger
 * images silently. So the ceiling is chosen per page from the inventory: the
 * page's images, smallest first, are admitted while their bytes fit
 * `pageBytes`; the ceiling sits between the largest admitted and the
 * smallest left out, and the left-out ones are COUNTED, so the result can say
 * a picture was not carried rather than that the page was empty. Images of
 * one pixel count are admitted or left out together: the ceiling cannot tell
 * them apart. Pages that leave nothing out share one ceiling, at least
 * `floorPixels`, so a typical document opens pdf.js once.
 *
 * AN INEXACT PAGE (its content could not be read, so its `images` are what
 * it DECLARES — an upper bound, not a count) gets the same ceiling, and is
 * not charged for what it leaves out. Its ceiling bounds what it decodes
 * whatever it paints, since it paints nothing it does not declare; but what
 * the ceiling leaves out it may never have painted, so none of it is
 * counted (`tooLarge` 0) and the page is `unverified` instead. The
 * document's total, which refuses a file outright, counts only what exact
 * pages are SEEN to decode: a refusal may not rest on what a page only
 * declares.
 *
 * Both halves were paid for on 2026-10-11. Counted like an exact page's, an
 * owner-password file whose twelve pages share one /Resources charged every
 * page for all twelve photos, pdf.js removed every photo, and the note
 * blamed 144 pictures' size (the second review). Given instead a ceiling
 * "never below `floorPixels`", such a page had no bound at all, and one
 * page of six 8000² photos decoded 2.2 GB — locked with an owner password,
 * or merely with a broken checksum on its content stream (the second
 * re-review). The locked album is now read exactly (`./standard-security`),
 * so neither trade is made for it.
 */
export function decodeBudgetPlan(
  pages: readonly PageInventory[],
  {
    pageBytes = PAGE_DECODE_BUDGET_BYTES,
    floorPixels = MAX_DECODED_IMAGE_PIXELS,
  }: { pageBytes?: number; floorPixels?: number } = {},
): { pages: PageDecodePlan[]; bytes: number } {
  const px = (i: { width: number; height: number }) => i.width * i.height;
  const measured = pages.map((page) => {
    const sorted = [...page.images].sort((a, b) => px(a) - px(b));
    let total = 0;
    let k = 0;
    while (k < sorted.length) {
      const size = px(sorted[k]!);
      let j = k;
      let group = 0;
      while (j < sorted.length && px(sorted[j]!) === size)
        group += sorted[j++]!.bytes;
      if (total + group > pageBytes) break;
      total += group;
      k = j;
    }
    return {
      exact: page.exact,
      admitted: k > 0 ? px(sorted[k - 1]!) : 0,
      smallestOut: k < sorted.length ? px(sorted[k]!) : Infinity,
      tooLarge: sorted.length - k,
      bytes: total,
    };
  });
  const shared = Math.max(
    floorPixels,
    ...measured.filter((m) => m.tooLarge === 0).map((m) => m.admitted),
  );
  return {
    pages: measured.map((m) => {
      if (m.tooLarge === 0)
        return { cap: shared, tooLarge: 0, bytes: m.bytes, unverified: false };
      const cap = Math.max(
        m.admitted,
        Math.min(floorPixels, m.smallestOut - 1),
      );
      // What an inexact page leaves out, it may never have painted.
      return m.exact
        ? { cap, tooLarge: m.tooLarge, bytes: m.bytes, unverified: false }
        : { cap, tooLarge: 0, bytes: m.bytes, unverified: true };
    }),
    bytes: measured.reduce((n, m) => n + (m.exact ? m.bytes : 0), 0),
  };
}

/**
 * What the scan knows, before pdf.js runs, about each page's pictures: the
 * page inventory when pdf-lib can read the page tree (an encrypted file's
 * once its object streams are read, {@link unlockObjectStreams}); otherwise
 * every image the file holds, as one inexact page that stands for each of
 * them (its images' dictionaries are top-level, in the clear). `forPage` is
 * null for a page the inventory does not hold. A file pdf-lib cannot load,
 * or whose objects cannot be walked, has no plan at all:
 * {@link PageScanUnreadableError}, before pdf.js is opened.
 */
async function planPages(
  lib: import("pdf-lib").PDFDocument | null,
  pageBytes: number | undefined,
): Promise<{
  forPage(n: number): PageDecodePlan | null;
  bytes: number;
  /**
   * The pictures page `n` paints on the page, as the file says (every
   * placement, stencils included), and its size; null when the page's
   * content could not be read. What a page left out unscanned is counted by.
   */
  shown(n: number): { pictures: number; width: number; height: number } | null;
}> {
  if (!lib) throw new PageScanUnreadableError("pdf-lib cannot load the file");
  const opts = pageBytes !== undefined ? { pageBytes } : {};
  await unlockObjectStreams(lib);
  const inventory = readInventory(lib);
  if (inventory) {
    const plan = decodeBudgetPlan(inventory, opts);
    return {
      forPage: (n) => plan.pages[n - 1] ?? null,
      bytes: plan.bytes,
      shown: (n) => {
        const inv = inventory[n - 1];
        if (!inv?.exact) return null;
        const on = inv.placements.filter(
          (p) =>
            !!inv.images[p.image] &&
            Math.min(p.box[2], inv.width) - Math.max(p.box[0], 0) > 0.5 &&
            Math.min(p.box[3], inv.height) - Math.max(p.box[1], 0) > 0.5,
        );
        return { pictures: on.length, width: inv.width, height: inv.height };
      },
    };
  }
  const images = documentImages(lib);
  if (!images)
    throw new PageScanUnreadableError("the file's objects cannot be walked");
  const plan = decodeBudgetPlan(
    [
      {
        pageNumber: 0,
        width: 0,
        height: 0,
        images,
        placements: [],
        visibleTextOps: 0,
        exact: false,
      },
    ],
    opts,
  );
  return {
    forPage: () => plan.pages[0]!,
    bytes: plan.bytes,
    shown: () => null,
  };
}

/**
 * The pictures alone would take more decoding than the worker allows for one
 * document. Deterministic, and refused before any decoding.
 */
export class PageScanDecodeBudgetError extends Error {
  constructor(
    readonly bytes: number,
    readonly limitBytes: number,
  ) {
    super(
      `page scan would decode ${bytes} bytes of images, over ${limitBytes}`,
    );
    this.name = "PageScanDecodeBudgetError";
  }
}

type ObjectPool = { has(id: string): boolean; get(id: string): unknown };

function poolOf(page: NodePdfPage, id: string): ObjectPool {
  return (id.startsWith("g_")
    ? page.commonObjs
    : page.objs) as unknown as ObjectPool;
}

/** Pixels pdf.js would paint itself, at native size, for op `i`; or null. */
function rasterPaintPixels(
  pdfjs: NodePdfjs,
  page: NodePdfPage,
  ol: OpList,
  i: number,
): number | null {
  const { OPS } = pdfjs;
  const fn = ol.fnArray[i]!;
  const args = ol.argsArray[i] ?? [];
  const dims = (v: unknown): number => {
    const o = v as { width?: unknown; height?: unknown } | null;
    return o && typeof o.width === "number" && typeof o.height === "number"
      ? o.width * o.height
      : 0;
  };
  const byId = (id: unknown): number => {
    if (typeof id !== "string") return 0;
    const pool = poolOf(page, id);
    return pool.has(id) ? dims(pool.get(id)) : 0;
  };
  switch (fn) {
    case OPS.paintImageXObject:
      return typeof args[1] === "number" && typeof args[2] === "number"
        ? args[1] * args[2]
        : byId(args[0]);
    case OPS.paintImageXObjectRepeat:
      return byId(args[0]);
    case OPS.paintInlineImageXObject:
    case OPS.paintInlineImageXObjectGroup:
    case OPS.paintImageMaskXObject:
    case OPS.paintImageMaskXObjectRepeat:
      return dims(args[0]);
    case OPS.paintImageMaskXObjectGroup:
      return Math.max(0, ...((args[0] ?? []) as unknown[]).map(dims));
    default:
      return null;
  }
}

/** The image op `i`'s object id when pdf.js holds no pixels for it. */
function undecodedAt(
  pdfjs: NodePdfjs,
  page: NodePdfPage,
  ol: OpList,
  i: number,
): string | null {
  const { OPS } = pdfjs;
  const fn = ol.fnArray[i]!;
  if (fn !== OPS.paintImageXObject && fn !== OPS.paintImageXObjectRepeat)
    return null;
  const id = ol.argsArray[i]?.[0];
  if (typeof id !== "string") return null;
  const pool = poolOf(page, id);
  return pool.has(id) && !isDecodedImage(pool.get(id)) ? id : null;
}

/** Bytes of decoded images in pdf.js's document-wide pool. */
function sharedImageBytes(page: NodePdfPage): number {
  let total = 0;
  for (const [, data] of page.commonObjs as unknown as Iterable<
    [string, unknown]
  >)
    if (isDecodedImage(data)) total += data.data.length;
  return total;
}

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

type Opened = Awaited<ReturnType<typeof openNodePdf>>;

async function openClassified(
  bytes: Uint8Array,
  maxImageSize: number,
): Promise<Opened> {
  try {
    return await openNodePdf(bytes, { maxImageSize });
  } catch (error) {
    if (error instanceof PdfEncryptedError)
      throw new PdfTextOpenError("needs-password");
    if (error instanceof PdfEngineError && error.kind === "unreadable")
      throw new PdfTextOpenError("unreadable");
    throw error;
  }
}

/**
 * Scan every page of `bytes`. Throws the engine's typed open errors for a file
 * pdf.js refuses, {@link PageScanTimeoutError} past the deadline,
 * {@link PageScanTooLargeError} past the media budget and
 * {@link PageScanDecodeBudgetError} past the document's decode budget.
 *
 * Before pdf.js decodes a page, `./page-inventory` says what it will decode,
 * and {@link decodeBudgetPlan} sets the page's ceiling: what that leaves out
 * is counted on the page (`picturesTooLarge`), never silently gone. An
 * encrypted file is read like any other. A page whose content still cannot
 * be read is held to the page budget over all it can reach, and is
 * `picturesUnverified` where that leaves a picture out. A file whose page
 * tree pdf-lib cannot read is planned from every image it holds
 * ({@link planPages}). A file the reader cannot plan at all — pdf-lib
 * cannot load it, or pdf.js finds a page the inventory does not hold — is
 * not scanned: {@link PageScanUnreadableError}, before any page is drawn.
 * (Until 2026-10-11 such a page was drawn at the floor ceiling, with no
 * bound.) An owner-password file in the object-stream layout is planned
 * like any other: until 2026-10-11 it threw here, outside any try.
 */
export const scanPdfPages: PdfPageScanner = async (bytes, options = {}) => {
  const loadLib = pdfLibLoader(bytes);
  const budget = await planPages(
    await loadLib(),
    options.pageDecodeBudgetBytes,
  );
  // After `planPages`, which reads an encrypted file's object streams.
  const lib = await loadLib();
  const frames = lib ? mediaFrames(lib) : null;
  const documentBudget =
    options.documentDecodeBudgetBytes ?? DOCUMENT_DECODE_BUDGET_BYTES;
  if (budget.bytes > documentBudget && !options.picturesOnly)
    throw new PageScanDecodeBudgetError(budget.bytes, documentBudget);
  const bestEffort = !!options.picturesOnly;
  // Opening a document decodes no image; the first page's ceiling, or the
  // smallest, until every page is known to have a plan.
  const first = await openClassified(bytes, budget.forPage(1)?.cap ?? 1);
  const { pdfjs } = first;
  const pageCount = first.doc.numPages;
  // Every page pdf.js will draw has a plan before ANY page is drawn: one it
  // finds beyond the page tree pdf-lib walked has none, and is not drawn
  // without a bound — the whole file is handed back as unreadable.
  const plans: PageDecodePlan[] = [];
  for (let n = 1; n <= pageCount; n++) {
    const plan = budget.forPage(n);
    if (!plan) {
      await first.close();
      throw new PageScanUnreadableError(
        `pdf.js reads ${pageCount} pages, the page tree holds ${n - 1}`,
      );
    }
    plans.push(plan);
  }
  const planFor = (n: number) => plans[n - 1]!;
  // Best effort: the pages whose pictures are decoded are admitted in page
  // order while the document's decode budget holds; the others are not
  // given to pdf.js at all, and their pictures are counted.
  const decoded = new Set<number>();
  {
    let spent = 0;
    for (let n = 1; n <= pageCount; n++)
      if (!bestEffort || spent + planFor(n).bytes <= documentBudget) {
        spent += planFor(n).bytes;
        decoded.add(n);
      }
  }
  const capFor = (n: number) => planFor(n).cap;
  const instances = new Map<number, Opened>([[capFor(1), first]]);
  const lastUse = new Map<number, number>();
  for (let n = 1; n <= pageCount; n++) lastUse.set(capFor(n), n);
  const instance = async (cap: number): Promise<Opened> => {
    const known = instances.get(cap);
    if (known) return known;
    const opened = await openClassified(bytes, cap);
    instances.set(cap, opened);
    return opened;
  };

  const media = new Map<string, ScannedMedia>();
  let mediaBytes = 0;
  // Best effort: what each picture adds to the file besides its media, and
  // how many have been placed, so the budget bounds the file.
  const overhead = bestEffort ? (options.pictureOverheadBytes ?? 0) : 0;
  let placed = 0;
  const overBudget = (more: number) =>
    options.maxMediaBytes !== undefined &&
    mediaBytes + more + (placed + 1) * overhead > options.maxMediaBytes;
  const addMedia = (m: ScannedMedia): ScannedMedia => {
    const known = media.get(m.key);
    if (known) return known;
    if (overBudget(m.bytes.length)) {
      if (bestEffort) throw new MediaOverBudget();
      throw new PageScanTooLargeError(options.maxMediaBytes!);
    }
    mediaBytes += m.bytes.length;
    media.set(m.key, m);
    return m;
  };
  const late = () =>
    options.deadline !== undefined && Date.now() > options.deadline;
  const full = () =>
    options.maxPictures !== undefined && placed >= options.maxPictures;
  try {
    const raw = rawImageSource(loadLib);
    const tables = opTables(pdfjs.OPS);
    const visibility = new Map<Opened, (props: unknown) => boolean>();
    const isVisibleIn = async (o: Opened) => {
      const known = visibility.get(o);
      if (known) return known;
      const oc = await o.doc.getOptionalContentConfig({ intent: "display" });
      const fn = (props: unknown) => {
        try {
          return (
            oc as unknown as { isVisible(g: unknown): boolean }
          ).isVisible(props);
        } catch {
          return true;
        }
      };
      visibility.set(o, fn);
      return fn;
    };
    const pages: ScannedPage[] = [];
    for (let n = 1; n <= pageCount; n++) {
      if (bestEffort && (!decoded.has(n) || late() || full())) {
        // Not given to pdf.js: past the decode budget, the deadline or the
        // picture count. Its text is poppler's, not this reader's; its
        // pictures are counted from the file, and a page whose content
        // could not be read is never called empty.
        const shown = budget.shown(n);
        pages.push({
          pageNumber: n,
          width: shown?.width ?? 612,
          height: shown?.height ?? 792,
          items: [],
          picturesTooLarge: 0,
          picturesUndecoded: 0,
          picturesUnverified: !shown,
          picturesOverBudget: shown?.pictures ?? 0,
          flattened: false,
          ...(frames?.[n - 1] ? { mediaFrame: frames[n - 1]! } : {}),
        });
        continue;
      }
      checkDeadline(options.deadline);
      const cap = capFor(n);
      const opened = await instance(cap);
      const { doc } = opened;
      const factory = canvasFactoryOf(doc);
      const tools: CanvasTools = { factory };
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const base = Array.from(viewport.transform) as Matrix;
      const pageBox: Box = [0, 0, viewport.width, viewport.height];
      const ol = await painterOpList(pdfjs, page, factory);
      const elements = walkPage(
        pdfjs,
        page,
        ol,
        base,
        pageBox,
        await isVisibleIn(opened),
        tables,
        bestEffort,
      );
      const scale = Math.min(
        LAYER_DPI / 72,
        MAX_PICTURE_SIDE / Math.max(viewport.width, viewport.height),
      );
      // Rasters pdf.js would have to paint itself past the paint budget are
      // left out of every drawing, and counted; images it could not decode
      // are counted once each.
      const unpaintable = new Set<number>();
      const undecoded = new Set<string>();
      for (let i = 0; i < ol.fnArray.length; i++) {
        const pixels = rasterPaintPixels(pdfjs, page, ol, i);
        if (
          pixels !== null &&
          pixels * PAINT_BYTES_PER_PIXEL > PAINT_BUDGET_BYTES
        )
          unpaintable.add(i);
        const lost = undecodedAt(pdfjs, page, ol, i);
        if (lost) undecoded.add(lost);
      }
      const items: ScannedItem[] = [];
      let tooLargeHere = planFor(n).tooLarge;
      let overBudgetHere = 0;
      let flattened = false;
      if (bestEffort) {
        // PDF to Word: every picture, each with whatever the page paints
        // over it painted in; the drawing itself is not rendered.
        for (let k = 0; k < elements.length; k++) {
          const el = elements[k]!;
          if (el.kind === "text") {
            items.push(el.line);
            continue;
          }
          if (el.kind !== "image") continue;
          if (late() || full()) {
            overBudgetHere++;
            continue;
          }
          // What the page paints later over this picture, and can show:
          // drawing, pictures, visible text (an OCR layer shows nothing).
          const over = elements
            .slice(k + 1)
            .filter(
              (o) =>
                overlaps(o.box, el.box) &&
                (o.kind !== "text" || o.line.runs.some((r) => !r.invisible)),
            );
          let pic: ScannedPicture | "undecoded" | null;
          try {
            if (el.stencil || over.length > 0) {
              // Painted by pdf.js; what it cannot paint is not delivered
              // uncovered: it is left out, and counted.
              if (
                unpaintable.has(el.op) ||
                over.some((o) => unpaintable.has(o.op))
              ) {
                tooLargeHere++;
                continue;
              }
              const painted = await paintedPicture(
                pdfjs,
                page,
                factory,
                ol,
                tables,
                el,
                over.length > 0,
                unpaintable,
                n,
                tools,
                raw,
                addMedia,
              );
              pic =
                painted === "as-placed"
                  ? await placeImage(page, el, n, tools, raw, addMedia)
                  : painted;
              await yieldToLoop();
            } else pic = await placeImage(page, el, n, tools, raw, addMedia);
          } catch (error) {
            if (!(error instanceof MediaOverBudget)) throw error;
            overBudgetHere++;
            continue;
          }
          if (pic === "undecoded")
            undecoded.add(el.objId ?? `op:${el.op}:${el.copy}`);
          else if (pic) {
            if (overBudget(0)) {
              // The media was shared with a picture already placed; the
              // picture itself still costs its place in the file.
              overBudgetHere++;
              continue;
            }
            items.push(pic);
            placed++;
          }
        }
      } else {
        const plan = planLayers(elements);
        const layers = plan.filter((step) => step.kind === "layer").length;
        flattened = layers > MAX_LAYERS_PER_PAGE;
        if (flattened) {
          // One pass over the whole page, in its own paint order: what the page
          // hides stays hidden by construction, and the cost is one render.
          const keep = new Set<number>();
          for (let i = 0; i < ol.fnArray.length; i++)
            if (isPaint(tables, pdfjs.OPS, ol, i)) {
              if (unpaintable.has(i)) tooLargeHere++;
              else keep.add(i);
            }
          const picture = await layerPicture(
            pdfjs,
            page,
            factory,
            ol,
            tables,
            keep,
            scale,
            pageBox,
            true,
            `flat:${n}`,
            addMedia,
          );
          if (picture) items.push(picture);
          for (const e of elements)
            if (e.kind === "text")
              items.push({
                ...e.line,
                runs: e.line.runs.map((r) => ({ ...r, invisible: true })),
              });
        } else {
          let firstLayer = true;
          for (const step of plan) {
            checkDeadline(options.deadline);
            if (step.kind === "text") {
              items.push((elements[step.element] as TextElement).line);
              continue;
            }
            if (step.kind === "image") {
              const el = elements[step.element] as ImageElement;
              const pic = await placeImage(page, el, n, tools, raw, addMedia);
              if (pic === "undecoded") undecoded.add(el.objId ?? `op:${el.op}`);
              else if (pic) items.push(pic);
              firstLayer = false;
              continue;
            }
            const keep = new Set<number>();
            for (const k of step.ops) {
              const op = elements[k]!.op;
              if (unpaintable.has(op)) tooLargeHere++;
              else keep.add(op);
            }
            const overWhite = firstLayer && items.length === 0;
            firstLayer = false;
            if (keep.size === 0) continue;
            const region = step.ops
              .map((k) => elements[k]!.box)
              .reduce((u, b) => [
                Math.min(u[0], b[0]),
                Math.min(u[1], b[1]),
                Math.max(u[2], b[2]),
                Math.max(u[3], b[3]),
              ]);
            const picture = await layerPicture(
              pdfjs,
              page,
              factory,
              ol,
              tables,
              keep,
              scale,
              grow(region, 1),
              overWhite,
              `layer:${n}:${items.length}`,
              addMedia,
            );
            if (picture) items.push(picture);
            // pdf.js runs a render to its end in microtasks: let the daemon's
            // own timers (its heartbeat) run between layers.
            await yieldToLoop();
          }
        }
      }
      pages.push({
        pageNumber: n,
        width: viewport.width,
        height: viewport.height,
        items,
        picturesTooLarge: tooLargeHere,
        picturesUndecoded: undecoded.size,
        picturesUnverified: planFor(n).unverified,
        ...(bestEffort ? { picturesOverBudget: overBudgetHere } : {}),
        flattened,
        ...(frames?.[n - 1] ? { mediaFrame: frames[n - 1]! } : {}),
      });
      const shared = sharedImageBytes(page);
      page.cleanup();
      if (shared > SHARED_IMAGE_BYTES) await doc.cleanup();
      if (lastUse.get(cap) === n && opened !== first) {
        instances.delete(cap);
        await opened.close();
      }
    }
    return {
      pageCount,
      pages,
      undecodedImages: pages.reduce((t, p) => t + p.picturesUndecoded, 0),
      tooLargeImages: pages.reduce((t, p) => t + p.picturesTooLarge, 0),
    };
  } finally {
    for (const o of instances.values()) await o.close();
  }
};

/**
 * Render the ops in `keep` (with every state op) over `region`, find the ink,
 * and make it a picture; null when nothing shows. `overWhite`: at the bottom
 * of the slide, where white on white is no ink.
 */
async function layerPicture(
  pdfjs: NodePdfjs,
  page: NodePdfPage,
  factory: NodeCanvasFactory,
  ol: OpList,
  tables: OpTables,
  keep: Set<number>,
  scale: number,
  region: Box,
  overWhite: boolean,
  key: string,
  addMedia: (m: ScannedMedia) => ScannedMedia,
): Promise<ScannedPicture | null> {
  const layer = await renderLayer(
    pdfjs,
    page,
    factory,
    ol,
    tables,
    keep,
    scale,
    region,
  );
  try {
    const local = inkBox(layer.data, layer.width, layer.height, overWhite);
    if (!local) return null;
    const ink: [number, number, number, number] = [
      local[0] + layer.originX,
      local[1] + layer.originY,
      local[2] + layer.originX,
      local[3] + layer.originY,
    ];
    const pixels = cropRgba(layer.data, layer.width, local);
    let opaque = true;
    for (let q = 3; q < pixels.length; q += 4)
      if (pixels[q]! < 255) {
        opaque = false;
        break;
      }
    const png = encodePngImage(
      ink[2] - ink[0],
      ink[3] - ink[1],
      opaque ? "rgb8" : "rgba8",
      pixels,
    );
    const m = addMedia({
      key,
      bytes: png,
      ext: "png",
      pixelWidth: ink[2] - ink[0],
      pixelHeight: ink[3] - ink[1],
      passthrough: false,
    });
    return {
      kind: "picture",
      role: "layer",
      media: m,
      x: ink[0] / scale,
      y: ink[1] / scale,
      width: (ink[2] - ink[0]) / scale,
      height: (ink[3] - ink[1]) / scale,
      rotation: 0,
      flipH: false,
      flipV: false,
    };
  } finally {
    factory.destroy(layer.cc);
  }
}

/**
 * Render the ops in `keep` (with every state op) so that `box` (page points)
 * fills exactly `width` × `height` pixels, on a transparent canvas.
 */
async function renderBox(
  pdfjs: NodePdfjs,
  page: NodePdfPage,
  factory: NodeCanvasFactory,
  ol: OpList,
  tables: OpTables,
  keep: ReadonlySet<number>,
  box: Box,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const sx = width / (box[2] - box[0]);
  const sy = height / (box[3] - box[1]);
  const cc = factory.create(width, height);
  try {
    await page.render({
      canvas: cc.canvas as unknown as HTMLCanvasElement,
      canvasContext: cc.context as unknown as CanvasRenderingContext2D,
      viewport: page.getViewport({ scale: 1 }),
      transform: [sx, 0, 0, sy, -box[0] * sx, -box[1] * sy],
      background: "rgba(0,0,0,0)",
      operationsFilter: (i: number) =>
        keep.has(i) || !isPaint(tables, pdfjs.OPS, ol, i),
    }).promise;
    return cc.context.getImageData(0, 0, width, height).data;
  } finally {
    factory.destroy(cc);
  }
}

/** The least resolution a picture painted with what covers it gets. */
const PAINTED_MIN_PX_PER_PT = 2;
/** Pixels a probe for ink over a picture renders at most. */
const COVER_PROBE_PIXELS = 1_000_000;

/**
 * A picture as pdf.js PAINTS it, with everything the page paints over it
 * later painted in: PDF to Word's picture for a stencil (only the painter
 * can show one), and for a picture something is painted over. Rendered over
 * the box the page shows it in, at the picture's own resolution (at least
 * {@link PAINTED_MIN_PX_PER_PT}, at most {@link MAX_PICTURE_SIDE}), so the pixels the page
 * covers are not in the file at all — not hidden under an object Word could
 * move, not cropped away where `a:srcRect` could be undone.
 *
 * `covered`: something visible overlaps it later in paint order. That is
 * looked at first, coarsely, with the picture left out: when nothing shows
 * there after all, the answer is "as-placed" and the picture goes in as any
 * other (a JPEG byte for byte). "undecoded" when pdf.js holds no pixels for
 * it; null when it shows nothing.
 */
async function paintedPicture(
  pdfjs: NodePdfjs,
  page: NodePdfPage,
  factory: NodeCanvasFactory,
  ol: OpList,
  tables: OpTables,
  el: ImageElement,
  covered: boolean,
  unpaintable: ReadonlySet<number>,
  pageNumber: number,
  tools: CanvasTools,
  raw: RawImageSource,
  addMedia: (m: ScannedMedia) => ScannedMedia,
): Promise<ScannedPicture | "undecoded" | "as-placed" | null> {
  const [x0, y0, x1, y1] = el.box;
  const bw = x1 - x0;
  const bh = y1 - y0;
  let px = el.stencil ?? null;
  let filter: string | null = null;
  if (!px) {
    let img: unknown = el.inline;
    if (el.objId) {
      const pool = poolOf(page, el.objId);
      img = pool.has(el.objId) ? pool.get(el.objId) : null;
    }
    if (!isDecodedImage(img)) return "undecoded";
    if (img.width < 1 || img.height < 1) return null;
    px = { width: img.width, height: img.height };
    if (typeof img.ref === "string") filter = await raw.filterOf(img.ref);
  }
  const size = (scale: number): [number, number] => [
    Math.max(1, Math.round(bw * scale)),
    Math.max(1, Math.round(bh * scale)),
  ];
  const later = new Set<number>();
  if (covered)
    for (let i = el.op + 1; i < ol.fnArray.length; i++)
      if (!unpaintable.has(i) && isPaint(tables, pdfjs.OPS, ol, i))
        later.add(i);
  if (covered && !el.stencil) {
    const [pw, ph] = size(
      Math.min(LAYER_DPI / 72, Math.sqrt(COVER_PROBE_PIXELS / (bw * bh))),
    );
    const ink = await renderBox(
      pdfjs,
      page,
      factory,
      ol,
      tables,
      later,
      el.box,
      pw,
      ph,
    );
    if (!inkBox(ink, pw, ph, false)) return "as-placed";
  }
  const shown = placementOf(el.m);
  const density = Math.max(
    px.width / Math.max(shown.width, 1e-6),
    px.height / Math.max(shown.height, 1e-6),
  );
  // Never below two pixels a point: a label painted over a 72-dpi callout
  // at 72 dpi is a smudge (measured: it no longer matched what the page
  // shows). Not the drawing's 200 dpi either: that only enlarges a
  // screenshot (the owner's tutorial went from 5.5 to 8.7 MB, for nothing).
  const [w, h] = size(
    Math.min(
      Math.max(density, PAINTED_MIN_PX_PER_PT),
      MAX_PICTURE_SIDE / Math.max(bw, bh),
    ),
  );
  const rgba = await renderBox(
    pdfjs,
    page,
    factory,
    ol,
    tables,
    new Set([el.op, ...later]),
    el.box,
    w,
    h,
  );
  if (!inkBox(rgba, w, h, false)) return null;
  const encoded = await encodePicture(
    tools,
    { width: w, height: h, kind: 3, data: rgba },
    filter,
  );
  const media = addMedia({
    key: `paint:${pageNumber}:${el.op}:${el.copy}`,
    ...encoded,
    passthrough: false,
  });
  return {
    kind: "picture",
    role: "image",
    media,
    x: x0,
    y: y0,
    width: bw,
    height: bh,
    rotation: 0,
    flipH: false,
    flipV: false,
  };
}

/** The inverse of an affine matrix, or null when it has none. */
function invert(m: readonly number[]): Matrix | null {
  const det = m[0]! * m[3]! - m[1]! * m[2]!;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    m[3]! / det,
    -m[1]! / det,
    -m[2]! / det,
    m[0]! / det,
    (m[2]! * m[5]! - m[3]! * m[4]!) / det,
    (m[1]! * m[4]! - m[0]! * m[5]!) / det,
  ];
}

/**
 * The clips a picture is painted through, in its own pixels (row 0 at the
 * top): the clip's box, and every clip shape in force. `null` when none of
 * them hides any of it; "hidden" when they hide all of it; otherwise the
 * pixel rectangle they can show and the shapes that cut it, relative to that
 * rectangle.
 */
function clipInPixels(
  el: ImageElement,
  width: number,
  height: number,
):
  | null
  | "hidden"
  | {
      region: [number, number, number, number];
      shapes: ClipShape[];
    } {
  const inv = invert(el.m);
  if (!inv) return "hidden";
  // Unit square (v up) → pixels (row 0 at the top).
  const toPixels = mul([width, 0, 0, -height, 0, height], inv);
  const [x0, y0, x1, y1] = el.clip;
  const all: ClipShape[] = [
    { polys: [[x0, y0, x1, y0, x1, y1, x0, y1]], evenOdd: false },
    ...el.clipShapes,
  ].map((c) => mapShape(c, toPixels));
  const picture: [number, number, number, number] = [0, 0, width, height];
  const cutting = all.filter((c) => !containsRect(c, picture, 0.5));
  if (cutting.length === 0) return null;
  let region: [number, number, number, number] = [0, 0, width, height];
  for (const c of cutting) {
    const b = polysBox(c.polys);
    region = [
      Math.max(region[0], b[0]),
      Math.max(region[1], b[1]),
      Math.min(region[2], b[2]),
      Math.min(region[3], b[3]),
    ];
  }
  const r: [number, number, number, number] = [
    Math.max(0, Math.floor(region[0])),
    Math.max(0, Math.floor(region[1])),
    Math.min(width, Math.ceil(region[2])),
    Math.min(height, Math.ceil(region[3])),
  ];
  if (r[2] - r[0] < 1 || r[3] - r[1] < 1) return "hidden";
  const local = [1, 0, 0, 1, -r[0], -r[1]];
  const rect: [number, number, number, number] = [
    0,
    0,
    r[2] - r[0],
    r[3] - r[1],
  ];
  const shapes = cutting
    .map((c) => mapShape(c, local))
    .filter((c) => !containsRect(c, rect, 0.5));
  return { region: r, shapes };
}

/**
 * A picture op's picture: its decoded pixels as media, at its place.
 *
 * Upright and cut only by a rectangle on the page, it is the whole picture
 * with a crop (srcRect), so a plain JPEG still goes in byte for byte and the
 * crop can be undone in PowerPoint. Turned, or cut by anything that is not
 * an upright rectangle, it is the part its clip can show, cut to the clip's
 * shape (`./picture-pixels`), placed at its own angle: what the page hides is
 * neither shown nor in the file.
 */
async function placeImage(
  page: NodePdfPage,
  el: ImageElement,
  pageNumber: number,
  tools: CanvasTools,
  raw: RawImageSource,
  addMedia: (m: ScannedMedia) => ScannedMedia,
): Promise<ScannedPicture | "undecoded" | null> {
  let img: unknown = el.inline;
  if (el.objId) {
    const pool = (el.objId.startsWith("g_")
      ? page.commonObjs
      : page.objs) as unknown as {
      has(id: string): boolean;
      get(id: string): unknown;
    };
    img = pool.has(el.objId) ? pool.get(el.objId) : null;
  }
  if (!isDecodedImage(img)) return "undecoded";
  if (img.width < 1 || img.height < 1) return null;
  const placement = placementOf(el.m);
  const ref = typeof img.ref === "string" ? img.ref : null;
  if (!isAxisAligned(placement) || el.clipShapes.length > 0) {
    const cut = clipInPixels(el, img.width, img.height);
    if (cut === "hidden") return null;
    if (cut) {
      const [x0, y0, x1, y1] = cut.region;
      const filter = ref ? await raw.filterOf(ref) : null;
      const encoded = await encodePicture(
        tools,
        img,
        filter,
        cut.region,
        cut.shapes,
      );
      const m = addMedia({
        key: `img:${pageNumber}:${el.op}:${el.copy}:cut`,
        ...encoded,
        passthrough: false,
      });
      // The unit square of the part shown, in the picture's unit square.
      const part = [
        (x1 - x0) / img.width,
        0,
        0,
        (y1 - y0) / img.height,
        x0 / img.width,
        1 - y1 / img.height,
      ];
      return {
        kind: "picture",
        role: "image",
        media: m,
        ...placementOf(mul(el.m, part)),
      };
    }
    // No clip hides any of it: the whole picture, at its angle.
  }
  let crop: ScannedPicture["crop"];
  let box: Placement = placement;
  if (isAxisAligned(placement)) {
    const full: Box = [
      placement.x,
      placement.y,
      placement.x + placement.width,
      placement.y + placement.height,
    ];
    const seen = intersect(full, el.clip);
    if (!seen) return null;
    const w = full[2] - full[0];
    const h = full[3] - full[1];
    const left = (seen[0] - full[0]) / w;
    const right = (full[2] - seen[2]) / w;
    let top = (seen[1] - full[1]) / h;
    let bottom = (full[3] - seen[3]) / h;
    if (placement.flipV) [top, bottom] = [bottom, top];
    if (left + right + top + bottom > 0.002) {
      crop = { left, top, right, bottom };
      box = {
        ...placement,
        x: seen[0],
        y: seen[1],
        width: seen[2] - seen[0],
        height: seen[3] - seen[1],
      };
    }
  }
  const key = ref ? `ref:${ref}` : `img:${pageNumber}:${el.op}:${el.copy}`;
  let m: ScannedMedia;
  const passthrough =
    ref && img.kind !== 1 && Math.max(img.width, img.height) <= MAX_PICTURE_SIDE
      ? await raw.jpeg(ref, img.width, img.height)
      : null;
  if (passthrough) {
    m = addMedia({
      key,
      // A PDF shows a JPEG's stored pixels: it has no notion of EXIF, and
      // pdf.js ignores the tag. A reader of the Office file that honoured it
      // would turn the photo, so the tag is set to "as stored" — a two-byte
      // patch on a copy, the pixels byte for byte (`uprightJpeg`). Until the
      // review of 2026-10-17 it went through, tag and all.
      bytes: uprightJpeg(passthrough).bytes,
      ext: "jpeg",
      pixelWidth: img.width,
      pixelHeight: img.height,
      passthrough: true,
    });
  } else {
    const filter = ref ? await raw.filterOf(ref) : null;
    const encoded = await encodePicture(tools, img, filter);
    m = addMedia({ key, ...encoded, passthrough: false });
  }
  return {
    kind: "picture",
    role: "image",
    media: m,
    ...box,
    ...(crop ? { crop } : {}),
  };
}

/** The plain text a scanned page carries, line by line, for coverage. */
export function scannedPageText(page: ScannedPage): string {
  return page.items
    .filter((i): i is ScannedTextLine => i.kind === "text")
    .map((l) => l.runs.map((r) => r.text).join(""))
    .join("\n");
}
