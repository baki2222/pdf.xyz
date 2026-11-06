import { describe, expect, it } from "vitest";
import { assembleExtraction, textItemsToPlainText } from "./text";
import { extractedPagesLabel, extractedTextSummary } from "./text-summary";

/**
 * Audit #50 (pdf-to-text#2, 2026-11-06): the result line counted UTF-16 code
 * units ("43 characters") — every emoji, mathematical alphanumeric (𝐀, 𝑥:
 * pdf.js emits these for many scientific PDFs) or CJK Extension B ideograph
 * counted twice. The audit's own items, through the same assembly
 * extractPdfText uses.
 */
describe("PDF to Text's result line counts characters, not UTF-16 units", () => {
  const MATH_A = String.fromCodePoint(0x1d400);
  const MATH_B = String.fromCodePoint(0x1d401);
  const GRIN = String.fromCodePoint(0x1f600);
  const items = [
    { str: "The quick exam-", hasEOL: true },
    { str: "ple of a para", hasEOL: true },
    { str: `graph ${MATH_A}${MATH_B} ${GRIN}`, hasEOL: false },
  ];

  it("says 40 characters for text holding three astral characters", () => {
    const page = { pageNumber: 1, text: textItemsToPlainText(items) };
    const result = assembleExtraction(1, [
      { ...page, characterCount: page.text.length },
    ]);
    const codePoints = [...result.text].length;
    // Health check: the fixture really has astral characters to miscount.
    expect(result.text.length - codePoints).toBe(3);
    expect(extractedTextSummary(result)).toBe(
      `${codePoints} characters from 1 page`,
    );
  });
});

describe("the pages label is one definition", () => {
  const page = (pageNumber: number, text: string) => ({
    pageNumber,
    text,
    characterCount: text.length,
  });

  it("names the pages that gave text, out of all of them", () => {
    const result = assembleExtraction(3, [
      page(1, "First page text."),
      page(2, ""),
      page(3, "Third page text."),
    ]);
    expect(extractedPagesLabel(result)).toBe("2 of 3 pages");
    expect(extractedTextSummary(result)).toMatch(/ from 2 of 3 pages$/);
  });

  it("CONTROL: every page gave text, so no 'of'", () => {
    const result = assembleExtraction(1, [page(1, "Only page.")]);
    expect(extractedPagesLabel(result)).toBe("1 page");
    expect(extractedTextSummary(result)).toBe("10 characters from 1 page");
  });

  it("no text, no summary", () => {
    const result = assembleExtraction(1, [page(1, "")]);
    expect(result.hasText).toBe(false);
    expect(extractedTextSummary(result)).toBeNull();
  });
});
