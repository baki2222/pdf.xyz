import { diffIds, intern, MAX_DIFF_CELLS, type Op } from "./diff";
import { drain, type Steps } from "./steps";

/**
 * Word marks: inside a changed line, which words differ. A run of removed
 * lines followed by a run of added lines is paired, in order, line with the
 * line it is a version of ({@link pairChangedLines}), and each pair is
 * diffed again over its tokens (words, numbers, single punctuation marks and
 * the spaces between them). A line with no such partner is not paired, and
 * is shown whole.
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

/**
 * The tokens of a line, in order, each one of:
 *
 * - a run of spaces;
 * - a flag (two regional indicators);
 * - one character of a script written without spaces between words —
 *   Chinese, Japanese, Thai, Lao, Khmer, Myanmar — with its marks, so a
 *   one-character edit marks one character, not the sentence;
 * - a word: a letter or digit, then letters, digits, combining marks and
 *   the two joiners (`\p{Join_C}`, which Bengali and Devanagari words carry
 *   inside them), so a vowel sign or a virama stays in its word;
 * - any other character with the marks, skin tones and joined symbols that
 *   follow it, so an emoji family is one token.
 *
 * Until 2026-11-14 a token was a run of letters and digits only: every
 * Indic vowel sign, every virama and every decomposed accent stood alone,
 * and a word mark could start on one (a lone vowel sign after "{+"), while a Japanese sentence
 * was one token (words.test.ts, "a word is a word in every script").
 */
const TOKEN =
  /\s+|\p{RI}{2}|[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]\p{M}*|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}])[\p{L}\p{N}])(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}])[\p{L}\p{M}\p{N}\p{Join_C}])*|[^\s\p{L}\p{N}][\p{M}\p{Emoji_Modifier}]*(?:\p{Join_C}[^\s\p{L}\p{N}][\p{M}\p{Emoji_Modifier}]*)*/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/**
 * How alike two lines must be to be paired: the share of their words they
 * have in common (Dice: twice the shared words over both counts). At 0.5,
 * "Fee 10" → "Fee 12" pairs and two clauses that share only "The", "is" and
 * the clause word do not.
 */
export const PAIR_SIMILARITY = 0.5;

const WORDY = /[\p{L}\p{N}]/u;

/** A line's words (tokens with a letter or digit), else its non-space tokens. */
function wordsOf(text: string, key: (token: string) => string): string[] {
  const tokens = tokenize(text).filter((t) => !/^\s+$/.test(t));
  const words = tokens.filter((t) => WORDY.test(t));
  return (words.length > 0 ? words : tokens).map(key);
}

/** Dice similarity of two word lists, as multisets: 0 to 1. */
export function lineSimilarity(a: readonly string[], b: readonly string[]) {
  if (a.length === 0 && b.length === 0) return 1;
  const count = new Map<string, number>();
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const n = count.get(w) ?? 0;
    if (n > 0) {
      shared += 1;
      count.set(w, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/**
 * The removed/added pairs of an edit script: within each run of removed
 * steps followed directly by a run of added steps, a removed line goes with
 * the added line it is a version of. The two runs are walked in order: the
 * lines in front are paired when they are at least {@link PAIR_SIMILARITY}
 * alike and neither is more like the other's next line; otherwise the one
 * whose next line is the better match is passed over, unpaired, or both
 * are when neither is like anything near it. An unpaired line is marked
 * whole.
 *
 * Until 2026-11-14 the k-th removed line went with the k-th added line,
 * related or not (history kept): with clause 4 deleted and clause 5 edited,
 * clause 4's fee was marked as becoming clause 5's term, and clause 5's
 * real edit, 12 months to 24, was never marked (words.test.ts, "pairs a
 * line with its own version, never with a neighbour").
 */
export function pairChangedLines(
  ops: readonly Op[],
  left: readonly string[],
  right: readonly string[],
  key: (token: string) => string = (token) => token,
): [number, number][] {
  return drain(pairChangedLinesSteps(ops, left, right, key));
}

/** {@link pairChangedLines}, pausing as it goes (`steps.ts`). */
export function* pairChangedLinesSteps(
  ops: readonly Op[],
  left: readonly string[],
  right: readonly string[],
  key: (token: string) => string = (token) => token,
): Steps<[number, number][]> {
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
    if (removed.length > 0 && added.length > 0)
      yield* pairRuns(removed, added, left, right, key, pairs);
    if (removed.length === 0 && added.length === 0) i += 1;
  }
  return pairs;
}

function* pairRuns(
  removed: readonly number[],
  added: readonly number[],
  left: readonly string[],
  right: readonly string[],
  key: (token: string) => string,
  out: [number, number][],
): Steps<void> {
  const leftWords = new Map<number, string[]>();
  const rightWords = new Map<number, string[]>();
  const lw = (r: number) => {
    let w = leftWords.get(r);
    if (!w) leftWords.set(r, (w = wordsOf(left[removed[r]!]!, key)));
    return w;
  };
  const rw = (s: number) => {
    let w = rightWords.get(s);
    if (!w) rightWords.set(s, (w = wordsOf(right[added[s]!]!, key)));
    return w;
  };
  const sim = (r: number, s: number) =>
    r < removed.length && s < added.length ? lineSimilarity(lw(r), rw(s)) : 0;
  let r = 0;
  let s = 0;
  while (r < removed.length && s < added.length) {
    const here = sim(r, s);
    const skipLeft = sim(r + 1, s);
    const skipRight = sim(r, s + 1);
    if (here >= PAIR_SIMILARITY && here >= skipLeft && here >= skipRight) {
      out.push([removed[r]!, added[s]!]);
      r += 1;
      s += 1;
    } else if (skipLeft >= PAIR_SIMILARITY && skipLeft >= skipRight) r += 1;
    else if (skipRight >= PAIR_SIMILARITY) s += 1;
    else {
      r += 1;
      s += 1;
    }
    // Lines already passed are never looked at again.
    leftWords.delete(r - 1);
    rightWords.delete(s - 1);
    if ((r + s) % 256 < 2) yield;
  }
  yield;
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
  return drain(markWordsSteps(pairs, left, right, key, onCells));
}

/** {@link markWords}, pausing every few pairs (`steps.ts`). */
export function* markWordsSteps(
  pairs: readonly [number, number][],
  left: readonly string[],
  right: readonly string[],
  key: (token: string) => string = (token) => token,
  onCells?: (cells: number) => void,
): Steps<{ pairs: WordPair[]; fallbacks: number }> {
  let remaining = MAX_WORD_WORK;
  let fallbacks = 0;
  const out: WordPair[] = [];
  for (const [l, r] of pairs) {
    if (out.length % 32 === 31) yield;
    const a = tokenize(left[l]!);
    const b = tokenize(right[r]!);
    const bound = (a.length + 1) * (b.length + 1);
    if (
      a.length > MAX_WORD_PAIR_TOKENS ||
      b.length > MAX_WORD_PAIR_TOKENS ||
      bound > remaining
    ) {
      fallbacks += 1;
      out.push({ left: l, right: r, tokens: null });
      continue;
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
    out.push({ left: l, right: r, tokens: tokensOf(ops, a, b) });
  }
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
