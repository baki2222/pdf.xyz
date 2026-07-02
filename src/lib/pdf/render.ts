import { renderDimensions, type Thumbnail } from "./render-utils";

/**
 * Browser-only PDF rasterizer built on pdfjs-dist. Everything here is loaded
 * lazily via dynamic `import()` and touches the DOM (canvas, object URLs), so
 * this module must only ever be called from client code — never at module load,
 * on the server, or in a plain Node test. The pure math lives in "./render-utils".
 *
 * Design notes:
 *  - The pdfjs worker is bundled locally (privacy-first: no CDN request).
 *  - Pages render at their *base* orientation (rotation 0); the UI applies the
 *    display rotation via CSS, so a page's rotation stays a single source of
 *    truth across the rotate/organize/select tools.
 *  - pdfjs may transfer (detach) the ArrayBuffer it is handed, so we always give
 *    it a private copy — the caller's bytes must stay intact for the real op.
 *  - Rendering is sequential and yields between pages, so even a large document
 *    never blocks selection or scrolling; an AbortSignal stops it promptly.
 */

let workerConfigured = false;

/** Lazily import pdfjs and point it at the locally-bundled worker (once). */
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    workerConfigured = true;
  }
  return pdfjs;
}

export interface RenderThumbnailsOptions {
  /** Target CSS width in px for each thumbnail (device pixels are derived). */
  targetWidth?: number;
  /** Device pixel ratio to render at (clamped internally). */
  pixelRatio?: number;
  /** Canvas background; defaults to white so transparent PDFs read cleanly. */
  background?: string;
  /** Stop rendering promptly when this aborts. */
  signal?: AbortSignal;
  /** Only render the first `maxPages` pages (used for cover thumbnails). */
  maxPages?: number;
  /** Called once per successfully-rendered page, in page order. */
  onThumbnail: (thumb: Thumbnail) => void;
}

/**
 * Progressively rasterize a PDF's pages to PNG object URLs, invoking
 * `onThumbnail` as each finishes. Resolves when all requested pages are done or
 * the signal aborts. Per-page failures are swallowed (the page keeps its
 * placeholder); a failure to load pdfjs or the document rejects the promise so
 * callers can fall back gracefully.
 */
export async function renderThumbnails(
  bytes: Uint8Array,
  {
    targetWidth,
    pixelRatio = 1,
    background = "#ffffff",
    signal,
    maxPages = Number.POSITIVE_INFINITY,
    onThumbnail,
  }: RenderThumbnailsOptions,
): Promise<void> {
  if (typeof document === "undefined") return;
  if (signal?.aborted) return;

  const pdfjs = await loadPdfjs();
  // Hand pdfjs a private copy; it may detach the buffer it receives.
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, verbosity: 0 });

  let currentRender: { cancel: () => void } | null = null;
  const onAbort = () => {
    currentRender?.cancel();
    void loadingTask.destroy().catch(() => {});
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    const doc = await loadingTask.promise;
    const limit = Math.min(doc.numPages, Math.max(0, maxPages));

    for (let i = 0; i < limit; i++) {
      if (signal?.aborted) break;

      let page;
      try {
        page = await doc.getPage(i + 1);
      } catch {
        continue; // Skip a page we can't even fetch.
      }

      try {
        const base = page.getViewport({ scale: 1, rotation: 0 });
        const dims = renderDimensions(base.width, base.height, targetWidth, pixelRatio);
        const viewport = page.getViewport({ scale: dims.scale, rotation: 0 });

        const canvas = document.createElement("canvas");
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        canvas.width = width;
        canvas.height = height;

        const task = page.render({ canvas, viewport, background });
        currentRender = task;
        await task.promise;
        currentRender = null;

        if (signal?.aborted) break;

        const url = await canvasToUrl(canvas);
        // Release the backing bitmap now that the PNG is captured.
        canvas.width = 0;
        canvas.height = 0;
        if (!url) continue;
        if (signal?.aborted) {
          URL.revokeObjectURL(url);
          break;
        }

        onThumbnail({ index: i, url, width, height });
        await nextFrame(); // Yield to keep the UI responsive between pages.
      } catch (err) {
        currentRender = null;
        if (signal?.aborted || isRenderingCancelled(pdfjs, err)) break;
        // Otherwise skip this page and keep going.
      } finally {
        page.cleanup();
      }
    }

    doc.cleanup();
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    await loadingTask.destroy().catch(() => {});
  }
}

/** Render just the first page of a PDF — a cover thumbnail. Never throws. */
export async function renderFirstPage(
  bytes: Uint8Array,
  options: Omit<RenderThumbnailsOptions, "onThumbnail" | "maxPages"> = {},
): Promise<Thumbnail | null> {
  let cover: Thumbnail | null = null;
  try {
    await renderThumbnails(bytes, {
      ...options,
      maxPages: 1,
      onThumbnail: (thumb) => {
        cover = thumb;
      },
    });
  } catch {
    return null;
  }
  return cover;
}

function isRenderingCancelled(
  pdfjs: Awaited<ReturnType<typeof loadPdfjs>>,
  err: unknown,
): boolean {
  return err instanceof pdfjs.RenderingCancelledException;
}

/** Turn a canvas into a PNG object URL, falling back to a data URL. */
function canvasToUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob(
        (blob) => resolve(blob ? URL.createObjectURL(blob) : null),
        "image/png",
      );
      return;
    }
    try {
      resolve(canvas.toDataURL("image/png"));
    } catch {
      resolve(null);
    }
  });
}

/** Resolve on the next animation frame (or a macrotask if rAF is unavailable). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
