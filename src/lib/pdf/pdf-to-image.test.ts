import { describe, expect, it } from "vitest";
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_RESOLUTION_ID,
  RASTER_EXT,
  RASTER_MIME,
  RASTER_RESOLUTIONS,
  clampJpegQuality,
  pageImageName,
  pageNumberWidth,
  rasterFormatForSlug,
  rasterScaleForDpi,
  resolutionById,
  shouldZipPages,
  zipOutputName,
} from "./pdf-to-image";

describe("format mapping", () => {
  it("maps slugs to their output format", () => {
    expect(rasterFormatForSlug("pdf-to-png")).toBe("png");
    expect(rasterFormatForSlug("pdf-to-jpg")).toBe("jpg");
    // Anything that isn't the PNG slug renders JPG (the runner is only mounted
    // for these two slugs, so JPG is the safe default).
    expect(rasterFormatForSlug("anything-else")).toBe("jpg");
  });

  it("has matching MIME and extension for each format", () => {
    expect(RASTER_MIME.png).toBe("image/png");
    expect(RASTER_MIME.jpg).toBe("image/jpeg");
    expect(RASTER_EXT.png).toBe("png");
    expect(RASTER_EXT.jpg).toBe("jpg");
  });
});

describe("resolution presets", () => {
  it("exposes a default that exists in the preset list", () => {
    expect(RASTER_RESOLUTIONS.some((r) => r.id === DEFAULT_RESOLUTION_ID)).toBe(
      true,
    );
  });

  it("orders presets from lowest to highest dpi", () => {
    const dpis = RASTER_RESOLUTIONS.map((r) => r.dpi);
    expect([...dpis].sort((a, b) => a - b)).toEqual(dpis);
  });

  it("resolves a preset by id and falls back to the default", () => {
    expect(resolutionById("print").dpi).toBe(300);
    expect(resolutionById("nope").id).toBe(DEFAULT_RESOLUTION_ID);
  });
});

describe("rasterScaleForDpi", () => {
  it("converts dpi to a pdfjs render scale (72 dpi baseline)", () => {
    expect(rasterScaleForDpi(72)).toBe(1);
    expect(rasterScaleForDpi(144)).toBe(2);
    expect(rasterScaleForDpi(150)).toBeCloseTo(150 / 72);
  });

  it("falls back to 1 for non-positive or non-finite dpi", () => {
    expect(rasterScaleForDpi(0)).toBe(1);
    expect(rasterScaleForDpi(-5)).toBe(1);
    expect(rasterScaleForDpi(Number.NaN)).toBe(1);
    expect(rasterScaleForDpi(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("clampJpegQuality", () => {
  it("clamps into [0.1, 1]", () => {
    expect(clampJpegQuality(0)).toBe(0.1);
    expect(clampJpegQuality(0.5)).toBe(0.5);
    expect(clampJpegQuality(2)).toBe(1);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampJpegQuality(Number.NaN)).toBe(DEFAULT_JPEG_QUALITY);
    expect(clampJpegQuality(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_JPEG_QUALITY,
    );
  });
});

describe("shouldZipPages", () => {
  it("zips only when there is more than one page", () => {
    expect(shouldZipPages(1)).toBe(false);
    expect(shouldZipPages(0)).toBe(false);
    expect(shouldZipPages(2)).toBe(true);
    expect(shouldZipPages(120)).toBe(true);
  });
});

describe("pageNumberWidth", () => {
  it("uses enough digits to hold the highest page number", () => {
    expect(pageNumberWidth(1)).toBe(1);
    expect(pageNumberWidth(9)).toBe(1);
    expect(pageNumberWidth(10)).toBe(2);
    expect(pageNumberWidth(100)).toBe(3);
  });

  it("never returns less than one digit for degenerate counts", () => {
    expect(pageNumberWidth(0)).toBe(1);
    expect(pageNumberWidth(-3)).toBe(1);
  });
});

describe("pageImageName", () => {
  it("keeps the source name for a single-page document", () => {
    expect(pageImageName("report.pdf", 0, 1, "png")).toBe("report.png");
    expect(pageImageName("report.pdf", 0, 1, "jpg")).toBe("report.jpg");
  });

  it("adds a zero-padded page suffix for multi-page documents", () => {
    expect(pageImageName("report.pdf", 0, 12, "png")).toBe(
      "report-page-01.png",
    );
    expect(pageImageName("report.pdf", 11, 12, "jpg")).toBe(
      "report-page-12.jpg",
    );
    expect(pageImageName("report.pdf", 4, 200, "png")).toBe(
      "report-page-005.png",
    );
  });

  it("sanitizes unsafe characters and falls back for empty names", () => {
    expect(pageImageName("a/b:c.pdf", 0, 1, "png")).toBe("abc.png");
    expect(pageImageName("", 0, 1, "jpg")).toBe("document.jpg");
  });
});

describe("zipOutputName", () => {
  it("derives a ZIP name from the source and format", () => {
    expect(zipOutputName("report.pdf", "png")).toBe("report-png.zip");
    expect(zipOutputName("report.pdf", "jpg")).toBe("report-jpg.zip");
    expect(zipOutputName("", "png")).toBe("document-png.zip");
  });
});
