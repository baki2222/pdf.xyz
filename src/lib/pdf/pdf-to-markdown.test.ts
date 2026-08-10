import { describe, expect, it } from "vitest";
import {
  extractedTextToMarkdown,
  markdownOutputName,
  normalizeMarkdownLine,
  type PdfToMarkdownInput,
} from "./pdf-to-markdown";

function extracted(
  overrides: Partial<PdfToMarkdownInput> = {},
): PdfToMarkdownInput {
  return {
    pageCount: 2,
    hasText: true,
    pages: [
      {
        pageNumber: 1,
        text: "Title\n\nFirst paragraph wraps\nacross lines.\n\n- existing bullet",
        characterCount: 63,
      },
      { pageNumber: 2, text: "Second page\n1. numbered", characterCount: 23 },
    ],
    text: "",
    characterCount: 86,
    ...overrides,
  };
}

describe("pdf-to-markdown", () => {
  it("escapes Markdown-sensitive leading characters without destroying text", () => {
    expect(normalizeMarkdownLine("# not a heading")).toBe("\\# not a heading");
    expect(normalizeMarkdownLine("plain **bold** text")).toBe(
      "plain **bold** text",
    );
    expect(normalizeMarkdownLine("   spaced   ")).toBe("spaced");
  });

  it("converts extracted page text into clean, page-separated Markdown", () => {
    const result = extractedTextToMarkdown(extracted(), {
      sourceName: "sample.pdf",
    });
    expect(result.hasMarkdown).toBe(true);
    expect(result.pageCount).toBe(2);
    expect(result.characterCount).toBeGreaterThan(50);
    expect(result.markdown).toContain("# sample");
    expect(result.markdown).toContain("## Page 1");
    expect(result.markdown).toContain("First paragraph wraps across lines.");
    expect(result.markdown).toContain("- existing bullet");
    expect(result.markdown).toContain("## Page 2");
    expect(result.markdown).toContain("1. numbered");
  });

  it("does not fabricate Markdown for image-only/scanned PDFs", () => {
    const result = extractedTextToMarkdown(
      extracted({
        hasText: false,
        pages: [{ pageNumber: 1, text: "", characterCount: 0 }],
      }),
    );
    expect(result.hasMarkdown).toBe(false);
    expect(result.markdown).toBe("");
    expect(result.characterCount).toBe(0);
  });

  it("names Markdown downloads from source PDFs", () => {
    expect(markdownOutputName("report.final.pdf")).toBe(
      "report.final-markdown.md",
    );
  });
});
