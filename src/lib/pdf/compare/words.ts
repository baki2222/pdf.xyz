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
