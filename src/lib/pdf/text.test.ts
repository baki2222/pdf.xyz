import { describe, expect, it } from "vitest";
import {
  joinPageTexts,
  normalizeExtractedText,
  pagesWithoutText,
  pageTextChunks,
  textItemsToPlainText,
  textOutputName,
  type ExtractedTextPage,
} from "./text";

describe("PDF text extraction helpers", () => {
  it("preserves pdfjs item text and explicit line endings", () => {
    expect(
      textItemsToPlainText([
        { str: "Invoice" },
        { str: " #123", hasEOL: true },
        { str: "Total" },
        { str: " $42" },
      ]),
    ).toBe("Invoice #123\nTotal $42");
  });

  it("normalizes CRLF and excessive blank lines", () => {
    expect(normalizeExtractedText("A\r\nB  \n\n\nC\t\t")).toBe("A\nB\n\nC");
  });

  it("joins only non-empty page text with a blank line", () => {
    const pages: Pick<ExtractedTextPage, "text" | "pageNumber">[] = [
      { pageNumber: 1, text: "Page one" },
      { pageNumber: 2, text: "   " },
      { pageNumber: 3, text: "Page three" },
    ];
    expect(joinPageTexts(pages)).toBe("Page one\n\nPage three");
  });

  it("names text downloads from the source PDF", () => {
    expect(textOutputName("report.final.pdf")).toBe("report.final-text.txt");
  });
});

/**
 * The pages the joined text leaves out, named.
 *
 * `joinPageTexts` drops a page whose text normalizes to nothing, and joins the
 * rest with the same blank line as a paragraph break — deliberately, since the
 * worker parse path, the AI page-offset math and translate's cap all read that
 * shape. The defect was that PDF to Text then said "N characters from 40
 * pages" when twelve of them contributed nothing, and nothing in the TXT shows
 * where they were. `pagesWithoutText` is what the runner reports; it is pinned
 * here as the exact complement of what the join keeps, so the two can never
 * disagree about which page is "empty".
 */
describe("pagesWithoutText names exactly the pages the join drops", () => {
  const corpus: Pick<ExtractedTextPage, "text" | "pageNumber">[][] = [
    // Positive control: an empty middle page.
    [
      { pageNumber: 1, text: "Page one" },
      { pageNumber: 2, text: "   " },
      { pageNumber: 3, text: "Page three" },
    ],
    // Whitespace only (built from char codes: an escape typed through a tool
    // layer has turned into the raw byte here before).
    [
      { pageNumber: 1, text: String.fromCharCode(9, 13, 10, 32, 13) },
      { pageNumber: 2, text: "Only text" },
      { pageNumber: 3, text: "" },
      { pageNumber: 4, text: String.fromCharCode(10, 10, 10) },
    ],
    // Every page has text.
    [
      { pageNumber: 1, text: "a" },
      { pageNumber: 2, text: "b" },
    ],
    // No page has text.
    [
      { pageNumber: 1, text: "" },
      { pageNumber: 2, text: " " },
    ],
  ];

  it("positive control: the empty middle page is named", () => {
    expect(pagesWithoutText(corpus[0]!)).toEqual([2]);
  });

  it("is [] when every page has text, and every page when none does", () => {
    expect(pagesWithoutText(corpus[2]!)).toEqual([]);
    expect(pagesWithoutText(corpus[3]!)).toEqual([1, 2]);
  });

  it("partitions the pages with pageTextChunks — disjoint, and together all of them", () => {
    for (const pages of corpus) {
      const kept = pageTextChunks(pages).map((chunk) => chunk.pageNumber);
      const dropped = pagesWithoutText(pages);
      expect(kept.filter((n) => dropped.includes(n))).toEqual([]);
      expect([...kept, ...dropped].sort((a, b) => a - b)).toEqual(
        pages.map((page) => page.pageNumber),
      );
    }
  });
});
