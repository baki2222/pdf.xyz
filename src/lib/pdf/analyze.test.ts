import { describe, expect, it } from "vitest";
import { PDFDocument, PDFRawStream } from "pdf-lib";
import {
  IMAGE_HEAVY_SHARE,
  LOSSLESS_MIN_RATIO,
  analyzePdf,
  optimizeLossless,
  summarizeAnalysis,
  type PdfAnalysis,
} from "./analyze";

async function makeTextPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
  return doc.save();
}

/** A PDF carrying a registered image XObject of a known byte length. */
async function makeImagePdf(imageBytes: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const stream = PDFRawStream.of(
    doc.context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: 1,
      Height: 1,
      BitsPerComponent: 8,
      ColorSpace: "DeviceRGB",
      Filter: "DCTDecode",
    }),
    new Uint8Array(imageBytes).fill(200),
  );
  doc.context.register(stream);
  return doc.save();
}

const analysis = (over: Partial<PdfAnalysis>): PdfAnalysis => ({
  pageCount: 1,
  originalBytes: 1000,
  imageCount: 0,
  imageBytes: 0,
  optimizedBytes: 1000,
  ...over,
});

describe("analyzePdf", () => {
  it("reports page count, byte size, and no images for a text PDF", async () => {
    const bytes = await makeTextPdf(3);
    const { analysis, optimized } = await analyzePdf(bytes);
    expect(analysis.pageCount).toBe(3);
    expect(analysis.originalBytes).toBe(bytes.byteLength);
    expect(analysis.imageCount).toBe(0);
    expect(analysis.imageBytes).toBe(0);
    expect(analysis.optimizedBytes).toBe(optimized.byteLength);
    expect(optimized.byteLength).toBeGreaterThan(0);
  });

  it("detects image XObjects and sums their byte length", async () => {
    const { analysis } = await analyzePdf(await makeImagePdf(4096));
    expect(analysis.imageCount).toBe(1);
    expect(analysis.imageBytes).toBe(4096);
  });

  it("rejects non-PDF bytes with a friendly error", async () => {
    await expect(analyzePdf(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

describe("optimizeLossless", () => {
  it("produces a valid PDF that preserves the page count", async () => {
    const optimized = await optimizeLossless(await makeTextPdf(5));
    const reloaded = await PDFDocument.load(optimized);
    expect(reloaded.getPageCount()).toBe(5);
  });
});

describe("summarizeAnalysis", () => {
  it("recommends the lossless download when the repack trims enough", () => {
    const summary = summarizeAnalysis(
      analysis({ originalBytes: 1000, optimizedBytes: 900 }),
    );
    expect(summary.savedBytes).toBe(100);
    expect(summary.savedRatio).toBeCloseTo(0.1);
    expect(summary.savedRatio).toBeGreaterThanOrEqual(LOSSLESS_MIN_RATIO);
    expect(summary.recommendation).toBe("lossless-helps");
  });

  it("recommends the worker for image-heavy files with little to repack", () => {
    const summary = summarizeAnalysis(
      analysis({ originalBytes: 1000, optimizedBytes: 995, imageBytes: 600 }),
    );
    expect(summary.imageShare).toBeGreaterThanOrEqual(IMAGE_HEAVY_SHARE);
    expect(summary.recommendation).toBe("needs-worker");
  });

  it("reports already-lean when nothing meaningful can be done", () => {
    const summary = summarizeAnalysis(
      analysis({ originalBytes: 1000, optimizedBytes: 1000, imageBytes: 100 }),
    );
    expect(summary.savedBytes).toBe(0);
    expect(summary.recommendation).toBe("already-lean");
  });

  it("clamps image share to 1 and never reports negative savings", () => {
    const summary = summarizeAnalysis(
      analysis({ originalBytes: 1000, optimizedBytes: 1200, imageBytes: 5000 }),
    );
    expect(summary.imageShare).toBe(1);
    expect(summary.savedBytes).toBe(0);
    expect(summary.savedRatio).toBe(0);
  });

  it("handles a zero-byte original without dividing by zero", () => {
    const summary = summarizeAnalysis(
      analysis({ originalBytes: 0, optimizedBytes: 0, imageBytes: 0 }),
    );
    expect(summary.imageShare).toBe(0);
    expect(summary.savedRatio).toBe(0);
    expect(summary.recommendation).toBe("already-lean");
  });
});
