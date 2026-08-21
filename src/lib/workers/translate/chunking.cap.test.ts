// @vitest-environment node
/**
 * Conservation survives the cap — proven over generated documents, not examples.
 *
 * `planTranslateChunks` already guarantees that every page lands in exactly one
 * chunk or is named oversize. The cap adds a third destination (withheld) and a
 * cut point, which is exactly the kind of change that turns "every page is
 * accounted for" into "every page is accounted for, except the ones on the
 * boundary". A page lost that way produces no error: a shorter translation that
 * reads perfectly.
 *
 * The bound REPORTED is checked too, and separately. `boundBy` is the only
 * record anywhere of which of the two limits actually binds in practice — there
 * is no telemetry — and a bound that is merely plausible is worse than none,
 * because the artifact states it to the reader as fact.
 */
import { describe, expect, it } from "vitest";
import { capPagesToDelivery, planTranslateChunks } from "./chunking";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function pagesOf(sizes: number[]): { pageNumber: number; text: string }[] {
  // Non-contiguous page numbers on purpose: `pageTextChunks` drops empty pages,
  // so the third block really can be page 5, and a cap that assumed index + 1
  // would withhold a page the reader could go and find was present.
  return sizes.map((size, i) => ({
    pageNumber: i * 2 + 1,
    text: "x".repeat(size),
  }));
}

describe("capPagesToDelivery — conservation", () => {
  it("accounts for every page exactly once across 500 generated documents", () => {
    const random = lcg(20260821);
    let sawCharacterCut = false;
    let sawPageCut = false;
    let sawNoCut = false;
    let sawOversizeInsideCut = false;

    for (let run = 0; run < 500; run += 1) {
      const ceiling = 50 + Math.floor(random() * 500);
      const count = Math.floor(random() * 20);
      const sizes = Array.from({ length: count }, () =>
        // Straddles the ceiling so some pages cannot fit in one call at all.
        Math.max(1, Math.floor(random() * ceiling * 1.6)),
      );
      const input = pagesOf(sizes);
      const limit = {
        characters: Math.floor(random() * ceiling * 12) + 1,
        ...(random() < 0.5
          ? { pages: Math.max(1, Math.floor(random() * 12)) }
          : {}),
      };
      const capped = capPagesToDelivery(input, ceiling, limit);

      const placed = [
        ...capped.plan.chunks.flatMap((c) => c.pages),
        ...capped.plan.oversize.map((o) => o.pageNumber),
        ...capped.withheldPages,
      ].sort((a, b) => a - b);

      expect(
        placed,
        `run ${run} (ceiling ${ceiling}, limit ${JSON.stringify(limit)}, sizes ${sizes.join()}) lost or duplicated a page`,
      ).toEqual(input.map((p) => p.pageNumber));

      // The withheld tail is contiguous and last: a cap that scattered its gaps
      // through the document would still conserve pages and would still be wrong.
      const firstWithheld = capped.withheldPages[0];
      if (firstWithheld !== undefined) {
        for (const chunk of capped.plan.chunks) {
          for (const page of chunk.pages) {
            expect(
              page,
              `run ${run} translated page ${page} after withholding from ${firstWithheld}`,
            ).toBeLessThan(firstWithheld);
          }
        }
      }

      // What was actually SENT never exceeds the character bound.
      const sent = capped.plan.chunks.reduce((n, c) => n + c.characters, 0);
      if (Number.isFinite(limit.characters)) {
        expect(
          sent,
          `run ${run} sent ${sent} characters against a bound of ${limit.characters}`,
        ).toBeLessThanOrEqual(
          // Chunks are joined with PAGE_JOIN, which the walk does not count.
          // Two characters per page boundary, and no more — see the docblock.
          limit.characters + 2 * Math.max(0, sizes.length - 1),
        );
      }
      if (limit.pages !== undefined) {
        const delivered = capped.plan.chunks.reduce(
          (n, c) => n + c.pages.length,
          0,
        );
        expect(
          delivered,
          `run ${run} translated ${delivered} pages against a bound of ${limit.pages}`,
        ).toBeLessThanOrEqual(limit.pages);
      }

      if (capped.boundBy === "characters") sawCharacterCut = true;
      if (capped.boundBy === "pages") sawPageCut = true;
      if (capped.boundBy === null) sawNoCut = true;
      if (capped.plan.oversize.length > 0) sawOversizeInsideCut = true;
    }

    // HEALTH CHECKS. Without these the loop reports the strongest possible pass
    // over a corpus that never produced a cut at all — the vacuous-truth shape
    // this codebase has been bitten by more than once.
    expect(sawCharacterCut, "no character-bound cut was generated").toBe(true);
    expect(sawPageCut, "no page-bound cut was generated").toBe(true);
    expect(sawNoCut, "no uncut document was generated").toBe(true);
    expect(
      sawOversizeInsideCut,
      "no oversize page ever landed inside the delivered range",
    ).toBe(true);
  });

  it("reports the bound that actually stopped it, not a plausible one", () => {
    const pages = pagesOf([100, 100, 100, 100]);

    // Characters bind: three pages fit in 350, the fourth does not.
    const byChars = capPagesToDelivery(pages, 500, { characters: 350 });
    expect(byChars.boundBy).toBe("characters");
    expect(byChars.withheldPages).toEqual([7]);

    // Pages bind: characters are ample, the declared page count is not.
    const byPages = capPagesToDelivery(pages, 500, {
      characters: 1_000_000,
      pages: 2,
    });
    expect(byPages.boundBy).toBe("pages");
    expect(byPages.withheldPages).toEqual([5, 7]);

    // BOTH would bind on the same page. The character bound is named, because
    // it is the one tied to spend and the one resting on a chosen constant.
    const both = capPagesToDelivery(pages, 500, { characters: 250, pages: 2 });
    expect(both.boundBy).toBe("characters");

    // Neither binds.
    const neither = capPagesToDelivery(pages, 500, {
      characters: 1_000_000,
      pages: 99,
    });
    expect(neither.boundBy).toBeNull();
    expect(neither.withheldPages).toEqual([]);
  });

  it("does not charge an oversize page against either bound", () => {
    // Page 3 (2,000 characters) can never be sent — it exceeds one call — so
    // spending the reservation on it would withhold pages that COULD have been
    // translated in order to pay for text nobody translated.
    const pages = pagesOf([100, 100, 2_000, 100, 100]);
    const capped = capPagesToDelivery(pages, 500, { characters: 400 });

    expect(capped.boundBy).toBeNull();
    expect(capped.withheldPages).toEqual([]);
    expect(capped.plan.oversize.map((o) => o.pageNumber)).toEqual([5]);
    expect(capped.plan.chunks.flatMap((c) => c.pages)).toEqual([1, 3, 7, 9]);
  });

  it("CONTROL: an unbounded limit is exactly the uncapped planner", () => {
    // This is the path every job queued before the cap existed runs on, and it
    // must be the same code producing the same plan — not a branch that skips
    // the walk, which would leave the common path untested by every cap test.
    const random = lcg(4242);
    for (let run = 0; run < 100; run += 1) {
      const ceiling = 60 + Math.floor(random() * 400);
      const sizes = Array.from({ length: Math.floor(random() * 15) }, () =>
        Math.max(1, Math.floor(random() * ceiling * 1.5)),
      );
      const input = pagesOf(sizes);
      const capped = capPagesToDelivery(input, ceiling, {
        characters: Number.POSITIVE_INFINITY,
      });
      expect(capped.boundBy).toBeNull();
      expect(capped.withheldPages).toEqual([]);
      expect(capped.plan).toEqual(planTranslateChunks(input, ceiling));
    }
  });
});
