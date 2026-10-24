import { awaitPdfjsDocument, loadPdfjs } from "../pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "../wasm-assets";
import type { PdfjsTextItem } from "./runs";

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

/** A rendered canvas larger than this many device pixels is drawn at a lower ratio. */
export const MAX_CANVAS_PIXELS = 16_000_000;

export interface EditorPdf {
  readonly numPages: number;
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
  ): Promise<HTMLCanvasElement | null>;
  /**
   * Page `index`'s text items as pdf.js reads them (what a viewer selects
   * and searches): text, text-space matrix in user space, advance. Empty on
   * failure (a scan has none either).
   */
  textContent(index: number): Promise<PdfjsTextItem[]>;
  destroy(): Promise<void>;
}

/** The device ratio a page can be drawn at without passing {@link MAX_CANVAS_PIXELS}. */
export function cappedPixelRatio(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): number {
  const ratio = Math.max(1, Math.min(3, pixelRatio || 1));
  const area = cssWidth * cssHeight * ratio * ratio;
  if (area <= MAX_CANVAS_PIXELS || area === 0) return ratio;
  return Math.max(0.5, Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)));
}

export async function openEditorPdf(bytes: Uint8Array): Promise<EditorPdf> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  const doc = await awaitPdfjsDocument(task);
  let destroyed = false;

  const render: EditorPdf["render"] = async (
    index,
    scale,
    pixelRatio,
    signal,
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
      const css = page.getViewport({ scale, rotation: page.rotate });
      const ratio = cappedPixelRatio(css.width, css.height, pixelRatio);
      const viewport = page.getViewport({
        scale: scale * ratio,
        rotation: page.rotate,
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
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
      page.cleanup();
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
    numPages: doc.numPages,
    render,
    textContent,
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      await task.destroy().catch(() => {});
    },
  };
}
