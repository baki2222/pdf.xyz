import {
  CSS_PX_PER_PT,
  MAX_ZOOM,
  MIN_FIT_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
} from "./editor/geometry";
import { COLUMN_PAD, type PageSlot } from "./view-layout";

/**
 * The PDF Viewer's arithmetic, pure: how large a page's canvas may be, which
 * pages are drawn, where the reading position goes when the zoom changes,
 * and the caps the viewer states in its own copy. Nothing here touches
 * pdf.js or the DOM, so `viewer-geometry.test.ts` holds every rule to
 * numbers.
 *
 * The zoom ladder is the editor's (`ZOOM_STEPS`, `MIN_ZOOM`..`MAX_ZOOM` in
 * `./editor/geometry`); the column layout is the shared one in
 * `./view-layout`. A page's size here is in points AS DISPLAYED (its own
 * `/Rotate` applied), before the viewer's view-only turn.
 */

export { CSS_PX_PER_PT, MAX_ZOOM, MIN_FIT_ZOOM, MIN_ZOOM, ZOOM_STEPS };

/** A rendered canvas larger than this many device pixels is drawn at a lower ratio. */
export const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * No canvas side passes this many device pixels, whatever its area: past
 * 8,192 some browsers draw a blank canvas rather than refuse it, and a
 * blank sheet says nothing.
 */
export const MAX_CANVAS_SIDE = 8_192;

/**
 * How many pages hold a live canvas at once: the visible pages and one on
 * each side, never more than this. Every other page is a placeholder at its
 * real size, so the column keeps its height and nothing below it moves.
 */
export const VIEWER_LIVE_PAGES = 8;

/**
 * The most text items one page's selectable text layer and search read.
 * A page past it (a 30,000-item map or table) is drawn in full; only its
 * first items are selectable and searched, and the viewer says so.
 */
export const VIEWER_MAX_TEXT_ITEMS = 20_000;

/** The most matches one search highlights; the status says when it stopped. */
export const VIEWER_MAX_MATCHES = 500;

/** The longest search the field takes, in characters. */
export const VIEWER_MAX_QUERY = 200;

/** The most bookmarks the Bookmarks tab lists, and how deep it reads. */
export const VIEWER_MAX_OUTLINE_ITEMS = 2_000;
export const VIEWER_MAX_OUTLINE_DEPTH = 32;

/** The most links read from one page. */
export const VIEWER_MAX_LINKS_PER_PAGE = 500;

/** Print draws each page as an image at this resolution. */
export const VIEWER_PRINT_DPI = 150;

/** The most pages one print sends. */
export const VIEWER_PRINT_MAX_PAGES = 50;

/**
 * The most image pixels one print holds, summed over its pages: the browser
 * keeps every page's decoded image while the print dialog is open, at 4
 * bytes a pixel, so 100 MP is about 400 MB. A Letter page at 150 dpi is
 * 2.1 MP, so a Letter document stops at 47 pages, before the page cap.
 */
export const VIEWER_PRINT_MAX_PIXELS = 100_000_000;

/** No printed page's image is wider or taller than this many pixels. */
export const VIEWER_PRINT_MAX_SIDE = 4_096;

export interface PageSize {
  /** Points, as displayed (the page's own `/Rotate` applied). */
  width: number;
  height: number;
}

export type QuarterTurn = 0 | 90 | 180 | 270;

/** `turn` a quarter further, clockwise for 1, back for -1. */
export function quarterTurn(turn: QuarterTurn, dir: 1 | -1): QuarterTurn {
  return ((((turn + dir * 90) % 360) + 360) % 360) as QuarterTurn;
}

/** A page's size after the viewer's view-only turn. */
export function turnedSize(size: PageSize, turn: QuarterTurn): PageSize {
  return turn % 180 === 0 ? size : { width: size.height, height: size.width };
}

/**
 * The device pixels per CSS pixel a page of `cssWidth` x `cssHeight` is
 * drawn at: the device's own ratio (1-3) when it fits, else the largest at
 * which the canvas holds at most {@link MAX_CANVAS_PIXELS} and no side is
 * over {@link MAX_CANVAS_SIDE} — however far below 1 that is. No floor: a
 * huge page at a deep zoom is drawn softer, the canvas never grows with it
 * (the editor's `cappedPixelRatio` floored at 0.5 until 2026-11-09, and A0
 * at 400% took 57 MP).
 */
export function viewerRenderScale(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): number {
  const ratio = Math.max(1, Math.min(3, pixelRatio || 1));
  if (!(cssWidth > 0) || !(cssHeight > 0)) return ratio;
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
  const bySide = MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight);
  return Math.min(ratio, byArea, bySide);
}

/** The canvas a page is drawn into at `ratio`: whole pixels, at least 1. */
export function canvasSize(
  cssWidth: number,
  cssHeight: number,
  ratio: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(cssWidth * ratio)),
    height: Math.max(1, Math.floor(cssHeight * ratio)),
  };
}

/** CSS pixels per point at `zoom`. */
export function scaleOf(zoom: number): number {
  return clampViewerZoom(zoom, MIN_FIT_ZOOM) * CSS_PX_PER_PT;
}

export function clampViewerZoom(zoom: number, min = MIN_ZOOM): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(min, zoom));
}

/**
 * The next step up (`dir` 1) or down (-1) the ladder from `zoom`, which may
 * be a fit zoom between steps; the end of the ladder past its last step.
 */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const next =
    dir > 0
      ? ZOOM_STEPS.find((z) => z > zoom + 0.001)
      : [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001);
  return next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM);
}

export type FitMode = "width" | "page";

/**
 * The zoom that fits `page` (points, turned) into a view of `viewWidth` x
 * `viewHeight` CSS pixels, inside the column's padding: its width for Fit
 * width, all of it for Fit page. May go below {@link MIN_ZOOM} (a Letter
 * page on a 360 px phone fits at about 34%), never below MIN_FIT_ZOOM.
 */
export function fitZoom(
  mode: FitMode,
  viewWidth: number,
  viewHeight: number,
  page: PageSize,
): number {
  if (!(page.width > 0) || !(page.height > 0) || !(viewWidth > 0)) return 1;
  const across = (viewWidth - COLUMN_PAD * 2) / (page.width * CSS_PX_PER_PT);
  if (mode === "width" || !(viewHeight > 0)) {
    return clampViewerZoom(across, MIN_FIT_ZOOM);
  }
  const down = (viewHeight - COLUMN_PAD * 2) / (page.height * CSS_PX_PER_PT);
  return clampViewerZoom(Math.min(across, down), MIN_FIT_ZOOM);
}

/** The first and last page (0-based) any part of which is in the view. */
export function visibleRange(
  slots: readonly PageSlot[],
  scrollTop: number,
  viewHeight: number,
): { first: number; last: number } | null {
  if (slots.length === 0) return null;
  const bottom = scrollTop + Math.max(0, viewHeight);
  let first = -1;
  let last = -1;
  // Slots are in column order, so a binary search finds the first page whose
  // bottom edge is below the view's top.
  let lo = 0;
  let hi = slots.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = slots[mid]!;
    if (s.top + s.height < scrollTop) lo = mid + 1;
    else hi = mid - 1;
  }
  for (let i = lo; i < slots.length; i++) {
    const s = slots[i]!;
    if (s.top > bottom) break;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) {
    // In a gap between pages, or past the end: the nearest page.
    const near = Math.min(lo, slots.length - 1);
    return { first: near, last: near };
  }
  return { first, last };
}

/**
 * The pages to hold live canvases: the visible ones and one each side,
 * never more than {@link VIEWER_LIVE_PAGES} — kept around `current` when
 * more than that are visible at once (a small zoom on short pages).
 */
export function liveWindow(
  slots: readonly PageSlot[],
  scrollTop: number,
  viewHeight: number,
  current: number,
  limit = VIEWER_LIVE_PAGES,
): number[] {
  const range = visibleRange(slots, scrollTop, viewHeight);
  if (!range) return [];
  let lo = Math.max(0, range.first - 1);
  let hi = Math.min(slots.length - 1, range.last + 1);
  if (hi - lo + 1 > limit) {
    const at = Math.min(Math.max(current, lo), hi);
    const start = Math.max(
      lo,
      Math.min(at - Math.floor((limit - 1) / 2), hi - limit + 1),
    );
    lo = start;
    hi = start + limit - 1;
  }
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/** Where the reading position is: a page and how far down it the view's top sits. */
export interface ReadingAnchor {
  index: number;
  /** 0 at the page's top edge, 1 at its bottom edge. */
  fraction: number;
}

/** The page under the view's top edge, and how far into it. */
export function readingAnchor(
  slots: readonly PageSlot[],
  scrollTop: number,
): ReadingAnchor {
  if (slots.length === 0) return { index: 0, fraction: 0 };
  let index = 0;
  for (const s of slots) {
    if (s.top <= scrollTop) index = s.index;
    else break;
  }
  const s = slots[index]!;
  const fraction = s.height > 0 ? (scrollTop - s.top) / s.height : 0;
  return { index, fraction: Math.min(1, Math.max(0, fraction)) };
}

/** The scroll position that puts `anchor` back under the view's top edge. */
export function scrollForAnchor(
  slots: readonly PageSlot[],
  anchor: ReadingAnchor,
): number {
  const s = slots[Math.min(Math.max(anchor.index, 0), slots.length - 1)];
  if (!s) return 0;
  return Math.max(0, s.top + anchor.fraction * s.height);
}

/** The scroll position that shows page `index` from its top, with a little room. */
export function scrollForPage(
  slots: readonly PageSlot[],
  index: number,
): number {
  const s = slots[Math.min(Math.max(index, 0), slots.length - 1)];
  return s ? Math.max(0, s.top - COLUMN_PAD / 2) : 0;
}

/**
 * A rectangle in fractions of the page as displayed (0..1, top-left
 * origin), turned with the viewer's view-only turn: links and highlights
 * are stored unturned and placed on the turned sheet with this.
 */
export interface FractionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function turnFractionRect(
  r: FractionRect,
  turn: QuarterTurn,
): FractionRect {
  switch (turn) {
    case 90:
      return {
        left: 1 - r.top - r.height,
        top: r.left,
        width: r.height,
        height: r.width,
      };
    case 180:
      return {
        left: 1 - r.left - r.width,
        top: 1 - r.top - r.height,
        width: r.width,
        height: r.height,
      };
    case 270:
      return {
        left: r.top,
        top: 1 - r.left - r.width,
        width: r.height,
        height: r.width,
      };
    default:
      return r;
  }
}

/** One page of a print: the image size it is drawn at. */
export interface PrintPage {
  index: number;
  width: number;
  height: number;
}

export interface PrintPlan {
  pages: PrintPage[];
  /** Why the print stops before the document's last page, when it does. */
  stoppedBy: "pages" | "pixels" | null;
}

/**
 * Which pages one print sends, and at what pixel size: from page 1, at
 * {@link VIEWER_PRINT_DPI} (a page whose side would pass
 * {@link VIEWER_PRINT_MAX_SIDE} drawn smaller to fit it), until
 * {@link VIEWER_PRINT_MAX_PAGES} pages or {@link VIEWER_PRINT_MAX_PIXELS}
 * pixels. The first page is always sent.
 */
export function printPlan(sizes: readonly PageSize[]): PrintPlan {
  const pages: PrintPage[] = [];
  let pixels = 0;
  for (let index = 0; index < sizes.length; index++) {
    if (pages.length >= VIEWER_PRINT_MAX_PAGES) {
      return { pages, stoppedBy: "pages" };
    }
    const size = sizes[index]!;
    const k = VIEWER_PRINT_DPI / 72;
    const fit = Math.min(
      1,
      VIEWER_PRINT_MAX_SIDE / Math.max(size.width * k, size.height * k, 1),
    );
    const width = Math.max(1, Math.floor(size.width * k * fit));
    const height = Math.max(1, Math.floor(size.height * k * fit));
    if (pages.length > 0 && pixels + width * height > VIEWER_PRINT_MAX_PIXELS) {
      return { pages, stoppedBy: "pixels" };
    }
    pixels += width * height;
    pages.push({ index, width, height });
  }
  return { pages, stoppedBy: null };
}
