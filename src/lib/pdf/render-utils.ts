/**
 * Pure geometry for PDF thumbnail rendering. No pdfjs, no DOM — just the
 * scale/fit math, so it can be unit-tested exhaustively and imported anywhere
 * without pulling in the (heavy, browser-only) rendering pipeline.
 */

/** A rendered thumbnail: an object URL plus its pixel dimensions. */
export interface Thumbnail {
  /** 0-based index of the source page this thumbnail belongs to. */
  index: number;
  /** Object URL of the rendered PNG. The owner must revoke it when done. */
  url: string;
  /** Rendered bitmap width, in device pixels. */
  width: number;
  /** Rendered bitmap height, in device pixels. */
  height: number;
}

/** CSS width (px) we aim for when rasterizing a page thumbnail. */
export const THUMBNAIL_TARGET_WIDTH = 240;

/** Upper bound on the device-pixel multiplier so hi-DPI screens don't over-render. */
export const MAX_PIXEL_RATIO = 2;

/** Cap on either rendered dimension (px) so a huge page can't exhaust memory. */
export const MAX_DEVICE_PX = 2400;

/** A4 portrait dimensions in PDF points — the fallback for malformed pages. */
const FALLBACK_WIDTH_PT = 595;
const FALLBACK_HEIGHT_PT = 842;

/** Clamp a device pixel ratio into a sane [1, MAX_PIXEL_RATIO] range. */
export function clampPixelRatio(pixelRatio: number): number {
  if (!Number.isFinite(pixelRatio) || pixelRatio < 1) return 1;
  return Math.min(pixelRatio, MAX_PIXEL_RATIO);
}

/**
 * The pdfjs render scale needed to hit a target *device* pixel width for a page
 * whose intrinsic (scale-1) width is `pageWidthPt`. Guards against zero/negative
 * inputs so a malformed page can't yield NaN/Infinity.
 */
export function thumbnailScale(
  pageWidthPt: number,
  targetCssWidth = THUMBNAIL_TARGET_WIDTH,
  pixelRatio = 1,
): number {
  if (!Number.isFinite(pageWidthPt) || pageWidthPt <= 0) return 1;
  const target = Math.max(1, targetCssWidth) * clampPixelRatio(pixelRatio);
  return target / pageWidthPt;
}

/** Aspect ratio (w / h) of a page; falls back to A4 portrait for bad input. */
export function aspectRatio(width: number, height: number): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return FALLBACK_WIDTH_PT / FALLBACK_HEIGHT_PT;
  }
  return width / height;
}

export interface RenderDims {
  /** Scale to pass to `getViewport`. */
  scale: number;
  /** Target bitmap width, in device pixels. */
  width: number;
  /** Target bitmap height, in device pixels. */
  height: number;
}

/**
 * Resolve the scale and integer pixel dimensions for a page thumbnail. The
 * scale targets `targetCssWidth * pixelRatio` device pixels wide, but is capped
 * so neither dimension exceeds `maxDevicePx`. Bad page sizes fall back to A4.
 */
export function renderDimensions(
  pageWidthPt: number,
  pageHeightPt: number,
  targetCssWidth = THUMBNAIL_TARGET_WIDTH,
  pixelRatio = 1,
  maxDevicePx = MAX_DEVICE_PX,
): RenderDims {
  const w =
    Number.isFinite(pageWidthPt) && pageWidthPt > 0
      ? pageWidthPt
      : FALLBACK_WIDTH_PT;
  const h =
    Number.isFinite(pageHeightPt) && pageHeightPt > 0
      ? pageHeightPt
      : FALLBACK_HEIGHT_PT;

  let scale = thumbnailScale(w, targetCssWidth, pixelRatio);
  const maxScale = Math.min(maxDevicePx / w, maxDevicePx / h);
  if (scale > maxScale) scale = maxScale;
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  return {
    scale,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/* ------------------------------------------------------------------ *
 *  Undecoded images — the engine's own verdict, not a pixel guess.
 * ------------------------------------------------------------------ */

/**
 * How many images on `pageIndex` pdfjs tried to paint and could not decode.
 *
 * pdfjs already reports this and we simply never read it. When
 * `buildPaintImageXObject` fails it warns and resolves the image object to
 * `null`; those are the only sites that resolve an image to null, so null
 * means "decode failed", exactly and only. `wasm-assets.test.ts` asserts that
 * convention still holds in the shipped worker, because the dangerous failure
 * here is a SILENT ZERO — a counter that has quietly stopped counting is a
 * more confident lie than the absence it replaced.
 *
 * Deliberately NOT a pixel heuristic: a legitimately blank page — a real empty
 * sheet, a cover page — has no failed image object and therefore reports zero,
 * which no uniformity check could promise.
 *
 * Ids look like `img_p{page}_{n}`, or `g_d{doc}_img_p{page}_{n}` when the image
 * came from the cross-page cache, so both pools are read and attributed by the
 * page number embedded in the id.
 */
export function countUndecodedImages(
  entries: Iterable<[string, unknown]> | null | undefined,
  pageIndex: number,
): number {
  if (!entries) return 0;
  const seen = new Set<string>();
  let failed = 0;
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 1) continue;
    const [id, data] = entry as [string, unknown];
    if (typeof id !== "string" || seen.has(id)) continue;
    const match = /(?:^|_)img_p(\d+)_/.exec(id);
    if (!match) continue; // patterns, masks and fonts are other kinds of object
    if (Number(match[1]) !== pageIndex) continue;
    seen.add(id);
    if (data === null) failed += 1;
  }
  return failed;
}
