// @vitest-environment node
/**
 * Grayscale PDF encodes a page as a JPEG only when a JPEG could be the
 * smaller of the two (perf sweep 2026-11-18, finding P3).
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * The builder stored every page both ways — a one-component JPEG and a Flate
 * image — and kept the smaller. On a 1,000-page text PDF the JPEG encoder was
 * 63% of the main thread's busy time and lost on every page: measured on the
 * sweep's F1 at 150 DPI, Flate 5.3 KB against JPEG 18.5 KB a page.
 *
 * ── THE FIX, AND ITS TOLERANCE ──────────────────────────────────────────────
 *
 * A JPEG from `encodeGrayJpeg` can never be smaller than
 * `grayJpegFloorBytes(width, height)` (2 bits per 8×8 block plus headers;
 * 8,280 bytes for a Letter page at 150 DPI). When the Flate image is already
 * no larger than that, the JPEG would have lost the comparison, so it is not
 * made. The choice is the one the old rule made, byte for byte: the
 * tolerance is ZERO. Ratio rules were measured and rejected: a smooth photo
 * page deflates to 12% of its plane while its JPEG is 4.6 times smaller
 * still, so "Flate under plane / 8" would have stored a page 4.6 times larger
 * than the JPEG alone.
 *
 * The spy is `vi.spyOn` on the module namespace, restored after each test,
 * never `vi.mock` (the suite shares one module cache, `isolate: false`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import * as grayJpeg from "./gray-jpeg";
import { grayJpegFloorBytes } from "./gray-jpeg-floor";
import { createGrayscaleBuilder } from "./grayscale-builder";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Letter at 150 DPI, the default preset: what the sweep's F1 pages render to. */
const W = 1275;
const H = 1650;

const info = (width: number, height: number) => ({
  index: 0,
  width,
  height,
  pageWidth: (width * 72) / 150,
  pageHeight: (height * 72) / 150,
});

/** A text-like page: white, with one band of glyph-like strokes. */
function sparseTextPlane(width = W, height = H): Uint8Array {
  const out = new Uint8Array(width * height).fill(255);
  for (let y = 120; y < 132; y++) {
    for (let x = 100; x < width - 100; x++) {
      if ((x >> 1) % 4 !== 3 && ((x >> 3) + y) % 3 !== 0)
        out[y * width + x] = 0;
    }
  }
  return out;
}

/** Body text all down the page: Flate still wins, but above the floor. */
function denseTextPlane(width = W, height = H): Uint8Array {
  const out = new Uint8Array(width * height).fill(255);
  for (let line = 100; line + 12 < height - 100; line += 28) {
    for (let y = line; y < line + 12; y++) {
      for (let x = 100; x < width - 100; x++) {
        if (((x * 7) ^ (y * 3) ^ line) % 5 < 2) out[y * width + x] = 0;
      }
    }
  }
  return out;
}

/** Wave plus noise, as in grayscale-output.test.ts: the JPEG wins. */
function photoPlane(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  let s = 12345;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const wave = 90 * Math.sin(x / 9) * Math.cos(y / 13);
      out[y * width + x] = Math.max(0, Math.min(255, 128 + wave + (s % 48)));
    }
  }
  return out;
}

async function flateBytes(plane: Uint8Array): Promise<number> {
  const doc = await PDFDocument.create();
  return doc.context.flateStream(plane, {}).contents.length;
}

describe("grayscale builder: a JPEG is made only when it could win", () => {
  it("a 99%-white text page is stored as Flate with encodeGrayJpeg called 0 times", async () => {
    const plane = sparseTextPlane();
    const white = plane.filter((v) => v === 255).length / plane.length;
    // Health check on the fixture: the shape the finding names.
    expect(white).toBeGreaterThanOrEqual(0.99);
    expect(white).toBeLessThan(1);
    const spy = vi.spyOn(grayJpeg, "encodeGrayJpeg");
    const builder = await createGrayscaleBuilder();
    const record = await builder.addPage(plane, info(W, H));
    expect(record.encoding).toBe("flate");
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("POSITIVE CONTROL: the spy sees the call on a photo page, which stores the JPEG", async () => {
    const spy = vi.spyOn(grayJpeg, "encodeGrayJpeg");
    const builder = await createGrayscaleBuilder();
    const record = await builder.addPage(photoPlane(400, 300), info(400, 300));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(record.encoding).toBe("jpeg");
  });

  it("keeps exactly the smaller encoding the old both-ways rule kept, on every shape", async () => {
    const cases: [string, Uint8Array, number, number][] = [
      ["sparse text", sparseTextPlane(), W, H],
      ["dense text", denseTextPlane(), W, H],
      ["photo", photoPlane(640, 480), 640, 480],
      ["flat", new Uint8Array(W * H).fill(255), W, H],
      ["one pixel", new Uint8Array([7]), 1, 1],
    ];
    const skipped: string[] = [];
    const encoded: string[] = [];
    for (const [label, plane, width, height] of cases) {
      const jpeg = grayJpeg.encodeGrayJpeg(plane, width, height, 0.88).length;
      const flate = await flateBytes(plane);
      const spy = vi.spyOn(grayJpeg, "encodeGrayJpeg");
      const builder = await createGrayscaleBuilder();
      const record = await builder.addPage(plane, info(width, height));
      (spy.mock.calls.length === 0 ? skipped : encoded).push(label);
      spy.mockRestore();
      expect(record.imageBytes, label).toBe(Math.min(jpeg, flate));
      expect(record.encoding, label).toBe(flate <= jpeg ? "flate" : "jpeg");
    }
    // Both branches taken, so neither is certified unseen.
    expect(skipped).toEqual(["sparse text", "flat", "one pixel"]);
    expect(encoded).toEqual(["dense text", "photo"]);
  });
});

describe("grayJpegFloorBytes", () => {
  const sizes: [number, number][] = [
    [1, 1],
    [8, 8],
    [9, 17],
    [200, 150],
    [W, H],
  ];

  it("is never more than the encoder writes, at any quality", () => {
    for (const [width, height] of sizes) {
      const floor = grayJpegFloorBytes(width, height);
      for (const quality of [0, 0.5, 0.88, 1]) {
        for (const plane of [
          new Uint8Array(width * height).fill(255),
          new Uint8Array(width * height).fill(0),
          new Uint8Array(width * height).fill(128),
          photoPlane(width, height),
        ]) {
          const actual = grayJpeg.encodeGrayJpeg(
            plane,
            width,
            height,
            quality,
          ).length;
          expect(
            actual,
            `${width}×${height} q${quality}`,
          ).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  it("POSITIVE CONTROL: is within 8 bytes of a flat plane's JPEG, so it is not true and useless", () => {
    for (const [width, height] of sizes) {
      const flat = grayJpeg.encodeGrayJpeg(
        new Uint8Array(width * height).fill(255),
        width,
        height,
        0.88,
      ).length;
      expect(
        flat - grayJpegFloorBytes(width, height),
        `${width}×${height}`,
      ).toBeLessThanOrEqual(8);
    }
  });
});
