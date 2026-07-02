import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countPdfPages } from "./page-count";

/** Build a valid, minimal PDF with `pages` blank pages. */
async function pdfBytes(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

describe("countPdfPages", () => {
  it("counts the pages of a valid PDF", async () => {
    expect(await countPdfPages(await pdfBytes(1))).toBe(1);
    expect(await countPdfPages(await pdfBytes(5))).toBe(5);
  });

  it("returns null for empty, truncated, or non-PDF bytes (never throws)", async () => {
    expect(await countPdfPages(new Uint8Array())).toBeNull();
    expect(await countPdfPages(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(await countPdfPages(new TextEncoder().encode("%PDF-1.7 not really"))).toBeNull();
  });
});
