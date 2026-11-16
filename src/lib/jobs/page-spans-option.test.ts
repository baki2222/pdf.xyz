// @vitest-environment node
/**
 * The wire grammar for a page selection, asked in both directions (CLAUDE.md
 * rule 1): every row below lands on a named validator branch, and every
 * branch is landed on by some row. A branch nothing exercises is decoration;
 * a row nothing catches is a hole.
 *
 * Plus the two statements of that grammar outside the parser: the typed half
 * (`parsePageList` → `pageSpansFromIndices`) round-trips into it, and the
 * result sanitizer's local copy (`buildAiResultMeta`'s chosen-pages bound)
 * gives the same keep/drop verdict as the parser.
 */
import { describe, expect, it } from "vitest";
import { parsePageList, rangesFromStarts } from "@/lib/pdf/ranges";
import { formatSpans, type PageSpan } from "@/lib/pdf/page-spans";
import { buildAiResultMeta } from "./ai-results";
import {
  MAX_PAGE_NUMBER,
  MAX_PAGE_SPANS,
  pageSpanFromRange,
  pageSpansFromIndices,
  parsePageSpansOption,
} from "./page-spans-option";

/** Each refusal branch, keyed to a fragment only its message contains. */
const BRANCHES = {
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
type Branch = keyof typeof BRANCHES | "accepted";

const singles = (n: number, from = 1): PageSpan[] =>
  Array.from({ length: n }, (_, i) => [from + 2 * i, from + 2 * i] as const);

const CORPUS: readonly [string, unknown, Branch][] = [
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

function branchOf(value: unknown): Branch {
  const result = parsePageSpansOption(value);
  if (result.ok) return "accepted";
  const message = result.error.body.error.message;
  const hits = (Object.keys(BRANCHES) as (keyof typeof BRANCHES)[]).filter(
    (key) => message.includes(BRANCHES[key]),
  );
  // Exactly one: a message two fragments match would make the map ambiguous.
  expect(hits, `"${message}" matched ${hits.length} branches`).toHaveLength(1);
  return hits[0]!;
}

describe("parsePageSpansOption - a both-directions corpus", () => {
  it("health: the corpus is not quietly small", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(16);
  });

  it.each(CORPUS)("%s -> %s", (_name, value, expected) => {
    expect(branchOf(value)).toBe(expected);
  });

  it("every branch is exercised by at least one row, and every row by a branch", () => {
    const hit = new Set(CORPUS.map(([, value]) => branchOf(value)));
    for (const branch of [...Object.keys(BRANCHES), "accepted"]) {
      expect(hit.has(branch as Branch), `no row reaches ${branch}`).toBe(true);
    }
  });

  it("returns the spans unchanged when accepted, and names the field it was given", () => {
    const spans = [
      [2, 4],
      [9, 9],
    ];
    expect(parsePageSpansOption(spans)).toEqual({ ok: true, value: spans });
    const refused = parsePageSpansOption([], "range");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.status).toBe(400);
      expect(refused.error.body.error.code).toBe("invalid_request");
      expect(refused.error.body.error.details).toEqual([
        { field: "range", message: refused.error.body.error.message },
      ]);
      expect(refused.error.body.error.message).toContain("`range`");
    }
  });
});

/** A small deterministic generator (mulberry32), so a red is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EN_DASH = String.fromCodePoint(0x2013);

describe("the typed half round-trips into the wire half", () => {
  it("parsePageList -> pageSpansFromIndices is canonical and equals the set, over 500 seeded sets", () => {
    const next = rng(20261116);
    let accepted = 0;
    for (let run = 0; run < 500; run += 1) {
      const pageCount = 1 + Math.floor(next() * 60);
      const pages = new Set<number>();
      const want = 1 + Math.floor(next() * pageCount);
      while (pages.size < want) pages.add(1 + Math.floor(next() * pageCount));
      const spans = pageSpansFromIndices([...pages].map((p) => p - 1));
      // What a person would type for those spans, in the typed grammar.
      const typed = formatSpans(spans).split(EN_DASH).join("-");
      const indices = parsePageList(typed, pageCount);
      const wire = pageSpansFromIndices(indices);
      expect(wire, typed).toEqual(spans);
      const parsed = parsePageSpansOption(wire);
      if (spans.length > MAX_PAGE_SPANS) {
        expect(parsed.ok, typed).toBe(false);
        continue;
      }
      expect(parsed, typed).toEqual({ ok: true, value: spans });
      accepted += 1;
    }
    // Health: the generator must mostly produce selections the wire accepts.
    expect(accepted).toBeGreaterThan(250);
  });

  it("pageSpansFromIndices converts 0-based to 1-based and merges runs", () => {
    expect(pageSpansFromIndices([0])).toEqual([[1, 1]]);
    expect(pageSpansFromIndices([3, 2, 4, 8, 2])).toEqual([
      [3, 5],
      [9, 9],
    ]);
  });

  it("pageSpanFromRange converts an outline section, and only adds one", () => {
    // Bookmarks on pages 3 and 6 of 8 (0-based starts 2 and 5).
    const ranges = rangesFromStarts([2, 5], 8);
    expect(ranges.map(pageSpanFromRange)).toEqual([
      [1, 2],
      [3, 5],
      [6, 8],
    ]);
    for (const span of ranges.map(pageSpanFromRange)) {
      expect(parsePageSpansOption([span]).ok).toBe(true);
    }
  });
});

describe("the result sanitizer's chosen-pages bound gives the parser's verdict", () => {
  // The sanitizer bounds against the document; at MAX_PAGE_NUMBER pages the
  // two bounds coincide, so any disagreement is a grammar difference.
  const kept = (pagesSent: unknown) =>
    buildAiResultMeta({
      truncation: {
        truncated: false,
        charactersSent: 10,
        charactersTotal: 10,
        totalPages: MAX_PAGE_NUMBER,
        lastCompletePage: MAX_PAGE_NUMBER,
        cutMidPage: false,
        pagesSent: pagesSent as PageSpan[],
      },
    }).truncation.pagesSent;

  it.each(CORPUS)("%s", (_name, value, expected) => {
    // above-max is the one row the document bound decides, not the grammar.
    const verdict = kept(value) !== undefined;
    expect(verdict).toBe(expected === "accepted");
    if (verdict) expect(kept(value)).toEqual(value);
  });
});
