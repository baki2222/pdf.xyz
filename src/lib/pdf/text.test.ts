import { describe, expect, it } from "vitest";
import {
  joinPageTexts,
  normalizeExtractedText,
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
