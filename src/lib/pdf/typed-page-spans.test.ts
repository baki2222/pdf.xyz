// @vitest-environment node
/**
 * Typed page text, asked in both directions (CLAUDE.md rule 1): every row
 * lands on a named branch of `typedPageSpans`, and every branch is landed on
 * by some row. A refusal's words are checked against `parsePageList`'s own
 * (called directly here), so this module can neither reword nor swallow the
 * grammar's sentence.
 */
import { describe, expect, it } from "vitest";
import { MAX_PAGE_SPANS } from "@/lib/jobs/page-spans-option";
import type { PageSpan } from "./page-spans";
import { PageRangeError, parsePageList } from "./ranges";
import {
  TOO_MANY_PAGE_SPANS_MESSAGE,
  coversEveryPage,
  typedPageSpans,
} from "./typed-page-spans";

type Branch = "spans" | "whole" | "grammar" | "too-many";

/** `n` single pages with a gap between each: 1, 3, 5, ... */
const odd = (n: number): string =>
  Array.from({ length: n }, (_, i) => String(1 + 2 * i)).join(", ");

const CORPUS: readonly [
  text: string,
  pageCount: number,
  branch: Branch,
  spans?: PageSpan[],
][] = [
  [
    "1-3, 8",
    10,
    "spans",
    [
      [1, 3],
      [8, 8],
    ],
  ],
  ["4", 5, "spans", [[4, 4]]],
  [
    "2,4",
    5,
    "spans",
    [
      [2, 2],
      [4, 4],
    ],
  ],
  ["3-", 5, "spans", [[3, 5]]],
  ["-2", 5, "spans", [[1, 2]]],
  ["2, 1", 3, "spans", [[1, 2]]],
  [
    "1\n3",
    3,
    "spans",
    [
      [1, 1],
      [3, 3],
    ],
  ],
  [odd(MAX_PAGE_SPANS), 2 * MAX_PAGE_SPANS, "spans"],
  ["1-5", 5, "whole"],
  ["1-3, 4-5", 5, "whole"],
  ["1", 1, "whole"],
  ["1, 1-2", 2, "whole"],
  ["6", 5, "grammar"],
  ["iv", 5, "grammar"],
  ["", 5, "grammar"],
  ["0", 5, "grammar"],
  ["5-3", 5, "grammar"],
  [odd(MAX_PAGE_SPANS + 1), 2 * MAX_PAGE_SPANS + 2, "too-many"],
];

/** What `parsePageList` itself says about `text`, or `null` if it accepts. */
function grammarSays(text: string, pageCount: number): string | null {
  try {
    parsePageList(text, pageCount);
    return null;
  } catch (error) {
    if (error instanceof PageRangeError) return error.message;
    throw error;
  }
}

function branchOf(text: string, pageCount: number): Branch {
  const result = typedPageSpans(text, pageCount);
  if (result.ok) return result.spans === null ? "whole" : "spans";
  return result.message === TOO_MANY_PAGE_SPANS_MESSAGE
    ? "too-many"
    : "grammar";
}

describe("typedPageSpans - a both-directions corpus", () => {
  it("health: the corpus is not quietly small", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(12);
    expect(CORPUS.length).toBeLessThan(200);
  });

  it("every branch is exercised by at least one row, and every row by a branch", () => {
    const seen = new Set(CORPUS.map(([text, count]) => branchOf(text, count)));
    expect([...seen].sort()).toEqual(
      (["grammar", "spans", "too-many", "whole"] as Branch[]).sort(),
    );
  });

  it.each(CORPUS.map((row) => [JSON.stringify(row[0]), ...row] as const))(
    "%s",
    (_label, text, pageCount, branch, spans) => {
      expect(branchOf(text, pageCount)).toBe(branch);
      const result = typedPageSpans(text, pageCount);
      if (branch === "grammar") {
        const said = grammarSays(text, pageCount);
        expect(said, "the grammar accepts this row").not.toBeNull();
        expect(result).toEqual({ ok: false, message: said });
      }
      if (branch === "whole") expect(result).toEqual({ ok: true, spans: null });
      if (branch === "spans" && spans)
        expect(result).toEqual({ ok: true, spans });
    },
  );

  it("names the span limit from the wire's constant", () => {
    expect(TOO_MANY_PAGE_SPANS_MESSAGE).toBe(
      `Choose at most ${MAX_PAGE_SPANS} separate page ranges.`,
    );
  });

  it("the out-of-range sentence is the grammar's, naming the page count", () => {
    expect(typedPageSpans("6", 5)).toEqual({
      ok: false,
      message: 'This PDF has 5 pages \u2014 "6" is out of range.',
    });
  });
});

describe("coversEveryPage - the one author of 'every page is the whole document'", () => {
  it.each([
    [[[1, 5]] as PageSpan[], 5, true],
    [[[1, 1]] as PageSpan[], 1, true],
    [[[1, 4]] as PageSpan[], 5, false],
    [[[2, 5]] as PageSpan[], 5, false],
    [
      [
        [1, 2],
        [4, 5],
      ] as PageSpan[],
      5,
      false,
    ],
    [[[1, 6]] as PageSpan[], 5, false],
    [[] as PageSpan[], 5, false],
  ])("%j of %i pages -> %s", (spans, pageCount, expected) => {
    expect(coversEveryPage(spans, pageCount)).toBe(expected);
  });
});
