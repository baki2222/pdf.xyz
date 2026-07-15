import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  markdownPdfOutputName,
  markdownToPdf,
  parseMarkdownBlocks,
  validateMarkdownInput,
} from "./markdown-to-pdf";

describe("markdown-to-pdf", () => {
  it("rejects empty markdown", () => {
    expect(() => validateMarkdownInput("  \n\t  ")).toThrow(/Add some Markdown/);
  });

  it("parses headings, bullets, ordered items, blockquotes, code fences, and paragraphs", () => {
    const blocks = parseMarkdownBlocks(`# Title\n\nIntro **bold** text.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n\`\`\`ts\nconst x = 1;\n\`\`\``);
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list-item",
      "list-item",
      "list-item",
      "list-item",
      "quote",
      "code",
    ]);
    expect(blocks[0]).toMatchObject({ kind: "heading", depth: 1, text: "Title" });
    expect(blocks[2]).toMatchObject({ kind: "list-item", ordered: false, text: "one" });
    expect(blocks[4]).toMatchObject({ kind: "list-item", ordered: true, index: 1, text: "first" });
    expect(blocks[7]).toMatchObject({ kind: "code", language: "ts" });
  });

  it("strips common inline markdown marks to readable PDF text", () => {
    const blocks = parseMarkdownBlocks("**Bold** and _em_ with [link](https://example.com) and `code`");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "paragraph",
      text: "Bold and em with link (https://example.com) and code",
    });
  });

  it("creates a valid PDF with document metadata", async () => {
    const bytes = await markdownToPdf("# Release notes\n\n- Repair PDF\n- Optimize for Web", { title: "notes.md" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("notes.md");
    expect(doc.getCreator()).toBe("pdf.xyz");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("names PDF downloads from source Markdown files", () => {
    expect(markdownPdfOutputName("README.md")).toBe("README-pdf.pdf");
    expect(markdownPdfOutputName("notes.markdown")).toBe("notes-pdf.pdf");
  });
});
