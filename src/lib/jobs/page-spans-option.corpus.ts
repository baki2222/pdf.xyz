/**
 * The wire grammar's both-directions corpus (CLAUDE.md rule 1), shared by
 * every parser that takes a `pages` option: `page-spans-option.test.ts` maps
 * each row to a validator branch and each branch to a row, and the tools'
 * own option tests (`summarize-pdf`, `translate-pdf`) post the same rows
 * through their parsers, so a tool cannot accept what the grammar refuses.
 *
 * A module of its own, not an export of a test file: importing a test file
 * registers its tests a second time in the importer. Imported only by tests.
 */
import type { PageSpan } from "@/lib/pdf/page-spans";
import { MAX_PAGE_NUMBER, MAX_PAGE_SPANS } from "./page-spans-option";

/** Each refusal branch, keyed to a fragment only its message contains. */
export const BRANCHES = {
  "not-a-list": "must be a list of",
  empty: "cannot be empty",
  "too-many": `at most ${MAX_PAGE_SPANS} separate`,
  "not-a-pair": "must be a [first, last] pair",
  "not-whole": "must be whole numbers",
  "below-one": "start at 1",
  "above-max": "cannot be greater than 100,000",
  reversed: "must start at or before its end",
  "order-or-overlap": "ascending order and must not overlap",
  adjacent: "that touch must be written as one range",
} as const;
export type Branch = keyof typeof BRANCHES | "accepted";

export const singles = (n: number, from = 1): PageSpan[] =>
  Array.from({ length: n }, (_, i) => [from + 2 * i, from + 2 * i] as const);

export const CORPUS: readonly [string, unknown, Branch][] = [
  ["one page", [[1, 1]], "accepted"],
  [
    "two spans with a gap",
    [
      [2, 4],
      [9, 9],
    ],
    "accepted",
  ],
  ["the whole integer bound", [[1, MAX_PAGE_NUMBER]], "accepted"],
  ["exactly the span limit", singles(MAX_PAGE_SPANS), "accepted"],
  [
    "a gap of exactly one page",
    [
      [1, 2],
      [4, 4],
    ],
    "accepted",
  ],
  ["a string", "x", "not-a-list"],
  ["an object", { 0: [1, 1] }, "not-a-list"],
  ["empty", [], "empty"],
  ["one over the span limit", singles(MAX_PAGE_SPANS + 1), "too-many"],
  ["a triple", [[1, 2, 3]], "not-a-pair"],
  ["a bare number", [1], "not-a-pair"],
  ["a fraction", [[1, 2.5]], "not-whole"],
  ["numeric strings", [["1", "2"]], "not-whole"],
  ["beyond safe integers", [[1, 2 ** 53]], "not-whole"],
  ["page zero", [[0, 1]], "below-one"],
  ["a negative page", [[-3, 2]], "below-one"],
  ["one past the integer bound", [[1, MAX_PAGE_NUMBER + 1]], "above-max"],
  ["reversed", [[3, 2]], "reversed"],
  [
    "out of order",
    [
      [4, 5],
      [1, 2],
    ],
    "order-or-overlap",
  ],
  [
    "overlapping at one page",
    [
      [1, 3],
      [3, 5],
    ],
    "order-or-overlap",
  ],
  [
    "adjacent (not canonical)",
    [
      [1, 2],
      [3, 4],
    ],
    "adjacent",
  ],
];
