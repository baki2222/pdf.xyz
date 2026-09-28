import type {
  PDFFont,
  PDFImage,
  PDFPage,
  RGB as PdfLibRGB,
  Rotation,
} from "pdf-lib";
import { embedRasterImage, loadPdfLib } from "./pdf-lib";
import {
  arrowHeadSegments,
  clampOpacity,
  isValidHexColor,
  parseHexColor,
  sanitizeNoteText,
  wrapText,
  type PageSize,
} from "./annotate";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { viewToContent, viewerFrame, type PageBox } from "./page-frame";
import { embedStampFont, loadPdf, stampProducer } from "./stamp";
import type { EditOpType } from "./offered-kinds";

/**
 * In-browser basic PDF editing built on pdf-lib only — no uploads, no worker.
 *
 * HONEST SCOPE: this *adds new, flattened content* on top of the existing pages —
 * free text, filled/outlined rectangles, lines and arrows, and inserted PNG/JPG
 * images — drawn as real content in each page's content stream. The original
 * pages, their count, and their sizes are preserved; nothing is rasterized, so
 * the underlying text and graphics stay crisp and selectable.
 *
 * It is deliberately NOT a WYSIWYG editor. It does **not** edit, reflow, restyle,
 * move, or delete the text and objects already in the PDF; there is no OCR text
 * layer, no drag handles, and no click-to-place canvas. New content is positioned
 * by numeric coordinates and, once exported, is baked into the page — a reader
 * can't select or peel it back off as a separate object. To white-out something
 * underneath, draw a filled rectangle over it (this hides but does not remove the
 * covered content — use the redact tool when the data must actually be gone).
 *
 * Coordinate model: PDF points from the bottom-left corner of the page AS THE
 * READER SEES IT — the visible CropBox, after the page's `/Rotate`. Every op is
 * validated against that displayed size ({@link getEditPageSizes}) and mapped
 * into pdf-lib's unrotated content space at draw time ({@link viewToContent}),
 * with text, boxes and images counter-rotated so they read upright. Pages from
 * our own Rotate PDF and Crop PDF carry exactly those entries; before this
 * mapping, text placed on them came out sideways or outside the visible page.
 * `edit-placement.test.ts` reads the output back through pdfjs to pin it.
 *
 * Text must also FIT: {@link editPdf} measures every wrapped line with the font
 * it will draw with and refuses text that would run past an edge, because the
 * viewer clips it silently and the export would otherwise report success.
 *
 * Geometry, color, wrapping, and validation are pure functions so they can be
 * unit-tested with plain numbers; only {@link getEditPageSizes},
 * {@link checkEditTextFit} and {@link editPdf} touch pdf-lib.
 */

const EDGE_EPSILON = 0.5;
const DEFAULT_TEXT_SIZE = 14;
const DEFAULT_BORDER_WIDTH = 1.5;
const DEFAULT_LINE_THICKNESS = 1.5;
/** Line advance as a multiple of font size for wrapped text. */
const TEXT_LINE_HEIGHT_RATIO = 1.18;
/** Guard against pasting a whole document into a single text box. */
const MAX_TEXT_CHARS = 2000;
/** Largest inserted image we embed in-browser, to keep the output sane (10 MB). */
export const MAX_EDIT_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The kinds of new content this editor can flatten onto a page — defined in the
 * `offered-kinds` leaf so the runner's buttons and the tool page's count read the
 * same list this union is derived from.
 */
export type { EditOpType };

/** The two raster image formats pdf-lib can embed. */
export type EditImageFormat = "png" | "jpg";

interface EditOpBase {
  /** 1-based page the content lands on. */
  page: number;
  /** Opacity in [0, 1]; defaults to fully opaque when omitted. */
  opacity?: number;
}

/** Free text drawn in Helvetica at a baseline anchor. */
export interface TextEditOp extends EditOpBase {
  type: "text";
  /** Baseline anchor of the first line, in points from the bottom-left. */
  x: number;
  y: number;
  text: string;
  /** Stroke/fill color as a `#rgb` or `#rrggbb` hex string. */
  color: string;
  /** Font size in points; defaults to 14. */
  size?: number;
  /**
   * Wrap width in points. When omitted (or ≤ 0) the text is drawn one line per
   * input line — no width-wrapping — so its behavior is predictable.
   */
  maxWidth?: number;
}

/** A rectangle — filled box (default) or outline-only. */
export interface RectEditOp extends EditOpBase {
  type: "rect";
  /** Lower-left corner and size, in points from the page's bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** Fill the box (default) or draw only its outline. */
  filled?: boolean;
  /** Outline stroke width in points when not filled; defaults to 1.5. */
  borderWidth?: number;
}

/** A straight line, optionally arrow-tipped at its end point. */
export interface LineEditOp extends EditOpBase {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  /** Stroke width in points; defaults to 1.5. */
  thickness?: number;
  /** Draw an arrowhead at (x2, y2). */
  arrow?: boolean;
}

/** A PNG or JPG image embedded at a placed rectangle. */
export interface ImageEditOp extends EditOpBase {
  type: "image";
  /** Lower-left corner and size, in points from the page's bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Which decoder to use — must match the actual bytes. */
  format: EditImageFormat;
  /** The raw image bytes to embed. */
  bytes: Uint8Array;
}

export type EditOp = TextEditOp | RectEditOp | LineEditOp | ImageEditOp;

/** A single problem with a proposed edit. */
export interface EditIssue {
  /** 0-based index of the offending op within the input list. */
  index: number;
  code:
    | "page-out-of-range"
    | "invalid-color"
    | "invalid-opacity"
    | "invalid"
    | "empty"
    | "out-of-bounds"
    | "image-missing"
    | "image-type";
  message: string;
}

export interface EditResult {
  bytes: Uint8Array;
  /** Output page count (equal to the input — pages are preserved). */
  pageCount: number;
  /** Total edits baked into the output. */
  opCount: number;
  /** Count per op type, for honest result copy. */
  counts: Record<EditOpType, number>;
}

export type { PageSize };

/** A download name for an edited document, derived from the source file. */
export function editedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "edited");
}

/**
 * Identify a raster image by its magic bytes. Returns `"png"`, `"jpg"`, or
 * `null` for anything we can't embed — enough to reject a mislabeled or
 * unsupported file (GIF, WebP, BMP, …) before it reaches pdf-lib's decoder.
 */
export function sniffImageFormat(bytes: Uint8Array): EditImageFormat | null {
  if (!bytes || bytes.byteLength < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  return null;
}

/**
 * Validate that image bytes are a non-empty, in-budget PNG/JPG whose contents
 * match the declared `format`. Returns a specific issue code or `null` when the
 * image is embeddable. Shared by {@link validateEditOps} and the UI file picker.
 */
export function checkEditImage(
  format: EditImageFormat,
  bytes: Uint8Array,
): "image-missing" | "image-type" | null {
  if (!bytes || bytes.byteLength === 0) return "image-missing";
  if (bytes.byteLength > MAX_EDIT_IMAGE_BYTES) return "image-type";
  const sniffed = sniffImageFormat(bytes);
  if (sniffed === null) return "image-type";
  if (sniffed !== format) return "image-type";
  return null;
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

/** Human-readable page size for out-of-bounds copy. */
function pageDims(size: PageSize): string {
  return `${Math.round(size.width)}×${Math.round(size.height)} pt`;
}

/**
 * Validate proposed edits against the document's page sizes. Returns one issue
 * per problem (empty when everything is valid) so the UI can point at exactly
 * which edit is wrong and why. Rejects out-of-range pages, invalid hex colors,
 * out-of-range opacity, non-finite coordinates, empty shapes/text, geometry that
 * spills off the page, and missing/mismatched image bytes.
 */
export function validateEditOps(
  ops: EditOp[],
  pageSizes: PageSize[],
): EditIssue[] {
  const issues: EditIssue[] = [];
  const pageCount = pageSizes.length;

  ops.forEach((op, index) => {
    const label = `Edit ${index + 1}`;
    const add = (code: EditIssue["code"], message: string) =>
      issues.push({ index, code, message: `${label}: ${message}` });

    if (!Number.isInteger(op.page) || op.page < 1 || op.page > pageCount) {
      add(
        "page-out-of-range",
        `page ${op.page} is out of range (1–${pageCount}).`,
      );
      return;
    }

    // Every type but image carries a color.
    if (op.type !== "image" && !isValidHexColor(op.color)) {
      add("invalid-color", `"${op.color}" isn't a valid hex color.`);
      return;
    }

    if (
      op.opacity !== undefined &&
      (!isFiniteNumber(op.opacity) || op.opacity < 0 || op.opacity > 1)
    ) {
      add("invalid-opacity", "opacity must be between 0 and 1.");
      return;
    }

    const size = pageSizes[op.page - 1]!;

    if (op.type === "text") {
      const { x, y, text } = op;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        add("invalid", "coordinates must be finite numbers.");
        return;
      }
      if (op.size !== undefined && (!isFiniteNumber(op.size) || op.size <= 0)) {
        add("invalid", "font size must be greater than 0.");
        return;
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        add("empty", "text can't be empty.");
        return;
      }
      if (text.length > MAX_TEXT_CHARS) {
        add("empty", `text is too long (max ${MAX_TEXT_CHARS} characters).`);
        return;
      }
      if (!pointOnPage(x, y, size)) {
        add(
          "out-of-bounds",
          `the text sits outside the ${pageDims(size)} page.`,
        );
      }
      return;
    }

    if (op.type === "rect") {
      const { x, y, width, height } = op;
      if (![x, y, width, height].every(isFiniteNumber)) {
        add("invalid", "coordinates must be finite numbers.");
        return;
      }
      if (width <= 0 || height <= 0) {
        add("empty", "width and height must be greater than 0.");
        return;
      }
      if (
        op.borderWidth !== undefined &&
        (!isFiniteNumber(op.borderWidth) || op.borderWidth <= 0)
      ) {
        add("invalid", "outline width must be greater than 0.");
        return;
      }
      if (!rectInPage(x, y, width, height, size)) {
        add(
          "out-of-bounds",
          `the box extends outside the ${pageDims(size)} page.`,
        );
      }
      return;
    }

    if (op.type === "image") {
      const { x, y, width, height } = op;
      if (![x, y, width, height].every(isFiniteNumber)) {
        add("invalid", "coordinates must be finite numbers.");
        return;
      }
      if (width <= 0 || height <= 0) {
        add("empty", "width and height must be greater than 0.");
        return;
      }
      const imageIssue = checkEditImage(op.format, op.bytes);
      if (imageIssue === "image-missing") {
        add("image-missing", "no image was provided to insert.");
        return;
      }
      if (imageIssue === "image-type") {
        add(
          "image-type",
          `the image must be a PNG or JPG under ${Math.round(MAX_EDIT_IMAGE_BYTES / (1024 * 1024))} MB that matches the chosen format.`,
        );
        return;
      }
      if (!rectInPage(x, y, width, height, size)) {
        add(
          "out-of-bounds",
          `the image extends outside the ${pageDims(size)} page.`,
        );
      }
      return;
    }

    // Line
    const { x1, y1, x2, y2 } = op;
    if (![x1, y1, x2, y2].every(isFiniteNumber)) {
      add("invalid", "endpoints must be finite numbers.");
      return;
    }
    if (
      op.thickness !== undefined &&
      (!isFiniteNumber(op.thickness) || op.thickness <= 0)
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
        `an endpoint sits outside the ${pageDims(size)} page.`,
      );
    }
  });

  return issues;
}

/**
 * One page as the reader sees it: the visible box in content space, its
 * normalized `/Rotate`, and the displayed size every op is validated against.
 * The UI's sizes and editPdf's validation both come from here, so they cannot
 * disagree about what "the page" is.
 */
interface EditPageFrame {
  box: PageBox;
  rotation: 0 | 90 | 180 | 270;
  size: PageSize;
}

function editPageFrame(page: PDFPage): EditPageFrame {
  const { box, rotation, width, height } = viewerFrame(page);
  return { box, rotation, size: { width, height } };
}

/**
 * Read each page's DISPLAYED size — its visible CropBox, width and height
 * swapped on a 90°/270° page — for bounding and validation in the UI.
 */
export async function getEditPageSizes(bytes: Uint8Array): Promise<PageSize[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((page) => editPageFrame(page).size);
}

/** The font metrics text layout needs; a pdf-lib `PDFFont` satisfies it. */
export interface EditTextMetrics {
  widthOfTextAtSize(text: string, size: number): number;
  heightAtSize(size: number, options?: { descender?: boolean }): number;
}

/** A text op laid out exactly as {@link editPdf} will draw it. */
interface TextLayout {
  size: number;
  lineHeight: number;
  /** Every line, including blank ones (which are skipped but still advance). */
  lines: string[];
}

/**
 * Lay out a text op: sanitize, wrap, and size it. The ONE layout both the fit
 * check and the drawing use, so the check sees the lines that get drawn.
 */
function layoutText(op: TextEditOp, font: EditTextMetrics): TextLayout {
  const size = op.size && op.size > 0 ? op.size : DEFAULT_TEXT_SIZE;
  const lines = wrapText(sanitizeNoteText(op.text), op.maxWidth ?? 0, (s) =>
    font.widthOfTextAtSize(s, size),
  );
  return { size, lineHeight: size * TEXT_LINE_HEIGHT_RATIO, lines };
}

/**
 * Where a text op's drawn glyphs would cross the displayed page's edge, or
 * `null` when every line fits. Measured with the font that will draw it:
 *
 * - right: the widest drawn line's advance, from the anchor x;
 * - bottom: the LAST drawn line's baseline (a baseline test, so text anchored
 *   at the bottom margin is not refused for its descenders);
 * - top: the first line's ascent above its baseline.
 *
 * The anchor itself is checked by {@link validateEditOps}, which has no font.
 */
function textOverflow(
  op: TextEditOp,
  page: PageSize,
  font: EditTextMetrics,
): { edge: "right" | "bottom" | "top"; message: string } | null {
  const { size, lineHeight, lines } = layoutText(op, font);
  let widest = 0;
  let lastDrawn = -1;
  lines.forEach((line, i) => {
    if (line.length === 0) return;
    widest = Math.max(widest, font.widthOfTextAtSize(line, size));
    lastDrawn = i;
  });
  if (lastDrawn < 0) return null;

  const room = Math.max(0, Math.floor(page.width - op.x));
  if (op.x + widest > page.width + EDGE_EPSILON) {
    return {
      edge: "right",
      message: `the text runs past the right edge of the ${pageDims(page)} page and would be cut off. Set a Wrap width of ${room} pt or less, move it left, or make it smaller.`,
    };
  }
  if (op.y - lastDrawn * lineHeight < -EDGE_EPSILON) {
    return {
      edge: "bottom",
      message: `the text runs below the bottom of the ${pageDims(page)} page and would be cut off. Move it up, shorten it, or make it smaller.`,
    };
  }
  if (
    op.y + font.heightAtSize(size, { descender: false }) >
    page.height + EDGE_EPSILON
  ) {
    return {
      edge: "top",
      message: `the text runs above the top of the ${pageDims(page)} page and would be cut off. Move it down or make it smaller.`,
    };
  }
  return null;
}

/** One issue per text op that would not fit its page, measured with `font`. */
function textFitIssues(
  ops: EditOp[],
  pageSizes: PageSize[],
  font: EditTextMetrics,
): EditIssue[] {
  const issues: EditIssue[] = [];
  ops.forEach((op, index) => {
    if (op.type !== "text") return;
    const page = pageSizes[op.page - 1];
    if (!page) return;
    const over = textOverflow(op, page, font);
    if (over) {
      issues.push({
        index,
        code: "out-of-bounds",
        message: `Edit ${index + 1}: ${over.message}`,
      });
    }
  });
  return issues;
}

/** The text of every text op, as the font is chosen from it. */
function textsOf(ops: EditOp[]): string[] {
  return ops
    .filter((op): op is TextEditOp => op.type === "text")
    .map((op) => sanitizeNoteText(op.text));
}

/**
 * Check, before export, that every text op fits its page — with the SAME font
 * {@link editPdf} will embed for this batch (Helvetica for Western text, the
 * matching Noto face otherwise), so the answer is the export's answer. The UI
 * calls this when an edit is added, with every edit placed so far.
 *
 * Rejects with the same typed error editPdf would for text no shipped face can
 * draw.
 */
export async function checkEditTextFit(
  ops: EditOp[],
  pageSizes: PageSize[],
): Promise<EditIssue[]> {
  const texts = textsOf(ops);
  if (texts.length === 0) return [];
  const { PDFDocument } = await loadPdfLib();
  const scratch = await PDFDocument.create();
  const font = await embedStampFont(scratch, texts);
  return textFitIssues(ops, pageSizes, font);
}

/** Resolve an op's validated hex color into a pdf-lib color. */
function opColor(
  rgbFn: (r: number, g: number, b: number) => PdfLibRGB,
  color: string,
) {
  const parsed = parseHexColor(color) ?? { r: 0, g: 0, b: 0 };
  return rgbFn(parsed.r, parsed.g, parsed.b);
}

/** The pdf-lib pieces the draw helpers need, threaded through from one load. */
interface DrawKit {
  rgb: (r: number, g: number, b: number) => PdfLibRGB;
  degrees: (angle: number) => Rotation;
}

/**
 * Draw wrapped free text at its baseline anchor. Each line's anchor is stepped
 * down in the VIEWER's frame and only then mapped: mapping once and stepping in
 * content space would stack lines sideways on a 90°/270° page.
 */
function drawTextOp(
  page: PDFPage,
  frame: EditPageFrame,
  op: TextEditOp,
  font: PDFFont,
  kit: DrawKit,
): void {
  const color = opColor(kit.rgb, op.color);
  const opacity = clampOpacity(op.opacity ?? 1);
  const { size, lineHeight, lines } = layoutText(op, font);
  lines.forEach((line, i) => {
    if (line.length === 0) return;
    const at = viewToContent(
      op.x,
      op.y - i * lineHeight,
      frame.box,
      frame.rotation,
    );
    page.drawText(line, {
      x: at.x,
      y: at.y,
      rotate: kit.degrees(frame.rotation),
      size,
      font,
      color,
      opacity,
    });
  });
}

/** Draw a filled/outlined rectangle or a line/arrow. Needs no font. */
function drawShapeOp(
  page: PDFPage,
  frame: EditPageFrame,
  op: RectEditOp | LineEditOp,
  kit: DrawKit,
): void {
  const color = opColor(kit.rgb, op.color);
  const opacity = clampOpacity(op.opacity ?? 1);

  if (op.type === "rect") {
    // pdf-lib rotates a rectangle about its (x, y) corner, so the anchor is the
    // viewer's bottom-left corner mapped into content space; width then runs
    // along the viewer's +x and height along its +y.
    const at = viewToContent(op.x, op.y, frame.box, frame.rotation);
    const rotate = kit.degrees(frame.rotation);
    if (op.filled ?? true) {
      page.drawRectangle({
        x: at.x,
        y: at.y,
        width: op.width,
        height: op.height,
        rotate,
        color,
        opacity,
      });
    } else {
      const borderWidth =
        op.borderWidth && op.borderWidth > 0
          ? op.borderWidth
          : DEFAULT_BORDER_WIDTH;
      // Pass only borderColor (no `color`) so pdf-lib strokes an outline without
      // filling — see its drawRectangle default-color behavior.
      page.drawRectangle({
        x: at.x,
        y: at.y,
        width: op.width,
        height: op.height,
        rotate,
        borderColor: color,
        borderWidth,
        borderOpacity: opacity,
      });
    }
    return;
  }

  const thickness =
    op.thickness && op.thickness > 0 ? op.thickness : DEFAULT_LINE_THICKNESS;
  // A line needs no rotation: map both endpoints. The mapping is rigid, so an
  // arrowhead computed from the mapped endpoints is the viewer's arrowhead.
  const start = viewToContent(op.x1, op.y1, frame.box, frame.rotation);
  const end = viewToContent(op.x2, op.y2, frame.box, frame.rotation);
  page.drawLine({ start, end, thickness, color, opacity });
  if (op.arrow) {
    const head = Math.max(6, thickness * 4);
    for (const seg of arrowHeadSegments(start.x, start.y, end.x, end.y, head)) {
      page.drawLine({
        start: seg.start,
        end: seg.end,
        thickness,
        color,
        opacity,
      });
    }
  }
}

/** Throw the first issue (with a count of the rest) as a user-facing error. */
function refuseIssues(issues: EditIssue[]): void {
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
 * Flatten the given edits onto an existing PDF and return a new PDF. The original
 * pages, their count, and their sizes are preserved — only new content is added
 * on top. Runs entirely in the browser with pdf-lib.
 *
 * Throws a typed, user-facing {@link PdfEngineError} when there are no edits, the
 * file can't be read, an edit fails validation, or an image can't be decoded.
 */
export async function editPdf(
  bytes: Uint8Array,
  ops: EditOp[],
): Promise<EditResult> {
  const { rgb, degrees } = await loadPdfLib();
  const kit: DrawKit = { rgb, degrees };
  const list = ops ?? [];
  if (list.length === 0) {
    throw new PdfEngineError("Add at least one edit before applying.");
  }

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const frames = pages.map(editPageFrame);
  const pageSizes: PageSize[] = frames.map((frame) => frame.size);

  refuseIssues(validateEditOps(list, pageSizes));

  // Embed the font ONCE, up front, from every text op in the batch — not lazily
  // at the first one. Two reasons, both about order rather than correctness:
  // a Bengali caption on page nine must pick the face even when page one is
  // ASCII, and the refusal for a script we cannot draw has to arrive before any
  // image has been embedded or any rectangle drawn. An image/shape-only edit
  // still costs nothing: `texts` is empty, WinAnsi answers, and the standard
  // face embeds without a download.
  const font: PDFFont = await embedStampFont(doc, textsOf(list));
  // Same ordering argument for FIT: the refusal for text that would be clipped
  // at a page edge needs the font's metrics, and must still arrive before
  // anything is drawn.
  refuseIssues(textFitIssues(list, pageSizes, font));
  const counts: Record<EditOpType, number> = {
    text: 0,
    rect: 0,
    line: 0,
    image: 0,
  };

  for (const op of list) {
    const page = pages[op.page - 1];
    const frame = frames[op.page - 1];
    if (!page || !frame) continue;

    if (op.type === "image") {
      let image: PDFImage;
      try {
        image = await embedRasterImage(doc, op.bytes, op.format);
      } catch {
        throw new PdfEngineError(
          `An inserted image on page ${op.page} couldn't be decoded as a ${op.format === "png" ? "PNG" : "JPG"}.`,
        );
      }
      // Anchored and rotated exactly like a rectangle.
      const at = viewToContent(op.x, op.y, frame.box, frame.rotation);
      page.drawImage(image, {
        x: at.x,
        y: at.y,
        width: op.width,
        height: op.height,
        rotate: degrees(frame.rotation),
        opacity: clampOpacity(op.opacity ?? 1),
      });
      counts.image += 1;
      continue;
    }

    if (op.type === "text") {
      drawTextOp(page, frame, op, font, kit);
      counts.text += 1;
      continue;
    }

    // rect | line — no font needed.
    drawShapeOp(page, frame, op, kit);
    counts[op.type] += 1;
  }

  stampProducer(doc);
  return {
    bytes: await doc.save(),
    pageCount: pages.length,
    opCount: list.length,
    counts,
  };
}
