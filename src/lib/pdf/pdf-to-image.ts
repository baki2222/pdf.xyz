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
