import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  cropPdf,
  croppedOutputName,
  getPageSizes,
  insetBox,
  isEmptyMargins,
  MIN_CROP_DIMENSION,
} from "./crop";

async function blankPdf(
  pages: number,
  size: [number, number] = [600, 800],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage(size);
  return doc.save();
}

describe("insetBox", () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };

  it("insets each edge and shifts the origin by left/bottom", () => {
    expect(insetBox(box, { top: 10, right: 20, bottom: 30, left: 40 })).toEqual(
      {
        x: 40,
        y: 30,
        width: 540,
        height: 760,
      },
    );
  });

  it("clamps negative margins to zero", () => {
    expect(insetBox(box, { top: -5, right: -1, bottom: 0, left: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 800,
    });
  });

  it("returns null when the remaining region would be degenerate", () => {
    expect(
      insetBox(box, { top: 0, right: 590, bottom: 0, left: 20 }),
    ).toBeNull();
  });

  it("allows a box exactly at the minimum dimension", () => {
    const result = insetBox(box, {
      top: 0,
      right: 600 - MIN_CROP_DIMENSION,
      bottom: 0,
      left: 0,
    });
    expect(result?.width).toBe(MIN_CROP_DIMENSION);
  });
});

describe("isEmptyMargins", () => {
  it("is true only when every edge is zero or less", () => {
    expect(isEmptyMargins({ top: 0, right: 0, bottom: 0, left: 0 })).toBe(true);
    expect(isEmptyMargins({ top: 0, right: 1, bottom: 0, left: 0 })).toBe(
      false,
    );
  });
});

describe("cropPdf", () => {
  it("shrinks every page's crop box and keeps the page count", async () => {
    const input = await blankPdf(3);
    const output = await cropPdf(input, {
      margins: { top: 50, right: 40, bottom: 30, left: 20 },
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
    const crop = doc.getPage(0).getCropBox();
    expect(crop.width).toBeCloseTo(600 - 20 - 40);
    expect(crop.height).toBeCloseTo(800 - 50 - 30);
    expect(crop.x).toBeCloseTo(20);
    expect(crop.y).toBeCloseTo(30);
  });

  it("crops only the selected pages", async () => {
    const input = await blankPdf(2);
    const output = await cropPdf(input, {
      margins: { top: 0, right: 0, bottom: 0, left: 100 },
      pages: [1],
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPage(0).getCropBox().width).toBeCloseTo(600);
    expect(doc.getPage(1).getCropBox().width).toBeCloseTo(500);
  });

  it("throws when every margin is zero", async () => {
    await expect(
      cropPdf(await blankPdf(1), {
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).rejects.toThrow(PdfEngineError);
  });

  it("throws when the margins exceed the page", async () => {
    await expect(
      cropPdf(await blankPdf(1), {
        margins: { top: 0, right: 0, bottom: 0, left: 599 },
      }),
    ).rejects.toThrow(/larger than page 1/i);
  });

  it("stamps our creator metadata", async () => {
    const output = await cropPdf(await blankPdf(1), {
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("reads page sizes", async () => {
    const sizes = await getPageSizes(await blankPdf(2, [420, 640]));
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toEqual({ width: 420, height: 640 });
  });

  it("names the download from the source", () => {
    expect(croppedOutputName("report.pdf")).toBe("report-cropped.pdf");
  });
});
