import {
  AUTO_CROP_LONG_SIDE_PX,
  findInkBox,
  planAutoCrop,
  type AutoCropPlan,
  type InkBox,
  type PageAnalysis,
} from "./auto-crop";
import { getPageSizes } from "./crop";
import { awaitPdfjsDocument, loadPdfjs } from "./pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/**
 * Auto-crop's render: every page through pdf.js at a low resolution, as a
 * reader sees it (crop box, `/Rotate` applied), reduced at once to its ink
 * box so no page's pixels outlive its own analysis. The arithmetic is
 * `auto-crop.ts`'s, shared with the Node render the unit test uses.
 *
 * Canvases come from pdf.js's own canvas factory, which is a DOM canvas in a
 * browser and `@napi-rs/canvas` under Node — so the runner test can drive
 * this very function. A missing factory is an error, never a white page: a
 * blank render would call every page blank, and "nothing to crop" is the
 * convenient answer.
 *
 * IMAGES IT DOES NOT DECODE (lane image-budget-residuals, 2026-11-14). An
 * image past its raster budget (CO-08) is skipped by pdf.js before it is
 * decoded (the preflight's `previewOptions`), and a page whose images
 * together pass the page budget is drawn with NO image (a second document
 * opened with `NO_IMAGES`). A skipped image leaves white where it sits, so
 * cropping to the remaining ink would cut it off: each skipped image's
 * PLACEMENT (its unit square through the matrix at its `Do`, read from the
 * page's content by `imagePlacements`) counts as ink instead. Where that
 * cannot be worked out, the page is kept whole (`plan.whole`) and said so.
 *
 * Until then this render opened pdf.js with neither option and decoded a
 * CO-08 image in full (the open guard's RENDER_EXEMPT entry).
 */

interface CanvasLike {
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray };
}

interface CanvasFactory {
  create(w: number, h: number): { canvas: unknown; context: CanvasLike };
  destroy?(entry: { canvas: unknown; context: CanvasLike }): void;
}

export interface AutoCropProgress {
  done: number;
  total: number;
}

/** Analyse every page of `bytes` and plan the crop. */
export async function detectAutoCrop(
  bytes: Uint8Array,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: AutoCropProgress) => void;
  } = {},
): Promise<AutoCropPlan> {
  const { signal, onProgress } = options;
  // The preflight every pdf.js open runs, before pdf-lib or pdf.js parses
  // anything; its chunk is requested with pdfjs, not after it.
  const guardModule = import("./pdfjs-guard");
  const pdfjsModule = loadPdfjs();
  pdfjsModule.catch(() => {});
  const guard = await guardModule;
  const preflight = await guard.preflightPdfjsOpen(bytes);
  const sizes = await getPageSizes(bytes);
  const pdfjs = await pdfjsModule;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...preflight.previewOptions,
  });
  const doc = await awaitPdfjsDocument(task);
  /** The same file with every image skipped, for pages past the page budget. */
  let bare: Awaited<ReturnType<typeof openWithoutImages>> | null = null;
  const bareDoc = async () =>
    (bare ??= await openWithoutImages(bytes, guard, pdfjs)).doc;
  const skipAbove = preflight.previewOptions.maxImageSize ?? Infinity;
  try {
    // pdf.js reports a root /Count of 0 or -1 as given while pdf-lib repairs
    // the tree, so a loop to numPages analysed no page against every size
    // and planned "nothing to crop". That is the unreadable-file refusal;
    // a page pdf.js cannot fetch is analysed as unread, and every size gets
    // a verdict (lane res1, CO-03).
    guard.pdfjsPageCount(doc.numPages);
    const total = sizes.length;
    const factory = (doc as unknown as { canvasFactory?: CanvasFactory })
      .canvasFactory;
    if (!factory || typeof factory.create !== "function") {
      // Not a sentence for a reader: the runner says what this means.
      throw new Error("pdf.js canvas factory unavailable");
    }
    const pages: PageAnalysis[] = [];
    for (let n = 1; n <= total; n++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const shown = await doc.getPage(n);
        // Past the page budget, every image is skipped; else those past
        // their own budget are. Each skipped image's placement is ink.
        const over = guard.pageImageVerdict(preflight, shown.ref) !== null;
        const bound = over ? 0 : skipAbove;
        const placed =
          over || preflight.overBudgetImage
            ? await guard.imagePlacements(bytes, shown.ref, bound)
            : [];
        if (placed === null) {
          pages.push("whole");
          onProgress?.({ done: n, total });
          continue;
        }
        const page = over ? await (await bareDoc()).getPage(n) : shown;
        const unit = page.getViewport({ scale: 1 });
        const scale =
          AUTO_CROP_LONG_SIDE_PX / Math.max(unit.width, unit.height, 1);
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.round(viewport.width));
        const height = Math.max(1, Math.round(viewport.height));
        const entry = factory.create(width, height);
        await page.render({
          canvas: entry.canvas as HTMLCanvasElement,
          canvasContext: entry.context as unknown as CanvasRenderingContext2D,
          viewport,
          background: "rgb(255,255,255)",
        }).promise;
        const raster = {
          width,
          height,
          data: entry.context.getImageData(0, 0, width, height).data,
        };
        const ink = withPlacements(
          findInkBox(raster),
          placed.map(([x0, y0, x1, y1]) =>
            [
              [x0, y0],
              [x1, y0],
              [x0, y1],
              [x1, y1],
            ].flatMap(
              ([x, y]) => viewport.convertToViewportPoint(x!, y!) as number[],
            ),
          ),
          width,
          height,
        );
        factory.destroy?.(entry);
        page.cleanup();
        // Keep only the size of the raster, never its pixels.
        pages.push({ ink, raster: { width, height, data: [] } });
      } catch (err) {
        if (signal?.aborted) throw err;
        // Unreadable page: left uncropped, and named.
        pages.push(null);
      }
      onProgress?.({ done: n, total });
    }
    const plan = planAutoCrop(pages, sizes);
    if (plan.whole.length > 0) plan.wholeNote = wholeNote(plan.whole);
    return plan;
  } finally {
    await task.destroy().catch(() => {});
    await (bare as { task: { destroy(): Promise<void> } } | null)?.task
      .destroy()
      .catch(() => {});
  }
}

/**
 * The words for pages kept whole: "Page 3 has a large image ...", "Pages 2
 * and 5 have large images ...", at most eight numbers then "and N more".
 */
export function wholeNote(whole: readonly number[]): {
  page: string;
  summary: string;
} {
  const shown = whole.slice(0, 8).map((i) => String(i + 1));
  const more = whole.length - shown.length;
  const one = whole.length === 1;
  const list = one
    ? `Page ${shown[0]}`
    : more > 0
      ? `Pages ${shown.join(", ")} and ${more} more`
      : `Pages ${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return {
    page: "This page has a large image whose position could not be worked out, so it is left uncropped. Crop it by hand to trim it.",
    summary: `${list} ${one ? "has a large image whose position" : "have large images whose positions"} could not be worked out, so ${one ? "it is" : "they are"} left uncropped; crop by hand to trim ${one ? "it" : "them"}.`,
  };
}

/**
 * `bytes` opened with every image skipped before it is decoded
 * (`NO_IMAGES`): a page past the page budget is analysed without its images,
 * which count by their placements instead. The preflight is the same call
 * every open makes first; for these bytes it is already answered.
 */
async function openWithoutImages(
  bytes: Uint8Array,
  guard: typeof import("./pdfjs-guard"),
  pdfjs: Awaited<ReturnType<typeof loadPdfjs>>,
) {
  await guard.preflightPdfjsOpen(bytes);
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...guard.NO_IMAGES.previewOptions,
  });
  const doc = awaitPdfjsDocument(task);
  // Awaited by the caller; never an unhandled rejection.
  doc.catch(() => {});
  return { task, doc };
}

/**
 * The ink box grown to hold every placement (each the viewport pixels of a
 * box's corners, x and y in turn, as `convertToViewportPoint` gives them),
 * clipped to the raster: a skipped image is ink wherever it sits on the page.
 */
export function withPlacements(
  ink: InkBox | null,
  rects: readonly number[][],
  width: number,
  height: number,
): InkBox | null {
  let box = ink;
  for (const r of rects) {
    const xs = r.filter((_, i) => i % 2 === 0);
    const ys = r.filter((_, i) => i % 2 === 1);
    if (![...xs, ...ys].every(Number.isFinite) || xs.length === 0) continue;
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const right = Math.min(width, Math.ceil(Math.max(...xs)));
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const bottom = Math.min(height, Math.ceil(Math.max(...ys)));
    // Off the page.
    if (!(left < right && top < bottom)) continue;
    box = box
      ? {
          left: Math.min(box.left, left),
          top: Math.min(box.top, top),
          right: Math.max(box.right, right),
          bottom: Math.max(box.bottom, bottom),
        }
      : { left, top, right, bottom };
  }
  return box;
}
