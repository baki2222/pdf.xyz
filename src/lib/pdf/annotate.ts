import type { PDFFont, PDFPage } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import {
  embedStampFont,
  loadPdf,
  normalizeRotation,
  stampProducer,
} from "./stamp";
import { isWinAnsiEncodable, nonWinAnsiCharacters } from "./winansi";

// Re-exported from their new home. Five modules needed the same predicate once
// a Unicode face could be embedded, and two copies of an alphabet are two
// chances to disagree about the euro sign. See `winansi.ts`.
export { isWinAnsiEncodable, nonWinAnsiCharacters };

/**
 * In-browser, flattened PDF markup built on pdf-lib only — no uploads, no worker.
 *
 * HONEST SCOPE: this adds *flattened visual markups* to existing pages —
 * translucent highlight boxes, outlined rectangles, free-text notes, and
 * lines/arrows — drawn as real vector content on top of the page. Because the
 * base pages are preserved and only content is added, text and graphics stay
 * crisp and selectable (nothing is rasterized).
 *
 * It is NOT a collaborative annotation layer. There are no PDF `/Annot` comment
 * objects, sticky notes, or reply threads; markups can't be toggled, replied to,
 * or edited by a PDF reader after export — they are baked into the page's
 * content stream. Highlights are geometric rectangles you place by coordinates,
 * not selections that snap to the underlying text. There is no freehand drawing
 * canvas; shapes are placed by numeric coordinates/endpoints.
 *
 * Coordinate model: PDF points from the bottom-left corner of the page AS A
 * READER SEES IT — the visible (crop) box, after the page's `/Rotate` flag has
 * turned it. {@link getAnnotatePageSizes} reports that displayed size, the
 * runner validates against it, and {@link toContentSpace} maps every point into
 * pdf-lib's unrotated draw space only at the moment of drawing; note glyphs are
 * counter-rotated so they read left to right. Until 2026-09-27 the numbers were
 * used raw, so on any page run through the Rotate tool a markup landed
 * somewhere else and notes read sideways — `annotate.pdfjs.test.ts` reads the
 * output back through pdfjs and pins where each markup lands on all four
 * rotations and on a cropped page.
 *
 * The geometry, color, wrapping, and validation are pure functions so they can
 * be unit-tested with plain numbers; only {@link getAnnotatePageSizes} and
 * {@link annotatePdf} touch pdf-lib and load a document.
 */

const EDGE_EPSILON = 0.5;
const DEFAULT_HIGHLIGHT_OPACITY = 0.4;
const DEFAULT_BORDER_WIDTH = 1.5;
const DEFAULT_LINE_THICKNESS = 1.5;
const DEFAULT_NOTE_SIZE = 12;
/** Line advance as a multiple of font size for wrapped note text. */
const NOTE_LINE_HEIGHT_RATIO = 1.18;
/** Guard against pasting a whole document into a single note. */
const MAX_NOTE_CHARS = 2000;

/** The four markup shapes this tool can flatten onto a page. */
export type AnnotationType = "highlight" | "rect" | "note" | "line";

interface AnnotationBase {
  /** 1-based page the markup lands on. */
  page: number;
  /** Stroke/fill color as a `#rgb` or `#rrggbb` hex string. */
  color: string;
  /** Opacity in [0, 1]; a type-specific default is used when omitted. */
  opacity?: number;
}

/** A translucent filled rectangle — the highlighter. */
export interface HighlightAnnotation extends AnnotationBase {
  type: "highlight";
  /** Lower-left corner and size, in points from the page's bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An outlined rectangle (no fill) — a box/callout border. */
export interface RectAnnotation extends AnnotationBase {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Outline stroke width in points; defaults to 1.5. */
  borderWidth?: number;
}

/** A free-text note drawn in Helvetica. */
export interface NoteAnnotation extends AnnotationBase {
  type: "note";
  /** Baseline anchor of the first line, in points from the bottom-left. */
  x: number;
  y: number;
  text: string;
  /** Font size in points; defaults to 12. */
  size?: number;
  /**
   * Wrap width in points. When omitted (or ≤ 0) the note is drawn one line per
   * input line — no width-wrapping — so its behavior is predictable.
   */
  maxWidth?: number;
}

/** A straight line, optionally arrow-tipped at its end point. */
export interface LineAnnotation extends AnnotationBase {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width in points; defaults to 1.5. */
  thickness?: number;
  /** Draw an arrowhead at (x2, y2). */
  arrow?: boolean;
}

export type Annotation =
  HighlightAnnotation | RectAnnotation | NoteAnnotation | LineAnnotation;

/** A page's size in PDF points, as displayed (rotation- and crop-aware). */
export interface PageSize {
  width: number;
  height: number;
}

/** A single problem with a proposed markup. */
export interface AnnotationIssue {
  /** 0-based index of the offending markup within the input list. */
  index: number;
  code:
    | "page-out-of-range"
    | "invalid-color"
    | "invalid-opacity"
    | "invalid"
    | "empty"
    | "out-of-bounds";
  message: string;
}

export interface AnnotateResult {
  bytes: Uint8Array;
  /** Output page count (equal to the input — pages are preserved). */
  pageCount: number;
  /** Total markups baked into the output. */
  annotationCount: number;
  /** Count per markup type, for honest result copy. */
  counts: Record<AnnotationType, number>;
}

/** RGB channels in the 0–1 range pdf-lib expects. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A download name for an annotated document, derived from the source file. */
export function annotatedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "annotated");
}

/**
 * Parse a `#rgb` / `#rrggbb` hex color (the leading `#` is optional) into 0–1
 * channels. Returns `null` for anything that isn't a valid hex color so callers
 * can reject it with a clear message.
 */
export function parseHexColor(hex: string): Rgb | null {
  if (typeof hex !== "string") return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  let digits = match[1]!;
  if (digits.length === 3) {
    digits = digits
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = Number.parseInt(digits, 16);
  return {
    r: ((int >> 16) & 0xff) / 255,
    g: ((int >> 8) & 0xff) / 255,
    b: (int & 0xff) / 255,
  };
}

/** True when `hex` is a color pdf-lib can draw with. */
export function isValidHexColor(hex: string): boolean {
  return parseHexColor(hex) !== null;
}

/** Clamp an opacity into pdf-lib's meaningful [0, 1] range; NaN → fully opaque. */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/**
 * Normalize note text for drawing: tabs become spaces and newlines are
 * preserved so callers can wrap on them.
 *
 * WHAT THIS FUNCTION USED TO DO, AND WHY IT NO LONGER DOES IT
 *
 * Until 2026-08-10 it SUBSTITUTED. Every character WinAnsi cannot represent —
 * all CJK, Cyrillic, Greek, Arabic, Hebrew, Hindi, every emoji, and ordinary
 * marks like the arrow and the tick — became `?` and the export reported
 * success. A user annotating a contract in Chinese was told "Markups applied"
 * and downloaded a PDF of question marks: their words destroyed, with nothing
 * anywhere saying so. That was replaced by a refusal, which was right and
 * remains the rule.
 *
 * The refusal is no longer HERE, because the alphabet limit is no longer here.
 * A real Unicode face is now chosen and embedded by {@link embedStampFont},
 * which draws Bengali, Chinese, Japanese, Korean, Cyrillic, Greek, Devanagari
 * and Latin-Extended, and which refuses — by name, per character, saying which
 * scripts it does and does not draw — for everything else. One place decides,
 * and it is the place that knows what the font can do. Leaving a second,
 * narrower refusal here would have meant Bengali notes rejected by a check that
 * had not noticed the fonts arrived.
 *
 * The invariant that survived both changes: this never substitutes. It returns
 * the user's characters, or the caller throws. There is no third outcome.
 */
export function sanitizeNoteText(text: string): string {
  let out = "";
  for (const ch of text) {
    out += ch === "\t" ? "    " : ch;
  }
  return out;
}

/** Break a single over-long word into width-bounded chunks, char by char. */
function breakWord(
  word: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const ch of word) {
    const next = current + ch;
    if (current && measure(next) > maxWidth) {
      chunks.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Greedily wrap `text` into lines no wider than `maxWidth`, measured by
 * `measure`. Explicit newlines always start a new line. A `maxWidth ≤ 0` (or
 * non-finite) disables width-wrapping and returns one line per input line. A
 * single word wider than `maxWidth` is split across lines so nothing overflows.
 *
 * `measure` is injected (rather than a pdf-lib font) so wrapping is pure and
 * testable with plain numbers.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n");
  const wrap = Number.isFinite(maxWidth) && maxWidth > 0;
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!wrap || paragraph.length === 0) {
      lines.push(paragraph);
      continue;
    }
    const parts = paragraph.split(/(\s+)/).filter((part) => part.length > 0);
    let current = "";
    for (const part of parts) {
      const pieces =
        measure(part) > maxWidth ? breakWord(part, maxWidth, measure) : [part];
      for (const piece of pieces) {
        const next = current + piece;
        if (current && measure(next) > maxWidth) {
          lines.push(current.trimEnd());
          current = piece.trimStart();
        } else {
          current = next;
        }
      }
    }
    lines.push(current.trimEnd());
  }

  return lines;
}

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  start: Point;
  end: Point;
}

/**
 * The two short segments forming a `V` arrowhead at a line's end point (x2, y2),
 * opening back toward its start (x1, y1). `size` is the barb length in points
 * and `spread` the half-angle between each barb and the shaft. Returns `[]` for
 * a zero-length line or a non-positive size.
 */
export function arrowHeadSegments(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number,
  spread = Math.PI / 7,
): Segment[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0 || size <= 0 || !Number.isFinite(length)) return [];
  const angle = Math.atan2(dy, dx);
  const tip: Point = { x: x2, y: y2 };
  return [
    {
      start: tip,
      end: {
        x: x2 - size * Math.cos(angle - spread),
        y: y2 - size * Math.sin(angle - spread),
      },
    },
    {
      start: tip,
      end: {
        x: x2 - size * Math.cos(angle + spread),
        y: y2 - size * Math.sin(angle + spread),
      },
    },
  ];
}

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** Is a point on the page (within a small edge tolerance)? */
function pointOnPage(x: number, y: number, size: PageSize): boolean {
  return (
    x >= -EDGE_EPSILON &&
    y >= -EDGE_EPSILON &&
    x <= size.width + EDGE_EPSILON &&
    y <= size.height + EDGE_EPSILON
  );
}

/** Does a rectangle sit fully inside the page (within a small tolerance)? */
function rectInPage(
  x: number,
  y: number,
  width: number,
  height: number,
  size: PageSize,
): boolean {
  return (
    x >= -EDGE_EPSILON &&
    y >= -EDGE_EPSILON &&
    x + width <= size.width + EDGE_EPSILON &&
    y + height <= size.height + EDGE_EPSILON
  );
}

/**
 * Validate proposed markups against the document's page sizes. Returns one issue
 * per problem (empty when everything is valid) so the UI can point at exactly
 * which markup is wrong and why. Rejects out-of-range pages, invalid hex colors,
 * out-of-range opacity, non-finite coordinates, empty shapes/text, and geometry
 * that spills off the page. For a note that means its ANCHOR only: how far its
 * words reach depends on the font, which {@link noteFitIssues} checks once the
 * font is known.
 */
export function validateAnnotations(
  annotations: Annotation[],
  pageSizes: PageSize[],
): AnnotationIssue[] {
  const issues: AnnotationIssue[] = [];
  const pageCount = pageSizes.length;

  annotations.forEach((annotation, index) => {
    const label = `Markup ${index + 1}`;
    const add = (code: AnnotationIssue["code"], message: string) =>
      issues.push({ index, code, message: `${label}: ${message}` });

    if (
      !Number.isInteger(annotation.page) ||
      annotation.page < 1 ||
      annotation.page > pageCount
    ) {
      add(
        "page-out-of-range",
        `page ${annotation.page} is out of range (1–${pageCount}).`,
      );
      return;
    }

    if (!isValidHexColor(annotation.color)) {
      add("invalid-color", `"${annotation.color}" isn't a valid hex color.`);
      return;
    }

    if (
      annotation.opacity !== undefined &&
      (!isFiniteNumber(annotation.opacity) ||
        annotation.opacity < 0 ||
        annotation.opacity > 1)
    ) {
      add("invalid-opacity", "opacity must be between 0 and 1.");
      return;
    }

    const size = pageSizes[annotation.page - 1]!;

    if (annotation.type === "highlight" || annotation.type === "rect") {
      const { x, y, width, height } = annotation;
      if (![x, y, width, height].every(isFiniteNumber)) {
        add("invalid", "coordinates must be finite numbers.");
        return;
      }
      if (width <= 0 || height <= 0) {
        add("empty", "width and height must be greater than 0.");
        return;
      }
      if (!rectInPage(x, y, width, height, size)) {
        add(
          "out-of-bounds",
          `the shape extends outside the ${Math.round(size.width)}×${Math.round(size.height)} pt page.`,
        );
      }
      return;
    }

    if (annotation.type === "note") {
      const { x, y, text } = annotation;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        add("invalid", "coordinates must be finite numbers.");
        return;
      }
      if (
        annotation.size !== undefined &&
        (!isFiniteNumber(annotation.size) || annotation.size <= 0)
      ) {
        add("invalid", "font size must be greater than 0.");
        return;
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        add("empty", "note text can't be empty.");
        return;
      }
      if (text.length > MAX_NOTE_CHARS) {
        add(
          "empty",
          `note text is too long (max ${MAX_NOTE_CHARS} characters).`,
        );
        return;
      }
      if (!pointOnPage(x, y, size)) {
        add(
          "out-of-bounds",
          `the note sits outside the ${Math.round(size.width)}×${Math.round(size.height)} pt page.`,
        );
      }
      return;
    }

    // Line
    const { x1, y1, x2, y2 } = annotation;
    if (![x1, y1, x2, y2].every(isFiniteNumber)) {
      add("invalid", "endpoints must be finite numbers.");
      return;
    }
    if (
      annotation.thickness !== undefined &&
      (!isFiniteNumber(annotation.thickness) || annotation.thickness <= 0)
    ) {
      add("invalid", "line thickness must be greater than 0.");
      return;
    }
    if (x1 === x2 && y1 === y2) {
      add("empty", "a line needs two different endpoints.");
      return;
    }
    if (!pointOnPage(x1, y1, size) || !pointOnPage(x2, y2, size)) {
      add(
        "out-of-bounds",
        `an endpoint sits outside the ${Math.round(size.width)}×${Math.round(size.height)} pt page.`,
      );
    }
  });

  return issues;
}

/**
 * Where a page's visible area sits in pdf-lib's unrotated draw space, and how a
 * viewer turns it: the crop box (clipped to the media box, as viewers do) plus
 * the page's `/Rotate` snapped to a quarter turn.
 */
export interface PageFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

/** The size a reader sees: a quarter-turned page swaps its width and height. */
export function displayedSize(frame: PageFrame): PageSize {
  return frame.rotation === 90 || frame.rotation === 270
    ? { width: frame.height, height: frame.width }
    : { width: frame.width, height: frame.height };
}

/**
 * Map a point typed in the DISPLAYED frame (points from the visible page's
 * bottom-left) into pdf-lib's unrotated draw space. `/Rotate` turns the page
 * clockwise for display, so this is the inverse turn — the transform
 * `placeStamp` uses — offset by the visible box's origin.
 */
export function toContentSpace(point: Point, frame: PageFrame): Point {
  const { x: ox, y: oy, width: w, height: h } = frame;
  const { x: vx, y: vy } = point;
  switch (frame.rotation) {
    case 90:
      return { x: ox + w - vy, y: oy + vx };
    case 180:
      return { x: ox + w - vx, y: oy + h - vy };
    case 270:
      return { x: ox + vy, y: oy + h - vx };
    default:
      return { x: ox + vx, y: oy + vy };
  }
}

interface Corners {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function corners(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Corners {
  return {
    x0: Math.min(box.x, box.x + box.width),
    y0: Math.min(box.y, box.y + box.height),
    x1: Math.max(box.x, box.x + box.width),
    y1: Math.max(box.y, box.y + box.height),
  };
}

/** Read a page's visible frame from pdf-lib. */
function pageFrame(page: PDFPage): PageFrame {
  const media = corners(page.getMediaBox());
  const crop = corners(page.getCropBox());
  // Viewers show the crop box clipped to the media box; a crop box that does
  // not overlap it at all is ignored in favour of the media box.
  const clipped: Corners = {
    x0: Math.max(media.x0, crop.x0),
    y0: Math.max(media.y0, crop.y0),
    x1: Math.min(media.x1, crop.x1),
    y1: Math.min(media.y1, crop.y1),
  };
  const box =
    clipped.x1 > clipped.x0 && clipped.y1 > clipped.y0 ? clipped : media;
  return {
    x: box.x0,
    y: box.y0,
    width: box.x1 - box.x0,
    height: box.y1 - box.y0,
    rotation: normalizeRotation(page.getRotation().angle),
  };
}

/**
 * Read each page's size AS DISPLAYED — the visible box, width and height
 * swapped on a quarter-turned page. One source for every consumer in the
 * runner: the size label, the input bounds, validation, and the preview's
 * aspect ratio.
 */
export async function getAnnotatePageSizes(
  bytes: Uint8Array,
): Promise<PageSize[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((page) => displayedSize(pageFrame(page)));
}

/**
 * The font measurements a note's fit depends on. A pdf-lib `PDFFont` satisfies
 * it; it is an interface so the check can be tested with plain numbers.
 */
export interface NoteMetrics {
  widthOfTextAtSize(text: string, size: number): number;
  heightAtSize(size: number, options?: { descender?: boolean }): number;
}

/** A note's resolved size, line advance, and wrapped lines — as drawn. */
function layoutNote(
  annotation: NoteAnnotation,
  font: Pick<NoteMetrics, "widthOfTextAtSize">,
): { size: number; lineHeight: number; lines: string[] } {
  const size =
    annotation.size && annotation.size > 0
      ? annotation.size
      : DEFAULT_NOTE_SIZE;
  const lines = wrapText(
    sanitizeNoteText(annotation.text),
    annotation.maxWidth ?? 0,
    (s) => font.widthOfTextAtSize(s, size),
  );
  return { size, lineHeight: size * NOTE_LINE_HEIGHT_RATIO, lines };
}

/**
 * Notes whose drawn text would leave the page — past the right edge, below the
 * bottom, or above the top. A page clips whatever leaves it, silently, so
 * before this check a note could lose its words while the export reported
 * "Annotated PDF ready". {@link validateAnnotations} can only check a note's
 * anchor, because how far the words reach depends on the font, and the font is
 * not chosen until every note's characters are known.
 *
 * Measured in the DISPLAYED frame against sizes from
 * {@link getAnnotatePageSizes}, with the same {@link layoutNote} the drawing
 * uses. Markups that already fail {@link validateAnnotations} are skipped:
 * that check reports them.
 */
export function noteFitIssues(
  annotations: Annotation[],
  pageSizes: PageSize[],
  font: NoteMetrics,
): AnnotationIssue[] {
  const invalid = new Set(
    validateAnnotations(annotations, pageSizes).map((issue) => issue.index),
  );
  const issues: AnnotationIssue[] = [];
  annotations.forEach((annotation, index) => {
    if (annotation.type !== "note" || invalid.has(index)) return;
    const page = pageSizes[annotation.page - 1];
    if (!page) return;
    const { size, lineHeight, lines } = layoutNote(annotation, font);
    const drawn = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.length > 0);
    if (drawn.length === 0) return;
    const widest = Math.max(
      ...drawn.map(({ line }) => font.widthOfTextAtSize(line, size)),
    );
    const ascent = font.heightAtSize(size, { descender: false });
    const descent = Math.max(0, font.heightAtSize(size) - ascent);
    const firstBaseline = annotation.y - drawn[0]!.i * lineHeight;
    const lastBaseline = annotation.y - drawn[drawn.length - 1]!.i * lineHeight;
    const right = annotation.x + widest;
    const top = firstBaseline + ascent;
    const bottom = lastBaseline - descent;

    const problems: string[] = [];
    if (right > page.width + EDGE_EPSILON) {
      problems.push(
        `runs ${Math.ceil(right - page.width)} pt past the right edge`,
      );
    }
    if (top > page.height + EDGE_EPSILON) {
      problems.push(
        `rises ${Math.ceil(top - page.height)} pt above the top edge`,
      );
    }
    if (bottom < -EDGE_EPSILON) {
      problems.push(`runs ${Math.ceil(-bottom)} pt below the bottom edge`);
    }
    if (problems.length > 0) {
      issues.push({
        index,
        code: "out-of-bounds",
        message: `Markup ${index + 1}: the note ${problems.join(" and ")} of the ${Math.round(page.width)}×${Math.round(page.height)} pt page, so part of it would be cut off. Move it, shorten it, or narrow its wrap width.`,
      });
    }
  });
  return issues;
}

/** The note texts that decide the font, normalized as they will be drawn. */
function noteTextsOf(annotations: Annotation[]): string[] {
  return annotations
    .filter((item): item is NoteAnnotation => item.type === "note")
    .map((item) => sanitizeNoteText(item.text));
}

/**
 * {@link noteFitIssues} measured with the SAME font {@link annotatePdf} will
 * choose for this set of markups — so the runner can refuse an overflowing note
 * when it is added, and can never refuse one that Apply would accept. Throws
 * the font chooser's own refusal when a note's characters cannot be drawn.
 */
export async function findNoteOverflows(
  annotations: Annotation[],
  pageSizes: PageSize[],
): Promise<AnnotationIssue[]> {
  const notes = noteTextsOf(annotations);
  if (notes.length === 0) return [];
  const { PDFDocument } = await loadPdfLib();
  const font = await embedStampFont(await PDFDocument.create(), notes);
  return noteFitIssues(annotations, pageSizes, font);
}

/** A displayed-frame rectangle as a draw-space one (min corner and size). */
function rectToContentSpace(
  x: number,
  y: number,
  width: number,
  height: number,
  frame: PageFrame,
): { x: number; y: number; width: number; height: number } {
  const a = toContentSpace({ x, y }, frame);
  const b = toContentSpace({ x: x + width, y: y + height }, frame);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * Draw a single markup onto its page. Colors/opacity are already validated;
 * coordinates are in the displayed frame and are mapped through `frame` here.
 */
function drawAnnotation(
  page: PDFPage,
  annotation: Annotation,
  font: PDFFont,
  lib: Pick<PdfLibModule, "rgb" | "degrees" | "BlendMode">,
  frame: PageFrame,
): void {
  const parsed = parseHexColor(annotation.color) ?? { r: 0, g: 0, b: 0 };
  const color = lib.rgb(parsed.r, parsed.g, parsed.b);

  switch (annotation.type) {
    case "highlight": {
      const opacity = clampOpacity(
        annotation.opacity ?? DEFAULT_HIGHLIGHT_OPACITY,
      );
      // Multiply, as a real highlighter: the tint only darkens what is lighter
      // than it, so black text under it stays black at any opacity. With the
      // Normal blend it painted OVER the text — washed to olive at the 40%
      // default, gone at the 100% the runner offers, while the text layer
      // stayed selectable underneath: a highlight that looked like a redaction
      // without being one.
      page.drawRectangle({
        ...rectToContentSpace(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height,
          frame,
        ),
        color,
        opacity,
        blendMode: lib.BlendMode.Multiply,
      });
      return;
    }
    case "rect": {
      const opacity = clampOpacity(annotation.opacity ?? 1);
      const borderWidth =
        annotation.borderWidth && annotation.borderWidth > 0
          ? annotation.borderWidth
          : DEFAULT_BORDER_WIDTH;
      // Pass only borderColor (no `color`) so pdf-lib strokes an outline without
      // filling — see its drawRectangle default-color behavior.
      page.drawRectangle({
        ...rectToContentSpace(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height,
          frame,
        ),
        borderColor: color,
        borderWidth,
        borderOpacity: opacity,
      });
      return;
    }
    case "line": {
      const opacity = clampOpacity(annotation.opacity ?? 1);
      const thickness =
        annotation.thickness && annotation.thickness > 0
          ? annotation.thickness
          : DEFAULT_LINE_THICKNESS;
      // A quarter turn is rigid, so the arrowhead built on the mapped
      // endpoints is the mapped arrowhead.
      const start = toContentSpace(
        { x: annotation.x1, y: annotation.y1 },
        frame,
      );
      const end = toContentSpace({ x: annotation.x2, y: annotation.y2 }, frame);
      page.drawLine({ start, end, thickness, color, opacity });
      if (annotation.arrow) {
        const head = Math.max(6, thickness * 4);
        for (const seg of arrowHeadSegments(
          start.x,
          start.y,
          end.x,
          end.y,
          head,
        )) {
          page.drawLine({
            start: seg.start,
            end: seg.end,
            thickness,
            color,
            opacity,
          });
        }
      }
      return;
    }
    case "note": {
      const opacity = clampOpacity(annotation.opacity ?? 1);
      const { size, lineHeight, lines } = layoutNote(annotation, font);
      lines.forEach((line, i) => {
        if (line.length === 0) return;
        // Each baseline steps down the DISPLAYED page and is then mapped;
        // stepping in draw space would slide lines 2+ sideways on a turned
        // page. The glyphs turn with the page's rotation so the viewer's turn
        // cancels it and the note reads left to right.
        page.drawText(line, {
          ...toContentSpace(
            { x: annotation.x, y: annotation.y - i * lineHeight },
            frame,
          ),
          rotate: lib.degrees(frame.rotation),
          size,
          font,
          color,
          opacity,
        });
      });
      return;
    }
  }
}

/** Throw the first issue (and how many more) as a user-facing error. */
function refuseIssues(issues: AnnotationIssue[]): void {
  if (issues.length === 0) return;
  const first = issues[0]!;
  const rest = issues.length - 1;
  throw new PdfEngineError(
    rest > 0
      ? `${first.message} (${rest} more issue${rest === 1 ? "" : "s"}.)`
      : first.message,
  );
}

/**
 * Flatten the given markups onto an existing PDF and return a new PDF. The
 * original pages, their count, and their sizes are preserved — only markup
 * content is added on top. Runs entirely in the browser with pdf-lib.
 *
 * Throws a typed, user-facing {@link PdfEngineError} when there are no markups,
 * the file can't be read, any markup fails validation, or a note's text would
 * run off its page ({@link noteFitIssues}).
 */
export async function annotatePdf(
  bytes: Uint8Array,
  annotations: Annotation[],
): Promise<AnnotateResult> {
  const list = annotations ?? [];
  if (list.length === 0) {
    throw new PdfEngineError("Add at least one markup before applying.");
  }

  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const frames = pages.map(pageFrame);
  const pageSizes: PageSize[] = frames.map(displayedSize);

  refuseIssues(validateAnnotations(list, pageSizes));

  // Every note that will be drawn, normalized, BEFORE a font is chosen — so a
  // Bengali note on page nine picks the face rather than the ASCII note on page
  // one, and so a refusal lands before any page has been touched.
  const font = await embedStampFont(doc, noteTextsOf(list));
  // With the font known, each note's real extent — still before any page is
  // touched.
  refuseIssues(noteFitIssues(list, pageSizes, font));

  const counts: Record<AnnotationType, number> = {
    highlight: 0,
    rect: 0,
    note: 0,
    line: 0,
  };

  for (const annotation of list) {
    const page = pages[annotation.page - 1];
    const frame = frames[annotation.page - 1];
    if (!page || !frame) continue;
    drawAnnotation(page, annotation, font, lib, frame);
    counts[annotation.type] += 1;
  }

  stampProducer(doc);
  return {
    bytes: await doc.save(),
    pageCount: pages.length,
    annotationCount: list.length,
    counts,
  };
}
