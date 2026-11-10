/**
 * What a pdf.js page view keeps of what pdf.js decoded for the pages it drew,
 * so a zoom step redraws a page without decoding its images again — the one
 * rule the PDF Viewer (`./viewer`) and the editor's page canvas
 * (`./editor/page-render`) share: at most `maxPages` pages, and at most
 * {@link KEPT_IMAGE_PIXELS} decoded image pixels summed over them. The page
 * drawn longest ago is released first (`page.cleanup()`), and a page whose own
 * images pass the pixel budget is released as soon as it is drawn.
 *
 * The pixel budget is the bound: a page count alone kept the decoded images of
 * the last pages drawn, which no cap limits (the raster budget is per image).
 * A 20-page scan of 25 MP images grew a viewer tab past 1.3 GB while its
 * canvases never passed 5 MP (review, 2026-11-10), and the editor kept six
 * pages the same way until it shared this rule. What a page holds is read from
 * pdf.js's own record of what it decoded for it (`page.objs`), so the sum is
 * of what is retained, not of what is shown.
 */

/**
 * The decoded image pixels kept across drawn pages: as many as ONE image may
 * have on the raster path (`RASTER_MAX_IMAGE_PIXELS`, held equal by
 * viewer-retention.test.ts and editor-retention.test.ts — typed here so a page
 * view does not load the guard's chunk with its own).
 */
export const KEPT_IMAGE_PIXELS = 50_000_000;

/**
 * The image pixels pdf.js holds decoded for `page`, from its object store
 * (`page.objs`: one entry per image it decoded for this page, with its width
 * and height). Infinity when the store cannot be read, so a page whose
 * holdings are unknown is never kept.
 */
export function decodedImagePixels(page: { objs?: unknown }): number {
  try {
    let pixels = 0;
    for (const entry of page.objs as Iterable<[unknown, unknown]>) {
      const data = entry[1];
      if (typeof data !== "object" || data === null) continue;
      const { width, height } = data as { width?: unknown; height?: unknown };
      if (
        typeof width === "number" &&
        typeof height === "number" &&
        width > 0 &&
        height > 0
      ) {
        pixels += width * height;
      }
    }
    return pixels;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** A drawn page as the rule sees it: its store, and how to release it. */
export interface KeptPage {
  readonly objs?: unknown;
  cleanup(): unknown;
}

/**
 * The keeper: call it with each page as it is drawn (again or for the first
 * time). It records the page as drawn most recently, then releases the oldest
 * until at most `maxPages` remain and their decoded images sum to at most
 * `maxPixels`.
 */
export function pageKeeper(
  maxPages: number,
  maxPixels: number = KEPT_IMAGE_PIXELS,
): (index: number, page: KeptPage) => void {
  const kept: { index: number; page: KeptPage; pixels: number }[] = [];
  return (index, page) => {
    const at = kept.findIndex((k) => k.index === index);
    if (at !== -1) kept.splice(at, 1);
    kept.push({ index, page, pixels: decodedImagePixels(page) });
    const held = () => kept.reduce((sum, k) => sum + k.pixels, 0);
    while (kept.length > 0 && (kept.length > maxPages || held() > maxPixels)) {
      kept.shift()!.page.cleanup();
    }
  };
}
