import type { PdfCompareResult } from "../compare-pdf";
import { pageTextChunks, type ExtractedTextPage } from "../text";
import {
  itemRangesFor,
  pageSearchText,
  type ItemRange,
  type SearchItem,
  type SearchMatch,
} from "../viewer-search";
import {
  normalizeComparableLine,
  normalizeComparableText,
  type ComparableLine,
} from "./lines";
import type { WordToken } from "./words";

/**
 * Compare PDF's changes, placed on the pages themselves: each changed line
 * of a result mapped to character ranges inside the text items the page's
 * selectable layer draws, so the page view marks them where they are.
 *
 * Pure. The page's items are `ViewerText.items` (pdf.js's `getTextContent`,
 * as the viewer reads them); the reading lines are the lines the comparison
 * read from the same page (`readingLinesByPage`). Both come from the same
 * items, so as a MULTISET the page's stream lines and its reading lines are
 * equal; only their ORDER can differ, where the extractor put the page in
 * reading order. A line is placed only when it can be found without a
 * guess, and flagged otherwise (`placePage`).
 */

export type ChangeKind = "removed" | "added";
export type MarkKind = ChangeKind | "line";

/** One changed line of a result, on the side it belongs to. */
export interface Change {
  /** Index of its hunk in `result.hunks`. */
  hunk: number;
  line: ComparableLine;
  kind: ChangeKind;
  /**
   * Word marks: undefined when the line has no counterpart (the whole line
   * is the change), null when a word-mark bound skipped its pair (no word is
   * known to be unchanged), else the pair's tokens.
   */
  tokens: WordToken[] | null | undefined;
}

export interface SideChanges {
  /** Changes by 1-based page. */
  byPage: Map<number, Change[]>;
  /** Per hunk, the 1-based page a move to it shows on this side. */
  target: number[];
}

/**
 * Every changed line of every hunk, by side and page, and each hunk's first
 * page on each side (its anchor page when that side has no changed line).
 * Independent of how much of the list is drawn.
 */
export function changesByPage(
  result: Pick<PdfCompareResult, "hunks" | "lines">,
): { left: SideChanges; right: SideChanges } {
  const left: SideChanges = { byPage: new Map(), target: [] };
  const right: SideChanges = { byPage: new Map(), target: [] };
  const add = (side: SideChanges, change: Change) => {
    const list = side.byPage.get(change.line.page);
    if (list) list.push(change);
    else side.byPage.set(change.line.page, [change]);
  };
  result.hunks.forEach((hunk, n) => {
    left.target.push(hunk.leftPages[0]);
    right.target.push(hunk.rightPages[0]);
    const byLeft = new Map(hunk.pairs.map((p) => [p.left, p.tokens]));
    const byRight = new Map(hunk.pairs.map((p) => [p.right, p.tokens]));
    for (const op of hunk.ops) {
      if (op.k === "removed") {
        const line = result.lines.left[op.a];
        if (line)
          add(left, {
            hunk: n,
            line,
            kind: "removed",
            tokens: byLeft.has(op.a) ? byLeft.get(op.a) : undefined,
          });
      } else if (op.k === "added") {
        const line = result.lines.right[op.b];
        if (line)
          add(right, {
            hunk: n,
            line,
            kind: "added",
            tokens: byRight.has(op.b) ? byRight.get(op.b) : undefined,
          });
      }
    }
  });
  return { left, right };
}

/**
 * Each page's lines as the comparison read them, furniture included (the
 * rank a line carries counts every line of its page), by 1-based page.
 * A page with no text has no entry.
 */
export function readingLinesByPage(
  pages: readonly Pick<ExtractedTextPage, "text" | "pageNumber">[],
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const chunk of pageTextChunks(pages as ExtractedTextPage[]))
    out.set(chunk.pageNumber, normalizeComparableText(chunk.text));
  return out;
}

/** One line of a page's text in stream order, normalised as the comparison normalises. */
export interface StreamLine {
  norm: string;
  /** Where the raw line starts in `pageSearchText(items).text`. */
  rawFrom: number;
  /**
   * For each character of `norm`, its offset in the raw line (a collapsed
   * run of spaces maps to its first character); the last entry is the
   * offset just after the last kept character.
   */
  map: Int32Array;
}

const WHITE = /\s/;

/**
 * A raw line normalised by the rule of `normalizeComparableLine` (runs of
 * spaces and tabs to one space, then trimmed), keeping where each kept
 * character came from.
 */
function mapLine(raw: string): { norm: string; map: Int32Array } {
  const chars: string[] = [];
  const from: number[] = [];
  let inRun = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === " " || c === "\t") {
      if (!inRun) {
        chars.push(" ");
        from.push(i);
      }
      inRun = true;
    } else {
      chars.push(c);
      from.push(i);
      inRun = false;
    }
  }
  let lo = 0;
  let hi = chars.length;
  while (lo < hi && WHITE.test(chars[lo]!)) lo += 1;
  while (hi > lo && WHITE.test(chars[hi - 1]!)) hi -= 1;
  const norm = chars.slice(lo, hi).join("");
  const map = new Int32Array(norm.length + 1);
  for (let k = lo; k < hi; k++) map[k - lo] = from[k]!;
  map[norm.length] = hi > lo ? from[hi - 1]! + 1 : 0;
  return { norm, map };
}

/** A page's non-blank lines in stream order, as {@link StreamLine}s. */
export function streamLines(items: readonly SearchItem[]): StreamLine[] {
  const { text } = pageSearchText(items);
  const out: StreamLine[] = [];
  const breaks = /\r\n?|\n/g;
  let start = 0;
  for (;;) {
    const m = breaks.exec(text);
    const end = m ? m.index : text.length;
    const raw = text.slice(start, end);
    const { norm, map } = mapLine(raw);
    if (norm !== "") out.push({ norm, rawFrom: start, map });
    if (!m) break;
    start = m.index + m[0].length;
  }
  return out;
}

/** One run of a placed line: its text, its kind, and where it sits. */
export interface PlacedSegment {
  text: string;
  kind: MarkKind;
  ranges: ItemRange[];
}

export interface PlacedLine {
  change: Change;
  segments: PlacedSegment[];
}

export interface PagePlacement {
  /** One match per hunk with a placed line on this page, in hunk order. */
  matches: SearchMatch[];
  /** The hunk of each match. */
  hunkOfMatch: number[];
  lines: PlacedLine[];
  /** Changed lines on this page that could not be placed. */
  flagged: Change[];
}

/** The runs of a changed line, as text and kind, in order. */
function segmentsOf(change: Change): { text: string; kind: MarkKind }[] {
  const { tokens, kind, line } = change;
  if (tokens === undefined) return [{ text: line.text, kind }];
  if (tokens === null) return [{ text: line.text, kind: "line" }];
  const out: { text: string; kind: MarkKind }[] = [];
  for (const t of tokens) {
    if (t.k === "same") {
      const text = kind === "added" ? (t.right ?? t.text) : t.text;
      out.push({ text, kind: "line" });
    } else if (t.k === kind) {
      out.push({ text: t.text, kind });
    }
  }
  return out;
}

const counts = (xs: readonly string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const ca = counts(a);
  const cb = counts(b);
  for (const [k, n] of ca) if (cb.get(k) !== n) return false;
  return true;
}

/**
 * Place a page's changed lines on its items.
 *
 * 1. A capped page (more items than the viewer reads) places nothing: every
 *    change on it is flagged.
 * 2. Health: the page's stream lines and `readingLines` must be one
 *    multiset, else the items are not the text the comparison read, and
 *    every change is flagged.
 * 3. A changed line is the `occurrence`-th reading line with its VERBATIM
 *    text (never its case-folded key).
 * 4. Reading line to stream line: by position when the two orders agree;
 *    otherwise only a line whose text occurs once on the page — a
 *    duplicate on a reordered page is flagged, not guessed.
 * 5. The line's runs (word marks) must spell its text exactly, else it is
 *    flagged; each run becomes item ranges of its kind.
 */
export function placePage(
  items: readonly SearchItem[],
  readingLines: readonly string[],
  changes: readonly Change[],
  capped: boolean,
): PagePlacement {
  const out: PagePlacement = {
    matches: [],
    hunkOfMatch: [],
    lines: [],
    flagged: [],
  };
  if (changes.length === 0) return out;
  if (capped) {
    out.flagged.push(...changes);
    return out;
  }
  const stream = streamLines(items);
  const norms = stream.map((s) => s.norm);
  if (!sameMultiset(norms, readingLines)) {
    out.flagged.push(...changes);
    return out;
  }
  const { starts } = pageSearchText(items);
  const inOrder = norms.every((n, i) => n === readingLines[i]);
  const once = counts(readingLines);
  const streamOf = (r: number): number => {
    if (inOrder) return r;
    const text = readingLines[r]!;
    return once.get(text) === 1 ? norms.indexOf(text) : -1;
  };

  const byHunk = new Map<number, ItemRange[]>();
  for (const change of changes) {
    const { text, occurrence } = change.line;
    let r = -1;
    let seen = 0;
    for (let i = 0; i < readingLines.length; i++) {
      if (readingLines[i] !== text) continue;
      if (seen === occurrence) {
        r = i;
        break;
      }
      seen += 1;
    }
    const s = r === -1 ? -1 : streamOf(r);
    const line = s === -1 ? undefined : stream[s];
    const segments = segmentsOf(change);
    if (
      !line ||
      line.norm !== text ||
      segments.map((g) => g.text).join("") !== text
    ) {
      out.flagged.push(change);
      continue;
    }
    const placed: PlacedSegment[] = [];
    let at = 0;
    for (const g of segments) {
      const from = at;
      const to = at + g.text.length;
      at = to;
      if (to === from) continue;
      const ranges = itemRangesFor(
        items,
        starts,
        line.rawFrom + line.map[from]!,
        line.rawFrom + line.map[to - 1]! + 1,
      ).map((x) => ({ ...x, kind: g.kind }));
      placed.push({ text: g.text, kind: g.kind, ranges });
    }
    out.lines.push({ change, segments: placed });
    const list = byHunk.get(change.hunk) ?? [];
    for (const g of placed) list.push(...g.ranges);
    byHunk.set(change.hunk, list);
  }
  for (const hunk of [...byHunk.keys()].sort((a, b) => a - b)) {
    out.matches.push(byHunk.get(hunk)!);
    out.hunkOfMatch.push(hunk);
  }
  return out;
}
