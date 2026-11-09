import {
  MAX_ZOOM,
  MIN_ZOOM,
  VIEWER_PRINT_DPI,
  VIEWER_PRINT_MAX_PAGES,
  VIEWER_PRINT_MAX_PIXELS,
  type PrintPlan,
} from "./viewer-geometry";

/**
 * The PDF Viewer's words: its control labels (which the tool page's steps
 * quote by import, so a renamed button renames the step) and the notes it
 * shows. Every figure is read from the constant it states.
 */

export const VIEWER_LABELS = {
  thumbnails: "Thumbnails",
  bookmarks: "Bookmarks",
  previous: "Previous page",
  next: "Next page",
  pageNumber: "Page number",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  zoom: "Zoom",
  fitWidth: "Fit width",
  fitPage: "Fit page",
  rotate: "Rotate view",
  search: "Search",
  searchField: "Find in document",
  matchCase: "Match case",
  previousMatch: "Previous match",
  nextMatch: "Next match",
  fullScreen: "Full screen",
  exitFullScreen: "Exit full screen",
  print: "Print",
  download: "Download PDF",
  doMore: "Do more with this PDF",
} as const;

const pct = (zoom: number) => `${Math.round(zoom * 100)}%`;

/** The zoom range the buttons and menu cover, as the copy states it. */
export const VIEWER_ZOOM_RANGE = `${pct(MIN_ZOOM)} to ${pct(MAX_ZOOM)}`;

export const VIEWER_ROTATE_NOTE =
  "Rotate view turns the pages on this screen only; the file is not changed.";

/**
 * Said once the file holds an image over the browser's raster budget, which
 * this view leaves out (pdf.js skips it before decoding it). The file's
 * fact, never a page's: pdf.js does not report which page skipped it, so
 * no page is named.
 */
export const VIEWER_IMAGE_NOTE =
  "Some large images are not drawn in this view: they are bigger than a browser tab can decode safely. The file itself is unchanged.";

export const VIEWER_PAGE_FAILED = "This page could not be drawn.";

/** Print's description while the page sizes it plans from are still read. */
export const VIEWER_PRINT_WAITING =
  "Print is ready once the page sizes are read.";

/**
 * Before a print that stops short of the last page: how many pages it
 * sends and why. Null when it sends them all.
 */
export function viewerPrintNote(plan: PrintPlan, total: number): string | null {
  if (plan.stoppedBy === null) return null;
  const n = plan.pages.length;
  const why =
    plan.stoppedBy === "pages"
      ? `Print sends at most ${VIEWER_PRINT_MAX_PAGES} pages at once`
      : `Print draws each page as an image at ${VIEWER_PRINT_DPI} dpi and holds at most ${VIEWER_PRINT_MAX_PIXELS / 1_000_000} megapixels at once, so large pages fill it sooner`;
  return `Printing pages 1 to ${n} of ${total.toLocaleString("en-US")}. ${why}. To print every page, download the PDF and print it from a PDF reader.`;
}
