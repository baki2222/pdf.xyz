/**
 * A validated HTML-render request (`@/lib/jobs/html-render-options`) as the
 * Chromium DevTools calls that carry it out:
 *
 *   - `viewport` — `Emulation.setDeviceMetricsOverride`, sent before the
 *     page loads, so scripts and screen styles see that window; the print
 *     itself is laid out at the same width through `scale`;
 *   - `measure` — for one long page: the CSS width to lay the PRINT styles
 *     out at before `Page.getLayoutMetrics` reads the content's height;
 *   - `printParams` — the `Page.printToPDF` arguments.
 *
 * `{}` (every default) produces exactly {@link PRINT_TO_PDF_OPTIONS} and no
 * emulation — the call the renderer made before these options existed, so
 * the header/footer and isolation proofs it was held to still describe it.
 */
import {
  htmlPrintGeometry,
  HTML_VIEWPORTS,
  isDefaultHtmlRenderOptions,
  onePageHeightInches,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";
import {
  STAMP_EMPTY_HEADER,
  STAMP_MIN_MARGIN_INCHES,
  WEBPAGE_OUTLINE_PARAMS,
} from "./stamp";

/**
 * What every render asks `Page.printToPDF` for — stated, not inherited. The
 * CLI this replaced printed the date and <title> atop every page and the
 * document's address (the worker's temp path, for an upload) along the
 * bottom. The PDF must carry the page and nothing else:
 * `native.chromium.test.ts` reads that back from a real Chromium,
 * `native.test.ts` holds the call to this object, and
 * `src/lib/tools/worker-tool-answers.test.ts` holds both Chromium tool pages
 * to it (no stamp claimed; backgrounds and the @page size named).
 */
export const PRINT_TO_PDF_OPTIONS = {
  displayHeaderFooter: false,
  printBackground: true,
  preferCSSPageSize: true,
} as const;

/**
 * Webpage to PDF's additions to the print (audit webpage-to-pdf#7,
 * `./stamp`): bookmarks from the headings, and the address-and-date footer.
 * Absent, the print is exactly what it was.
 */
export interface PrintExtras {
  outline?: boolean;
  /** A `footerTemplate`; a header that draws nothing goes with it. */
  footerTemplate?: string;
}

export interface PrintPlan {
  viewport: { width: number; height: number } | null;
  measure: { widthPx: number } | null;
  printParams: (contentHeightPx?: number) => Record<string, unknown>;
}

function extraParams(extras: PrintExtras): Record<string, unknown> {
  return {
    ...(extras.outline ? WEBPAGE_OUTLINE_PARAMS : {}),
    ...(extras.footerTemplate !== undefined
      ? {
          displayHeaderFooter: true,
          headerTemplate: STAMP_EMPTY_HEADER,
          footerTemplate: extras.footerTemplate,
        }
      : {}),
  };
}

export function planPrint(
  options: HtmlRenderOptions,
  extras: PrintExtras = {},
): PrintPlan {
  if (isDefaultHtmlRenderOptions(options))
    return {
      viewport: null,
      measure: null,
      // Chromium's default margins (1 cm, about 0.39 in) leave the stamp its
      // room, unless the page's own CSS @page margin takes it (see ./stamp).
      printParams: () => ({ ...PRINT_TO_PDF_OPTIONS, ...extraParams(extras) }),
    };
  // A stamped page keeps at least STAMP_MIN_MARGIN_INCHES at its foot.
  const stamped = extras.footerTemplate !== undefined;
  const g = htmlPrintGeometry(options);
  const screen = HTML_VIEWPORTS.find((v) => v.id === options.viewport);
  return {
    viewport:
      screen?.width && screen.height
        ? { width: screen.width, height: screen.height }
        : null,
    measure: options.onePage ? { widthPx: Math.round(g.layoutWidthPx) } : null,
    printParams: (contentHeightPx) => {
      if (options.onePage && contentHeightPx === undefined)
        throw new Error("one long page needs the content's measured height");
      const marginBottom = stamped
        ? Math.max(g.marginInches, STAMP_MIN_MARGIN_INCHES)
        : g.marginInches;
      return {
        ...PRINT_TO_PDF_OPTIONS,
        preferCSSPageSize: g.preferCSSPageSize,
        // The paper is stated in its printed orientation, so Chromium is
        // never asked to turn it a second time.
        landscape: false,
        paperWidth: g.paperInches[0],
        paperHeight: options.onePage
          ? onePageHeightInches(g, contentHeightPx!) +
            (marginBottom - g.marginInches)
          : g.paperInches[1],
        marginTop: g.marginInches,
        marginBottom,
        marginLeft: g.marginInches,
        marginRight: g.marginInches,
        ...(g.scale !== 1 ? { scale: g.scale } : {}),
        ...extraParams(extras),
      };
    },
  };
}
