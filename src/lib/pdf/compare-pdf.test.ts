import { describe, expect, it } from "vitest";
import {
  compareExtractedPdfText,
  compareOutputName,
  diffLines,
  type ComparablePdfText,
} from "./compare-pdf";

function doc(name: string, text: string, pageCount = 1): ComparablePdfText {
  return {
    name,
    size: new TextEncoder().encode(text).byteLength,
    extracted: {
      pageCount,
      pages: [{ pageNumber: 1, text, characterCount: text.length }],
      text,
      characterCount: text.length,
      hasText: text.trim().length > 0,
    },
  };
}

describe("compare-pdf", () => {
  it("computes added/removed/common line diffs", () => {
    expect(diffLines("A\nB\nC", "A\nB2\nC\nD")).toEqual([
      { kind: "same", text: "A" },
      { kind: "removed", text: "B" },
      { kind: "added", text: "B2" },
      { kind: "same", text: "C" },
      { kind: "added", text: "D" },
    ]);
  });

  it("summarizes identical selectable text", () => {
    const result = compareExtractedPdfText(
      doc("old.pdf", "Same\nText"),
      doc("new.pdf", "Same\nText"),
    );
    expect(result.identicalText).toBe(true);
    expect(result.summary.changedLines).toBe(0);
    expect(result.summary.addedLines).toBe(0);
    expect(result.summary.removedLines).toBe(0);
  });

  it("summarizes page, size, and text differences", () => {
    const result = compareExtractedPdfText(
      doc("old.pdf", "A\nB\nC", 1),
      doc("new.pdf", "A\nB2\nC\nD", 2),
    );
    expect(result.identicalText).toBe(false);
    expect(result.pageDelta).toBe(1);
    expect(result.sizeDelta).toBeGreaterThan(0);
    expect(result.summary.addedLines).toBe(2);
    expect(result.summary.removedLines).toBe(1);
    expect(result.summary.changedLines).toBe(3);
  });

  it("stays honest when neither PDF has selectable text", () => {
    const result = compareExtractedPdfText(
      doc("scan-a.pdf", ""),
      doc("scan-b.pdf", ""),
    );
    expect(result.hasComparableText).toBe(false);
    expect(result.identicalText).toBe(false);
    expect(result.summary.changedLines).toBe(0);
  });

  it("names comparison report downloads", () => {
    expect(compareOutputName("draft.pdf", "final.pdf")).toBe(
      "draft-vs-final-comparison.txt",
    );
  });
});
