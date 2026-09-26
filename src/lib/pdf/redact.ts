import { embedRasterImage, loadPdfLib } from "./pdf-lib";
import { PdfEngineError, loadPdf } from "./engine";
import { outputName } from "./files";
import {
  rasterizePdf,
  type RasterCanvasInfo,
  type RasterPage,
  type RasterizeOptions,
} from "./render";

/**
 * Privacy-safe, in-browser PDF redaction.
 *
 * The only way to redact a PDF safely is to *destroy* the covered content, not
 * draw an opaque box on top of it — a vector rectangle laid over text leaves the
 * text selectable/extractable underneath. So we rasterize every page to an
 * image, paint solid fill directly over the redaction rectangles' pixels, and
 * rebuild a fresh PDF from those flattened images. There is no recoverable text,
 * vector, form, or annotation layer left under a box.
 *
 * The trade-off is intentional and honest: the output is a raster PDF. Selectable
 * text everywhere on a redacted page is flattened into an image — that flattening
 * is exactly what makes the redaction permanent.
 *
 * The geometry (validation + point→pixel mapping) is pure so it can be unit
 * tested with plain numbers; only {@link getRedactPageSizes}/{@link redactPdf}
 * touch pdf-lib/pdfjs and must run in the browser.
 */

const PRODUCER = "pdf.xyz";

/** Fill colors offered for a redaction box. */
export type RedactionFill = "black" | "white";

/**
 * Every fill the tool offers, in the order the runner shows them. The runner's
 * fill control renders THIS list, and `redact-paint.test.ts` walks it — so a
 * fill added here is offered and proven to reach the pixels in the same edit,
 * rather than offered by one list and tested against another.
 */
export const REDACTION_FILL_OPTIONS: readonly {
  value: RedactionFill;
  label: string;
}[] = [
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
];

/**
 * A rectangle to redact, in PDF points with a bottom-left origin (the standard
 * PDF coordinate space), on a specific 1-based page. `x`/`y` locate the box's
 * lower-left corner; `width`/`height` size it.
 */
export interface RedactionRect {
  /** 1-based page number. */
  page: number;
  /** Distance of the box's left edge from the page's left edge, in points. */
  x: number;
  /** Distance of the box's bottom edge from the page's bottom edge, in points. */
  y: number;
  /** Box width in points. */
  width: number;
  /** Box height in points. */
  height: number;
}

/**
 * The box the runner's form starts with — what "Add area" adds when the user
 * touches nothing. Exported because it is the one rectangle every redaction
 * proof can name without a drag: the unit paint test and the browser proof
 * (e2e/client-proof/cases.ts) both locate their pixel regions from it, so
 * moving the default moves the checks with it.
 */
export const DEFAULT_REDACTION_DRAFT: Readonly<RedactionRect> = {
  page: 1,
  x: 36,
  y: 36,
  width: 200,
  height: 72,
};

/** A page's displayed size in PDF points. */
export interface PageSize {
  width: number;
  height: number;
}

/** A rectangle in device pixels with a top-left origin (canvas space). */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const REDACT_DPI_PRESETS = [
  { id: "screen", label: "Screen", dpi: 96 },
  { id: "print", label: "Print", dpi: 150 },
] as const;

export type RedactDpiPreset = (typeof REDACT_DPI_PRESETS)[number]["id"];

export interface RedactOptions {
  /** The rectangles to redact. Must contain at least one box. */
  rects: RedactionRect[];
  /** Fill color painted over each box; defaults to black. */
  fill?: RedactionFill;
  /** Rasterization resolution in DPI; defaults to 150 (print). */
  dpi?: number;
  /** JPEG quality in [0, 1] for the rebuilt page images; defaults to 0.85. */
  quality?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface RedactResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Number of redaction boxes baked into the output. */
  redactionCount: number;
  totalImageBytes: number;
  /**
   * Images the renderer could not decode, which are therefore ABSENT from the
   * output — not hidden under a box, gone. Reported so the tool can say so:
   * a redacted scan that silently lost its content is the worst outcome this
   * tool has, and pdfjs already knows it happened.
   */
  undecodedImages: number;
}

/** A single problem with a proposed redaction rectangle. */
export interface RedactionIssue {
  /** 0-based index of the offending rect within the input list. */
  index: number;
  code: "page-out-of-range" | "invalid" | "empty" | "out-of-bounds";
  message: string;
}

/** Tolerance (points) when checking a box against page edges. */
const EDGE_EPSILON = 0.5;

export function redactedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "redacted");
}

export function redactPresetById(
  id: string,
): (typeof REDACT_DPI_PRESETS)[number] {
  return (
    REDACT_DPI_PRESETS.find((preset) => preset.id === id) ??
    REDACT_DPI_PRESETS[1]!
  );
}

/** Hex fill for a redaction color, used both on the canvas and for pdf-lib. */
export function redactionFillHex(fill: RedactionFill | undefined): string {
  return fill === "white" ? "#ffffff" : "#000000";
}

/**
 * A page's displayed size, accounting for its rotation: a page rotated 90°/270°
 * presents its media box's height as its width and vice-versa. This is the space
 * a redaction rectangle is expressed in — the page as the viewer sees it.
 */
export function displayedPageSize(
  width: number,
  height: number,
  rotationDegrees = 0,
): PageSize {
  const angle = ((Math.round(rotationDegrees) % 360) + 360) % 360;
  return angle === 90 || angle === 270
    ? { width: height, height: width }
    : { width, height };
}

function isFiniteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate proposed redaction rectangles against the document's page sizes.
 * Returns one issue per problem (empty when everything is valid), so a UI can
 * surface exactly which box is wrong and why.
 */
export function validateRedactions(
  rects: RedactionRect[],
  pageSizes: PageSize[],
): RedactionIssue[] {
  const issues: RedactionIssue[] = [];
  const pageCount = pageSizes.length;

  rects.forEach((rect, index) => {
    const label = `Redaction ${index + 1}`;

    if (
      !Number.isInteger(rect.page) ||
      rect.page < 1 ||
      rect.page > pageCount
    ) {
      issues.push({
        index,
        code: "page-out-of-range",
        message: `${label}: page ${rect.page} is out of range (1–${pageCount}).`,
      });
      return;
    }

    if (
      !isFiniteNumber(rect.x) ||
      !isFiniteNumber(rect.y) ||
      !isFiniteNumber(rect.width) ||
      !isFiniteNumber(rect.height)
    ) {
      issues.push({
        index,
        code: "invalid",
        message: `${label}: coordinates must be finite numbers.`,
      });
      return;
    }

    if (rect.width <= 0 || rect.height <= 0) {
      issues.push({
        index,
        code: "empty",
        message: `${label}: width and height must be greater than 0.`,
      });
      return;
    }

    const size = pageSizes[rect.page - 1]!;
    const withinBounds =
      rect.x >= -EDGE_EPSILON &&
      rect.y >= -EDGE_EPSILON &&
      rect.x + rect.width <= size.width + EDGE_EPSILON &&
      rect.y + rect.height <= size.height + EDGE_EPSILON;

    if (!withinBounds) {
      issues.push({
        index,
        code: "out-of-bounds",
        message: `${label}: the box extends outside the ${Math.round(size.width)}×${Math.round(size.height)} pt page.`,
      });
    }
  });

  return issues;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a redaction rectangle (PDF points, bottom-left origin) onto a rendered
 * page bitmap (device pixels, top-left origin). Rounds the box *outward* so it
 * can never leave a readable sliver, then clamps it to the canvas.
 */
export function redactionRectToPixels(
  rect: Pick<RedactionRect, "x" | "y" | "width" | "height">,
  page: Pick<RasterCanvasInfo, "width" | "height" | "pageWidth" | "pageHeight">,
): PixelRect {
  const scaleX = page.pageWidth > 0 ? page.width / page.pageWidth : 1;
  const scaleY = page.pageHeight > 0 ? page.height / page.pageHeight : 1;

  // Canvas y grows downward, so the box's top edge sits at (pageHeight - top-in-
  // points) where top-in-points = y + height (its upper edge from the bottom).
  const leftPx = rect.x * scaleX;
  const rightPx = (rect.x + rect.width) * scaleX;
  const topPx = (page.pageHeight - (rect.y + rect.height)) * scaleY;
  const bottomPx = (page.pageHeight - rect.y) * scaleY;

  const x0 = clampInt(Math.floor(leftPx), 0, page.width);
  const x1 = clampInt(Math.ceil(rightPx), 0, page.width);
  const y0 = clampInt(Math.floor(topPx), 0, page.height);
  const y1 = clampInt(Math.ceil(bottomPx), 0, page.height);

  return {
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  };
}

/** Resolve a rebuilt page's size in points, falling back to pixel dimensions. */
export function pageSizeForRaster(
  page: Pick<RasterPage, "pageWidth" | "pageHeight" | "width" | "height">,
): [number, number] {
  const width =
    Number.isFinite(page.pageWidth) && page.pageWidth > 0
      ? page.pageWidth
      : page.width;
  const height =
    Number.isFinite(page.pageHeight) && page.pageHeight > 0
      ? page.pageHeight
      : page.height;
  return [Math.max(1, width), Math.max(1, height)];
}

/**
 * Read each page's displayed size (rotation-aware, in points). Used by the UI to
 * bound and validate boxes before running the redaction.
 */
export async function getRedactPageSizes(
  bytes: Uint8Array,
): Promise<PageSize[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((page) => {
    const { width, height } = page.getCropBox();
    return displayedPageSize(width, height, page.getRotation().angle);
  });
}

/** Group rectangles by their 1-based page number. */
function groupByPage(rects: RedactionRect[]): Map<number, RedactionRect[]> {
  const byPage = new Map<number, RedactionRect[]>();
  for (const rect of rects) {
    const list = byPage.get(rect.page);
    if (list) list.push(rect);
    else byPage.set(rect.page, [rect]);
  }
  return byPage;
}

/** Paint every redaction box for a page onto its rendered canvas (in place). */
function paintRedactions(
  canvas: HTMLCanvasElement,
  rects: RedactionRect[],
  page: RasterCanvasInfo,
  fillHex: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = fillHex;
  for (const rect of rects) {
    const px = redactionRectToPixels(rect, page);
    if (px.width > 0 && px.height > 0) {
      ctx.fillRect(px.x, px.y, px.width, px.height);
    }
  }
}

/**
 * Redact a PDF by rasterizing every page, painting solid fill over the given
 * rectangles, and rebuilding a new PDF from those images. Runs entirely in the
 * browser — nothing is uploaded, and the pdfjs worker is bundled locally.
 *
 * Throws a typed, user-facing error when no boxes are given or nothing can be
 * rendered. Out-of-canvas geometry is clamped rather than rejected here; callers
 * should pre-validate with {@link validateRedactions} to catch bad input early.
 */
export async function redactPdf(
  bytes: Uint8Array,
  options: RedactOptions,
  /**
   * The rasterizer. Always {@link rasterizePdf} in the product; a parameter so
   * `redact-paint.test.ts` can hand the REAL paint path a pixel canvas in Node
   * and read the bitmap the encoder would receive — the pdfjs render itself
   * needs a browser, but the paint that makes a redaction a redaction does not.
   * (A `vi.mock` of ./render would poison this module in the shared test cache:
   * see src/tests/mock-isolation.test.ts.)
   */
  rasterize: (
    bytes: Uint8Array,
    options: RasterizeOptions,
  ) => Promise<RasterPage[]> = rasterizePdf,
): Promise<RedactResult> {
  const rects = options.rects ?? [];
  if (rects.length === 0) {
    throw new PdfEngineError(
      "Add at least one redaction area before redacting.",
    );
  }

  const pageSizes = await getRedactPageSizes(bytes);
  const issues = validateRedactions(rects, pageSizes);
  if (issues.length > 0) {
    const first = issues[0]!;
    const rest = issues.length - 1;
    throw new PdfEngineError(
      rest > 0
        ? `${first.message} (${rest} more issue${rest === 1 ? "" : "s"}.)`
        : first.message,
    );
  }

  const fillHex = redactionFillHex(options.fill);
  const byPage = groupByPage(rects);

  const pages = await rasterize(bytes, {
    format: "jpg",
    dpi: options.dpi ?? 150,
    quality: options.quality ?? 0.85,
    signal: options.signal,
    onProgress: options.onProgress,
    onCanvas: (canvas, page) => {
      const pageRects = byPage.get(page.index + 1);
      if (pageRects && pageRects.length > 0) {
        paintRedactions(canvas, pageRects, page, fillHex);
      }
    },
  });
  if (pages.length === 0) {
    throw new PdfEngineError("No pages could be rendered from this PDF.");
  }

  const { PDFDocument, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setTitle("Redacted PDF");

  for (const page of pages) {
    const [pageWidth, pageHeight] = pageSizeForRaster(page);
    const outPage = doc.addPage([pageWidth, pageHeight]);
    outPage.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: rgb(1, 1, 1),
    });
    const image = await embedRasterImage(doc, page.bytes, "jpg");
    outPage.drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  }

  return {
    bytes: await doc.save(),
    pageCount: pages.length,
    redactionCount: rects.length,
    totalImageBytes: pages.reduce(
      (sum, page) => sum + page.bytes.byteLength,
      0,
    ),
    undecodedImages: pages.reduce((sum, page) => sum + page.undecodedImages, 0),
  };
}
