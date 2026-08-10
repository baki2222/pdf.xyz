import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  addWatermark,
  validateWatermarkText,
  watermarkedOutputName,
} from "./watermark";

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return doc.save();
}

describe("watermark", () => {
  it("rejects empty watermark text", () => {
    expect(() => validateWatermarkText("   ")).toThrow(PdfEngineError);
    expect(() => validateWatermarkText("")).toThrow(/watermark/i);
  });

  it("stamps every page while preserving the page count", async () => {
    const input = await blankPdf(2);
    const output = await addWatermark(input, "CONFIDENTIAL");
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(2);
    expect(output.byteLength).toBeGreaterThan(input.byteLength);
  });

  it("stamps our creator metadata", async () => {
    const output = await addWatermark(await blankPdf(1), "DRAFT");
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("accepts custom opacity and rotation without throwing", async () => {
    const input = await blankPdf(1);
    const output = await addWatermark(input, "SAMPLE", {
      opacity: 0.35,
      rotation: -30,
      fontSize: 48,
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(1);
  });

  it("names the download from the source", () => {
    expect(watermarkedOutputName("invoice.pdf")).toBe(
      "invoice-watermarked.pdf",
    );
  });
});
