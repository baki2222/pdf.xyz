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
 * pdf.js's own records of what it decoded for it, so the sum is of what is
 * retained, not of what is shown — BOTH records:
 *
 *  - `page.objs`, one entry per image XObject it decoded for the page;
 *  - the page's operator lists (`page._intentStates`), where pdf.js keeps an
 *    INLINE image under 200 px wide-plus-high (pdfjs-dist 6,
 *    `SMALL_IMAGE_DIMENSIONS`) decoded to RGBA inside the operator's
 *    arguments, never in `page.objs`. Until 2026-11-10 only the first was
 *    read, and a page of 1,700 such images (16.7 MP) read as 0: a 593 KB
 *    file held 439 MB in the editor (hostile review). Both stores live until
 *    `page.cleanup()`.
 *
 * `pdfjs-guard-bounds.test.ts` measures both, through real pdf.js, as what
 * the PROCESS retains.
 */

/**
 * The decoded image pixels kept across drawn pages: as many as ONE image may
 * have on the raster path (`RASTER_MAX_IMAGE_PIXELS`, held equal by
 * viewer-retention.test.ts and editor-retention.test.ts — typed here so a page
 * view does not load the guard's chunk with its own).
 */
export const KEPT_IMAGE_PIXELS = 50_000_000;

/**
 * The image pixels pdf.js holds decoded for `page`: its object store
 * (`page.objs`: one entry per image it decoded for this page, with its width
 * and height) plus the images inside its operator lists
 * ({@link operatorListImagePixels}). Infinity when either cannot be read, so
 * a page whose holdings are unknown is never kept.
 */
export function decodedImagePixels(page: {
  objs?: unknown;
  _intentStates?: unknown;
}): number {
  try {
    let pixels = operatorListImagePixels(page._intentStates);
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

/**
 * The decoded image data a page's operator lists hold, in pixels of RGBA (its
 * bytes / 4: an inline image pdf.js decodes to RGBA is exactly its width x
 * height; a 1-bit mask is less). `intentStates` is pdf.js's
 * `PDFPageProxy._intentStates`: a Map of render intents, each holding
 * `operatorList.argsArray`. Every argument that is image data (a `data`
 * typed array with a numeric width and height), or an array of such (the
 * grouped forms pdf.js makes of runs of small images), is counted. Throws
 * when the lists are not where pdf.js 6 keeps them.
 */
function operatorListImagePixels(intentStates: unknown): number {
  if (!(intentStates instanceof Map)) {
    throw new TypeError("no operator lists to read");
  }
  let bytes = 0;
  const imageBytes = (v: unknown): number => {
    if (typeof v !== "object" || v === null) return 0;
    const { data, width, height } = v as {
      data?: unknown;
      width?: unknown;
      height?: unknown;
    };
    return ArrayBuffer.isView(data) &&
      typeof width === "number" &&
      typeof height === "number"
      ? data.byteLength
      : 0;
  };
  for (const state of intentStates.values()) {
    const args = (state as { operatorList?: { argsArray?: unknown } })
      .operatorList?.argsArray;
    if (args === undefined) continue;
    if (!Array.isArray(args)) throw new TypeError("unreadable operator list");
    for (const op of args) {
      if (!Array.isArray(op)) continue;
      for (const arg of op) {
        if (Array.isArray(arg)) for (const a of arg) bytes += imageBytes(a);
        else bytes += imageBytes(arg);
      }
    }
  }
  return Math.ceil(bytes / 4);
}

/** A drawn page as the rule sees it: its stores, and how to release it. */
export interface KeptPage {
  readonly objs?: unknown;
  readonly _intentStates?: unknown;
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
