import { describe, expect, it } from "vitest";
import {
  buildSplitParts,
  formatPageNumbers,
  formatRange,
  PageRangeError,
  parsePageList,
  parseRanges,
  rangesEveryN,
  rangesPerPage,
  rangeToIndices,
} from "./ranges";

describe("parsePageList", () => {
  it("parses single pages into 0-based indices", () => {
    expect(parsePageList("1", 5)).toEqual([0]);
    expect(parsePageList("3", 5)).toEqual([2]);
  });

  it("parses ranges and expands them", () => {
    expect(parsePageList("1-3", 5)).toEqual([0, 1, 2]);
  });

  it("parses mixed lists, de-duplicates, and sorts", () => {
    expect(parsePageList("3, 1-2, 3", 5)).toEqual([0, 1, 2]);
  });

  it("supports open-ended ranges (N- and -M)", () => {
    expect(parsePageList("3-", 5)).toEqual([2, 3, 4]);
    expect(parsePageList("-2", 5)).toEqual([0, 1]);
  });

  it("ignores whitespace and newlines between tokens", () => {
    expect(parsePageList(" 1 , 2 \n 4 ", 5)).toEqual([0, 1, 3]);
  });

  it("throws on empty input", () => {
    expect(() => parsePageList("   ", 5)).toThrow(PageRangeError);
  });

  it("throws on non-numeric tokens", () => {
    expect(() => parsePageList("abc", 5)).toThrow(PageRangeError);
    expect(() => parsePageList("1-x", 5)).toThrow(PageRangeError);
  });

  it("throws when a page is out of range", () => {
    expect(() => parsePageList("6", 5)).toThrow(/out of range/);
    expect(() => parsePageList("0", 5)).toThrow(/start at 1/);
  });

  it("throws on backwards ranges", () => {
    expect(() => parsePageList("4-2", 5)).toThrow(/backwards/);
  });
});

describe("parseRanges", () => {
  it("keeps each token as its own inclusive 0-based range", () => {
    expect(parseRanges("1-3, 5", 8)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 4 },
    ]);
  });

  it("throws on empty input", () => {
    expect(() => parseRanges("", 8)).toThrow(PageRangeError);
  });
});

describe("rangesEveryN", () => {
  it("chunks pages into fixed sizes, clamping the last chunk", () => {
    expect(rangesEveryN(7, 3)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 6 },
    ]);
  });

  it("returns one chunk when size exceeds the page count", () => {
    expect(rangesEveryN(3, 10)).toEqual([{ start: 0, end: 2 }]);
  });

  it("throws on a non-positive size", () => {
    expect(() => rangesEveryN(5, 0)).toThrow(PageRangeError);
  });
});

describe("rangesPerPage", () => {
  it("returns one single-page range per page", () => {
    expect(rangesPerPage(3)).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ]);
  });
});

describe("rangeToIndices / formatRange", () => {
  it("expands an inclusive range into indices", () => {
    expect(rangeToIndices({ start: 2, end: 5 })).toEqual([2, 3, 4, 5]);
  });

  it("formats single pages and ranges (1-based)", () => {
    expect(formatRange({ start: 0, end: 0 })).toBe("1");
    expect(formatRange({ start: 2, end: 4 })).toBe("3–5");
  });
});

describe("buildSplitParts", () => {
  it("names parts with zero-padded sequence and page labels", () => {
    const parts = buildSplitParts("report", [
      { start: 0, end: 2 },
      { start: 3, end: 3 },
    ]);
    expect(parts).toEqual([
      { name: "report-1-pages-1-3.pdf", indices: [0, 1, 2] },
      { name: "report-2-page-4.pdf", indices: [3] },
    ]);
  });

  it("zero-pads the sequence when there are 10+ parts", () => {
    const parts = buildSplitParts("doc", rangesPerPage(10));
    expect(parts[0]!.name).toBe("doc-01-page-1.pdf");
    expect(parts[9]!.name).toBe("doc-10-page-10.pdf");
  });

  it("falls back to a default base name when blank", () => {
    const parts = buildSplitParts("  ", [{ start: 0, end: 0 }]);
    expect(parts[0]!.name).toBe("document-1-page-1.pdf");
  });
});

describe("formatPageNumbers", () => {
  it("compresses runs into en-dash ranges", () => {
    expect(formatPageNumbers([2, 7, 8, 9])).toBe("2, 7–9");
    expect(formatPageNumbers([1])).toBe("1");
    expect(formatPageNumbers([3, 4])).toBe("3–4");
    expect(formatPageNumbers([])).toBe("");
  });

  it("sorts and de-duplicates its input", () => {
    expect(formatPageNumbers([9, 2, 8, 7, 8])).toBe("2, 7–9");
  });

  it("round-trips through the parser users type ranges into", () => {
    // The label must name the same pages the reader could type back in.
    const pageCount = 40;
    const sets = [[2], [1, 2, 3], [2, 7, 8, 9], [1, 3, 5, 6, 7, 40], [40]];
    for (const pages of sets) {
      const typed = formatPageNumbers(pages).replace(/–/g, "-");
      expect(parsePageList(typed, pageCount).map((i) => i + 1)).toEqual(pages);
    }
  });
});
