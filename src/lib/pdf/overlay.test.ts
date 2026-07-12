import { PDFDocument, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  clampOpacity,
  fitOverlayRect,
  neededOverlayIndices,
  overlayOutputName,
  overlayPageIndexFor,
  overlayPdf,
} from "./overlay";

/** A base PDF with the given page sizes (points). */
async function basePdf(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc.save();
}

/** An overlay PDF whose pages carry a distinctive filled rectangle. */
async function overlayDoc(pages = 1, size: [number, number] = [200, 100]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage(size);
    page.drawRectangle({ x: 10, y: 10, width: 80, height: 40, color: rgb(0.9, 0.1, 0.1) });
  }
  return doc.save();
}

describe("fitOverlayRect", () => {
  it("fits inside the page preserving aspect ratio, centered", () => {
    const rect = fitOverlayRect({
      overlayWidth: 100,
      overlayHeight: 200,
      pageWidth: 300,
      pageHeight: 300,
      fit: "fit",
    });
    // min(300/100, 300/200) = 1.5 → 150 x 300
    expect(rect).toEqual({ x: 75, y: 0, width: 150, height: 300 });
  });

  it("stretches to exactly cover the page", () => {
    expect(
      fitOverlayRect({
        overlayWidth: 100,
        overlayHeight: 200,
        pageWidth: 300,
        pageHeight: 400,
        fit: "stretch",
      }),
    ).toEqual({ x: 0, y: 0, width: 300, height: 400 });
  });

  it("keeps the overlay's actual size, centered", () => {
    expect(
      fitOverlayRect({
        overlayWidth: 100,
        overlayHeight: 200,
        pageWidth: 300,
        pageHeight: 300,
        fit: "actual",
      }),
    ).toEqual({ x: 100, y: 50, width: 100, height: 200 });
  });

  it("scales small overlays up to fit", () => {
    const rect = fitOverlayRect({
      overlayWidth: 50,
      overlayHeight: 50,
      pageWidth: 200,
      pageHeight: 400,
      fit: "fit",
    });
    expect(rect).toEqual({ x: 0, y: 100, width: 200, height: 200 });
  });

  it("falls back to covering the page for degenerate sizes", () => {
    expect(
      fitOverlayRect({
        overlayWidth: 0,
        overlayHeight: 100,
        pageWidth: 300,
        pageHeight: 300,
        fit: "fit",
      }),
    ).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });
});

describe("overlayPageIndexFor", () => {
  it("always uses the first overlay page when repeating", () => {
    expect(overlayPageIndexFor(0, 3, "repeat")).toBe(0);
    expect(overlayPageIndexFor(5, 3, "repeat")).toBe(0);
  });

  it("cycles overlay pages in order, wrapping around", () => {
    const seq = [0, 1, 2, 3, 4].map((i) => overlayPageIndexFor(i, 2, "cycle"));
    expect(seq).toEqual([0, 1, 0, 1, 0]);
  });

  it("returns -1 when there are no overlay pages", () => {
    expect(overlayPageIndexFor(0, 0, "cycle")).toBe(-1);
    expect(overlayPageIndexFor(2, 0, "repeat")).toBe(-1);
  });
});

describe("neededOverlayIndices", () => {
  it("needs only the first page when repeating", () => {
    expect(neededOverlayIndices(5, 3, "repeat")).toEqual([0]);
  });

  it("needs only the reachable pages when cycling", () => {
    expect(neededOverlayIndices(3, 2, "cycle")).toEqual([0, 1]);
    expect(neededOverlayIndices(2, 5, "cycle")).toEqual([0, 1]);
    expect(neededOverlayIndices(5, 3, "cycle")).toEqual([0, 1, 2]);
  });

  it("needs nothing for empty inputs", () => {
    expect(neededOverlayIndices(0, 3, "cycle")).toEqual([]);
    expect(neededOverlayIndices(3, 0, "repeat")).toEqual([]);
  });
});

describe("clampOpacity", () => {
  it("clamps into [0, 1] and defaults NaN to opaque", () => {
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(-1)).toBe(0);
    expect(clampOpacity(Number.NaN)).toBe(1);
  });
});

describe("overlayOutputName", () => {
  it("derives the name from the base file", () => {
    expect(overlayOutputName("contract.pdf")).toBe("contract-overlay.pdf");
    expect(overlayOutputName("")).toBe("document-overlay.pdf");
  });
});

describe("overlayPdf", () => {
  it("overlays a stamp on every page, preserving page count and sizes", async () => {
    const sizes: [number, number][] = [
      [612, 792],
      [400, 400],
      [800, 300],
    ];
    const base = await basePdf(sizes);
    const overlay = await overlayDoc(1);

    const result = await overlayPdf(base, overlay, { opacity: 0.5, fit: "fit" });
    expect(result.pageCount).toBe(3);
    expect(result.overlayPageCount).toBe(1);
    expect(result.opacity).toBe(0.5);
    // Overlaying adds content, so the output is larger than the base alone.
    expect(result.bytes.byteLength).toBeGreaterThan(base.byteLength);

    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(3);
    expect(out.getCreator()).toBe("pdf.xyz");
    out.getPages().forEach((page, i) => {
      expect(page.getWidth()).toBeCloseTo(sizes[i]![0]);
      expect(page.getHeight()).toBeCloseTo(sizes[i]![1]);
    });
  });

  it("cycles through multi-page overlays", async () => {
    const base = await basePdf([
      [500, 500],
      [500, 500],
      [500, 500],
    ]);
    const overlay = await overlayDoc(2);
    const result = await overlayPdf(base, overlay, { paging: "cycle" });
    expect(result.pageCount).toBe(3);
    expect(result.overlayPageCount).toBe(2);
    expect(result.paging).toBe("cycle");
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(3);
  });

  it("clamps out-of-range opacity", async () => {
    const base = await basePdf([[300, 300]]);
    const overlay = await overlayDoc(1);
    const result = await overlayPdf(base, overlay, { opacity: 5 });
    expect(result.opacity).toBe(1);
  });

  it("rejects a base file that isn't a PDF", async () => {
    const notPdf = new TextEncoder().encode("this is not a pdf");
    const overlay = await overlayDoc(1);
    await expect(overlayPdf(notPdf, overlay)).rejects.toBeInstanceOf(PdfEngineError);
  });

  it("rejects an overlay that isn't a PDF", async () => {
    const base = await basePdf([[300, 300]]);
    const notPdf = new TextEncoder().encode("this is not a pdf");
    await expect(overlayPdf(base, notPdf)).rejects.toBeInstanceOf(PdfEngineError);
  });
});
