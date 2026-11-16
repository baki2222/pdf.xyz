/**
 * Summarize PDF's "Part to summarize" sections: one per distinct top-level
 * bookmark page, each running to the page before the next (competitor audit
 * summarize-pdf#5).
 *
 * A LAZY feature module: the panel imports it with `import()` only when the
 * running worker proves `summarizePages` and a file is chosen, because it
 * reads the outline with pdf-lib (`topLevelBookmarks`, Split PDF's "By
 * bookmarks" reader, which already skips URL and action bookmarks, resolves
 * named destinations and stops a hostile `/Next` loop). The titles never
 * leave the browser: only the chosen section's span is sent.
 *
 * Page numbers are PHYSICAL (1 is the first page object), the same numbers
 * the typed "Pages" field and the worker use, never /PageLabels labels.
 */

import { loadPdf } from "./engine";
import { loadPdfLib } from "./pdf-lib";
import type { PageSpan } from "./page-spans";
import { rangesFromStarts } from "./ranges";
import { topLevelBookmarks, type TopLevelBookmark } from "./split-modes";
import { pageSpanFromRange } from "@/lib/jobs/page-spans-option";

/** A section the panel offers: the bookmark's title and its pages. */
export interface SummarySection {
  readonly title: string;
  readonly span: PageSpan;
}

/** At most this many sections are offered, in page order. */
export const MAX_SUMMARY_SECTIONS = 100;

/** A title longer than this is cut, with an ellipsis. */
export const MAX_SECTION_TITLE = 80;

/**
 * A bookmark title as plain display text: control characters removed (an
 * outline title is attacker-chosen bytes), whitespace runs collapsed, and
 * cut at {@link MAX_SECTION_TITLE} characters with "…". React escapes it.
 */
export function cleanSectionTitle(title: string, page: number): string {
  // Control characters (C0, DEL, C1) become spaces, then runs collapse.
  let out = "";
  for (const char of title) {
    const code = char.codePointAt(0)!;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  out = out.replace(/\s+/g, " ").trim();
  if (out.length === 0) return `Bookmark on page ${page}`;
  const chars = [...out];
  return chars.length > MAX_SECTION_TITLE
    ? `${chars.slice(0, MAX_SECTION_TITLE - 1).join("")}…`
    : out;
}

/**
 * The sections of a document with `pageCount` pages and these top-level
 * bookmarks (in OUTLINE order, 0-based `pageIndex`).
 *
 * `rangesFromStarts` cuts at the distinct bookmark pages and ALSO emits the
 * pages before the first bookmark as a range of their own; that range has no
 * bookmark, so it is dropped here (the typed "Pages" field covers it). Two
 * bookmarks on one page give one section, titled by the first in outline
 * order. The 0-based ranges become 1-based spans in exactly one helper
 * (`pageSpanFromRange`).
 */
export function summarySections(
  bookmarks: readonly TopLevelBookmark[],
  pageCount: number,
): SummarySection[] {
  const titleAt = new Map<number, string>();
  for (const { title, pageIndex } of bookmarks) {
    if (!titleAt.has(pageIndex)) titleAt.set(pageIndex, title);
  }
  return rangesFromStarts([...titleAt.keys()], pageCount)
    .filter((range) => titleAt.has(range.start))
    .slice(0, MAX_SUMMARY_SECTIONS)
    .map((range) => {
      const span = pageSpanFromRange(range);
      return {
        title: cleanSectionTitle(titleAt.get(range.start)!, span[0]),
        span,
      };
    });
}

/**
 * The sections of the PDF in `bytes`, or `[]` when it has none or its
 * outline cannot be read (a locked or damaged file): the panel then offers
 * only "Whole document" and "Pages…".
 */
export async function readSummarySections(
  bytes: Uint8Array,
): Promise<SummarySection[]> {
  try {
    const lib = await loadPdfLib();
    const src = await loadPdf(bytes);
    return summarySections(topLevelBookmarks(lib, src), src.getPageCount());
  } catch {
    return [];
  }
}
