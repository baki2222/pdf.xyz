/**
 * Every verbatim poppler `-layout` / `-bbox-layout` pair in
 * `./poppler-samples`, DISCOVERED by export name (`X_LAYOUT` beside
 * `X_BBOX`) rather than listed, so a sample added there is enrolled in every
 * reading-order test without anyone remembering this file.
 *
 * Each pair is given in the shapes Translate reads: the `-layout` text as the
 * shared extractor's "collapse" mode parses it, and the flow text as the flow
 * extractor returns it. Raw stdout is kept too, for tests that drive the
 * native runner through its `exec` seam.
 */
import {
  collapseLayoutPadding,
  joinPageTexts,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import { parseBboxFlow, parseLayoutText } from "@/lib/workers/pdf-text/parse";
import { flowText, type PdfFlowText } from "@/lib/workers/pdf-text/flow";
import * as samples from "./poppler-samples";

export interface ReadingOrderPair {
  name: string;
  /** `pdftotext -layout` stdout, verbatim. */
  layoutStdout: string;
  /** `pdftotext -bbox-layout` stdout, verbatim. */
  bboxStdout: string;
  layout: ExtractedPdfText;
  flow: PdfFlowText;
}

export function discoverReadingOrderPairs(): ReadingOrderPair[] {
  const exported = samples as unknown as Record<string, unknown>;
  return Object.keys(exported)
    .filter((key) => key.endsWith("_LAYOUT"))
    .map((key) => key.slice(0, -"_LAYOUT".length))
    .filter((base) => typeof exported[`${base}_BBOX`] === "string")
    .sort()
    .map((name) => {
      const layoutStdout = exported[`${name}_LAYOUT`] as string;
      const bboxStdout = exported[`${name}_BBOX`] as string;
      return {
        name,
        layoutStdout,
        bboxStdout,
        layout: parseLayoutText(collapseLayoutPadding(layoutStdout)),
        flow: flowText(parseBboxFlow(bboxStdout)),
      };
    });
}

/**
 * Several pairs as ONE document: pages renumbered 1..n in order, on both
 * sides, so a multi-page job can be driven from verbatim samples. The
 * `-layout` document's `text` is its pages joined as the extractor joins
 * them.
 */
export function concatReadingOrderPairs(
  pairs: readonly Pick<ReadingOrderPair, "layout" | "flow">[],
): { layout: ExtractedPdfText; flow: PdfFlowText } {
  let n = 0;
  const pages = pairs.flatMap((pair) =>
    pair.layout.pages.map((page) => ({ ...page, pageNumber: (n += 1) })),
  );
  let m = 0;
  const flowPages = pairs.flatMap((pair) =>
    pair.flow.pages.map((page) => ({ ...page, pageNumber: (m += 1) })),
  );
  const text = joinPageTexts(pages);
  return {
    layout: {
      pageCount: n,
      pages,
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    },
    flow: { pageCount: m, pages: flowPages },
  };
}
