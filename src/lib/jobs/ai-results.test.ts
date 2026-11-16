// @vitest-environment node
/**
 * `buildAiResultMeta` is the writer the WORKER IMAGE runs on every completed
 * AI job (`queue/redis.ts` complete → `sanitizeJobResults`), and the browser
 * reads its output raw. A field it does not rebuild never reaches a reader,
 * and a field it rebuilds without bounding is a sentence the panel prints
 * about a page nobody sent. These cases pin the relevance window (chat page
 * retrieval, slice 3): what survives, what is clamped, and that a dropped
 * page list degrades to the page-free sentence rather than a false range.
 *
 * The whole and prefix windows are held elsewhere, unchanged:
 * `results.test.ts` and `partial-delivery.chain.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { userTruncationNotice } from "@/lib/workers/ai/truncation";
import { buildAiResultMeta, type AiWindowMeta } from "./ai-results";

const RELEVANCE: AiWindowMeta = {
  truncated: true,
  charactersSent: 2_900,
  charactersTotal: 40_000,
  totalPages: 70,
  lastCompletePage: null,
  cutMidPage: false,
  selection: "relevance",
  pagesSent: [
    [1, 3],
    [60, 60],
  ],
  pagesRead: 4,
};

function rebuilt(window: unknown): AiWindowMeta {
  return buildAiResultMeta({ truncation: window as AiWindowMeta }).truncation;
}

describe("a relevance window survives the writer", () => {
  it("keeps selection, spans and pagesRead on a well-formed window", () => {
    expect(rebuilt(RELEVANCE)).toEqual(RELEVANCE);
  });

  it("forces lastCompletePage to null under a selection", () => {
    expect(
      rebuilt({ ...RELEVANCE, lastCompletePage: 3 }).lastCompletePage,
    ).toBe(null);
  });

  it("drops selection, spans and pagesRead when the window is not truncated", () => {
    const out = rebuilt({ ...RELEVANCE, truncated: false });
    expect(out).toEqual({
      truncated: false,
      charactersSent: 40_000,
      charactersTotal: 40_000,
      totalPages: 70,
      lastCompletePage: 70,
      cutMidPage: false,
    });
  });

  // INVERTED 2026-11-16 (Summarize page ranges). Until then this read "drops
  // spans and pagesRead with no selection": `pagesSent` existed only beside
  // `selection: "relevance"`. Summarize's chosen pages now write `pagesSent`
  // WITHOUT `selection`, so a window without it keeps a CANONICAL page list
  // (as the pages a person chose) and still drops `pagesRead`. A
  // non-canonical list (chat's merge-me shapes) is dropped whole, so the
  // window is the six fields again — the half of the old pin that still holds.
  it("with no selection, keeps a canonical page list as the chosen pages and drops pagesRead", () => {
    const { selection: _s, ...prefix } = RELEVANCE;
    const out = rebuilt({ ...prefix, lastCompletePage: 3 });
    expect(out.pagesSent).toEqual(RELEVANCE.pagesSent);
    expect(out.pagesRead).toBeUndefined();
    expect(out.selection).toBeUndefined();
  });

  it("with no selection, a non-canonical page list is dropped and the window stays six fields", () => {
    const { selection: _s, ...prefix } = RELEVANCE;
    expect(
      Object.keys(
        rebuilt({
          ...prefix,
          lastCompletePage: 3,
          pagesSent: [
            [1, 3],
            [4, 4],
          ],
        }),
      ).sort(),
    ).toEqual([
      "charactersSent",
      "charactersTotal",
      "cutMidPage",
      "lastCompletePage",
      "totalPages",
      "truncated",
    ]);
  });

  it("ignores a selection value outside the closed vocabulary", () => {
    expect(rebuilt({ ...RELEVANCE, selection: "semantic" }).selection).toBe(
      undefined,
    );
  });
});

describe("spans are re-bounded", () => {
  const spansOf = (pagesSent: unknown, totalPages = 70) =>
    rebuilt({ ...RELEVANCE, totalPages, pagesSent }).pagesSent;

  it("sorts, merges overlapping and adjacent spans", () => {
    expect(
      spansOf([
        [60, 61],
        [1, 3],
        [2, 5],
        [6, 6],
        [62, 62],
      ]),
    ).toEqual([
      [1, 6],
      [60, 62],
    ]);
  });

  it("clamps a span reaching past the document to its last page", () => {
    expect(
      spansOf([
        [1, 2],
        [69, 90],
      ]),
    ).toEqual([
      [1, 2],
      [69, 70],
    ]);
  });

  it("drops every span when one lies wholly outside the document", () => {
    expect(
      spansOf([
        [1, 2],
        [80, 90],
      ]),
    ).toBeUndefined();
    expect(spansOf([[0, 0]])).toBeUndefined();
  });

  it("drops every span when one is not a pair of integers", () => {
    for (const bad of [
      [[1, 2.5]],
      [[3, 1]],
      [["1", "2"]],
      [[1]],
      [null],
      "1-3",
      [],
    ])
      expect(spansOf(bad), JSON.stringify(bad)).toBeUndefined();
  });

  it("drops every span past 64 (after merging), keeping the selection", () => {
    const many = Array.from({ length: 65 }, (_, i) => [2 * i + 1, 2 * i + 1]);
    const out = rebuilt({ ...RELEVANCE, totalPages: 200, pagesSent: many });
    expect(out.pagesSent).toBeUndefined();
    expect(out.selection).toBe("relevance");
    const sixtyFour = many.slice(0, 64);
    expect(
      rebuilt({ ...RELEVANCE, totalPages: 200, pagesSent: sixtyFour })
        .pagesSent,
    ).toHaveLength(64);
  });

  it("clamps pagesRead to the pages the spans cover and to the document", () => {
    expect(rebuilt({ ...RELEVANCE, pagesRead: 500 }).pagesRead).toBe(4);
    expect(rebuilt({ ...RELEVANCE, pagesRead: 2 }).pagesRead).toBe(2);
    expect(
      rebuilt({ ...RELEVANCE, pagesSent: "junk", pagesRead: 500 }).pagesRead,
    ).toBe(70);
  });
});

describe("what the reader gets after the writer", () => {
  it("names the pages when the spans survive", () => {
    const sentence = userTruncationNotice(rebuilt(RELEVANCE));
    expect(sentence).toContain("pages 1–3, 60");
  });

  it("renders the page-free sentence when the spans were dropped, never a range", () => {
    const sentence = userTruncationNotice(
      rebuilt({
        ...RELEVANCE,
        pagesSent: [
          [1, 3],
          [80, 90],
        ],
      }),
    );
    expect(sentence).toBe(
      "This document is longer than one question can read, so only some of its 70 pages were read.",
    );
    expect(sentence).not.toMatch(/pages 1–|first part/);
  });
});
