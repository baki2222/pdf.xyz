import type { PDFFont, PDFPage, RGB as PdfLibRGB } from "pdf-lib";
import { loadPdfLib } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { embedStampFont, loadPdf, stampProducer } from "./stamp";
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
 * Coordinate model: PDF points from the page's bottom-left corner, in the page's
 * *unrotated* content space (pdf-lib's draw space). On the uncommon page
 * carrying a `/Rotate` flag, the markup follows the content, not the viewer's
 * rotation. (The overlay tool no longer shares this caveat: it places in the
 * viewer's frame, see `overlay.ts`.)
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

/** A page's size in PDF points (unrotated content space). */
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
 * that spills off the page.
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

/** Read each page's size (unrotated content space) for bounding/validation. */
export async function getAnnotatePageSizes(
  bytes: Uint8Array,
): Promise<PageSize[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width, height };
  });
}

/** Draw a single markup onto its page. Colors/opacity are already validated. */
function drawAnnotation(
  page: PDFPage,
  annotation: Annotation,
  font: PDFFont,
  rgbFn: (r: number, g: number, b: number) => PdfLibRGB,
): void {
  const parsed = parseHexColor(annotation.color) ?? { r: 0, g: 0, b: 0 };
  const color = rgbFn(parsed.r, parsed.g, parsed.b);

  switch (annotation.type) {
    case "highlight": {
      const opacity = clampOpacity(
        annotation.opacity ?? DEFAULT_HIGHLIGHT_OPACITY,
      );
      page.drawRectangle({
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        color,
        opacity,
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
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
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
      page.drawLine({
        start: { x: annotation.x1, y: annotation.y1 },
        end: { x: annotation.x2, y: annotation.y2 },
        thickness,
        color,
        opacity,
      });
      if (annotation.arrow) {
        const head = Math.max(6, thickness * 4);
        for (const seg of arrowHeadSegments(
          annotation.x1,
          annotation.y1,
          annotation.x2,
          annotation.y2,
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
      const size =
        annotation.size && annotation.size > 0
          ? annotation.size
          : DEFAULT_NOTE_SIZE;
      const safe = sanitizeNoteText(annotation.text);
      const lines = wrapText(safe, annotation.maxWidth ?? 0, (s) =>
        font.widthOfTextAtSize(s, size),
      );
      const lineHeight = size * NOTE_LINE_HEIGHT_RATIO;
      lines.forEach((line, i) => {
        if (line.length === 0) return;
        page.drawText(line, {
          x: annotation.x,
          y: annotation.y - i * lineHeight,
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

/**
 * Flatten the given markups onto an existing PDF and return a new PDF. The
 * original pages, their count, and their sizes are preserved — only markup
 * content is added on top. Runs entirely in the browser with pdf-lib.
 *
 * Throws a typed, user-facing {@link PdfEngineError} when there are no markups,
 * the file can't be read, or any markup fails validation.
 */
export async function annotatePdf(
  bytes: Uint8Array,
  annotations: Annotation[],
): Promise<AnnotateResult> {
  const list = annotations ?? [];
  if (list.length === 0) {
    throw new PdfEngineError("Add at least one markup before applying.");
  }

  const { rgb } = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const pageSizes: PageSize[] = pages.map((page) => {
    const { width, height } = page.getSize();
    return { width, height };
  });

  const issues = validateAnnotations(list, pageSizes);
  if (issues.length > 0) {
    const first = issues[0]!;
    const rest = issues.length - 1;
    throw new PdfEngineError(
      rest > 0
        ? `${first.message} (${rest} more issue${rest === 1 ? "" : "s"}.)`
        : first.message,
    );
  }

  // Every note that will be drawn, normalized, BEFORE a font is chosen — so a
  // Bengali note on page nine picks the face rather than the ASCII note on page
  // one, and so a refusal lands before any page has been touched.
  const noteTexts = list
    .filter((item) => item.type === "note")
    .map((item) => sanitizeNoteText((item as { text: string }).text));
  const font = await embedStampFont(doc, noteTexts);
  const counts: Record<AnnotationType, number> = {
    highlight: 0,
    rect: 0,
    note: 0,
    line: 0,
  };

  for (const annotation of list) {
    const page = pages[annotation.page - 1];
    if (!page) continue;
    drawAnnotation(page, annotation, font, rgb);
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
