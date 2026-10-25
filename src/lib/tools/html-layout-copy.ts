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
 */
import {
  HTML_MARGINS,
  HTML_ONE_PAGE_MAX_INCHES,
  HTML_PAGE_SIZES,
  HTML_VIEWPORTS,
} from "@/lib/jobs/html-render-options";

const list = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "disjunction" }).format(items);

const SIZES = list(HTML_PAGE_SIZES.filter((s) => s.inches).map((s) => s.label));
const MARGINS = list(HTML_MARGINS.map((m) => m.label));
const WIDTHS = list(
  HTML_VIEWPORTS.filter((v) => v.width).map((v) => `${v.width}`),
);
const AUTO_SIZE = HTML_PAGE_SIZES.find((s) => s.inches === null)!.label;

/** The FAQ answer to "Can I choose the page size, margins or orientation?". */
export function htmlLayoutAnswer(source: "file" | "site"): string {
  const rule =
    source === "file"
      ? "a CSS @page rule in your file"
      : "a page size the site's print stylesheet sets";
  return `Yes, under Page layout: Page size (${SIZES}), Orientation, Margins (${MARGINS}), Screen width and One long page. Leave Page size on ${AUTO_SIZE} and ${rule} still decides the paper, US Letter when there is none; choose a size, a screen width or One long page and your choice decides it instead. Screen width lays the page out as on a ${WIDTHS} pixel wide screen and scales it to fit the paper. One long page prints the whole page on a single page as tall as its content, up to ${HTML_ONE_PAGE_MAX_INCHES} inches; anything longer continues on more pages.`;
}

/** The how-to step for the layout group. */
export const HTML_LAYOUT_STEP = {
  title: "Choose the page layout, if you want one",
  body: `Under Page layout, pick a Page size (${SIZES}), Portrait or Landscape, the Margins, a Screen width, or tick One long page. Left as they are, the page's own print settings decide the layout.`,
};
