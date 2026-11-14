import { describe, expect, it } from "vitest";
import { MAX_DIFF_CELLS } from "./diff";
import {
  MAX_WORD_PAIR_TOKENS,
  MAX_WORD_WORK,
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
    // Lines that share no token build a full table: (n+1)² cells each.
    const n = MAX_WORD_PAIR_TOKENS;
    const left = Array.from({ length: 10 }, () => tokens(n, "a", ","));
    const right = Array.from({ length: 10 }, () => tokens(n, "b", ";"));
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
    expect(
      pairChangedLines([
        { k: "same", a: 0, b: 0 },
        { k: "removed", a: 1 },
        { k: "removed", a: 2 },
        { k: "added", b: 1 },
        { k: "same", a: 3, b: 2 },
        { k: "added", b: 3 },
        { k: "removed", a: 4 },
        { k: "added", b: 4 },
      ]),
    ).toEqual([
      [1, 1],
      [4, 4],
    ]);
  });
});
