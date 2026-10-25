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

export interface PrintPlan {
  viewport: { width: number; height: number } | null;
  measure: { widthPx: number } | null;
  printParams: (contentHeightPx?: number) => Record<string, unknown>;
}

export function planPrint(options: HtmlRenderOptions): PrintPlan {
  if (isDefaultHtmlRenderOptions(options))
    return {
      viewport: null,
      measure: null,
      printParams: () => ({ ...PRINT_TO_PDF_OPTIONS }),
    };
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
      return {
        ...PRINT_TO_PDF_OPTIONS,
        preferCSSPageSize: g.preferCSSPageSize,
        // The paper is stated in its printed orientation, so Chromium is
        // never asked to turn it a second time.
        landscape: false,
        paperWidth: g.paperInches[0],
        paperHeight: options.onePage
          ? onePageHeightInches(g, contentHeightPx!)
          : g.paperInches[1],
        marginTop: g.marginInches,
        marginBottom: g.marginInches,
        marginLeft: g.marginInches,
        marginRight: g.marginInches,
        ...(g.scale !== 1 ? { scale: g.scale } : {}),
      };
    },
  };
}
