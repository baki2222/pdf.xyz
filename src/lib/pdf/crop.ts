import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { clamp, loadPdf, stampProducer } from "./stamp";
import { MIN_CROP_DIMENSION } from "./page-geometry";

/**
 * Crop PDF pages entirely in-browser by shrinking each page's CropBox — the
 * region a viewer displays and prints. We inset the *current* crop box (so
 * repeated crops compose) and never emit a degenerate box, which keeps the
 * output valid in every reader. The geometry is a pure function, so it can be
 * unit-tested with plain numbers instead of brittle visual assertions.
 *
 * Coordinate model: PDF boxes use a bottom-left origin (y up), so the `left`
 * and `bottom` insets move the origin inward while `right`/`top` only shrink
 * the size. We touch the CropBox rather than the MediaBox so the underlying
 * page geometry is preserved and downstream tools stay well-defined.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-edge crop insets, in PDF points (1pt = 1/72 inch). */
export interface CropMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// The floor lives in the page-geometry leaf, where the tool page's answer reads
// it too; re-exported so existing importers keep working.
export { MIN_CROP_DIMENSION };

/** A no-op crop, handy as an initial UI state. */
export const NO_CROP: CropMargins = { top: 0, right: 0, bottom: 0, left: 0 };

/** True when every edge inset is zero or negative (nothing to crop). */
export function isEmptyMargins(margins: CropMargins): boolean {
  return (
    margins.top <= 0 &&
    margins.right <= 0 &&
    margins.bottom <= 0 &&
    margins.left <= 0
  );
}

/**
 * Inset a box by per-edge margins (points, each clamped to ≥0). Returns null
 * when the remaining region would be smaller than {@link MIN_CROP_DIMENSION} on
 * either axis, so callers can refuse rather than write an invalid page box.
 */
export function insetBox(box: Box, margins: CropMargins): Box | null {
  const left = Math.max(0, margins.left);
  const right = Math.max(0, margins.right);
  const top = Math.max(0, margins.top);
  const bottom = Math.max(0, margins.bottom);
  const width = box.width - left - right;
  const height = box.height - top - bottom;
  if (width < MIN_CROP_DIMENSION || height < MIN_CROP_DIMENSION) return null;
  return { x: box.x + left, y: box.y + bottom, width, height };
}

/** A sensible download name for a cropped document, derived from the source. */
export function croppedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "cropped");
}

/** Read each page's displayed size (its CropBox), in document order (points). */
export async function getPageSizes(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }[]> {
  const doc = await loadPdf(bytes);
  return doc.getPages().map((page) => {
    const { width, height } = page.getCropBox();
    return { width, height };
  });
}

/** De-duplicate, drop out-of-range values, and sort ascending. */
function sanitizeIndices(indices: number[], count: number): number[] {
  const set = new Set<number>();
  for (const i of indices) {
    if (Number.isInteger(i) && i >= 0 && i < count) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

export interface CropOptions {
  margins: CropMargins;
  /** 0-based indices to crop; when omitted, every page is cropped. */
  pages?: number[];
}

/**
 * Crop pages of a PDF by insetting each target page's crop box. Throws a typed,
 * user-facing error if the margins are empty, no valid page is selected, or the
 * inset would collapse a page.
 */
export async function cropPdf(
  bytes: Uint8Array,
  options: CropOptions,
): Promise<Uint8Array> {
  const margins: CropMargins = {
    top: clamp(options.margins.top, 0, 100000),
    right: clamp(options.margins.right, 0, 100000),
    bottom: clamp(options.margins.bottom, 0, 100000),
    left: clamp(options.margins.left, 0, 100000),
  };
  if (isEmptyMargins(margins)) {
    throw new PdfEngineError("Set a crop margin on at least one edge.");
  }

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const target =
    options.pages === undefined
      ? pages.map((_, i) => i)
      : sanitizeIndices(options.pages, pages.length);
  if (target.length === 0) {
    throw new PdfEngineError("Select at least one page to crop.");
  }

  for (const index of target) {
    const page = pages[index];
    if (!page) continue;
    const next = insetBox(page.getCropBox(), margins);
    if (!next) {
      throw new PdfEngineError(
        `The crop margins are larger than page ${index + 1}. Reduce them and try again.`,
      );
    }
    page.setCropBox(next.x, next.y, next.width, next.height);
  }

  stampProducer(doc);
  return doc.save();
}
