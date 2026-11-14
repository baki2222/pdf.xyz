import { describe, expect, it } from "vitest";
import { MAX_DIFF_CELLS } from "./diff";
import {
  MAX_WORD_PAIR_TOKENS,
  MAX_WORD_WORK,
  PAIR_SIMILARITY,
  lineSimilarity,
  markWords,
  pairChangedLines,
  tokenize,
} from "./words";

/** `n` tokens exactly: "a," repeated, with an "a" for an odd count. */
function tokens(n: number, word = "a", mark = ","): string {
  return (word + mark).repeat(Math.floor(n / 2)) + (n % 2 ? word : "");
}

describe("word marks: the bounds", () => {
  it("health: the token builder makes exactly the count asked for", () => {
    expect(tokenize(tokens(MAX_WORD_PAIR_TOKENS))).toHaveLength(
      MAX_WORD_PAIR_TOKENS,
    );
    expect(tokenize(tokens(MAX_WORD_PAIR_TOKENS + 1))).toHaveLength(
      MAX_WORD_PAIR_TOKENS + 1,
    );
    expect(tokenize("Total due: 100")).toEqual([
      "Total",
      " ",
      "due",
      ":",
      " ",
      "100",
    ]);
  });

  it(`a pair of ${MAX_WORD_PAIR_TOKENS} tokens is marked; one of ${MAX_WORD_PAIR_TOKENS + 1} is shown whole and counted`, () => {
    const at = tokens(MAX_WORD_PAIR_TOKENS);
    const over = tokens(MAX_WORD_PAIR_TOKENS + 1);
    const edit = (s: string) => `b${s.slice(1)}`;
    const marked = markWords([[0, 0]], [at], [edit(at)]);
    expect(marked.pairs[0]!.tokens).not.toBeNull();
    expect(marked.fallbacks).toBe(0);
    const whole = markWords([[0, 0]], [over], [edit(over)]);
    expect(whole.pairs[0]!.tokens).toBeNull();
    expect(whole.fallbacks).toBe(1);
  });

  it(`the pairs of one comparison build at most ${MAX_WORD_WORK.toLocaleString("en-US")} cells together, and the rest fall back`, () => {
    // Lines that share ONE token, mid-line, build a full table: (n+1)²
    // cells each. (Lines that share none were the fixture until 2026-11-14,
    // when such a pair stopped building its all-zero table: diff.ts,
    // DISJOINT_CHECK_CELLS.)
    const n = MAX_WORD_PAIR_TOKENS;
    const left = Array.from({ length: 10 }, () => tokens(n, "a", ","));
    const oneShared = (line: string) => {
      const at = 2 * Math.floor(n / 4);
      return `${line.slice(0, at)}a${line.slice(at + 1)}`;
    };
    const right = Array.from({ length: 10 }, () =>
      oneShared(tokens(n, "b", ";")),
    );
    const pairs = left.map((_, i) => [i, i] as [number, number]);
    let charged = 0;
    const tables: number[] = [];
    const result = markWords(pairs, left, right, undefined, (cells) => {
      charged += cells;
      tables.push(cells);
    });
    // Health: a table really is that big, and ten would blow the budget.
    expect(tables[0]).toBe((n + 1) * (n + 1));
    expect(10 * (n + 1) * (n + 1)).toBeGreaterThan(MAX_WORD_WORK);
    expect(charged).toBeLessThanOrEqual(MAX_WORD_WORK);
    const marked = result.pairs.filter((p) => p.tokens !== null).length;
    expect(marked).toBe(Math.floor(MAX_WORD_WORK / ((n + 1) * (n + 1))));
    expect(result.fallbacks).toBe(10 - marked);
    // No word table is ever larger than the line diff's own bound.
    expect(Math.max(...tables)).toBeLessThanOrEqual(MAX_DIFF_CELLS);
  });

  it("marks the changed word of 'Total due: 100' -> 'Total due: 120'", () => {
    const { pairs } = markWords(
      [[0, 0]],
      ["Total due: 100"],
      ["Total due: 120"],
    );
    expect(pairs[0]!.tokens).toEqual([
      { k: "same", text: "Total due: ", right: "Total due: " },
      { k: "removed", text: "100" },
      { k: "added", text: "120" },
    ]);
  });

  it("pairs a removed run with the added run after it, line by line", () => {
    const left = ["Intro", "Fee 10", "Term 3 years", "Middle", "Total 100"];
    const right = ["Intro", "Fee 12", "Middle", "Extra line", "Total 120"];
    expect(
      pairChangedLines(
        [
          { k: "same", a: 0, b: 0 },
          { k: "removed", a: 1 },
          { k: "removed", a: 2 },
          { k: "added", b: 1 },
          { k: "same", a: 3, b: 2 },
          { k: "added", b: 3 },
          { k: "removed", a: 4 },
          { k: "added", b: 4 },
        ],
        left,
        right,
      ),
    ).toEqual([
      [1, 1],
      [4, 4],
    ]);
  });

  /*
   * Until 2026-11-14 the k-th removed line of a run was paired with its k-th
   * added line, related or not (second review of audit compare-pdf#4).
   * Clause 4 deleted and clause 5 edited printed "~ Clause [-4-]{+5+}: The
   * [-fee-]{+term+} is ...": every span a true token difference for the pair
   * it was handed, and the pair a false statement of what changed.
   */
  it("pairs a line with its own version, never with a neighbour", () => {
    const left = [
      "Clause 4: The fee is 100 USD per month.",
      "Clause 5: The term is 12 months.",
    ];
    const right = ["Clause 5: The term is 24 months."];
    const ops = [
      { k: "removed", a: 0 },
      { k: "removed", a: 1 },
      { k: "added", b: 0 },
    ] as const;
    expect(pairChangedLines(ops, left, right)).toEqual([[1, 0]]);
    // The other way round: clause 4 added before an edited clause 5.
    expect(
      pairChangedLines(
        [
          { k: "removed", a: 0 },
          { k: "added", b: 0 },
          { k: "added", b: 1 },
        ],
        ["Clause 5: The term is 12 months."],
        [
          "Clause 4: The fee is 100 USD per month.",
          "Clause 5: The term is 24 months.",
        ],
      ),
    ).toEqual([[0, 1]]);
    // Two unrelated lines in one place are not paired at all.
    expect(
      pairChangedLines(
        [
          { k: "removed", a: 0 },
          { k: "added", b: 0 },
        ],
        ["The fee is 100 USD per month."],
        ["Signed by both parties today"],
      ),
    ).toEqual([]);
    // Health: the real edit is alike enough, and the wrong pair is not.
    const words = (t: string) => t.match(/[\p{L}\p{N}]+/gu) ?? [];
    expect(lineSimilarity(words(left[1]!), words(right[0]!))).toBeGreaterThan(
      PAIR_SIMILARITY,
    );
    expect(lineSimilarity(words(left[0]!), words(right[0]!))).toBeLessThan(
      PAIR_SIMILARITY,
    );
  });
});

/**
 * The tokenizer keeps a letter and its marks together (review of audit
 * compare-pdf#4, 2026-11-14). Until then a token was a run of letters and
 * digits only, so every Bengali or Devanagari vowel sign and virama, and
 * every decomposed accent, was a token of its own; the marks cut through
 * syllables and the report printed a lone vowel sign after "{+". Scripts
 * written without spaces were the other way round: a whole Japanese
 * sentence was one token, and a one-character edit marked all of it.
 *
 * Each entry: a text and the tokens a reader would call its words.
 */
const SCRIPTS: Record<string, [string, string[]]> = {
  bengali: ["কলকাতা শহর", ["কলকাতা", " ", "শহর"]],
  devanagari: ["नमस्ते दुनिया", ["नमस्ते", " ", "दुनिया"]],
  "a decomposed accent": [
    `cafe${String.fromCharCode(0x301)} au lait`,
    [`cafe${String.fromCharCode(0x301)}`, " ", "au", " ", "lait"],
  ],
  "a joined emoji": [
    `family ${String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)} ok`,
    [
      "family",
      " ",
      String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
      " ",
      "ok",
    ],
  ],
  "a flag": [
    `BD ${String.fromCodePoint(0x1f1e7, 0x1f1e9)}`,
    ["BD", " ", String.fromCodePoint(0x1f1e7, 0x1f1e9)],
  ],
  japanese: ["今日は良い天気", ["今", "日", "は", "良", "い", "天", "気"]],
  thai: ["สวัสดี", ["ส", "วั", "ส", "ดี"]],
  latin: ["Total due: 100", ["Total", " ", "due", ":", " ", "100"]],
};

describe("word marks: a word is a word in every script", () => {
  it("health: every text is the concatenation of its tokens", () => {
    for (const [name, [text, want]] of Object.entries(SCRIPTS))
      expect(want.join(""), name).toBe(text);
  });

  it("each text tokenizes into its words, never a lone mark", () => {
    const wrong: string[] = [];
    for (const [name, [text, want]] of Object.entries(SCRIPTS)) {
      const got = tokenize(text);
      if (JSON.stringify(got) !== JSON.stringify(want))
        wrong.push(`${name}: ${JSON.stringify(got)}`);
      // No token starts with a combining mark or a joiner, wherever the
      // corpus's expectations might be wrong.
      const lone = got.filter((t) => /^[\p{M}\u200c\u200d]/u.test(t));
      if (lone.length) wrong.push(`${name}: lone ${JSON.stringify(lone)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("a changed vowel sign marks the whole word, and a changed character only itself", () => {
    const one = (l: string, r: string) =>
      markWords([[0, 0]], [l], [r]).pairs[0]!.tokens;
    expect(one("আমি ভাত খাই", "আমি ভাতে খাই")).toEqual([
      { k: "same", text: "আমি ", right: "আমি " },
      { k: "removed", text: "ভাত" },
      { k: "added", text: "ভাতে" },
      { k: "same", text: " খাই", right: " খাই" },
    ]);
    expect(one("今日は良い天気です", "今日は悪い天気です")).toEqual([
      { k: "same", text: "今日は", right: "今日は" },
      { k: "removed", text: "良" },
      { k: "added", text: "悪" },
      { k: "same", text: "い天気です", right: "い天気です" },
    ]);
  });
});
