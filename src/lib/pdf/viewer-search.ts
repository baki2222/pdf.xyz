import { VIEWER_MAX_MATCHES, VIEWER_MAX_QUERY } from "./viewer-geometry";

/**
 * The PDF Viewer's search, pure: a page's text items (pdf.js's
 * `getTextContent` strings, in the order its text layer draws them) joined
 * the way pdf.js's own find does — each item's string, and a line break
 * after an item that ends a line — matched against the query, and every
 * match mapped back to CHARACTER ranges inside the items it covers, so the
 * text layer can highlight exactly those characters, across item
 * boundaries.
 *
 * A run of spaces in the query matches any run of white space in the page
 * (a line break included), so "total due" finds it split over two lines.
 * Only selectable text is searched: a scanned page has none, and the
 * viewer counts such pages and points to OCR PDF rather than reporting
 * "no matches" as if it had looked.
 */

export interface SearchItem {
  str: string;
  hasEOL?: boolean;
}

/** Characters `start`..`end` (end exclusive) of item `item`. */
export interface ItemRange {
  item: number;
  start: number;
  end: number;
}

/** One match: the item ranges it covers, in order. */
export type SearchMatch = readonly ItemRange[];

export interface SearchOptions {
  matchCase: boolean;
}

/**
 * The query as a pattern, or null when there is nothing to look for (blank,
 * or white space only). Longer than {@link VIEWER_MAX_QUERY} characters is
 * cut to it.
 */
export function viewerSearchPattern(
  query: string,
  { matchCase }: SearchOptions,
): RegExp | null {
  const trimmed = query.slice(0, VIEWER_MAX_QUERY).trim();
  if (trimmed === "") return null;
  const source = trimmed
    .split(/\s+/u)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(source, matchCase ? "gu" : "giu");
}

/** A page's text as searched, and where each item starts in it. */
export function pageSearchText(items: readonly SearchItem[]): {
  text: string;
  starts: number[];
} {
  let text = "";
  const starts: number[] = [];
  for (const item of items) {
    starts.push(text.length);
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return { text, starts };
}

/** Does this page have any selectable text at all (not just white space)? */
export function hasSearchableText(items: readonly SearchItem[]): boolean {
  return items.some((item) => /\S/u.test(item.str));
}

/**
 * Every match of `pattern` in `items`, at most `limit`, as item ranges.
 * Separator characters (the line break after an item) belong to no item
 * and are not highlighted.
 */
export function findInItems(
  items: readonly SearchItem[],
  pattern: RegExp,
  limit = VIEWER_MAX_MATCHES,
): SearchMatch[] {
  if (limit <= 0) return [];
  const { text, starts } = pageSearchText(items);
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  const out: SearchMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    out.push(rangesFor(items, starts, m.index, m.index + m[0].length));
    if (out.length >= limit) break;
  }
  return out;
}

/** The item ranges text offsets `from`..`to` cover. */
function rangesFor(
  items: readonly SearchItem[],
  starts: readonly number[],
  from: number,
  to: number,
): ItemRange[] {
  const ranges: ItemRange[] = [];
  for (let i = firstItemAt(starts, from); i < items.length; i++) {
    const begin = starts[i]!;
    const end = begin + items[i]!.str.length;
    if (begin >= to) break;
    const s = Math.max(from, begin);
    const e = Math.min(to, end);
    if (e > s) ranges.push({ item: i, start: s - begin, end: e - begin });
  }
  return ranges;
}

/** The last item starting at or before `offset` (binary search). */
function firstItemAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let at = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= offset) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at;
}

/** Where a whole-document search stands. */
export interface SearchTally {
  /** Matches found so far (at most {@link VIEWER_MAX_MATCHES}). */
  matches: number;
  /** Pages with at least one match. */
  pagesWithMatches: number;
  /** Pages searched so far, and of how many. */
  searched: number;
  total: number;
  /** Pages with no selectable text: not searched, because there is nothing to search. */
  pagesWithoutText: number;
  /** Pages whose text layer stopped at the item cap (their later text unsearched). */
  pagesCapped: number;
  /** The search stopped at {@link VIEWER_MAX_MATCHES}. */
  stoppedAtCap: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * What the search's status line says: progress while it runs, then the
 * count, then each reason it may have missed something — the cap it
 * stopped at, the pages with no text (scans), the pages read only in part.
 */
export function searchStatus(t: SearchTally): string {
  const parts: string[] = [];
  if (t.searched < t.total && !t.stoppedAtCap) {
    parts.push(
      `Searching… page ${t.searched.toLocaleString("en-US")} of ${t.total.toLocaleString("en-US")}.`,
    );
  } else if (t.matches === 0) {
    parts.push("No matches.");
  } else {
    parts.push(
      `${plural(t.matches, "match", "matches")} on ${plural(t.pagesWithMatches, "page")}.`,
    );
  }
  if (t.stoppedAtCap) {
    parts.push(
      `The search stopped at the first ${VIEWER_MAX_MATCHES.toLocaleString("en-US")} matches; type more of the phrase to narrow it.`,
    );
  }
  if (t.pagesWithoutText > 0) {
    parts.push(
      `${plural(t.pagesWithoutText, "page")} ${t.pagesWithoutText === 1 ? "has" : "have"} no selectable text, so ${t.pagesWithoutText === 1 ? "it was" : "they were"} not searched.`,
    );
  }
  if (t.pagesCapped > 0) {
    parts.push(
      `${plural(t.pagesCapped, "page")} ${t.pagesCapped === 1 ? "has" : "have"} more text than this view reads, so only the first part was searched.`,
    );
  }
  return parts.join(" ");
}
