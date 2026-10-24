import { describe, expect, it } from "vitest";
import { jpegComponentCount } from "./gray-jpeg";
import {
  DEFAULT_RASTER_COLOR,
  RASTER_COLORS,
  pageImageName,
  rasterPageSelection,
} from "./pdf-to-image";
import { PageRangeError } from "./ranges";
import { rasterCapture } from "./render";

describe("PDF to image — which pages", () => {
  it("all pages is every page, in order (the default)", () => {
    expect(rasterPageSelection({ mode: "all", range: "" }, 4)).toEqual([
      0, 1, 2, 3,
    ]);
    // The range text is ignored while "All pages" is chosen.
    expect(rasterPageSelection({ mode: "all", range: "zzz" }, 2)).toEqual([
      0, 1,
    ]);
  });

  it("a range is the split/extract parser's answer: sorted, de-duplicated, 0-based", () => {
    expect(rasterPageSelection({ mode: "range", range: "1-3,5" }, 8)).toEqual([
      0, 1, 2, 4,
    ]);
    expect(
      rasterPageSelection({ mode: "range", range: "5, 2-3, 3" }, 8),
    ).toEqual([1, 2, 4]);
    expect(rasterPageSelection({ mode: "range", range: "7-" }, 8)).toEqual([
      6, 7,
    ]);
  });

  it("a range the PDF cannot satisfy is refused with the parser's words", () => {
    expect(() => rasterPageSelection({ mode: "range", range: "9" }, 8)).toThrow(
      PageRangeError,
    );
    expect(() => rasterPageSelection({ mode: "range", range: "" }, 8)).toThrow(
      /at least one page/,
    );
  });

  it("a page keeps its own number in its file name when only some are rendered", () => {
    // Named by the DOCUMENT's page count, so page 5 of 12 is page-05.
    expect(pageImageName("report.pdf", 4, 12, "jpg")).toBe(
      "report-page-05.jpg",
    );
    // A one-page document still downloads under its own name.
    expect(pageImageName("report.pdf", 0, 1, "jpg")).toBe("report.jpg");
  });
});

/** A stand-in canvas: `toBlob` records its call; pixels are a fixed RGBA. */
function fakeCanvas(width: number, height: number, rgba: number[]) {
  const calls: string[] = [];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  const canvas = {
    width,
    height,
    getContext: () => ({
      getImageData: () => ({ data, width, height }),
    }),
    toBlob: (cb: (b: Blob | null) => void, type: string) => {
      calls.push(type);
      cb(new Blob([new Uint8Array([1, 2, 3])], { type }));
    },
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, calls };
}

describe("PDF to image — colour", () => {
  it("offers Colour (the default) and Grayscale", () => {
    expect(RASTER_COLORS.map((c) => c.id)).toEqual(["color", "gray"]);
    expect(DEFAULT_RASTER_COLOR).toBe("color");
  });

  it("grayscale JPEG is a ONE-component JPEG, not neutral pixels in YCbCr", async () => {
    const { canvas, calls } = fakeCanvas(16, 8, [200, 30, 30, 255]);
    const bytes = await rasterCapture("jpg", { grayscale: true })(canvas);
    expect(bytes).not.toBeNull();
    expect(jpegComponentCount(bytes!)).toBe(1);
    // The browser's encoder (which only writes three components) is not used.
    expect(calls).toEqual([]);
  });

  it("colour JPEG and every PNG go through the browser's encoder (control)", async () => {
    const jpg = fakeCanvas(4, 4, [0, 0, 0, 255]);
    await rasterCapture("jpg", { grayscale: false })(jpg.canvas);
    expect(jpg.calls).toEqual(["image/jpeg"]);
    const png = fakeCanvas(4, 4, [0, 0, 0, 255]);
    await rasterCapture("png", { grayscale: true })(png.canvas);
    expect(png.calls).toEqual(["image/png"]);
  });
});
