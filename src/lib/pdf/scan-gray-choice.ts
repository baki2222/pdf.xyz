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
 * a sample of about one row in eight — {@link FLATE_PROBE_BAND_ROWS} rows
 * from every {@link FLATE_PROBE_STRIDE} bands' worth, at a scrambled
 * position inside each ({@link flateProbeRows}) — scale that up to an
 * estimate of the whole page's Flate size, and skip the full Flate only
 * when the estimate is more than {@link FLATE_SKIP_MARGIN} times the JPEG.
 *
 * Why scrambled, and why short bands (review 2026-11-18): the first version
 * took one 16-row band from the MIDDLE of every 128 rows. A document whose
 * lines repeat near that stride — lines every 127 or 128 px, ~16 mm on the
 * page — put the ink on every sampled band, or on none: estimates 3.4x to
 * 7.6x the true Flate, and the JPEG stored at up to 1.82x the size of the
 * Flate it skipped. A fixed position lines up with some line pitch; a
 * scrambled one does not, and many short bands average over a line's ink
 * and paper instead of landing wholly on one or the other. Measured over
 * 354 lined pages (pitch 24 to 200 px, every pixel, noise +-2 and +-12, the
 * sweep in the PR for perf/scan-to-pdf-yield): the estimate was 0.52x to
 * 1.29x the true Flate, so never past the margin.
 *
 * The guarantee "the smaller encoding is stored" holds for every page whose
 * estimate over-states its Flate by less than the margin: a wrong skip needs
 * estimate > margin x JPEG while Flate < JPEG. `scan-gray-choice.test.ts`
 * pins that bound on photo, text, half-blank and lined pages (some near
 * parity, where the margin decides), and that the stored choice equals the
 * exhaustive one on each.
 */

/** Rows per sampled band. */
export const FLATE_PROBE_BAND_ROWS = 2;

/** One band in this many is sampled (1/8 of the plane is deflated). */
export const FLATE_PROBE_STRIDE = 8;

/** A plane shorter than this is not sampled: the whole is cheap enough. */
export const FLATE_PROBE_MIN_ROWS = 256;

/** Skip the full Flate only when its estimate exceeds the JPEG by this. */
export const FLATE_SKIP_MARGIN = 1.5;

/** A fixed scramble of the band number (deterministic: same page, same choice). */
function scramble(n: number): number {
  let h = (n + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The rows the probe samples, as `[first row, row count]` in page order —
 * one band in each stride of `FLATE_PROBE_BAND_ROWS * FLATE_PROBE_STRIDE`
 * rows, at a scrambled offset inside it — or `null` for a plane shorter than
 * {@link FLATE_PROBE_MIN_ROWS}, in which case nothing is skipped.
 */
export function flateProbeRows(height: number): [number, number][] | null {
  if (height < FLATE_PROBE_MIN_ROWS) return null;
  const stride = FLATE_PROBE_BAND_ROWS * FLATE_PROBE_STRIDE;
  const rows: [number, number][] = [];
  for (let b = 0; b < Math.floor(height / stride); b += 1) {
    const offset = scramble(b) % (stride - FLATE_PROBE_BAND_ROWS + 1);
    rows.push([b * stride + offset, FLATE_PROBE_BAND_ROWS]);
  }
  return rows;
}

/** The sampled rows of a `width` x `height` plane, back to back (or `null`). */
export function flateProbe(
  plane: Uint8Array,
  width: number,
  height: number,
): Uint8Array | null {
  const rows = flateProbeRows(height);
  if (rows === null) return null;
  const out = new Uint8Array(rows.length * FLATE_PROBE_BAND_ROWS * width);
  let at = 0;
  for (const [row, count] of rows) {
    out.set(plane.subarray(row * width, (row + count) * width), at);
    at += count * width;
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
