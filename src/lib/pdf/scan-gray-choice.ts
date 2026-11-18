/**
 * Scan to PDF, "document" clean-up: when the writer may skip the Flate
 * encoding of a page because a SAMPLE of it already shows the JPEG will win.
 *
 * The writer stores each gray page as a one-component JPEG or as the lossless
 * plane under Flate, whichever is smaller. Both encodings of a 2400 px plane
 * cost about the same (~0.2 s each), and on photographs the Flate one is
 * always thrown away. Measured 2026-11-18 (`.perf/measure-encodings.ts` in the
 * perf/scan-to-pdf-yield lane, the real `documentPlane` + `encodeGrayJpeg` +
 * pdf-lib Flate on @napi-rs/canvas decodes):
 *
 *  - IMG60 (60 photo-like 12 MP JPEGs): the JPEG won on 60 of 60 pages; the
 *    Flate stream was 2.43x to 2.75x the JPEG; Flate cost 11.5 s in total,
 *    all of it discarded.
 *  - A white page with 40 lines of text, rendered clean: Flate won (0.41x
 *    the JPEG) — so "a small JPEG means skip Flate" would be WRONG here.
 *  - The same page with sensor noise (+-4, +-12) or lighting shade and noise
 *    (+-6, +-16): the JPEG won every time, Flate 2.56x to 3.55x the JPEG.
 *
 * So the decision is made from the plane, not from the JPEG alone: deflate
 * one band of {@link FLATE_PROBE_BAND_ROWS} rows in every
 * {@link FLATE_PROBE_STRIDE}, scale that up to an estimate of the whole
 * page's Flate size, and skip the full Flate only when the estimate is more
 * than {@link FLATE_SKIP_MARGIN} times the JPEG. The guarantee "the smaller
 * encoding is stored" then holds for every page whose estimate is within
 * that margin of its true Flate size; `scan-gray-choice.test.ts` pins the
 * estimate's error on photo, text, half-blank and banded pages, and that
 * the stored choice equals the exhaustive one on each.
 */

/** Rows per sampled band: wider than Flate's 32 KB window at 2400 px. */
export const FLATE_PROBE_BAND_ROWS = 16;

/** One band in this many is sampled (1/8 of the plane is deflated). */
export const FLATE_PROBE_STRIDE = 8;

/** Skip the full Flate only when its estimate exceeds the JPEG by this. */
export const FLATE_SKIP_MARGIN = 1.5;

/**
 * The sampled bands of a `width` x `height` plane, back to back — or `null`
 * when the plane is too short for a sample to be cheaper than the whole
 * (fewer than two strides of bands), in which case nothing is skipped.
 */
export function flateProbe(
  plane: Uint8Array,
  width: number,
  height: number,
): Uint8Array | null {
  const stride = FLATE_PROBE_BAND_ROWS * FLATE_PROBE_STRIDE;
  if (height < stride * 2) return null;
  const bands = Math.floor(height / stride);
  const out = new Uint8Array(bands * FLATE_PROBE_BAND_ROWS * width);
  for (let b = 0; b < bands; b += 1) {
    // The band in the MIDDLE of each stride, so the first and last rows
    // (often a margin) do not stand for the page.
    const row = b * stride + ((stride - FLATE_PROBE_BAND_ROWS) >> 1);
    out.set(
      plane.subarray(row * width, (row + FLATE_PROBE_BAND_ROWS) * width),
      b * FLATE_PROBE_BAND_ROWS * width,
    );
  }
  return out;
}

/** The whole plane's Flate size, estimated from its probe's. */
export function estimateFlateBytes(
  probeDeflatedBytes: number,
  probeBytes: number,
  planeBytes: number,
): number {
  return Math.ceil((probeDeflatedBytes * planeBytes) / probeBytes);
}

/** Whether the full Flate can be skipped: the JPEG wins by a clear margin. */
export function flateCannotWin(
  estimatedFlateBytes: number,
  jpegBytes: number,
): boolean {
  return estimatedFlateBytes > jpegBytes * FLATE_SKIP_MARGIN;
}
