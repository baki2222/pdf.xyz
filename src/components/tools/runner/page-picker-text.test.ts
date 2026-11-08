import { describe, expect, it } from "vitest";
import { parsePageList, parseRanges } from "@/lib/pdf/ranges";
import {
  cutsInRanges,
  pageListText,
  pagesInText,
  partsOfEachPage,
  rangesTextFromCuts,
} from "./page-picker-text";

/**
 * The picker writes the typed box, so every text it writes must parse back
 * to the pages it was given — through the parsers the runners use.
 */
describe("page picker text", () => {
  it("a page set round-trips through parsePageList, runs compressed", () => {
    const sets = [[0], [0, 1, 2, 4], [1, 3, 5], [6, 7, 8, 9]];
    for (const set of sets) {
      const text = pageListText(set);
      expect(text).not.toContain("–");
      expect(parsePageList(text, 10)).toEqual(set);
    }
    expect(pageListText([4, 0, 1, 2])).toBe("1-3, 5");
  });

  it("a set of cuts round-trips through parseRanges and covers every page", () => {
    for (const cuts of [[], [0], [2], [0, 2, 3], [8]]) {
      const text = rangesTextFromCuts(cuts, 10);
      const ranges = parseRanges(text, 10);
      expect(ranges[0]!.start).toBe(0);
      expect(ranges[ranges.length - 1]!.end).toBe(9);
      ranges
        .slice(1)
        .forEach((r, i) => expect(r.start).toBe(ranges[i]!.end + 1));
      expect([...cutsInRanges(text, 10)].sort((a, b) => a - b)).toEqual(cuts);
    }
    expect(rangesTextFromCuts([0, 2], 5)).toBe("1, 2-3, 4-5");
  });

  it("an unparsable box draws nothing rather than a guess", () => {
    expect(pagesInText("1-", 0).size).toBe(0);
    expect(pagesInText("9", 3).size).toBe(0);
    expect(cutsInRanges("3-1", 5).size).toBe(0);
    expect(partsOfEachPage("abc", 3)).toEqual([[], [], []]);
    // Positive control: the same helpers do see a valid box.
    expect([...pagesInText("2-3", 3)]).toEqual([1, 2]);
  });

  // Was "each page names the first file that holds it" (7d46f446): a page in
  // two overlapping ranges then showed one file while landing in two, against
  // the note "the badge on each page is the file it lands in". Inverted.
  it("each page names every file that holds it; a gap names none", () => {
    expect(partsOfEachPage("1-2, 4", 5)).toEqual([[1], [1], [], [2], []]);
    expect(partsOfEachPage("1-3, 2-4", 5)).toEqual([
      [1],
      [1, 2],
      [1, 2],
      [2],
      [],
    ]);
    // The same range typed twice is two files, both holding the page.
    expect(partsOfEachPage("2, 2", 3)).toEqual([[], [1, 2], []]);
    expect(cutsInRanges("1-2", 5)).toEqual(new Set([1]));
  });
});
