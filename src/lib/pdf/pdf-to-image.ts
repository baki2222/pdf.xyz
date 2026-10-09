/**
 * Pure, DOM-free helpers for the "PDF to image" tools (PDF → PNG, PDF → JPG):
 * format/MIME/extension mapping, render-resolution presets, JPEG quality
 * clamping, the single-vs-ZIP decision, and download-file naming. The
 * browser-only rasterization (pdfjs + canvas) lives in "./render"; everything
 * here is plain data so it can be unit-tested exhaustively and imported from
 * anywhere without pulling in the heavy rendering pipeline.
 */

import { baseName, sanitizeSegment } from "./files";

export type RasterFormat = "png" | "jpg";

/** Canvas / Blob MIME type for each output format. */
export const RASTER_MIME: Record<RasterFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
};

/** Download-file extension for each output format. */
export const RASTER_EXT: Record<RasterFormat, string> = {
  png: "png",
  jpg: "jpg",
};

/** Map a catalog slug to the image format its runner produces. */
export function rasterFormatForSlug(slug: string): RasterFormat {
  return slug === "pdf-to-png" ? "png" : "jpg";
}

/** A selectable render-resolution preset. */
export interface RasterResolution {
  id: string;
  label: string;
  /** Dots per inch to rasterize at (PDF user space is 72 dpi). */
  dpi: number;
}

/** Resolution presets offered in the UI, lowest → highest. */
export const RASTER_RESOLUTIONS: readonly RasterResolution[] = [
  { id: "screen", label: "Screen", dpi: 96 },
  { id: "high", label: "High", dpi: 150 },
  { id: "print", label: "Print", dpi: 300 },
];

/** "a, b or c" — a reader's list. */
function orList(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/**
 * "Screen (96 DPI), High (150 DPI) or Print (300 DPI)" — the presets as the
 * tool pages and guides name them, built from the list the runner renders.
 */
export const RASTER_RESOLUTION_CHOICES = orList(
  RASTER_RESOLUTIONS.map((r) => `${r.label} (${r.dpi} DPI)`),
);

/** "96, 150 or 300" — the same presets, as numbers. */
export const RASTER_RESOLUTION_DPIS = orList(
  RASTER_RESOLUTIONS.map((r) => String(r.dpi)),
);

/** Default resolution id — a good balance of sharpness and file size. */
export const DEFAULT_RESOLUTION_ID = "high";

/** Resolve a preset id to its resolution, falling back to the default. */
export function resolutionById(id: string): RasterResolution {
  const found = RASTER_RESOLUTIONS.find((r) => r.id === id);
  if (found) return found;
  // The default id is guaranteed to exist in the preset list.
  return RASTER_RESOLUTIONS.find((r) => r.id === DEFAULT_RESOLUTION_ID)!;
}

/** PDF user space is 72 dpi; the pdfjs render scale to hit `dpi` is dpi / 72. */
export function rasterScaleForDpi(dpi: number): number {
  if (!Number.isFinite(dpi) || dpi <= 0) return 1;
  return dpi / 72;
}

/**
 * Cap on either rendered dimension (px) for full-page rasterization. Higher
 * than the thumbnail cap so print-DPI output stays crisp, but still bounds peak
 * canvas memory (one page's bitmap is freed before the next renders). Lives
 * here, beside the presets, because the tool pages state it: at Print, a page
 * larger than about 16 inches on a side is rendered below the preset.
 */
export const RASTER_MAX_DEVICE_PX = 5000;

/** Default JPEG quality (0..1) — high, visually near-lossless but compact. */
export const DEFAULT_JPEG_QUALITY = 0.92;

/** Clamp a JPEG quality into canvas' meaningful [0.1, 1] range; NaN → default. */
export function clampJpegQuality(quality: number): number {
  if (!Number.isFinite(quality)) return DEFAULT_JPEG_QUALITY;
  return Math.min(1, Math.max(0.1, quality));
}

/**
 * How many rendered pages get a preview — and with it, their own download
 * button. The ZIP still holds every page. Here rather than in the runner
 * because the tool page says which pages can be saved one by one.
 */
export const RASTER_PREVIEW_LIMIT = 24;

/** More than one page is delivered as a ZIP; a single page downloads directly. */
export function shouldZipPages(pageCount: number): boolean {
  return pageCount > 1;
}

/** Zero-pad width so page numbers sort in reading order, e.g. 10 pages → 2. */
export function pageNumberWidth(pageCount: number): number {
  return String(Math.max(1, Math.floor(pageCount) || 1)).length;
}

/**
 * Download name for one rendered page. A single-page document keeps the source
 * name (`report.png`); multi-page documents get a zero-padded page suffix
 * (`report-page-03.png`) so the files sort in reading order.
 */
export function pageImageName(
  sourceName: string,
  index: number,
  pageCount: number,
  format: RasterFormat,
): string {
  const base = sanitizeSegment(baseName(sourceName ?? ""));
  const ext = RASTER_EXT[format];
  if (pageCount <= 1) return `${base}.${ext}`;
  const n = String(index + 1).padStart(pageNumberWidth(pageCount), "0");
  return `${base}-page-${n}.${ext}`;
}

/** Download name for the ZIP bundling every rendered page. */
export function zipOutputName(
  sourceName: string,
  format: RasterFormat,
): string {
  const base = sanitizeSegment(baseName(sourceName ?? ""));
  return `${base}-${format}.zip`;
}

/** The next preset below `id`, or `undefined` when `id` is already the lowest. */
export function lowerResolutionThan(id: string): RasterResolution | undefined {
  const at = RASTER_RESOLUTIONS.findIndex((r) => r.id === id);
  return at > 0 ? RASTER_RESOLUTIONS[at - 1] : undefined;
}

/**
 * The sentence appended to "the ZIP could not be prepared" on the PDF-to-image
 * result — only what the page can actually do. A lower preset makes smaller
 * images and so a smaller archive; per-page downloads exist only for pages that
 * have a preview button, which is not every page of a long document.
 */
export function zipFailureFallback({
  lowerResolution,
  everyPageHasButton,
}: {
  lowerResolution: string | undefined;
  everyPageHasButton: boolean;
}): string | undefined {
  const lower = lowerResolution
    ? `re-render at ${lowerResolution} resolution for a smaller ZIP`
    : null;
  const pages = everyPageHasButton
    ? "download the pages one at a time below"
    : null;
  if (lower && pages) return `If it keeps failing, ${lower}, or ${pages}.`;
  if (lower ?? pages) return `If it keeps failing, ${lower ?? pages}.`;
  return undefined;
}

/**
 * The longest page side, in inches, that `dpi` renders at full resolution
 * under the rasterizer's `maxDevicePx` cap — what a preset chip promises
 * before anything renders. Floored to a tenth, never rounded: 5000 / 300 is
 * 16.67 in, and "16.7 in" would name a 16.68 in page as safe when the cap
 * lowers it.
 */
export function rasterCapInches(dpi: number, maxDevicePx: number): string {
  return (Math.floor((maxDevicePx / dpi) * 10) / 10).toFixed(1);
}

/**
 * What the result panel says when the rasterizer rendered pages BELOW the DPI
 * the user picked — `null` when it did not. Pages longer than
 * `maxDevicePx / requestedDpi` inches are capped (see `RASTER_MAX_DEVICE_PX`);
 * the preset label alone would then overstate every one of them.
 *
 * The DPI is floored, never rounded: 213.8 DPI of scale is at most 213 DPI of
 * whole pixels, and the note exists to stop overstating.
 */
export function rasterCapNote(
  pages: readonly { dpi: number; dpiCapped: boolean }[],
  requestedDpi: number,
  maxDevicePx: number,
): string | null {
  const capped = pages.filter((p) => p.dpiCapped);
  if (capped.length === 0) return null;
  const floors = capped.map((p) => Math.floor(p.dpi));
  const lowest = floors.reduce((a, b) => Math.min(a, b));
  const same = floors.every((d) => d === lowest);
  const single = pages.length === 1;
  const subject = single
    ? "This page is"
    : capped.length === pages.length
      ? `All ${pages.length} pages are`
      : `${capped.length} of ${pages.length} pages are`;
  const verb = single ? "it was" : "they were";
  const at = same ? `${lowest} DPI` : `as low as ${lowest} DPI`;
  return `${subject} too large for ${requestedDpi} DPI — ${verb} rendered at ${at}, because images are limited to ${maxDevicePx.toLocaleString("en-US")} pixels on a side.`;
}
