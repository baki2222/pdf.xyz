import { type PDFEmbeddedPage } from "pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { loadPdf, stampProducer } from "./stamp";

/**
 * Overlay one PDF on top of another, entirely in-browser with pdf-lib. The
 * overlay/stamp document's page(s) are embedded as Form XObjects into the base
 * document and drawn over each base page — real vector content, not a raster —
 * so text and graphics in both documents stay crisp and selectable.
 *
 * Everything here is isomorphic (pdf-lib only, no DOM), and all the geometry and
 * page-mapping is expressed as pure functions so it can be unit-tested with
 * plain numbers rather than brittle visual assertions.
 *
 * HONEST SCOPE: the overlay is placed in each base page's *unrotated* content
 * space (pdf-lib's draw space). Base pages carrying a `/Rotate` flag are the
 * uncommon case for letterhead/stamp templates; the overlay still covers the
 * page but is oriented to the content, not the viewer's rotation.
 */

/** How the overlay page is sized onto each base page. */
export type OverlayFit = "fit" | "stretch" | "actual";

/** Which overlay page is used for each base page. */
export type OverlayPaging = "repeat" | "cycle";

export interface OverlayFitOption {
  id: OverlayFit;
  label: string;
  hint: string;
}

/** The scale modes offered in the UI, in a sensible reading order. */
export const OVERLAY_FITS: readonly OverlayFitOption[] = [
  {
    id: "fit",
    label: "Fit page",
    hint: "Scale to fit, keeping the overlay's proportions (centered).",
  },
  {
    id: "stretch",
    label: "Stretch",
    hint: "Stretch the overlay to exactly cover each page.",
  },
  {
    id: "actual",
    label: "Actual size",
    hint: "Place the overlay at its original size, centered.",
  },
] as const;

/** A download name for an overlaid document, derived from the base file. */
export function overlayOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "overlay");
}

/** Clamp an opacity into pdf-lib's meaningful [0, 1] range; NaN → fully opaque. */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export interface OverlayRectInput {
  /** Overlay page box width, in points. */
  overlayWidth: number;
  /** Overlay page box height, in points. */
  overlayHeight: number;
  /** Base page width, in points. */
  pageWidth: number;
  /** Base page height, in points. */
  pageHeight: number;
  fit: OverlayFit;
}

export interface OverlayRect {
  /** Bottom-left x in the base page's content space. */
  x: number;
  /** Bottom-left y in the base page's content space. */
  y: number;
  width: number;
  height: number;
}

/**
 * Compute where and how large to draw an overlay page on a base page.
 *  - `fit`     : scale down/up to fit inside the page, preserving aspect ratio,
 *                centered — the safe default (no cropping, no distortion).
 *  - `stretch` : scale each axis independently to exactly cover the page.
 *  - `actual`  : keep the overlay's own size, centered (may overhang the page).
 */
export function fitOverlayRect(input: OverlayRectInput): OverlayRect {
  const { overlayWidth: ow, overlayHeight: oh, pageWidth: pw, pageHeight: ph, fit } = input;
  // Degenerate sizes can't be scaled sensibly — fall back to covering the page.
  if (ow <= 0 || oh <= 0 || pw <= 0 || ph <= 0) {
    return { x: 0, y: 0, width: Math.max(0, pw), height: Math.max(0, ph) };
  }
  if (fit === "stretch") {
    return { x: 0, y: 0, width: pw, height: ph };
  }
  if (fit === "actual") {
    return { x: (pw - ow) / 2, y: (ph - oh) / 2, width: ow, height: oh };
  }
  const scale = Math.min(pw / ow, ph / oh);
  const width = ow * scale;
  const height = oh * scale;
  return { x: (pw - width) / 2, y: (ph - height) / 2, width, height };
}

/**
 * The 0-based overlay page to use for a given base page.
 *  - `repeat`: always the first overlay page.
 *  - `cycle` : walk the overlay pages in order, wrapping around.
 * Returns -1 when there are no overlay pages.
 */
export function overlayPageIndexFor(
  baseIndex: number,
  overlayCount: number,
  paging: OverlayPaging,
): number {
  if (overlayCount <= 0) return -1;
  if (paging === "repeat") return 0;
  const i = baseIndex % overlayCount;
  return i < 0 ? i + overlayCount : i;
}

/**
 * The distinct overlay page indices we must embed to overlay `baseCount` pages.
 *  - `repeat`: just page 0.
 *  - `cycle` : the first `min(overlayCount, baseCount)` pages — every index the
 *    cyclic mapping can actually reach, and no more.
 */
export function neededOverlayIndices(
  baseCount: number,
  overlayCount: number,
  paging: OverlayPaging,
): number[] {
  if (overlayCount <= 0 || baseCount <= 0) return [];
  if (paging === "repeat") return [0];
  const count = Math.min(overlayCount, baseCount);
  return Array.from({ length: count }, (_, k) => k);
}

export interface OverlayOptions {
  /** Overlay opacity in [0, 1]; defaults to fully opaque. */
  opacity?: number;
  /** How the overlay is sized onto each page; defaults to `fit`. */
  fit?: OverlayFit;
  /** Which overlay page maps to each base page; defaults to `repeat`. */
  paging?: OverlayPaging;
}

export interface OverlayResult {
  bytes: Uint8Array;
  /** Base page count (equal to the output page count). */
  pageCount: number;
  /** Number of pages in the overlay document. */
  overlayPageCount: number;
  fit: OverlayFit;
  paging: OverlayPaging;
  opacity: number;
}

/**
 * Overlay `overlayBytes` onto every page of `baseBytes`. The base document's
 * page count and page sizes are preserved; only overlaid content is added.
 */
export async function overlayPdf(
  baseBytes: Uint8Array,
  overlayBytes: Uint8Array,
  options: OverlayOptions = {},
): Promise<OverlayResult> {
  const opacity = clampOpacity(options.opacity ?? 1);
  const fit = options.fit ?? "fit";
  const paging = options.paging ?? "repeat";

  const base = await loadPdf(baseBytes);
  const baseCount = base.getPageCount();
  if (baseCount === 0) {
    throw new PdfEngineError("The base PDF has no pages to overlay.");
  }

  // Validate the overlay and read its page count up front, with clear copy.
  const overlayDoc = await loadOverlay(overlayBytes);
  const overlayCount = overlayDoc.getPageCount();
  if (overlayCount === 0) {
    throw new PdfEngineError("The overlay PDF has no pages.");
  }

  // Embed only the overlay pages we actually reference, then draw each base page
  // with the mapped overlay. The same embedded page is reused across base pages,
  // so a repeated stamp is stored once.
  //
  // pdf-lib embeds lazily: a page that can't be embedded (e.g. a blank overlay
  // page with no content stream, or an unsupported feature) may only fail when
  // the document is written. Wrap the whole embed → draw → save region so those
  // deferred failures still surface as clean, user-facing copy.
  const indices = neededOverlayIndices(baseCount, overlayCount, paging);
  try {
    const embedded: PDFEmbeddedPage[] = await base.embedPdf(overlayBytes, indices);
    // Map an overlay page index → its slot in `embedded` (which follows `indices`).
    const slotByOverlayIndex = new Map(
      indices.map((overlayIndex, slot) => [overlayIndex, slot]),
    );

    const pages = base.getPages();
    for (let i = 0; i < baseCount; i += 1) {
      const page = pages[i];
      if (!page) continue;
      const overlayIndex = overlayPageIndexFor(i, overlayCount, paging);
      const slot = slotByOverlayIndex.get(overlayIndex);
      if (slot === undefined) continue;
      const emb = embedded[slot];
      if (!emb) continue;
      const { width: pw, height: ph } = page.getSize();
      const rect = fitOverlayRect({
        overlayWidth: emb.width,
        overlayHeight: emb.height,
        pageWidth: pw,
        pageHeight: ph,
        fit,
      });
      page.drawPage(emb, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        opacity,
      });
    }

    stampProducer(base);
    const bytes = await base.save();
    return { bytes, pageCount: baseCount, overlayPageCount: overlayCount, fit, paging, opacity };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new PdfEngineError(
      "The overlay PDF couldn't be applied — it may use features we can't process yet, or contain a blank page with no content.",
    );
  }
}

/** Load the overlay document, mapping pdf-lib failures to overlay-specific copy. */
async function loadOverlay(bytes: Uint8Array) {
  try {
    return await loadPdf(bytes);
  } catch (err) {
    if (err instanceof PdfEngineError && /password/i.test(err.message)) {
      throw new PdfEngineError(
        "The overlay PDF is password-protected. Unlock it first, then try again.",
      );
    }
    throw new PdfEngineError(
      "The overlay file couldn't be read as a PDF — it may be corrupted or not a PDF.",
    );
  }
}
