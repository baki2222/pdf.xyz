import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  addHeaderFooter,
  hasHeaderFooterContent,
  headerFooterOutputName,
  validateHeaderFooter,
} from "./header-footer";

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return doc.save();
}

describe("header-footer", () => {
  it("detects whether any slot carries text", () => {
    expect(hasHeaderFooterContent({})).toBe(false);
    expect(hasHeaderFooterContent({ header: { center: "   " } })).toBe(false);
    expect(hasHeaderFooterContent({ footer: { right: "Page {n}" } })).toBe(true);
  });

  it("rejects an empty configuration", () => {
    expect(() => validateHeaderFooter({})).toThrow(PdfEngineError);
    expect(() => validateHeaderFooter({ header: { left: "" } })).toThrow(
      /header or footer/i,
    );
  });

  it("stamps header and footer while preserving the page count", async () => {
    const input = await blankPdf(3);
    const output = await addHeaderFooter(input, {
      header: { center: "Acme Report" },
      footer: { left: "Confidential", right: "Page {n} of {total}" },
      date: "2026-07-12",
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
    expect(output.byteLength).toBeGreaterThan(input.byteLength);
  });

  it("stamps our creator metadata", async () => {
    const output = await addHeaderFooter(await blankPdf(1), {
      footer: { center: "Printed {date}" },
      date: "2026-07-12",
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("tolerates a slot that resolves to empty after token substitution", async () => {
    // {date} with no date supplied resolves to "" — that slot is simply skipped.
    const output = await addHeaderFooter(await blankPdf(1), {
      header: { center: "Report" },
      footer: { center: "{date}" },
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(1);
  });

  it("names the download from the source", () => {
    expect(headerFooterOutputName("brief.pdf")).toBe("brief-header-footer.pdf");
  });
});
