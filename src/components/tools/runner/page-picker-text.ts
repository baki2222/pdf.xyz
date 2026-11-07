/**
 * The page picker's two-way link to a typed page box (audits split-pdf#3,
 * pdf-to-png#7, resize-pdf#6, 2026-11-08).
 *
 * The box stays the source of truth: the picker DRAWS what the text says and
 * WRITES text when a tile is pressed, so typing and clicking can never
 * disagree about which pages a run will use. Every text written here parses
 * back through `parsePageList` / `parseRanges` to the same pages (held by
 * page-picker-text.test.ts) — which is why the en dash `formatRange` draws for
 * reading is typed back as the hyphen the parser accepts.
 *
 * A module of its own, imported only by the runners that offer a picker, so
 * nothing here lands on first-load or shared code (ranges.ts is shared).
 */
import {
  formatPageNumbers,
  formatRange,
  parsePageList,
  parseRanges,
  rangesFromStarts,
} from "@/lib/pdf/ranges";
import type { PageRange } from "@/lib/pdf/types";

/** "3–5" as a person reads it becomes "3-5" as the parser accepts it. */
const typed = (label: string) => label.replace(/–/g, "-");

/** The typed form of a set of 0-based pages, e.g. {0,1,2,4} -> "1-3, 5". */
export function pageListText(indices: Iterable<number>): string {
  return typed(formatPageNumbers([...indices].map((i) => i + 1)));
}

/** The pages a typed list names, or none while it does not parse. */
export function pagesInText(text: string, pageCount: number): Set<number> {
  try {
    return new Set(parsePageList(text, pageCount));
  } catch {
    return new Set();
  }
}

function rangesIn(text: string, pageCount: number): PageRange[] {
  try {
    return parseRanges(text, pageCount);
  } catch {
    return [];
  }
}

/**
 * The cuts a typed split list makes, as "cut after page index i": wherever a
 * range ends before the last page, or starts after the first one.
 */
export function cutsInRanges(text: string, pageCount: number): Set<number> {
  const cuts = new Set<number>();
  for (const { start, end } of rangesIn(text, pageCount)) {
    if (start > 0) cuts.add(start - 1);
    if (end < pageCount - 1) cuts.add(end);
  }
  return cuts;
}

/**
 * The typed split list for a set of cuts: one range per run of pages between
 * cuts, covering EVERY page from 1 to `pageCount`, in order.
 */
export function rangesTextFromCuts(
  cuts: Iterable<number>,
  pageCount: number,
): string {
  const starts = [0, ...[...cuts].map((cut) => cut + 1)];
  return rangesFromStarts(starts, pageCount)
    .map((range) => typed(formatRange(range)))
    .join(", ");
}

/**
 * Which file (1-based) each page lands in under a typed split list — the first
 * range that holds it — or null for a page no range names.
 */
export function partOfEachPage(
  text: string,
  pageCount: number,
): (number | null)[] {
  const parts: (number | null)[] = new Array(Math.max(0, pageCount)).fill(null);
  rangesIn(text, pageCount).forEach(({ start, end }, part) => {
    for (let i = start; i <= end; i++) parts[i] ??= part + 1;
  });
  return parts;
}
