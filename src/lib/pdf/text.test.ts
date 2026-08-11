import { describe, expect, it } from "vitest";
import {
  joinPageTexts,
  normalizeExtractedText,
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
