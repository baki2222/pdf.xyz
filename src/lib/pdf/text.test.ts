import { describe, expect, it } from "vitest";
import {
  joinPageTexts,
  normalizeExtractedText,
  pagesWithoutText,
  pageTextChunks,
  textItemsToLines,
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

  it("takes a line's geometry from its first VISIBLE item, not pdfjs's EOL filler", () => {
    // pdfjs 6.1.200 measured on a pdf-lib PDF: after a 22pt title at y=740
    // `appendEOL` pushed {str:"", hasEOL:true, height:0} carrying the NEXT
    // line's transform (15pt, y=704). Reading geometry from it would put
    // every line one line too low and give the title the heading's size.
    const lines = textItemsToLines([
      {
        str: "Title",
        hasEOL: false,
        height: 22,
        transform: [22, 0, 0, 22, 72, 740],
      },
      { str: "", hasEOL: true, height: 0, transform: [15, 0, 0, 15, 72, 704] },
      {
        str: " ",
        hasEOL: false,
        height: 0,
        transform: [15, 0, 0, 15, 60, 704],
      },
      {
        str: "Heading",
        hasEOL: true,
        height: 0,
        transform: [0, 15, -15, 0, 72, 704],
      },
      {
        str: "   ",
        hasEOL: true,
        height: 11,
        transform: [11, 0, 0, 11, 72, 690],
      },
    ]);
    expect(lines.map(({ text, x, y, size }) => ({ text, x, y, size }))).toEqual(
      [
        { text: "Title", x: 72, y: 740, size: 22 },
        // The leading space is text but not geometry; the height of 0 falls
        // back to the transform's scale, which rotation does not change.
        { text: " Heading", x: 72, y: 704, size: 15 },
        { text: "   ", x: null, y: null, size: null },
      ],
    );
  });

  it("splits lines exactly where textItemsToPlainText breaks them", () => {
    const corpus = [
      [{ str: "a", hasEOL: true }, { str: "b" }],
      [
        { str: "one\ntwo", hasEOL: false },
        { str: " three", hasEOL: true },
      ],
      [{ str: "crlf\r\nline" }, { str: "", hasEOL: true }, { str: "end  " }],
      [
        { str: "x", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "y" },
      ],
      [{ str: 42 }, { str: "only text counts" }],
    ];
    for (const items of corpus) {
      const joined = textItemsToLines(items)
        .map((line) => line.text)
        .join("\n");
      expect(textItemsToPlainText([{ str: joined }])).toBe(
        textItemsToPlainText(items),
      );
    }
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
