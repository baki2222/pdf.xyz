import type { PageRange, SplitPart } from "./types";

/**
 * Pure page-range math. No pdf-lib, no DOM — just parsing and expanding the
 * page expressions users type ("1-3, 5, 8-"). Kept separate from the engine so
 * it can be unit-tested exhaustively and reused across tools.
 */

/** Thrown when a user-supplied page expression can't be parsed. */
export class PageRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageRangeError";
  }
}

const INT = /^\d+$/;

/**
 * Turn a single token ("5", "2-4", "3-", "-6") into an inclusive 0-based range.
 * `pageCount` bounds the range and resolves open-ended tokens.
 */
function tokenToRange(rawToken: string, pageCount: number): PageRange {
  const token = rawToken.trim();
  const dash = token.indexOf("-");

  let startStr: string;
  let endStr: string;
  if (dash === -1) {
    startStr = token;
    endStr = token;
  } else {
    startStr = token.slice(0, dash).trim() || "1";
    endStr = token.slice(dash + 1).trim() || String(pageCount);
  }

  if (!INT.test(startStr) || !INT.test(endStr)) {
    throw new PageRangeError(`"${token}" isn't a valid page or range.`);
  }

  const start = Number(startStr);
  const end = Number(endStr);

  if (start < 1 || end < 1) {
    throw new PageRangeError(`Pages start at 1 — "${token}" is out of range.`);
  }
  if (start > pageCount || end > pageCount) {
    throw new PageRangeError(
      `This PDF has ${pageCount} page${pageCount === 1 ? "" : "s"} — "${token}" is out of range.`,
    );
  }
  if (start > end) {
    throw new PageRangeError(`"${token}" is backwards — start must be ≤ end.`);
  }

  return { start: start - 1, end: end - 1 };
}

function splitTokens(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Parse a 1-based page expression into a sorted, de-duplicated list of 0-based
 * page indices. Used by extract/delete/rotate where a flat page set is wanted.
 *
 * Supported tokens: "N", "N-M", "N-" (N to end), "-M" (start to M).
 */
export function parsePageList(input: string, pageCount: number): number[] {
  const tokens = splitTokens(input);
  if (tokens.length === 0) {
    throw new PageRangeError("Enter at least one page, e.g. 1-3, 5.");
  }
  const indices = new Set<number>();
  for (const token of tokens) {
    const { start, end } = tokenToRange(token, pageCount);
    for (let i = start; i <= end; i++) indices.add(i);
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * Parse a page expression into ordered, inclusive 0-based ranges. Used by split,
 * where each token becomes its own output file.
 */
export function parseRanges(input: string, pageCount: number): PageRange[] {
  const tokens = splitTokens(input);
  if (tokens.length === 0) {
    throw new PageRangeError("Enter at least one range, e.g. 1-3, 4-6.");
  }
  return tokens.map((token) => tokenToRange(token, pageCount));
}

/** Split a document into fixed-size chunks of `size` pages each. */
export function rangesEveryN(pageCount: number, size: number): PageRange[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new PageRangeError(
      "Pages per file must be a whole number of 1 or more.",
    );
  }
  const ranges: PageRange[] = [];
  for (let start = 0; start < pageCount; start += size) {
    ranges.push({ start, end: Math.min(start + size - 1, pageCount - 1) });
  }
  return ranges;
}

/** One range per page — the "each page as its own file" mode. */
export function rangesPerPage(pageCount: number): PageRange[] {
  return Array.from({ length: pageCount }, (_, i) => ({ start: i, end: i }));
}

/**
 * Cut a document at the given 0-based start pages — Split PDF's "By
 * bookmarks" mode, where each top-level bookmark's page starts a file. Starts
 * are sorted and de-duplicated (two bookmarks on one page start ONE file);
 * pages before the first start form a file of their own, so no page is lost.
 */
export function rangesFromStarts(
  starts: readonly number[],
  pageCount: number,
): PageRange[] {
  const cuts = [
    ...new Set(
      starts.filter((s) => Number.isInteger(s) && s >= 0 && s < pageCount),
    ),
  ].sort((a, b) => a - b);
  if (pageCount < 1) return [];
  if (cuts[0] !== 0) cuts.unshift(0);
  return cuts.map((start, i) => ({
    start,
    end: (cuts[i + 1] ?? pageCount) - 1,
  }));
}

/** Expand an inclusive range into its 0-based indices. */
export function rangeToIndices({ start, end }: PageRange): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/** Human label for a range, 1-based inclusive, e.g. "1" or "3–5". */
export function formatRange({ start, end }: PageRange): string {
  return start === end ? `${start + 1}` : `${start + 1}–${end + 1}`;
}

/**
 * Human label for a set of 1-based page numbers, runs compressed with
 * {@link formatRange}: [2, 7, 8, 9] -> "2, 7–9". Sorted and de-duplicated, so
 * the label reads the same whatever order the pages were found in; with "–"
 * typed as "-" it parses back to the same pages through {@link parsePageList}.
 */
export function formatPageNumbers(pageNumbers: readonly number[]): string {
  const sorted = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const runs: PageRange[] = [];
  for (const page of sorted) {
    const last = runs[runs.length - 1];
    if (last && page - 1 === last.end + 1) last.end = page - 1;
    else runs.push({ start: page - 1, end: page - 1 });
  }
  return runs.map(formatRange).join(", ");
}

/**
 * Build named split parts from ranges. Names are zero-padded and carry the page
 * range so a folder of outputs sorts and reads sensibly.
 */
export function buildSplitParts(
  base: string,
  ranges: PageRange[],
): SplitPart[] {
  const safeBase = base.trim() || "document";
  const pad = String(ranges.length).length;
  return ranges.map((range, i) => {
    const seq = String(i + 1).padStart(pad, "0");
    const label =
      range.start === range.end
        ? `page-${range.start + 1}`
        : `pages-${range.start + 1}-${range.end + 1}`;
    return {
      name: `${safeBase}-${seq}-${label}.pdf`,
      indices: rangeToIndices(range),
    };
  });
}
