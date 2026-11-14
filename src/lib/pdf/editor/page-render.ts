import { awaitPdfjsDocument, loadPdfjs } from "../pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "../wasm-assets";
import type { PdfjsTextItem } from "./runs";
import { MAX_CANVAS_PIXELS } from "../viewer-geometry";
import { KEPT_IMAGE_PIXELS, pageKeeper } from "../kept-pages";

/**
 * pdf.js, held open for the editor's page view: one parse, then any page
 * rendered on demand into a canvas the caller owns, in the DISPLAYED
 * orientation (the page's own `/Rotate` applied, its visible box only) — the
 * frame the overlay's objects are stored in.
 *
 * Browser-only (canvas). The caller's bytes are copied before pdf.js sees
 * them, because pdf.js may detach the buffer it is handed and the same bytes
 * go to pdf-lib at export.
 */

/**
 * Where the editor's open finds pdf.js: `loadPdfjs`, behind an object so a
 * test can see the options `getDocument` is handed without `vi.mock` (under
 * the suite's `isolate: false`, a module evaluated under a mock stays bound
 * to the stub for the next file). Nothing else writes it.
 */
export const editorPdfjs = { load: loadPdfjs };

/**
 * How many pages keep what pdf.js decoded for them (operator list, images)
 * after they are drawn: at most 6. A zoom step, the page's rail thumbnail and
 * the canvas draw one page several times, and `page.cleanup()` drops its
 * decoded images, so each draw decoded them again (measured on a 25 MP image
 * at scales 1, 1.25, 1.5: 3,997, 4,045 and 4,052 ms, a full decode each
 * time). The page drawn longest ago past this many is cleaned up, as pdf.js's
 * own viewer keeps a buffer of pages (`DEFAULT_CACHE_SIZE`, 10) instead of
 * cleaning each one — and sooner when the pages kept hold more decoded image
 * pixels than {@link EDITOR_KEPT_IMAGE_PIXELS} (`../kept-pages`, the PDF
 * Viewer's rule).
 */
export const EDITOR_KEPT_PAGES = 6;

/**
 * The decoded image pixels kept across drawn pages: the viewer's budget, one
 * raster image's (`RASTER_MAX_IMAGE_PIXELS`, held equal by
 * editor-retention.test.ts). Six pages alone held 150 MP of a 25 MP scan.
 */
export const EDITOR_KEPT_IMAGE_PIXELS = KEPT_IMAGE_PIXELS;

/**
 * A rendered canvas larger than this many device pixels is drawn at a lower
 * ratio. One figure for the editor and the PDF Viewer, defined beside the
 * viewer's own cap (`../viewer-geometry`).
 */
export { MAX_CANVAS_PIXELS };

export interface EditorPdf {
  readonly numPages: number;
  /**
   * The output paths' sentence for an image over its raster budget (CO-08,
   * `PDF_IMAGE_TOO_LARGE_MESSAGE`) when the file holds one, which this view
   * leaves out; null when there is none. The file's, never a page's: pdf.js
   * 6 does not report which page skipped it (see `preflightPdfjsBytes`).
   * What the view does instead is the caller's to say, in its own words.
   */
  readonly imageTooLarge: string | null;
  /**
   * Draw page `index` (0-based) into a NEW canvas at `scale` CSS px per point
   * and `pixelRatio` device px per CSS px. Resolves null when aborted or the
   * page fails — never throws, so a bad page keeps its blank sheet.
   */
  render(
    index: number,
    scale: number,
    pixelRatio: number,
    signal?: AbortSignal,
    /** A quarter turn ADDED to the page's own `/Rotate` (the editor's page list). */
    turn?: number,
  ): Promise<HTMLCanvasElement | null>;
  /**
   * Page `index`'s text items as pdf.js reads them (what a viewer selects
   * and searches): text, text-space matrix in user space, advance. Empty on
   * failure (a scan has none either).
   */
  textContent(index: number): Promise<PdfjsTextItem[]>;
  destroy(): Promise<void>;
}

/**
 * The device ratio a page can be drawn at without passing
 * {@link MAX_CANVAS_PIXELS}: the device's own (1-3) when it fits, else the
 * ratio at which the canvas IS the cap, however far below 1 that is.
 *
 * History (2026-11-09): the cap was floored at 0.5, so a page past 64 MP of
 * CSS pixels (A1 or larger at the deepest zoom) was allocated past the cap
 * it is named for: A0 at 400% took 57 MP. A page that large is drawn softer
 * at that zoom; the canvas no longer grows with it.
 */
export function cappedPixelRatio(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): number {
  const ratio = Math.max(1, Math.min(3, pixelRatio || 1));
  const area = cssWidth * cssHeight * ratio * ratio;
  if (area <= MAX_CANVAS_PIXELS || area === 0) return ratio;
  return Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
}

/**
 * Open `bytes` for the editor's canvas. Rejects, typed, when the preflight
 * every pdf.js open runs refuses the file (a stream that expands past the
 * memory bounds, content nested too deeply, a cross-reference pdf.js would
 * walk without end), when pdf.js cannot open it, or when its page count is
 * not one a person can be shown (/Count 0 or -1: the unreadable copy).
 */
export async function openEditorPdf(bytes: Uint8Array): Promise<EditorPdf> {
  // ../pdfjs-guard is its own chunk, requested with pdfjs, not after it.
  const guardModule = import("../pdfjs-guard");
  const pdfjsModule = editorPdfjs.load();
  pdfjsModule.catch(() => {});
  const guard = await guardModule;
  // A preview, as the thumbnails are (`createThumbnailRenderer`): an image
  // over its raster budget is skipped by pdf.js before it decodes it (CO-08),
  // so the page is drawn without it instead of stalling ~40 s on it.
  const preflight = await guard.preflightPdfjsOpen(bytes);
  const { previewOptions, overBudgetImage } = preflight;
  const pdfjs = await pdfjsModule;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...previewOptions,
  });
  const doc = await awaitPdfjsDocument(task);
  let numPages: number;
  try {
    numPages = guard.pdfjsPageCount(doc.numPages);
  } catch (err) {
    await task.destroy().catch(() => {});
    throw err;
  }
  let destroyed = false;
  // Pages drawn lately, each still holding what pdf.js decoded for it (see
  // EDITOR_KEPT_PAGES and EDITOR_KEPT_IMAGE_PIXELS).
  const keep = pageKeeper(EDITOR_KEPT_PAGES, EDITOR_KEPT_IMAGE_PIXELS);

  const render: EditorPdf["render"] = async (
    index,
    scale,
    pixelRatio,
    signal,
    turn = 0,
  ) => {
    if (destroyed || signal?.aborted) return null;
    let page;
    try {
      page = await doc.getPage(index + 1);
    } catch {
      return null;
    }
    let running: { promise: Promise<void>; cancel: () => void } | null = null;
    const onAbort = () => running?.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const rotation = (page.rotate + turn) % 360;
      const css = page.getViewport({ scale, rotation });
      const ratio = cappedPixelRatio(css.width, css.height, pixelRatio);
      const viewport = page.getViewport({
        scale: scale * ratio,
        rotation,
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      // A page whose images together pass the page budget is not decoded:
      // its sheet says why (RASTER_MAX_PAGE_IMAGE_PIXELS), never blank.
      const note = guard.pageImageVerdict(preflight, page.ref);
      if (note !== null) {
        guard.drawPageNote(canvas, note);
        return canvas;
      }
      running = page.render({ canvas, viewport, background: "#ffffff" });
      await running.promise;
      if (signal?.aborted) {
        canvas.width = 0;
        canvas.height = 0;
        return null;
      }
      return canvas;
    } catch {
      return null;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      keep(index, page);
    }
  };

  const textContent: EditorPdf["textContent"] = async (index) => {
    if (destroyed) return [];
    try {
      const page = await doc.getPage(index + 1);
      const content = await page.getTextContent();
      const out: PdfjsTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        out.push({
          str: item.str,
          transform: Array.from(item.transform as number[]),
          width: item.width,
        });
      }
      return out;
    } catch {
      return [];
    }
  };

  return {
    numPages,
    imageTooLarge: overBudgetImage ? guard.PDF_IMAGE_TOO_LARGE_MESSAGE : null,
    render,
    textContent,
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      await task.destroy().catch(() => {});
    },
  };
}
