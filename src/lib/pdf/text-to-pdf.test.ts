import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  layoutPlainText,
  textPdfOutputName,
  textToPdf,
  validatePlainTextInput,
  wrapTextLine,
} from "./text-to-pdf";

describe("text-to-pdf", () => {
  it("rejects empty text", () => {
    expect(() => validatePlainTextInput("   \n\t  ")).toThrow(/Add some text/);
  });

  it("wraps long lines", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    const lines = wrapTextLine("alpha beta gamma delta", font, 60, 11);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toContain("alpha");
  });

  it("paginates plain text", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    const layout = layoutPlainText(
      Array.from({ length: 90 }, (_, i) => `Line ${i + 1}`).join("\n"),
      font,
    );
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.lineCount).toBe(90);
  });

  it("creates a readable PDF", async () => {
    const bytes = await textToPdf("Hello pdf.xyz\nThis is a text file.", {
      title: "notes.txt",
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("names PDF downloads from source text files", () => {
    expect(textPdfOutputName("notes.txt")).toBe("notes-pdf.pdf");
  });
});
