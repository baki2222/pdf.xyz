import {
  AUTO_CROP_LONG_SIDE_PX,
  findInkBox,
  planAutoCrop,
  type AutoCropPlan,
  type InkBox,
  type RasterPage,
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
  await guard.preflightPdfjsOpen(bytes);
  const sizes = await getPageSizes(bytes);
  const pdfjs = await pdfjsModule;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  const doc = await awaitPdfjsDocument(task);
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
    const pages: ({ ink: InkBox | null; raster: RasterPage } | null)[] = [];
    for (let n = 1; n <= total; n++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const page = await doc.getPage(n);
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
        const ink = findInkBox(raster);
        factory.destroy?.(entry);
        page.cleanup();
        // Keep only the size of the raster, never its pixels.
        pages.push({ ink, raster: { width, height, data: [] } });
      } catch (err) {
        if (signal?.aborted) throw err;
        pages.push(null); // Unreadable page: left uncropped, and named.
      }
      onProgress?.({ done: n, total });
    }
    return planAutoCrop(pages, sizes);
  } finally {
    await task.destroy().catch(() => {});
  }
}
