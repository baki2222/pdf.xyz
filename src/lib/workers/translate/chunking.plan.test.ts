// @vitest-environment node
/**
 * The planner's conservation law, proven exhaustively rather than by example.
 *
 * `planTranslateChunks` is pure, so the property that matters — **every page
 * lands in exactly one chunk or is reported oversize, never both, never
 * neither** — can be checked over hundreds of generated documents instead of
 * the three anyone would think to write by hand. That matters because losing a
 * page is the one failure in this feature that produces no error: a shorter
 * translation that reads perfectly.
 */
import { describe, expect, it } from "vitest";
import { PAGE_JOIN } from "@/lib/pdf/text";
import { planTranslateChunks, missingPageMarker } from "./chunking";

/** A deterministic pseudo-random generator, so a failure is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function pagesOf(sizes: number[]): { pageNumber: number; text: string }[] {
  // Page numbers deliberately non-contiguous: `pageTextChunks` drops empty
  // pages, so the third chunk really can be page 5, and a planner that assumed
  // index + 1 would name a page the reader could check and find wrong.
  return sizes.map((size, i) => ({
    pageNumber: i * 2 + 1,
    text: "x".repeat(size),
  }));
}

describe("planTranslateChunks — conservation", () => {
  it("accounts for every page exactly once, over 400 generated documents", () => {
    const random = lcg(20260821);
    let sawMultiChunk = false;
    let sawOversize = false;
    let sawSingleChunk = false;

    for (let run = 0; run < 400; run += 1) {
      const ceiling = 50 + Math.floor(random() * 500);
      const count = Math.floor(random() * 25);
      const sizes = Array.from({ length: count }, () =>
        // Deliberately straddles the ceiling: some pages cannot fit alone.
        Math.max(1, Math.floor(random() * ceiling * 1.6)),
      );
      const input = pagesOf(sizes);
      const plan = planTranslateChunks(input, ceiling);

      const placed = [
        ...plan.chunks.flatMap((c) => c.pages),
        ...plan.oversize.map((o) => o.pageNumber),
      ].sort((a, b) => a - b);
      const expected = input.map((p) => p.pageNumber);

      expect(
        placed,
        `run ${run} (ceiling ${ceiling}, sizes ${sizes.join()}) lost or duplicated a page`,
      ).toEqual(expected);

      if (plan.chunks.length > 1) sawMultiChunk = true;
      if (plan.chunks.length === 1) sawSingleChunk = true;
      if (plan.oversize.length > 0) sawOversize = true;
    }

    // HEALTH CHECK: the generator must actually have produced all three shapes,
    // or the loop above proved conservation only for the easy one.
    expect(sawSingleChunk, "no single-chunk document was generated").toBe(true);
    expect(sawMultiChunk, "no multi-chunk document was generated").toBe(true);
    expect(sawOversize, "no oversize page was generated").toBe(true);
  });

  it("never exceeds the ceiling, and never splits a page", () => {
    const random = lcg(777);
    for (let run = 0; run < 200; run += 1) {
      const ceiling = 40 + Math.floor(random() * 300);
      const sizes = Array.from({ length: Math.floor(random() * 20) }, () =>
        Math.max(1, Math.floor(random() * ceiling * 1.5)),
      );
      const input = pagesOf(sizes);
      const plan = planTranslateChunks(input, ceiling);
      const byNumber = new Map(input.map((p) => [p.pageNumber, p.text]));

      for (const chunk of plan.chunks) {
        expect(
          chunk.characters,
          `chunk ${chunk.index} is ${chunk.characters} over a ceiling of ${ceiling}`,
        ).toBeLessThanOrEqual(ceiling);
        expect(chunk.text.length).toBe(chunk.characters);
        // Whole pages only: the chunk text is exactly its pages, joined.
        expect(chunk.text).toBe(
          chunk.pages.map((n) => byNumber.get(n)!).join(PAGE_JOIN),
        );
      }
    }
  });

  it("keeps document order across chunks and gaps", () => {
    // 5 fits, 5 fits, 40 is oversize, 5 fits. The oversize page must END the
    // first chunk, not be skipped over, or the gap lands in the wrong place.
    const plan = planTranslateChunks(pagesOf([5, 5, 40, 5]), 20);
    expect(plan.chunks.map((c) => c.pages)).toEqual([[1, 3], [7]]);
    expect(plan.oversize.map((o) => o.pageNumber)).toEqual([5]);
    expect(plan.chunks.map((c) => c.index)).toEqual([0, 1]);
  });

  it("packs to the ceiling but not past it, joins included", () => {
    // Two 9-char pages plus the 2-char join is exactly 20.
    expect(planTranslateChunks(pagesOf([9, 9]), 20).chunks).toHaveLength(1);
    // One more character and the join no longer fits — the separator is part
    // of what is sent, and a planner that forgot it would overrun by exactly
    // PAGE_JOIN per page.
    expect(planTranslateChunks(pagesOf([9, 10]), 20).chunks).toHaveLength(2);
  });

  it("returns an empty plan for an empty document, without inventing a chunk", () => {
    const plan = planTranslateChunks([], 100);
    expect(plan.chunks).toEqual([]);
    expect(plan.oversize).toEqual([]);
    expect(plan.pages).toEqual([]);
  });

  it("reports a document of only oversize pages as entirely undeliverable", () => {
    const plan = planTranslateChunks(pagesOf([500, 600]), 100);
    expect(plan.chunks).toEqual([]);
    expect(plan.oversize.map((o) => o.pageNumber)).toEqual([1, 3]);
  });
});

describe("missingPageMarker", () => {
  it("names the page and says what to do, positioned in the text", () => {
    const marker = missingPageMarker({ pageNumber: 7, characters: 15_400 });
    expect(marker).toContain("Page 7");
    expect(marker).toContain("15,400");
    // It must read as a gap, not as a footnote — the reader meets it where the
    // page was rather than after believing the document was complete.
    expect(marker).toMatch(/not translated/i);
    expect(marker).toMatch(/translate it separately/i);
  });
});
