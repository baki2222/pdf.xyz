import { awaitPdfjsDocument, loadPdfjs } from "./pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";
import {
  VIEWER_MAX_LINKS_PER_PAGE,
  VIEWER_MAX_TEXT_ITEMS,
  canvasSize,
  viewerRenderScale,
  type FractionRect,
  type PageSize,
  type QuarterTurn,
} from "./viewer-geometry";
import { safeExternalHref, walkOutline } from "./viewer-links";
import type { SearchItem } from "./viewer-search";

/**
 * pdf.js, held open for the PDF Viewer: one parse, then any page drawn on
 * demand into a canvas the caller owns, its text read for search and the
 * selectable layer, its links and the bookmark tree read — every one
 * bounded (`./viewer-geometry`'s caps), every failure contained to the page
 * it is about.
 *
 * THE OPEN IS EVERY pdf.js OPEN'S: `preflightPdfjsOpen` first (the xref
 * pre-scan and the stream preflight refuse, typed, what pdf.js cannot open
 * in bounded memory or time), then `getDocument` with the app's defaults
 * and the preflight's `previewOptions` — a view is a PREVIEW, so an image
 * over its raster budget is skipped by pdf.js before it is decoded
 * (CO-08), and the viewer says "some large images are not drawn" without
 * claiming which (pdf.js 6 does not report the page). Both are held by
 * `pdfjs-open-preflight.test.ts`, which discovers this file by its
 * `getDocument(` and its `page.render(`.
 *
 * Browser-only for drawing (canvas); the bytes are copied before pdf.js sees
 * them, because pdf.js may detach the buffer it is handed and the same
 * bytes are what Download saves, unchanged.
 */

/**
 * Where the viewer's open finds pdf.js: `loadPdfjs`, behind an object so a
 * test can see the options `getDocument` is handed without `vi.mock` (under
 * the suite's `isolate: false`, a module evaluated under a mock stays bound
 * to the stub for the next file). Nothing else writes it.
 */
export const viewerPdfjs = { loadPdfjs };

/**
 * What a drawn page keeps of what pdf.js decoded for it, so a zoom step
 * redraws it without decoding its images again: at most
 * {@link VIEWER_KEPT_PAGES} pages, and at most
 * {@link VIEWER_KEPT_IMAGE_PIXELS} decoded image pixels summed over them.
 * The page drawn longest ago is released first (`page.cleanup()`), and a
 * page whose own images pass the pixel budget is released as soon as it is
 * drawn.
 *
 * The pixel budget is the bound: a page count alone kept the decoded
 * images of the last ten pages drawn, which no cap limits (the raster
 * budget is per image), and a 20-page scan of 25 MP images grew a tab past
 * 1.3 GB while its canvases never passed 5 MP (review, 2026-11-10). What a
 * page holds is read from pdf.js's own record of what it decoded for it
 * (`page.objs`), so the sum is of what is retained, not of what is shown.
 */
export const VIEWER_KEPT_PAGES = 6;

/**
 * The decoded image pixels kept across drawn pages: as many as ONE image
 * may have on the raster path (`RASTER_MAX_IMAGE_PIXELS`, held equal by
 * viewer-retention.test.ts — typed here so this module does not load the
 * guard's chunk with the viewer's).
 */
export const VIEWER_KEPT_IMAGE_PIXELS = 50_000_000;

/** Pages' text kept for search and the text layer (search walks them all). */
const VIEWER_KEPT_TEXTS = 20;

/**
 * The image pixels pdf.js holds decoded for `page`, from its object store
 * (`page.objs`: one entry per image it decoded for this page, with its
 * width and height). Infinity when the store cannot be read, so a page
 * whose holdings are unknown is never kept.
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

/** A page's text, as searched and as its selectable layer draws it. */
export interface ViewerText {
  /** Text items in drawing order, at most {@link VIEWER_MAX_TEXT_ITEMS}. */
  items: SearchItem[];
  /** The page had more items than that; the rest are not read. */
  capped: boolean;
}

/** A link the viewer draws over a page. */
export type ViewerLink =
  | { kind: "page"; page: number; rect: FractionRect }
  | { kind: "url"; href: string; rect: FractionRect };

/** A bookmark, with the page it opens when it opens one. */
export interface ViewerBookmark {
  title: string;
  depth: number;
  /** 0-based page, or null when its destination does not resolve. */
  page: number | null;
  href: string | null;
}

/** What drawing one page came to. */
export type DrawResult =
  | { kind: "drawn"; canvas: HTMLCanvasElement }
  | { kind: "aborted" }
  | { kind: "failed" };

/** A page's selectable text layer, drawn into a container the caller owns. */
export interface TextLayerHandle {
  /** One element per text item, in the order of {@link ViewerText.items}. */
  readonly divs: readonly HTMLElement[];
  cancel(): void;
}

export interface ViewerPdf {
  readonly numPages: number;
  /**
   * The file holds an image over its raster budget, which this view leaves
   * out (pdf.js skips it before decoding). The file's, never a page's.
   */
  readonly imageTooLarge: boolean;
  /** Page `index`'s size in points as displayed. Rejects only when the page cannot be read. */
  pageSize(index: number): Promise<PageSize>;
  /**
   * Draw page `index` (0-based) at `scale` CSS px per point, turned a
   * further `turn`, for a screen of `pixelRatio`; the canvas's device
   * pixels are capped by `viewerRenderScale`. Never throws.
   */
  render(
    index: number,
    scale: number,
    pixelRatio: number,
    turn: QuarterTurn,
    signal?: AbortSignal,
  ): Promise<DrawResult>;
  /**
   * Draw page `index` for print: `width` x `height` image pixels (from
   * `printPlan`), unturned. Null when the page cannot be drawn.
   */
  renderForPrint(
    index: number,
    width: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<HTMLCanvasElement | null>;
  /** Page `index`'s text, capped. Empty on failure (a scan has none either). */
  text(index: number): Promise<ViewerText>;
  /** Draw page `index`'s selectable text into `container`. Null on failure or abort. */
  textLayer(
    index: number,
    container: HTMLElement,
    scale: number,
    turn: QuarterTurn,
    signal?: AbortSignal,
  ): Promise<TextLayerHandle | null>;
  /** Page `index`'s links the viewer follows; every other link is dropped. */
  links(index: number): Promise<ViewerLink[]>;
  /** The bookmark tree, flattened and bounded. */
  outline(): Promise<{ entries: ViewerBookmark[]; truncated: boolean }>;
  destroy(): Promise<void>;
}

interface PdfjsTextContent {
  items: unknown[];
  styles: Record<string, unknown>;
  lang?: string | null;
}

/** The text items of `content` that carry a string (marked-content markers do not). */
function stringItems(content: PdfjsTextContent): {
  items: { str: string; hasEOL?: boolean }[];
  capped: boolean;
} {
  const items: { str: string; hasEOL?: boolean }[] = [];
  let capped = false;
  for (const item of content.items) {
    if (typeof item !== "object" || item === null || !("str" in item)) continue;
    if (items.length >= VIEWER_MAX_TEXT_ITEMS) {
      capped = true;
      break;
    }
    items.push(item as { str: string; hasEOL?: boolean });
  }
  return { items, capped };
}

/**
 * Open `bytes` for the viewer. Rejects, typed, when the preflight refuses
 * the file (a stream that expands past the memory bounds, content nested
 * too deeply, a cross-reference pdf.js would walk without end), when pdf.js
 * cannot open it (a password needed to open it: the needs-password error,
 * whose remedy is Unlock PDF), or when its page count is not one a person
 * can be shown (/Count 0 or -1: the unreadable copy).
 */
export async function openViewerPdf(bytes: Uint8Array): Promise<ViewerPdf> {
  // ./pdfjs-guard is its own chunk, requested with pdfjs, not after it.
  const guardModule = import("./pdfjs-guard");
  const pdfjsModule = viewerPdfjs.loadPdfjs();
  pdfjsModule.catch(() => {});
  const guard = await guardModule;
  const { previewOptions, overBudgetImage } =
    await guard.preflightPdfjsOpen(bytes);
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

  type Page = Awaited<ReturnType<typeof doc.getPage>>;
  // Pages drawn lately, oldest first, each still holding what pdf.js
  // decoded for it, and how many image pixels that is.
  const kept: { index: number; page: Page; pixels: number }[] = [];
  const keep = (index: number, page: Page) => {
    const at = kept.findIndex((k) => k.index === index);
    if (at !== -1) kept.splice(at, 1);
    kept.push({ index, page, pixels: decodedImagePixels(page) });
    const held = () => kept.reduce((sum, k) => sum + k.pixels, 0);
    while (
      kept.length > 0 &&
      (kept.length > VIEWER_KEPT_PAGES || held() > VIEWER_KEPT_IMAGE_PIXELS)
    ) {
      kept.shift()!.page.cleanup();
    }
  };
  const getPage = (index: number) => doc.getPage(index + 1);

  const sizes = new Map<number, Promise<PageSize>>();
  const pageSize: ViewerPdf["pageSize"] = (index) => {
    let size = sizes.get(index);
    if (!size) {
      size = getPage(index).then((page) => {
        const vp = page.getViewport({ scale: 1 });
        return { width: vp.width, height: vp.height };
      });
      sizes.set(index, size);
      size.catch(() => sizes.delete(index));
    }
    return size;
  };

  /**
   * Draw `page` into a new canvas at `viewport`; the one place this file
   * calls pdf.js's page render, so both callers share its abort and its
   * containment.
   */
  const draw = async (
    page: Page,
    viewport: ReturnType<Page["getViewport"]>,
    width: number,
    height: number,
    signal?: AbortSignal,
  ): Promise<DrawResult> => {
    let running: { promise: Promise<void>; cancel: () => void } | null = null;
    const onAbort = () => running?.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
      running = page.render({ canvas, viewport, background: "#ffffff" });
      await running.promise;
      if (signal?.aborted) {
        canvas.width = 0;
        canvas.height = 0;
        return { kind: "aborted" };
      }
      return { kind: "drawn", canvas };
    } catch {
      canvas.width = 0;
      canvas.height = 0;
      return signal?.aborted ? { kind: "aborted" } : { kind: "failed" };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };

  const render: ViewerPdf["render"] = async (
    index,
    scale,
    pixelRatio,
    turn,
    signal,
  ) => {
    if (destroyed || signal?.aborted) return { kind: "aborted" };
    let page: Page;
    try {
      page = await getPage(index);
    } catch {
      return { kind: "failed" };
    }
    if (signal?.aborted) return { kind: "aborted" };
    try {
      const rotation = (page.rotate + turn) % 360;
      const css = page.getViewport({ scale, rotation });
      const ratio = viewerRenderScale(css.width, css.height, pixelRatio);
      const viewport = page.getViewport({ scale: scale * ratio, rotation });
      const { width, height } = canvasSize(css.width, css.height, ratio);
      return await draw(page, viewport, width, height, signal);
    } finally {
      keep(index, page);
    }
  };

  const renderForPrint: ViewerPdf["renderForPrint"] = async (
    index,
    width,
    height,
    signal,
  ) => {
    if (destroyed || signal?.aborted) return null;
    let page: Page;
    try {
      page = await getPage(index);
    } catch {
      return null;
    }
    try {
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(width / base.width, height / base.height),
      });
      const drawn = await draw(page, viewport, width, height, signal);
      return drawn.kind === "drawn" ? drawn.canvas : null;
    } finally {
      // Not kept: a print draws each page once, and keeping fifty decoded
      // pages would hold the memory the print's own cap is there to bound.
      page.cleanup();
    }
  };

  const texts = new Map<number, Promise<PdfjsTextContent | null>>();
  const rawText = (index: number): Promise<PdfjsTextContent | null> => {
    let text = texts.get(index);
    if (!text) {
      text = getPage(index)
        .then((page) => page.getTextContent() as Promise<PdfjsTextContent>)
        .catch(() => null);
      texts.set(index, text);
      // Only a few pages' text is kept: a search walks them all.
      if (texts.size > VIEWER_KEPT_TEXTS) {
        texts.delete(texts.keys().next().value!);
      }
    }
    return text;
  };

  const text: ViewerPdf["text"] = async (index) => {
    if (destroyed) return { items: [], capped: false };
    const content = await rawText(index);
    if (!content) return { items: [], capped: false };
    const { items, capped } = stringItems(content);
    return {
      items: items.map((i) => ({ str: i.str, hasEOL: i.hasEOL === true })),
      capped,
    };
  };

  const textLayer: ViewerPdf["textLayer"] = async (
    index,
    container,
    scale,
    turn,
    signal,
  ) => {
    if (destroyed || signal?.aborted) return null;
    try {
      const [page, content] = await Promise.all([
        getPage(index),
        rawText(index),
      ]);
      if (!content || signal?.aborted) return null;
      const { items } = stringItems(content);
      const viewport = page.getViewport({
        scale,
        rotation: (page.rotate + turn) % 360,
      });
      const layer = new pdfjs.TextLayer({
        // The same capped list the search reads, so item i is div i.
        textContentSource: {
          items,
          styles: content.styles,
          lang: content.lang ?? null,
        } as unknown as ConstructorParameters<
          typeof pdfjs.TextLayer
        >[0]["textContentSource"],
        container,
        viewport,
      });
      const onAbort = () => layer.cancel();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await layer.render();
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      if (signal?.aborted) return null;
      return { divs: layer.textDivs, cancel: () => layer.cancel() };
    } catch {
      return null;
    }
  };

  // A destination resolves to a page once per name or array.
  const resolveDest = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit =
        typeof dest === "string" ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const target = explicit[0] as unknown;
      let index: number | null = null;
      if (typeof target === "number" && Number.isInteger(target)) {
        index = target;
      } else if (
        typeof target === "object" &&
        target !== null &&
        "num" in target &&
        "gen" in target
      ) {
        index = await doc.getPageIndex(
          target as Parameters<typeof doc.getPageIndex>[0],
        );
      }
      return index !== null && index >= 0 && index < numPages ? index : null;
    } catch {
      return null;
    }
  };

  const links: ViewerPdf["links"] = async (index) => {
    if (destroyed) return [];
    try {
      const page = await getPage(index);
      const annotations = await page.getAnnotations({ intent: "display" });
      const viewport = page.getViewport({ scale: 1 });
      const out: ViewerLink[] = [];
      for (const a of annotations as {
        subtype?: unknown;
        rect?: unknown;
        url?: unknown;
        dest?: unknown;
      }[]) {
        if (out.length >= VIEWER_MAX_LINKS_PER_PAGE) break;
        if (a?.subtype !== "Link" || !Array.isArray(a.rect)) continue;
        const [r0, r1, r2, r3] = a.rect as number[];
        const [x1, y1] = viewport.convertToViewportPoint(r0!, r1!) as number[];
        const [x2, y2] = viewport.convertToViewportPoint(r2!, r3!) as number[];
        if (![x1, y1, x2, y2].every((v) => Number.isFinite(v))) continue;
        const rect: FractionRect = {
          left: Math.min(x1!, x2!) / viewport.width,
          top: Math.min(y1!, y2!) / viewport.height,
          width: Math.abs(x2! - x1!) / viewport.width,
          height: Math.abs(y2! - y1!) / viewport.height,
        };
        if (!(rect.width > 0) || !(rect.height > 0)) continue;
        if (a.dest !== undefined && a.dest !== null) {
          const target = await resolveDest(a.dest);
          if (target !== null) out.push({ kind: "page", page: target, rect });
          continue;
        }
        const href = safeExternalHref(a.url);
        if (href) out.push({ kind: "url", href, rect });
        // Anything else — another scheme, a launch, a script — is dropped.
      }
      return out;
    } catch {
      return [];
    }
  };

  const outline: ViewerPdf["outline"] = async () => {
    if (destroyed) return { entries: [], truncated: false };
    try {
      const walked = walkOutline(await doc.getOutline());
      const entries: ViewerBookmark[] = [];
      for (const e of walked.entries) {
        entries.push({
          title: e.title,
          depth: e.depth,
          page: e.dest !== null ? await resolveDest(e.dest) : null,
          href: e.href,
        });
      }
      return { entries, truncated: walked.truncated };
    } catch {
      return { entries: [], truncated: false };
    }
  };

  return {
    numPages,
    imageTooLarge: overBudgetImage,
    pageSize,
    render,
    renderForPrint,
    text,
    textLayer,
    links,
    outline,
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      await task.destroy().catch(() => {});
    },
  };
}
