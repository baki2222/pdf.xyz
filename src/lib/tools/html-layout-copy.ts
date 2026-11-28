/**
 * The page-layout sentences HTML to PDF and Webpage to PDF share, built from
 * the option lists the panel draws and the worker validates
 * (`@/lib/jobs/html-render-options`), so a size or a width added there
 * reaches the copy, and one removed leaves it.
 *
 * Read off the implementation (2026-10-25):
 *  - the panel: src/components/tools/html-render-layout-options.tsx — a
 *    "Page layout" group of four selects (Page size, Orientation, Margins,
 *    Screen width) and a "One long page" checkbox, defaults unchanged from
 *    the render before they existed;
 *  - the print: src/lib/workers/html-render/print-params.ts — the page's own
 *    @page size is preferred only while Page size is "As the page sets it"
 *    and neither a screen width nor one long page is chosen; a screen width
 *    is emulated before the page loads and the print is scaled to it; one
 *    long page measures the print layout's height and prints one page that
 *    tall, at most HTML_ONE_PAGE_MAX_INCHES;
 *  - proven on a real Chromium in layout.chromium.test.ts (page boxes, text,
 *    margins), in the worker image by `pnpm worker:options-proof`, and on a
 *    deployment by `pnpm worker:prove-tools`.
 *
 * Since 2026-11-16 (audit backlog #5) the panel's Page size STARTS on the
 * browser region's paper, A4 or Letter (`useRegionalPaper`), not on "As the
 * page sets it": until then these sentences said "Leave Page size on As the
 * page sets it" and "Left as they are, the page's own print settings decide
 * the layout", true of a default the panel no longer starts on. The job API's
 * own default (`DEFAULT_HTML_RENDER_OPTIONS`, a request that names no size)
 * is unchanged, and "As the page sets it" is still one choice away.
 */
import {
  CHROMIUM_DEFAULT_PAPER_INCHES,
  HTML_MARGINS,
  HTML_ONE_PAGE_MAX_INCHES,
  HTML_PAGE_SIZES,
  HTML_VIEWPORTS,
  DEFAULT_HTML_RENDER_OPTIONS,
  HTML_START_VIEWPORT,
  htmlPaperWidthPx,
  type HtmlPageSize,
} from "@/lib/jobs/html-render-options";
import { WEBPAGE_CAPTURE_LABELS } from "@/lib/jobs/webpage-capture-options";
import {
  LETTER_REGION_PAGE_SIZE,
  WORLD_PAGE_SIZE,
} from "@/lib/pdf/image-page-defaults";
import { imageDefaultPaperCopy } from "@/lib/tools/tool-facts";

const list = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "disjunction" }).format(items);

const MARGINS = list(HTML_MARGINS.map((m) => m.label));
const WIDTHS = list(
  HTML_VIEWPORTS.filter((v) => v.width).map((v) => `${v.width}`),
);
/** "“As the page sets it”", the menu's own entry, quotes included. */
export const HTML_AUTO_SIZE = `“${HTML_PAGE_SIZES.find((s) => s.inches === null)!.label}”`;
const AUTO_SIZE = HTML_AUTO_SIZE;
/** Every Page size choice, the sizes first and the page's own last. */
const ALL_SIZES = list([
  ...HTML_PAGE_SIZES.filter((s) => s.inches).map((s) => s.label),
  AUTO_SIZE,
]);
/** The HTML menu's entry for one of the two regional papers ("a4", "letter"). */
const htmlSizeFor = (paper: string): HtmlPageSize =>
  HTML_PAGE_SIZES.find((s) => s.id.toLowerCase() === paper)!.id;
const labelOfSize = (id: HtmlPageSize) =>
  HTML_PAGE_SIZES.find((s) => s.id === id)!.label;
/** "A4, or Letter if your browser's preferred language is set for …". */
export const HTML_START_SIZE = imageDefaultPaperCopy((size) =>
  labelOfSize(htmlSizeFor(size.id)),
);
const START_SIZE = HTML_START_SIZE;
/** The paper "As the page sets it" falls back to: Chromium's, Letter. */
const FALLBACK_SIZE = HTML_PAGE_SIZES.find(
  (s) =>
    s.inches?.[0] === CHROMIUM_DEFAULT_PAPER_INCHES[0] &&
    s.inches?.[1] === CHROMIUM_DEFAULT_PAPER_INCHES[1],
)!.label;

/**
 * What the default screen width means in pixels (audit webpage-to-pdf#5,
 * 2026-11-07), from the geometry the worker prints with, on each paper the
 * panel can start on.
 */
const AUTO_WIDTH = HTML_VIEWPORTS.find((v) => v.width === null)!.label;
const autoWidthOn = (paper: string) => ({
  label: labelOfSize(htmlSizeFor(paper)),
  px: htmlPaperWidthPx({
    ...DEFAULT_HTML_RENDER_OPTIONS,
    pageSize: htmlSizeFor(paper),
  }),
});
const WORLD_WIDTH = autoWidthOn(WORLD_PAGE_SIZE);
const LETTER_WIDTH = autoWidthOn(LETTER_REGION_PAGE_SIZE);
const NARROWEST_PX = Math.max(WORLD_WIDTH.px, LETTER_WIDTH.px);
const DEFAULT_MARGIN = HTML_MARGINS.find(
  (m) => m.id === DEFAULT_HTML_RENDER_OPTIONS.margin,
)!.label;
const TABLET_PX = HTML_VIEWPORTS.find((v) => v.id === "tablet")!.width;
const DESKTOP = HTML_VIEWPORTS.find((v) => v.id === "desktop")!.label;
const PRINT_STYLES_LABEL = WEBPAGE_CAPTURE_LABELS.printStyles;

/**
 * A webpage's print styles outrank the Screen width (review of audit wave 2
 * webpage-to-pdf#5, 2026-11-28): while that box is ticked, a site with print
 * styles is laid out at the paper's width (`src/lib/workers/html-render/
 * print-css.ts`; print-css.chromium.test.ts reads 12pt back from the PDF).
 */
export const HTML_PRINT_STYLES_WIDTH_SENTENCE = `While “${PRINT_STYLES_LABEL}” is ticked, a site that has print styles is printed with them at the paper's width, whatever Screen width is chosen, so its text keeps the size those styles set. `;

/** The FAQ answer to "Can I choose the page size, margins or orientation?". */
export function htmlLayoutAnswer(source: "file" | "site"): string {
  const rule =
    source === "file"
      ? "a CSS @page rule in your file"
      : "a page size the site's print stylesheet sets";
  const startWidth = HTML_VIEWPORTS.find(
    (v) => v.id === HTML_START_VIEWPORT[source],
  )!;
  const paperWidth = `lays the page out at the paper's printable width: ${WORLD_WIDTH.px} pixels on ${WORLD_WIDTH.label} and ${LETTER_WIDTH.px} on ${LETTER_WIDTH.label}, with ${DEFAULT_MARGIN} margins`;
  const narrow = NARROWEST_PX < (TABLET_PX ?? 0);
  const widths =
    startWidth.width === null
      ? `Its default, ${AUTO_WIDTH}, ${paperWidth}. ${narrow ? `Both are narrower than a ${TABLET_PX} pixel tablet screen, so a site without print styles may come out in its tablet or phone layout, and ${DESKTOP} gives its desktop layout. ` : ""}`
      : `It starts on ${startWidth.label}, so a site without print styles comes out in its desktop layout. ${AUTO_WIDTH} ${paperWidth}${narrow ? `, narrower than a ${TABLET_PX} pixel tablet screen` : ""}. `;
  return `Yes, under Page layout: Page size (${ALL_SIZES}), Orientation, Margins (${MARGINS}), Screen width and One long page. Page size starts on ${START_SIZE}. Choose ${AUTO_SIZE} to let ${rule} decide the paper instead, ${FALLBACK_SIZE} when there is none; with a Screen width or One long page as well, ${AUTO_SIZE} prints on ${FALLBACK_SIZE}. Screen width lays the page out as on a ${WIDTHS} pixel wide screen and scales it to fit the paper. ${widths}${source === "site" ? HTML_PRINT_STYLES_WIDTH_SENTENCE : ""}One long page prints the whole page on a single page as tall as its content, up to ${HTML_ONE_PAGE_MAX_INCHES} inches; anything longer continues on more pages.`;
}

/** The how-to step for the layout group. */
export const HTML_LAYOUT_STEP = {
  title: "Choose the page layout, if you want one",
  body: `Under Page layout, pick a Page size (${ALL_SIZES}), Portrait or Landscape, the Margins, a Screen width, or tick One long page. Page size starts on ${START_SIZE}; choose ${AUTO_SIZE} to use the paper size the page itself asks for.`,
};
