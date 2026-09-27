import {
  countUndecodedImages,
  rasterPageScale,
  renderDimensions,
  type Thumbnail,
} from "./render-utils";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import {
  DEFAULT_JPEG_QUALITY,
  RASTER_MIME,
  clampJpegQuality,
  type RasterFormat,
} from "./pdf-to-image";

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
  /**
   * `"base"` (default) renders the unrotated page for tiles that apply a
   * rotation in CSS; `"displayed"` applies the page's own `/Rotate`, so the
   * pixels are in the same frame as coordinates a reader would use.
   */
  orientation?: "base" | "displayed";
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
  renderPage(
    index: number,
    options?: RenderPageOptions,
  ): Promise<Thumbnail | null>;
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
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
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
      // Base orientation by default (the rotate/organize tiles turn it in CSS);
      // "displayed" bakes the page's own /Rotate in, for overlays drawn in the
      // frame a reader sees.
      const orientation = options.orientation ?? base.orientation ?? "base";
      const rotation = orientation === "displayed" ? page.rotate : 0;
      const baseViewport = page.getViewport({ scale: 1, rotation });
      const dims = renderDimensions(
        baseViewport.width,
        baseViewport.height,
        options.targetWidth ?? base.targetWidth,
        options.pixelRatio ?? base.pixelRatio ?? 1,
      );
      const viewport = page.getViewport({ scale: dims.scale, rotation });

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
  options: Omit<
    RenderThumbnailsOptions,
    "onThumbnail" | "maxPages" | "pages"
  > = {},
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

/* ------------------------------------------------------------------ *
 *  Full-page rasterization (PDF → PNG / JPG)
 * ------------------------------------------------------------------ */

/** One rendered page: encoded image bytes plus its bitmap dimensions. */
export interface RasterPage {
  /** 0-based index of the source page. */
  index: number;
  /** Encoded image bytes — PNG or JPEG per the requested format. */
  bytes: Uint8Array;
  /** Rendered bitmap width, in device pixels. */
  width: number;
  /** Rendered bitmap height, in device pixels. */
  height: number;
  /** Source page width, in PDF points. */
  pageWidth: number;
  /** Source page height, in PDF points. */
  pageHeight: number;
  /**
   * Resolution this page was ACTUALLY rendered at, in DPI. Equal to the
   * requested DPI unless {@link RasterPage.dpiCapped}.
   */
  dpi: number;
  /**
   * True when the requested DPI would have exceeded `RASTER_MAX_DEVICE_PX` on
   * a side, so the page was rendered at the lower `dpi`. A tool that names a
   * DPI to the user has to say so when this is set.
   */
  dpiCapped: boolean;
  /**
   * Images on this page that pdfjs could not decode, and which are therefore
   * MISSING from `bytes` — the engine's own verdict, counted so a tool can say
   * so instead of handing back a confidently blank picture. Normally 0.
   */
  undecodedImages: number;
}

/**
 * The rendered-canvas context handed to an {@link RasterizeOptions.onCanvas}
 * hook: the bitmap size (device px) plus the source page size (PDF points), so a
 * caller can map point-space geometry onto the pixels.
 */
export interface RasterCanvasInfo {
  /** 0-based index of the source page. */
  index: number;
  /** Rendered bitmap width, in device pixels. */
  width: number;
  /** Rendered bitmap height, in device pixels. */
  height: number;
  /** Source page width, in PDF points. */
  pageWidth: number;
  /** Source page height, in PDF points. */
  pageHeight: number;
}

export interface RasterizeOptions {
  /** Output image format. */
  format: RasterFormat;
  /** Target resolution in dots-per-inch (PDF user space is 72 dpi). */
  dpi?: number;
  /** JPEG quality in [0, 1]; ignored for PNG. */
  quality?: number;
  /** Canvas background; defaults to white (JPEG has no alpha channel). */
  background?: string;
  /** Convert rendered pixels to grayscale before encoding. */
  grayscale?: boolean;
  /**
   * Mutate each page's canvas in place just before it is encoded — after any
   * grayscale pass. Used to paint solid redaction boxes directly over the
   * pixels so the underlying content is destroyed, not merely covered.
   */
  onCanvas?: (canvas: HTMLCanvasElement, page: RasterCanvasInfo) => void;
  /** Abort promptly between and within pages. */
  signal?: AbortSignal;
  /** Invoked as each page finishes, in page order. */
  onPage?: (page: RasterPage) => void;
  /** Invoked after each page with running progress counts. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Rasterize every page of a PDF to encoded image bytes, entirely in the browser
 * (privacy-first: nothing is uploaded, and the pdfjs worker is bundled locally).
 * Pages render at their embedded rotation so the image matches how the page is
 * displayed.
 *
 * Rejects if the document can't be parsed, or if a page genuinely fails to
 * render or encode — a converter must never silently drop pages. An aborted
 * signal instead resolves early with the pages produced so far.
 */
export async function rasterizePdf(
  bytes: Uint8Array,
  { format, quality, onPage, ...rest }: RasterizeOptions,
): Promise<RasterPage[]> {
  const mime = RASTER_MIME[format];
  const encodeQuality =
    format === "jpg"
      ? clampJpegQuality(quality ?? DEFAULT_JPEG_QUALITY)
      : undefined;
  const toRasterPage = ({ data, ...page }: CapturedPage<Uint8Array>) => ({
    ...page,
    bytes: data,
  });
  const pages = await capturePdfPages(bytes, {
    ...rest,
    capture: (canvas) => canvasToImageBytes(canvas, mime, encodeQuality),
    onPage: onPage && ((page) => onPage(toRasterPage(page))),
  });
  return pages.map(toRasterPage);
}

/** One rendered page, captured by {@link CapturePagesOptions.capture}. */
export interface CapturedPage<T> extends RasterCanvasInfo {
  /** Whatever the capture hook made of the rendered canvas. */
  data: T;
  /** See {@link RasterPage.dpi}. */
  dpi: number;
  /** See {@link RasterPage.dpiCapped}. */
  dpiCapped: boolean;
  /** See {@link RasterPage.undecodedImages}. */
  undecodedImages: number;
}

export interface CapturePagesOptions<T> extends Omit<
  RasterizeOptions,
  "format" | "quality" | "onPage"
> {
  /**
   * Turn each rendered canvas into the caller's own page payload — runs after
   * the grayscale pass and `onCanvas`, and in place of the browser's image
   * encoder. The canvas is released as soon as this settles, so a caller that
   * needs the pixels in another form (a luminance plane, say) takes them here
   * and keeps only what it produced: nothing page-sized is retained across the
   * document. Returning `null` fails the page, exactly as a failed encode does.
   */
  capture: (
    canvas: HTMLCanvasElement,
    page: RasterCanvasInfo,
  ) => Promise<T | null> | T | null;
  /** Invoked as each page finishes, in page order. */
  onPage?: (page: CapturedPage<T>) => void;
  /** Invoked once, after the document parses and before any page renders. */
  onDocument?: (info: RasterDocumentInfo) => void;
}

/** Document-level facts a capture caller may want to carry into its output. */
export interface RasterDocumentInfo {
  numPages: number;
  /**
   * The source's title — the Info dictionary's /Title, else XMP `dc:title` —
   * or null when it has none (or its metadata cannot be read).
   */
  title: string | null;
}

/**
 * The page loop behind {@link rasterizePdf}, with the encode step handed to the
 * caller. Same guarantees: rejects on a page that fails to render or capture,
 * resolves early (with the pages so far) on abort.
 */
export async function capturePdfPages<T>(
  bytes: Uint8Array,
  {
    dpi = 150,
    background = "#ffffff",
    grayscale = false,
    onCanvas,
    capture,
    signal,
    onPage,
    onDocument,
    onProgress,
  }: CapturePagesOptions<T>,
): Promise<CapturedPage<T>[]> {
  if (typeof document === "undefined") return [];
  const pdfjs = await loadPdfjs();
  // Hand pdfjs a private copy; it may detach the buffer it receives.
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({ data, ...PDFJS_DOCUMENT_DEFAULTS });
  const doc = await loadingTask.promise;

  const pages: CapturedPage<T>[] = [];

  try {
    if (onDocument) {
      onDocument({ numPages: doc.numPages, title: await documentTitle(doc) });
    }
    const total = doc.numPages;
    onProgress?.(0, total);
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) break;
      const page = await doc.getPage(i + 1);

      let task: { promise: Promise<void>; cancel: () => void } | null = null;
      const onAbort = () => task?.cancel();
      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      try {
        // Render at the page's embedded rotation (the default viewport rotation)
        // so the exported image matches the page as it is displayed.
        const base = page.getViewport({ scale: 1 });
        // The scale AND the verdict on it: a page too large for `dpi` is
        // rendered lower, and the page record below carries that fact out.
        const fit = rasterPageScale(base.width, base.height, dpi);
        const viewport = page.getViewport({ scale: fit.scale });

        const canvas = document.createElement("canvas");
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        canvas.width = width;
        canvas.height = height;

        task = page.render({ canvas, viewport, background });
        await task.promise;

        // Read pdfjs's decode verdicts BEFORE `page.cleanup()` in the finally
        // block clears the object pools. Safe here by construction: pdfjs
        // blocks the operator list on each image dependency, so every image
        // this page paints has resolved by the time the render promise does.
        const undecodedImages =
          countUndecodedImages(page.objs as never, i) +
          countUndecodedImages(page.commonObjs as never, i);

        if (signal?.aborted) {
          canvas.width = 0;
          canvas.height = 0;
          break;
        }

        if (grayscale) grayscaleCanvas(canvas);
        const info: RasterCanvasInfo = {
          index: i,
          width,
          height,
          pageWidth: base.width,
          pageHeight: base.height,
        };
        // Let the caller paint over the pixels (e.g. redaction boxes) before the
        // image is encoded — this is what makes the covered content unrecoverable.
        onCanvas?.(canvas, info);
        const captured = await capture(canvas, info);
        // Release the backing bitmap now that the page is captured.
        canvas.width = 0;
        canvas.height = 0;

        if (signal?.aborted) break;
        if (captured === null) {
          throw new Error(`Page ${i + 1} could not be encoded.`);
        }

        const rendered: CapturedPage<T> = {
          ...info,
          data: captured,
          dpi: fit.dpi,
          dpiCapped: fit.dpiCapped,
          undecodedImages,
        };
        pages.push(rendered);
        onPage?.(rendered);
        onProgress?.(pages.length, total);
        await nextFrame(); // Yield so the UI stays responsive between pages.
      } catch (err) {
        if (signal?.aborted || isRenderingCancelled(pdfjs, err)) break;
        throw new Error(`Page ${i + 1} could not be rendered.`);
      } finally {
        if (signal) signal.removeEventListener("abort", onAbort);
        page.cleanup();
      }
    }
  } finally {
    try {
      doc.cleanup();
    } catch {
      // best-effort
    }
    await loadingTask.destroy().catch(() => {});
  }

  return pages;
}

/** The document's own title, as a viewer would show it; null when absent. */
async function documentTitle(doc: {
  getMetadata(): Promise<{
    info: object;
    metadata: { get(name: string): unknown } | null;
  }>;
}): Promise<string | null> {
  try {
    const { info, metadata } = await doc.getMetadata();
    const candidates = [
      (info as { Title?: unknown }).Title,
      metadata?.get("dc:title"),
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  } catch {
    // Unreadable metadata is not a reason to fail a render.
  }
  return null;
}

/** Rec. 601 luma of one pixel — the single definition both helpers below use. */
function luma(r: number, g: number, b: number): number {
  return Math.round(r * 0.299 + g * 0.587 + b * 0.114);
}

/** Convert RGBA image data to luminance grayscale in-place. */
export function grayscaleImageData(data: Uint8ClampedArray): void {
  for (let i = 0; i + 2 < data.length; i += 4) {
    const gray = luma(data[i]!, data[i + 1]!, data[i + 2]!);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
}

/**
 * The luminance plane of RGBA image data: one byte per pixel, row-major, the
 * same value {@link grayscaleImageData} would write into each colour channel.
 * This is what a genuinely single-channel (DeviceGray) image is made from.
 */
export function luminancePlane(data: Uint8ClampedArray): Uint8Array {
  const plane = new Uint8Array(data.length >> 2);
  for (let i = 0, p = 0; p < plane.length; i += 4, p++) {
    plane[p] = luma(data[i]!, data[i + 1]!, data[i + 2]!);
  }
  return plane;
}

function grayscaleCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  grayscaleImageData(image.data);
  ctx.putImageData(image, 0, 0);
}

/** Encode a canvas to image bytes, falling back to a data URL when needed. */
async function canvasToImageBytes(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number | undefined,
): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((result) => resolve(result), mime, quality);
    } else {
      resolve(null);
    }
  });
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  try {
    return dataUrlToBytes(canvas.toDataURL(mime, quality));
  } catch {
    return null;
  }
}

/** Decode a base64 `data:` URL into raw bytes. */
function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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
