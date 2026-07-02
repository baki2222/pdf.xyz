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
 *  - A document is parsed **once** into a `ThumbnailRenderer`; individual pages
 *    are then rasterized on demand. This lets the UI eagerly render the first N
 *    pages and lazily render the rest as they scroll into view — without
 *    re-parsing a large PDF for every batch.
 *  - pdfjs may transfer (detach) the ArrayBuffer it is handed, so we always give
 *    it a private copy — the caller's bytes must stay intact for the real op.
 *  - Each render can be cancelled promptly via an AbortSignal.
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

export interface RenderPageOptions {
  /** Target CSS width in px for the thumbnail (device pixels are derived). */
  targetWidth?: number;
  /** Device pixel ratio to render at (clamped internally). */
  pixelRatio?: number;
  /** Canvas background; defaults to white so transparent PDFs read cleanly. */
  background?: string;
  /** Stop rendering promptly when this aborts. */
  signal?: AbortSignal;
}

/**
 * A parsed PDF whose pages can be rasterized one at a time. Hold onto it for the
 * lifetime of a document view and call `destroy()` when done to free pdfjs.
 */
export interface ThumbnailRenderer {
  /** Number of pages in the document. */
  readonly numPages: number;
  /**
   * Rasterize a single 0-based page to a PNG object URL. Returns `null` for an
   * out-of-range index, an aborted signal, or a per-page render failure — never
   * throws — so callers keep their placeholder tile. The owner must revoke the
   * returned URL when finished with it.
   */
  renderPage(index: number, options?: RenderPageOptions): Promise<Thumbnail | null>;
  /** Release the pdfjs document and worker resources. Idempotent. */
  destroy(): Promise<void>;
}

/**
 * Parse `bytes` once and return a renderer for on-demand page rasterization.
 * Rejects only if the document can't be loaded at all (so callers can fall back
 * to placeholders); individual page failures are swallowed by `renderPage`.
 */
export async function createThumbnailRenderer(
  bytes: Uint8Array,
  base: RenderPageOptions = {},
): Promise<ThumbnailRenderer> {
  const pdfjs = await loadPdfjs();
  // Hand pdfjs a private copy; it may detach the buffer it receives.
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await loadingTask.promise;
  let destroyed = false;

  const renderPage = async (
    index: number,
    options: RenderPageOptions = {},
  ): Promise<Thumbnail | null> => {
    if (destroyed) return null;
    const signal = options.signal ?? base.signal;
    if (signal?.aborted) return null;
    if (!Number.isInteger(index) || index < 0 || index >= doc.numPages) {
      return null;
    }

    let page;
    try {
      page = await doc.getPage(index + 1);
    } catch {
      return null; // Can't even fetch the page — keep the placeholder.
    }

    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    const onAbort = () => task?.cancel();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    try {
      const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
      const dims = renderDimensions(
        baseViewport.width,
        baseViewport.height,
        options.targetWidth ?? base.targetWidth,
        options.pixelRatio ?? base.pixelRatio ?? 1,
      );
      const viewport = page.getViewport({ scale: dims.scale, rotation: 0 });

      const canvas = document.createElement("canvas");
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      canvas.width = width;
      canvas.height = height;

      const background = options.background ?? base.background ?? "#ffffff";
      task = page.render({ canvas, viewport, background });
      await task.promise;

      if (signal?.aborted) {
        canvas.width = 0;
        canvas.height = 0;
        return null;
      }

      const url = await canvasToUrl(canvas);
      // Release the backing bitmap now that the PNG is captured.
      canvas.width = 0;
      canvas.height = 0;
      if (!url) return null;
      if (signal?.aborted) {
        URL.revokeObjectURL(url);
        return null;
      }
      return { index, url, width, height };
    } catch (err) {
      if (signal?.aborted || isRenderingCancelled(pdfjs, err)) return null;
      return null; // Any other per-page failure: fall back to the placeholder.
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      page.cleanup();
    }
  };

  const destroy = async () => {
    if (destroyed) return;
    destroyed = true;
    try {
      doc.cleanup();
    } catch {
      // best-effort
    }
    await loadingTask.destroy().catch(() => {});
  };

  return { numPages: doc.numPages, renderPage, destroy };
}

export interface RenderThumbnailsOptions extends RenderPageOptions {
  /** Only render the first `maxPages` pages (used for cover thumbnails). */
  maxPages?: number;
  /** Explicit 0-based page indices to render, in order (overrides `maxPages`). */
  pages?: number[];
  /** Called once per successfully-rendered page, in the given order. */
  onThumbnail: (thumb: Thumbnail) => void;
}

/**
 * Progressively rasterize a set of pages to PNG object URLs, invoking
 * `onThumbnail` as each finishes. Resolves when all requested pages are done or
 * the signal aborts. A failure to load pdfjs or the document rejects the promise
 * so callers can fall back gracefully; per-page failures are swallowed.
 */
export async function renderThumbnails(
  bytes: Uint8Array,
  {
    targetWidth,
    pixelRatio = 1,
    background = "#ffffff",
    signal,
    maxPages = Number.POSITIVE_INFINITY,
    pages,
    onThumbnail,
  }: RenderThumbnailsOptions,
): Promise<void> {
  if (typeof document === "undefined") return;
  if (signal?.aborted) return;

  const renderer = await createThumbnailRenderer(bytes, {
    targetWidth,
    pixelRatio,
    background,
  });

  try {
    const indices =
      pages ??
      Array.from(
        { length: Math.min(renderer.numPages, Math.max(0, maxPages)) },
        (_, i) => i,
      );

    for (const index of indices) {
      if (signal?.aborted) break;
      const thumb = await renderer.renderPage(index, { signal });
      if (signal?.aborted) {
        if (thumb) URL.revokeObjectURL(thumb.url);
        break;
      }
      if (!thumb) continue;
      onThumbnail(thumb);
      await nextFrame(); // Yield to keep the UI responsive between pages.
    }
  } finally {
    await renderer.destroy();
  }
}

/** Render just the first page of a PDF — a cover thumbnail. Never throws. */
export async function renderFirstPage(
  bytes: Uint8Array,
  options: Omit<RenderThumbnailsOptions, "onThumbnail" | "maxPages" | "pages"> = {},
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
