import { describe, expect, it } from "vitest";
import { grayscaleImageData, luminancePlane } from "./render";
import {
  grayscaleOutputName,
  grayscalePresetById,
  pageSizeForRaster,
} from "./grayscale";

describe("grayscaleImageData", () => {
  it("converts RGB pixels to luminance grayscale and preserves alpha", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0,
    ]);
    grayscaleImageData(data);
    expect([...data]).toEqual([
      76, 76, 76, 255, 150, 150, 150, 128, 29, 29, 29, 0,
    ]);
  });
});

describe("luminancePlane", () => {
  it("is exactly the value grayscaleImageData writes, one byte per pixel", () => {
    // The plane the grayscale tool embeds and the in-place pass the other
    // raster paths use must not drift apart: compare them over every channel
    // combination at a coarse step plus the extremes.
    const values = [0, 1, 37, 64, 127, 128, 200, 254, 255];
    const pixels: number[] = [];
    for (const r of values)
      for (const g of values) for (const b of values) pixels.push(r, g, b, 255);
    const data = new Uint8ClampedArray(pixels);
    const plane = luminancePlane(data);
    const inPlace = new Uint8ClampedArray(data);
    grayscaleImageData(inPlace);

    expect(plane.length).toBe(values.length ** 3);
    expect([...plane]).toEqual(
      Array.from({ length: plane.length }, (_, p) => inPlace[p * 4]),
    );
    // And it is not trivially constant.
    expect(new Set(plane).size).toBeGreaterThan(50);
  });
});

describe("grayscale helpers", () => {
  it("names output from the source file", () => {
    expect(grayscaleOutputName("report.pdf")).toBe("report-grayscale.pdf");
    expect(grayscaleOutputName("")).toBe("document-grayscale.pdf");
  });

  it("resolves known presets and falls back to print", () => {
    expect(grayscalePresetById("screen").dpi).toBe(96);
    expect(grayscalePresetById("unknown").id).toBe("print");
  });

  it("preserves PDF point dimensions when present", () => {
    expect(
      pageSizeForRaster({
        pageWidth: 612,
        pageHeight: 792,
        width: 1275,
        height: 1650,
      }),
    ).toEqual([612, 792]);
  });

  it("falls back to pixel dimensions for degenerate page dimensions", () => {
    expect(
      pageSizeForRaster({
        pageWidth: 0,
        pageHeight: Number.NaN,
        width: 320,
        height: 200,
      }),
    ).toEqual([320, 200]);
  });
});
