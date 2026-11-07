import {
  EDGE_LINES,
  REPEATED_LINE_MIN_PAGES,
  REPEATED_LINE_SHARE,
} from "@/lib/pdf/pdf-to-markdown";

/**
 * The words under PDF to Markdown's options, from the converter's own
 * constants, so the panel, the tool page and the guide state the rule the
 * converter applies. Only this tool's runner and copy import it.
 *
 * The checkbox labels themselves are JSX text in the runner, where
 * `tick-label-claims.test.ts` discovers them; the copy names them in quotes.
 */

/** The note under "Leave out repeated headers and footers". */
export const REPEATED_LINES_HINT = `A line among the top or bottom ${EDGE_LINES} lines of at least ${Math.round(REPEATED_LINE_SHARE * 100)}% of the pages, at the same height on each, is left out of a PDF of ${REPEATED_LINE_MIN_PAGES} pages or more. A page number counts as the same line on every page.`;
