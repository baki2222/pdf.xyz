import { rangesFromStarts } from "./ranges";
import type { PageRange } from "./types";
import { normalizeExtractedText, pagesWithoutText } from "./text";

/**
 * Split PDF's "By text": a new file starts at every page whose selectable
 * text (pdf.js's, as Extract text reads it) contains the phrase. Pages before
 * the first such page are a file of their own, as in "By bookmarks". White
 * space is compared loosely — a phrase broken across two lines still matches
 * — and case only when asked. A page with no text layer (a scan) can never
 * match, so it is reported: it stays in whichever file it falls in.
 */

export interface TextSplitPlan {
  /** 0-based pages that start a file because they contain the phrase. */
  matched: number[];
  ranges: PageRange[];
  /** 1-based pages with no selectable text. */
  noText: number[];
}

function squash(text: string, matchCase: boolean): string {
  const s = text.replace(/\s+/gu, " ").trim();
  return matchCase ? s : s.toLocaleLowerCase();
}

export function planTextSplit(
  pages: readonly { pageNumber: number; text: string }[],
  query: string,
  matchCase: boolean,
): TextSplitPlan {
  const needle = squash(query, matchCase);
  const noText = pagesWithoutText([...pages]);
  if (needle.length === 0) {
    return { matched: [], ranges: [], noText };
  }
  const matched = pages
    .filter((p) =>
      squash(normalizeExtractedText(p.text), matchCase).includes(needle),
    )
    .map((p) => p.pageNumber - 1);
  return {
    matched,
    ranges: matched.length > 0 ? rangesFromStarts(matched, pages.length) : [],
    noText,
  };
}
