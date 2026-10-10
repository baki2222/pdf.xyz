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
 *               picture at its CTM, cropped to its clip when axis-aligned; a
 *               plain DCT JPEG goes in byte for byte, anything else is
 *               re-encoded from pdf.js's decoded pixels, capped in size
 *   other ink   every remaining painting op, rendered by pdf.js into
 *               transparent layers, omitted when blank
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
 * layer. Text used as a clip (render modes 4–7) clips nothing in the layers.
 * Image masks, repeated and grouped inline images are drawn into the layers,
 * not placed as pictures. Right-to-left text is written in the order it is
 * painted. Vertical text is approximated. Each is a rendering difference, not
 * a loss of content.
 */
import { PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";
import { PdfEncryptedError, PdfEngineError } from "@/lib/pdf/engine";
import { PdfTextOpenError } from "../pdf-text/errors";
import {
  canvasFactoryOf,
  openNodePdf,
  type NodeCanvasAndContext,
  type NodeCanvasFactory,
  type NodePdfjs,
  type NodePdfPage,
} from "./pdfjs-node";
import { encodePngImage } from "./png-encode";

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
}

export interface PdfPageScan {
  pageCount: number;
  pages: ScannedPage[];
  /** Images pdf.js could not decode (it resolves them to null). */
  undecodedImages: number;
}

export interface PageScanOptions {
  /** Epoch ms after which the scan gives up. */
  deadline?: number;
  /** Total media bytes allowed before the scan stops as too large. */
  maxMediaBytes?: number;
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

/** Longest side, in pixels, of a colour or grey picture written to the deck. */
export const MAX_PICTURE_SIDE = 2400;
/** Bilevel scans stay crisp and small as 1-bit PNGs, so they get more room. */
export const MAX_BILEVEL_PICTURE_SIDE = 3600;
/** Rendered layers: this resolution, unless the page would pass the cap. */
export const LAYER_DPI = 200;
/** JPEG quality for re-encoded photographs. */
export const JPEG_QUALITY = 90;

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
  clip: Box;
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
  m: Matrix;
  clip: Box;
  box: Box;
  objId: string | null;
  inline: unknown;
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
  let pendingClip = false;
  const save = () => {
    stack.push(st);
    st = { ...st };
  };
  const restore = () => {
    st = stack.pop() ?? st;
    pendingClip = false;
  };
  const vector = (op: number, box: Box | null) => {
    const clipped = box ? intersect(box, st.clip) : st.clip;
    if (clipped) elements.push({ kind: "vector", op, box: clipped });
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
    const ascent = Math.min(Math.max(font.ascent ?? 0.8, 0.5), 1.2);
    const descent = Math.min(Math.max(-(font.descent ?? -0.2), 0.05), 0.6);
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
        if (bbox)
          st.clip = intersect(st.clip, boxOf(st.ctm, bbox)) ?? [0, 0, 0, 0];
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
        if (group.bbox) {
          const m = group.matrix ? mul(st.ctm, group.matrix) : st.ctm;
          st.clip = intersect(st.clip, boxOf(m, group.bbox)) ?? [0, 0, 0, 0];
        }
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
      case OPS.eoClip:
        pendingClip = true;
        break;
      case OPS.endPath:
        pendingClip = false;
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
          if (local) st.clip = intersect(st.clip, local) ?? [0, 0, 0, 0];
          pendingClip = false;
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
        const box = intersect(boxOf(st.ctm, [0, 0, 1, 1]), st.clip);
        if (!box) break;
        elements.push({
          kind: "image",
          op: i,
          m: st.ctm,
          clip: st.clip,
          box,
          objId: fn === OPS.paintImageXObject ? String(args[0]) : null,
          inline: fn === OPS.paintInlineImageXObject ? args[0] : null,
        });
        break;
      }
      default:
        if (!visible) break;
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

interface DecodedImage {
  width: number;
  height: number;
  /** pdf.js ImageKind: 1 = 1-bit grey, 2 = RGB, 3 = RGBA. */
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
  ref?: string;
}

function isDecodedImage(v: unknown): v is DecodedImage {
  const o = v as DecodedImage | null;
  return (
    !!o &&
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    typeof o.kind === "number" &&
    !!o.data &&
    typeof (o.data as Uint8Array).length === "number"
  );
}

/** RGBA, top row first, from any of pdf.js's three image kinds. */
function toRgba(img: DecodedImage): Uint8ClampedArray {
  const { width, height, kind, data } = img;
  const out = new Uint8ClampedArray(width * height * 4);
  if (kind === 3) {
    out.set(data.subarray(0, out.length));
    return out;
  }
  if (kind === 2) {
    for (let p = 0, q = 0; q < out.length; p += 3, q += 4) {
      out[q] = data[p]!;
      out[q + 1] = data[p + 1]!;
      out[q + 2] = data[p + 2]!;
      out[q + 3] = 255;
    }
    return out;
  }
  // 1 bit per pixel, rows padded to a byte; a set bit is white.
  const rowBytes = (width + 7) >> 3;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
      const q = (y * width + x) * 4;
      const v = bit ? 255 : 0;
      out[q] = out[q + 1] = out[q + 2] = v;
      out[q + 3] = 255;
    }
  return out;
}

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

function rawImageSource(bytes: Uint8Array): RawImageSource {
  let doc: Promise<import("pdf-lib").PDFDocument | null> | undefined;
  const load = () => {
    doc ??= import("pdf-lib")
      .then(({ PDFDocument }) =>
        PDFDocument.load(bytes, {
          ignoreEncryption: true,
          updateMetadata: false,
          throwOnInvalidObject: false,
        }),
      )
      .then((d) => (d.isEncrypted ? null : d))
      .catch(() => null);
    return doc;
  };
  const stream = async (ref: string): Promise<PDFRawStream | null> => {
    const m = /^(\d+)R(\d*)$/.exec(ref);
    if (!m) return null;
    const d = await load();
    if (!d) return null;
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
 * Shrink RGBA pixels to `width` × `height` by averaging each target pixel's
 * footprint, in premultiplied alpha so a transparent edge does not darken.
 *
 * Not the canvas's `drawImage`: measured on @napi-rs/canvas 1.0.2 (the one
 * pdf.js hands back), a canvas pdf.js created reads back transparent through
 * `getImageData` but is copied by `drawImage`, and encoded by `toBuffer`, as
 * OPAQUE white wherever it was transparent. A layer over a screenshot came
 * out as a white rectangle hiding it. Pixels leave the canvas through
 * `getImageData` only; PNGs are written by `./png-encode`.
 */
export function downscaleRgba(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const fx = sw / width;
  const fy = sh / height;
  for (let ty = 0; ty < height; ty++) {
    const y0 = ty * fy;
    const y1 = Math.min(sh, (ty + 1) * fy);
    for (let tx = 0; tx < width; tx++) {
      const x0 = tx * fx;
      const x1 = Math.min(sw, (tx + 1) * fx);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          const w = wx * wy;
          const p = (y * sw + x) * 4;
          const alpha = src[p + 3]! / 255;
          r += src[p]! * alpha * w;
          g += src[p + 1]! * alpha * w;
          b += src[p + 2]! * alpha * w;
          a += alpha * w;
          area += w;
        }
      }
      const q = (ty * width + tx) * 4;
      if (a > 0) {
        out[q] = r / a;
        out[q + 1] = g / a;
        out[q + 2] = b / a;
      }
      out[q + 3] = (a / area) * 255;
    }
  }
  return out;
}

function fitWithin(
  width: number,
  height: number,
  max: number,
): [number, number] {
  const longest = Math.max(width, height);
  if (longest <= max) return [width, height];
  const s = max / longest;
  return [
    Math.max(1, Math.round(width * s)),
    Math.max(1, Math.round(height * s)),
  ];
}

/**
 * Encode a decoded picture: PNG for anything with transparency, flat colour
 * or two tones; JPEG for photographs (a lossy source, or a PNG that came out
 * heavier than four bits a pixel).
 */
async function encodePicture(
  tools: CanvasTools,
  img: DecodedImage,
  sourceFilter: string | null,
): Promise<Omit<ScannedMedia, "key" | "passthrough">> {
  const bilevel = img.kind === 1;
  const [w, h] = fitWithin(
    img.width,
    img.height,
    bilevel ? MAX_BILEVEL_PICTURE_SIDE : MAX_PICTURE_SIDE,
  );
  if (bilevel && w === img.width && h === img.height) {
    // pdf.js packs these 1 bit a pixel, set bit = white: a PNG's own
    // 1-bit grey layout, so the rows go in untouched.
    return {
      bytes: encodePngImage(w, h, "gray1", img.data),
      ext: "png",
      pixelWidth: w,
      pixelHeight: h,
    };
  }
  let rgba = toRgba(img);
  if (w !== img.width || h !== img.height)
    rgba = downscaleRgba(rgba, img.width, img.height, w, h);
  let opaque = true;
  let grey = true;
  for (let q = 0; q < rgba.length; q += 4) {
    if (rgba[q + 3]! < 255) opaque = false;
    if (rgba[q] !== rgba[q + 1] || rgba[q] !== rgba[q + 2]) grey = false;
    if (!opaque && !grey) break;
  }
  const lossySource =
    sourceFilter === "/DCTDecode" || sourceFilter === "/JPXDecode";
  // JPEG only ever for opaque pixels, where the canvas's alpha handling
  // (see `downscaleRgba`) has nothing to get wrong.
  const jpeg = () => {
    const cc = canvasFrom(tools, rgba, w, h);
    const bytes = cc.canvas.toBuffer("image/jpeg", JPEG_QUALITY);
    tools.factory.destroy(cc);
    return { bytes: new Uint8Array(bytes), ext: "jpeg" as const };
  };
  if (opaque && lossySource)
    return { ...jpeg(), pixelWidth: w, pixelHeight: h };
  const png = encodePngImage(
    w,
    h,
    opaque ? (grey ? "gray8" : "rgb8") : "rgba8",
    rgba,
  );
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

/**
 * Scan every page of `bytes`. Throws the engine's typed open errors for a file
 * pdf.js refuses, {@link PageScanTimeoutError} past the deadline and
 * {@link PageScanTooLargeError} past the media budget.
 */
export const scanPdfPages: PdfPageScanner = async (bytes, options = {}) => {
  let opened: Awaited<ReturnType<typeof openNodePdf>>;
  try {
    opened = await openNodePdf(bytes);
  } catch (error) {
    if (error instanceof PdfEncryptedError)
      throw new PdfTextOpenError("needs-password");
    if (error instanceof PdfEngineError && error.kind === "unreadable")
      throw new PdfTextOpenError("unreadable");
    throw error;
  }
  const { pdfjs, doc, close } = opened;
  const media = new Map<string, ScannedMedia>();
  let mediaBytes = 0;
  const addMedia = (m: ScannedMedia): ScannedMedia => {
    const known = media.get(m.key);
    if (known) return known;
    mediaBytes += m.bytes.length;
    if (
      options.maxMediaBytes !== undefined &&
      mediaBytes > options.maxMediaBytes
    )
      throw new PageScanTooLargeError(options.maxMediaBytes);
    media.set(m.key, m);
    return m;
  };
  let undecodedImages = 0;
  try {
    const factory = canvasFactoryOf(doc);
    const tools: CanvasTools = { factory };
    const raw = rawImageSource(bytes);
    const tables = opTables(pdfjs.OPS);
    const oc = await doc.getOptionalContentConfig({ intent: "display" });
    const isVisible = (props: unknown) => {
      try {
        return (oc as unknown as { isVisible(g: unknown): boolean }).isVisible(
          props,
        );
      } catch {
        return true;
      }
    };
    const pages: ScannedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      checkDeadline(options.deadline);
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
        isVisible,
        tables,
      );
      const plan = planLayers(elements);
      const items: ScannedItem[] = [];
      const scale = Math.min(
        LAYER_DPI / 72,
        MAX_PICTURE_SIDE / Math.max(viewport.width, viewport.height),
      );
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
          if (pic === "undecoded") undecodedImages++;
          else if (pic) items.push(pic);
          firstLayer = false;
          continue;
        }
        const keep = new Set(step.ops.map((k) => elements[k]!.op));
        const overWhite = firstLayer && items.length === 0;
        firstLayer = false;
        const region = step.ops
          .map((k) => elements[k]!.box)
          .reduce((u, b) => [
            Math.min(u[0], b[0]),
            Math.min(u[1], b[1]),
            Math.max(u[2], b[2]),
            Math.max(u[3], b[3]),
          ]);
        const layer = await renderLayer(
          pdfjs,
          page,
          factory,
          ol,
          tables,
          keep,
          scale,
          grow(region, 1),
        );
        const local = inkBox(layer.data, layer.width, layer.height, overWhite);
        const ink: [number, number, number, number] | null = local && [
          local[0] + layer.originX,
          local[1] + layer.originY,
          local[2] + layer.originX,
          local[3] + layer.originY,
        ];
        if (ink) {
          const pixels = cropRgba(layer.data, layer.width, local!);
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
            key: `layer:${n}:${items.length}`,
            bytes: png,
            ext: "png",
            pixelWidth: ink[2] - ink[0],
            pixelHeight: ink[3] - ink[1],
            passthrough: false,
          });
          items.push({
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
          });
        }
        factory.destroy(layer.cc);
      }
      pages.push({
        pageNumber: n,
        width: viewport.width,
        height: viewport.height,
        items,
      });
      page.cleanup();
    }
    return { pageCount: doc.numPages, pages, undecodedImages };
  } finally {
    await close();
  }
};

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
  const ref = typeof img.ref === "string" ? img.ref : null;
  const key = ref ? `ref:${ref}` : `img:${pageNumber}:${el.op}`;
  let m: ScannedMedia;
  const passthrough =
    ref && img.kind !== 1 && Math.max(img.width, img.height) <= MAX_PICTURE_SIDE
      ? await raw.jpeg(ref, img.width, img.height)
      : null;
  if (passthrough) {
    m = addMedia({
      key,
      bytes: passthrough,
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
