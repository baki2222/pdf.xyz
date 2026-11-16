// @vitest-environment node
/**
 * `selectExtraction` is GENERIC over the page type (competitor audit #29,
 * slice 6): Translate's worker rebinds its extraction to the selection, and
 * its pages carry the reading-order gate's input (`ReadingOrderPage.send`)
 * beside their text. The selection must hand the SAME page objects back,
 * typed as they came in, so no later line needs a cast to read `send`.
 *
 * The type half is checked by `tsc` (this file is in the project): if
 * `selectExtraction` stopped being generic, `selected.pages[0]!.send` below
 * would not compile. `page-selection.test.ts` is unchanged by the generic
 * and remains the proof that nothing moved at runtime.
 */
import { describe, expect, it } from "vitest";
import type { ReadingOrderPage } from "@/lib/workers/translate/reading-order";
import { selectExtraction } from "./page-selection";
import { joinPageTexts } from "./text";

const PAGES: ReadingOrderPage[] = [
  { pageNumber: 1, text: "", characterCount: 0 },
  { pageNumber: 2, text: "Birch two", characterCount: 9, send: "Birch two" },
  { pageNumber: 3, text: "Cedar three", characterCount: 11 },
  { pageNumber: 4, text: "Dogwood four", characterCount: 12, send: "flow 4" },
];

const EXTRACTED = {
  pageCount: 4,
  pages: PAGES,
  text: joinPageTexts(PAGES),
  characterCount: joinPageTexts(PAGES).length,
  hasText: true,
  readingOrder: { source: "flow" as const },
};

describe("selectExtraction keeps a richer page type", () => {
  it("returns the chosen page OBJECTS, `send` included, typed without a cast", () => {
    const selected = selectExtraction(EXTRACTED, [
      [2, 2],
      [4, 4],
    ]);
    const send: string | undefined = selected.pages[0]!.send;
    expect(send).toBe("Birch two");
    expect(selected.pages[1]!.send).toBe("flow 4");
    expect(selected.pages[0]).toBe(PAGES[1]);
    expect(selected.pages[1]).toBe(PAGES[3]);
    expect(selected.pages.map((p) => p.pageNumber)).toEqual([2, 4]);
    expect(selected.pageCount).toBe(4);
    expect(selected.text).toBe(joinPageTexts([PAGES[1]!, PAGES[3]!]));
  });

  it("spread over the extraction, the caller's other fields survive the rebinding", () => {
    const rebound = { ...EXTRACTED, ...selectExtraction(EXTRACTED, [[3, 3]]) };
    expect(rebound.readingOrder).toEqual({ source: "flow" });
    expect(rebound.pages.map((p) => p.pageNumber)).toEqual([3]);
    expect(rebound.characterCount).toBe("Cedar three".length);
  });
});
