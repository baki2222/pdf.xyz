import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  addPageNumbers,
  DEFAULT_PAGE_NUMBER_FORMAT,
  numberedOutputName,
  previewPageNumber,
  validatePageNumberFormat,
} from "./page-numbers";

/** Build a blank multi-page PDF for exercising the stamp helpers. */
async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return doc.save();
}

describe("page-numbers", () => {
  it("rejects an empty format", () => {
    expect(() => validatePageNumberFormat("   ")).toThrow(PdfEngineError);
    expect(() => validatePageNumberFormat("   ")).toThrow(/format/);
  });

  // Audit #28 (2026-11-06): page numbers pass no date, so applyTokens erased
  // {date} to nothing — "Printed {date} - Page {n}" stamped "Printed  - Page
  // 1" with no warning — and a token from another tool ({p}) printed as is.
  it("refuses a token it cannot fill, naming the ones it can", () => {
    for (const bad of [
      "Printed {date} - Page {n}",
      "Page {p}",
      "{N} of {count}",
      "{date:6}",
    ]) {
      expect(() => validatePageNumberFormat(bad), bad).toThrow(PdfEngineError);
    }
    expect(() => validatePageNumberFormat("Printed {date} {n}")).toThrow(
      /"\{date\}".*\{n\}.*\{total\}/,
    );
    // Positive controls: every token the engine fills, in any case, padded
    // or not, and literal braces that are not a token at all.
    for (const good of [
      "Page {n} of {total}",
      "{PAGE} / {Pages}",
      "{n:6}",
      "{pages:3}",
      "Sheet {n} {1} { } {}",
    ]) {
      expect(() => validatePageNumberFormat(good), good).not.toThrow();
    }
  });

  it("previews the label a page will show", () => {
    expect(previewPageNumber(DEFAULT_PAGE_NUMBER_FORMAT, 2, 5)).toBe(
      "Page 2 of 5",
    );
  });

  it("stamps every page while preserving the page count", async () => {
    const input = await blankPdf(3);
    const output = await addPageNumbers(input, { fontSize: 12 });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
    // stamping adds content, so the file must grow
    expect(output.byteLength).toBeGreaterThan(input.byteLength);
  });

  it("stamps our creator metadata", async () => {
    const output = await addPageNumbers(await blankPdf(1));
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("can start numbering on a later page without changing page count", async () => {
    const input = await blankPdf(4);
    const output = await addPageNumbers(input, { startPage: 2, startAt: 1 });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(4);
  });

  it("supports every corner position", async () => {
    const input = await blankPdf(1);
    for (const position of [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as const) {
      const output = await addPageNumbers(input, { position });
      const doc = await PDFDocument.load(output);
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it("names the download from the source", () => {
    expect(numberedOutputName("report.pdf")).toBe("report-numbered.pdf");
    expect(numberedOutputName("")).toBe("document-numbered.pdf");
  });
});
