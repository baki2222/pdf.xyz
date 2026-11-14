import { diffIds, intern, MAX_DIFF_CELLS, type Op } from "./diff";

/**
 * Word marks: inside a changed line, which words differ. A run of removed
 * lines followed by a run of added lines is paired line by line, in order,
 * and each pair is diffed again over its tokens (words, numbers, single
 * punctuation marks and the spaces between them).
 *
 * Two bounds, because one is not enough: a pair longer than
 * {@link MAX_WORD_PAIR_TOKENS} on either side is shown whole, and all the
 * pairs of one comparison share {@link MAX_WORD_WORK} cells of LCS table —
 * without the second, 10,000 pairs just under the first would each build a
 * 4-million-cell table. A pair the bounds skip keeps `tokens: null` and is
 * counted in `fallbacks`, so the report can say how many lines it marked
 * whole.
 */

/** The longest line, in tokens, whose words are marked. */
export const MAX_WORD_PAIR_TOKENS = 2_000;

/** The LCS cells every pair of one comparison may build, together. */
export const MAX_WORD_WORK = 20_000_000;

export type WordTokenKind = "same" | "removed" | "added";

export interface WordToken {
  k: WordTokenKind;
  /** The left line's text for "same" and "removed", the right's for "added". */
  text: string;
  /** For "same": the right line's text, which "ignore case" lets differ. */
  right?: string;
}

/** A removed line and the added line it is paired with, by index. */
export interface WordPair {
  left: number;
  right: number;
  /** In order, runs of one kind merged; null when a bound skipped the pair. */
  tokens: WordToken[] | null;
}

/** Spaces, a run of letters or digits, or one other character. */
const TOKEN = /\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/**
 * The removed/added pairs of an edit script: within each run of removed
 * steps followed directly by a run of added steps, the first removed line
 * goes with the first added one, and so on. Extra lines on either side stay
 * unpaired (marked whole).
 */
export function pairChangedLines(ops: readonly Op[]): [number, number][] {
  const pairs: [number, number][] = [];
  let i = 0;
  while (i < ops.length) {
    const removed: number[] = [];
    while (i < ops.length && ops[i]!.k === "removed") {
      removed.push((ops[i] as { a: number }).a);
      i += 1;
    }
    const added: number[] = [];
    while (i < ops.length && ops[i]!.k === "added") {
      added.push((ops[i] as { b: number }).b);
      i += 1;
    }
    for (let p = 0; p < Math.min(removed.length, added.length); p += 1)
      pairs.push([removed[p]!, added[p]!]);
    if (removed.length === 0 && added.length === 0) i += 1;
  }
  return pairs;
}

/**
 * The word marks of every pair. `left`/`right` are the lines' texts (what
 * the reader sees), `key` what a token is matched on (lowercased under
 * "ignore case"). `onCells` hears every table built — the tests count it.
 */
export function markWords(
  pairs: readonly [number, number][],
  left: readonly string[],
  right: readonly string[],
  key: (token: string) => string = (token) => token,
  onCells?: (cells: number) => void,
): { pairs: WordPair[]; fallbacks: number } {
  let remaining = MAX_WORD_WORK;
  let fallbacks = 0;
  const out = pairs.map(([l, r]): WordPair => {
    const a = tokenize(left[l]!);
    const b = tokenize(right[r]!);
    const bound = (a.length + 1) * (b.length + 1);
    if (
      a.length > MAX_WORD_PAIR_TOKENS ||
      b.length > MAX_WORD_PAIR_TOKENS ||
      bound > remaining
    ) {
      fallbacks += 1;
      return { left: l, right: r, tokens: null };
    }
    const ids = new Map<string, number>();
    const ops = diffIds(
      intern(ids, a.map(key)),
      intern(ids, b.map(key)),
      MAX_DIFF_CELLS,
      (cells) => {
        remaining -= cells;
        onCells?.(cells);
      },
    );
    return { left: l, right: r, tokens: tokensOf(ops, a, b) };
  });
  return { pairs: out, fallbacks };
}

function tokensOf(ops: readonly Op[], a: string[], b: string[]): WordToken[] {
  const tokens: WordToken[] = [];
  const push = (k: WordTokenKind, text: string, right?: string) => {
    const last = tokens.at(-1);
    if (last && last.k === k) {
      last.text += text;
      if (right !== undefined) last.right = (last.right ?? "") + right;
    } else tokens.push(right === undefined ? { k, text } : { k, text, right });
  };
  for (const op of ops) {
    if (op.k === "same") push("same", a[op.a]!, b[op.b]!);
    else if (op.k === "removed") push("removed", a[op.a]!);
    else push("added", b[op.b]!);
  }
  return tokens;
}
