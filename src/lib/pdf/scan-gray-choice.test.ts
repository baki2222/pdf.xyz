import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { encodeGrayJpeg } from "./gray-jpeg";
import {
  FLATE_PROBE_BAND_ROWS,
  FLATE_PROBE_STRIDE,
  FLATE_SKIP_MARGIN,
  estimateFlateBytes,
  flateCannotWin,
  flateProbe,
} from "./scan-gray-choice";
import { SCAN_JPEG_QUALITY, scansToPdf } from "./scan-to-pdf";

/**
 * "Smaller wins" for Scan to PDF's document pages, with the Flate skip.
 * The skip (see `./scan-gray-choice`) may only change which encoding is
 * stored when its sampled estimate is off by more than FLATE_SKIP_MARGIN.
 * These pin, on full-size (2400 px) planes of the kinds a scan holds:
 *  1. the estimate's error is far inside the margin (measured, not assumed);
 *  2. the encoding scansToPdf stores is the one the EXHAUSTIVE comparison
 *     picks, byte for byte, and Flate is skipped only where the JPEG won;
 *  3. control: a plane built to fool the sample IS mis-estimated beyond the
 *     margin — the error check can fail, so its passes above mean something.
 */

const W = 1800;
const H = 2400;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s >>> 24;
  };
}

/** A photo-like plane: gradient plus per-pixel noise. */
function photoPlane(): Uint8Array {
  const r = lcg(1);
  const p = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1)
      p[y * W + x] = ((x * 200) / W + (y * 40) / H + (r() >> 3)) & 255;
  return p;
}

/** A clean text page: white paper, dark "words" in lines. */
function textPlane(): Uint8Array {
  const p = new Uint8Array(W * H).fill(255);
  for (let line = 0; line < 40; line += 1) {
    const top = 200 + line * 50;
    for (let y = top; y < top + 18; y += 1)
      for (let x = 150; x < W - 150; x += 1)
        if (x % 37 < 28 && (x * 7 + y * 3) % 11 < 6) p[y * W + x] = 20;
  }
  return p;
}

/** Top half noise, bottom half blank paper. */
function halfPlane(): Uint8Array {
  const r = lcg(3);
  const p = new Uint8Array(W * H).fill(255);
  for (let i = 0; i < (W * H) / 2; i += 1) p[i] = r();
  return p;
}

/** Noise ONLY on the rows the probe samples: built to fool it. */
function foolingPlane(): Uint8Array {
  const r = lcg(5);
  const p = new Uint8Array(W * H).fill(255);
  const stride = FLATE_PROBE_BAND_ROWS * FLATE_PROBE_STRIDE;
  const offset = (stride - FLATE_PROBE_BAND_ROWS) >> 1;
  for (let y = 0; y < H; y += 1)
    if (y % stride >= offset && y % stride < offset + FLATE_PROBE_BAND_ROWS)
      for (let x = 0; x < W; x += 1) p[y * W + x] = r();
  return p;
}

async function measured(plane: Uint8Array) {
  const doc = await PDFDocument.create();
  const flate = doc.context.flateStream(plane, {}).contents.length;
  const jpeg = encodeGrayJpeg(plane, W, H, SCAN_JPEG_QUALITY).length;
  const probe = flateProbe(plane, W, H)!;
  const estimate = estimateFlateBytes(
    doc.context.flateStream(probe, {}).contents.length,
    probe.length,
    plane.length,
  );
  return { flate, jpeg, estimate };
}

const CORPUS = [
  ["photo", photoPlane],
  ["clean text page", textPlane],
  ["half photo, half blank", halfPlane],
] as const;

describe("scan Flate skip · smaller still wins", () => {
  it("samples one band in every stride, and none of a short plane", () => {
    expect(flateProbe(new Uint8Array(W * H), W, H)!.length).toBe(
      Math.floor(H / (FLATE_PROBE_BAND_ROWS * FLATE_PROBE_STRIDE)) *
        FLATE_PROBE_BAND_ROWS *
        W,
    );
    expect(flateProbe(new Uint8Array(160 * 120), 160, 120)).toBeNull();
  });

  it("skips only past the margin", () => {
    expect(flateCannotWin(1000 * FLATE_SKIP_MARGIN, 1000)).toBe(false);
    expect(flateCannotWin(1000 * FLATE_SKIP_MARGIN + 1, 1000)).toBe(true);
  });

  it.each(CORPUS)(
    "%s: the estimate is within 15%% of the true Flate size",
    async (_, make) => {
      const { flate, estimate } = await measured(make());
      expect(estimate / flate).toBeGreaterThan(0.85);
      expect(estimate / flate).toBeLessThan(1.15);
    },
    30_000,
  );

  it.each(CORPUS)(
    "%s: scansToPdf stores the exhaustive winner, byte for byte",
    async (_, make) => {
      const plane = make();
      const { flate, jpeg } = await measured(plane);
      const { pages } = await scansToPdf(
        [{ enhancement: "document", plane, width: W, height: H }],
        "a4",
      );
      const page = pages[0]!;
      expect(page.imageBytes).toBe(Math.min(flate, jpeg));
      expect(page.encoding).toBe(flate <= jpeg ? "gray-flate" : "gray-jpeg");
      // Flate is skipped only where it lost, and the photo does skip it
      // (the work the skip exists to save).
      if (page.flateSkipped) expect(jpeg).toBeLessThan(flate);
      if (make === photoPlane) expect(page.flateSkipped).toBe(true);
      if (make === textPlane) expect(page.flateSkipped).toBeUndefined();
    },
    30_000,
  );

  it("control: a plane noisy only on the sampled rows is mis-estimated past the margin", async () => {
    const { flate, estimate } = await measured(foolingPlane());
    expect(estimate / flate).toBeGreaterThan(FLATE_SKIP_MARGIN);
  }, 30_000);
});
