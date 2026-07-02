import { describe, expect, it } from "vitest";
import {
  MAX_PIXEL_RATIO,
  THUMBNAIL_TARGET_WIDTH,
  aspectRatio,
  clampPixelRatio,
  renderDimensions,
  thumbnailScale,
} from "./render-utils";

const A4_PORTRAIT = 595 / 842;

describe("clampPixelRatio", () => {
  it("clamps into [1, MAX_PIXEL_RATIO]", () => {
    expect(clampPixelRatio(0.5)).toBe(1);
    expect(clampPixelRatio(1)).toBe(1);
    expect(clampPixelRatio(1.5)).toBe(1.5);
    expect(clampPixelRatio(4)).toBe(MAX_PIXEL_RATIO);
  });

  it("falls back to 1 for non-finite input", () => {
    expect(clampPixelRatio(Number.NaN)).toBe(1);
    expect(clampPixelRatio(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("thumbnailScale", () => {
  it("scales a page to the target device width", () => {
    expect(thumbnailScale(100, 240, 1)).toBeCloseTo(2.4);
    expect(thumbnailScale(100, 240, 2)).toBeCloseTo(4.8);
  });

  it("returns 1 for a target that equals the page width", () => {
    expect(thumbnailScale(THUMBNAIL_TARGET_WIDTH)).toBeCloseTo(1);
  });

  it("guards against bad page widths", () => {
    expect(thumbnailScale(0, 240, 1)).toBe(1);
    expect(thumbnailScale(-10, 240, 1)).toBe(1);
    expect(thumbnailScale(Number.NaN, 240, 1)).toBe(1);
  });
});

describe("aspectRatio", () => {
  it("returns width / height", () => {
    expect(aspectRatio(200, 100)).toBe(2);
    expect(aspectRatio(100, 200)).toBe(0.5);
  });

  it("falls back to A4 portrait for bad input", () => {
    expect(aspectRatio(0, 100)).toBeCloseTo(A4_PORTRAIT);
    expect(aspectRatio(100, 0)).toBeCloseTo(A4_PORTRAIT);
    expect(aspectRatio(Number.NaN, Number.NaN)).toBeCloseTo(A4_PORTRAIT);
  });
});

describe("renderDimensions", () => {
  it("computes integer pixel dimensions at the target width", () => {
    const dims = renderDimensions(300, 600, 240, 1);
    expect(dims.width).toBe(240);
    expect(dims.height).toBe(480);
    expect(dims.scale).toBeCloseTo(0.8);
  });

  it("honors the device pixel ratio", () => {
    const dims = renderDimensions(300, 600, 240, 2);
    expect(dims.width).toBe(480);
    expect(dims.height).toBe(960);
  });

  it("caps either dimension at maxDevicePx to protect memory", () => {
    const dims = renderDimensions(1000, 5000, 100_000, 1, 2400);
    expect(dims.width).toBeLessThanOrEqual(2400);
    expect(dims.height).toBeLessThanOrEqual(2400);
    // The tall side hits the cap exactly.
    expect(dims.height).toBe(2400);
  });

  it("falls back to A4 for non-positive page sizes", () => {
    const dims = renderDimensions(0, 0, 240, 1);
    expect(dims.width).toBe(240);
    expect(dims.height).toBe(Math.round(842 * (240 / 595)));
  });
});
