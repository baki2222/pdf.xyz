import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { encodeGrayJpeg } from "./gray-jpeg";
import {
  FLATE_SKIP_MARGIN,
  estimateFlateBytes,
  flateCannotWin,
  flateProbe,
  flateProbeRows,
} from "./scan-gray-choice";
import { SCAN_JPEG_QUALITY, scansToPdf } from "./scan-to-pdf";

/**
 * "Smaller wins" for Scan to PDF's document pages, with the Flate skip.
 * The skip (see `./scan-gray-choice`) may only change which encoding is
 * stored when its sampled estimate is off by more than FLATE_SKIP_MARGIN.
 * These pin, on full-size (2400 px) planes of the kinds a scan holds:
 *  1. the estimate never over-states a page's Flate by FLATE_SKIP_MARGIN or
 *     more — the property "smaller wins" rests on: a wrong skip needs
 *     estimate > margin x JPEG > margin x Flate (measured, not assumed);
 *  2. the encoding scansToPdf stores is the one the EXHAUSTIVE comparison
 *     picks, byte for byte, and Flate is skipped only where the JPEG won;
 *  3. control: a plane built to fool the sample IS mis-estimated beyond the
 *     margin — the error check can fail, so its passes above mean something.
 *
 * Review of the first fix (2026-11-18): the corpus had one text pitch (50
 * px), and the sample was one 16-row band in the middle of every 128 rows.
 * A document whose lines repeat near that stride fooled it — lines every
 * 127 px with faint noise on the ink: estimate 3.4x the true Flate, JPEG
 * stored at 1.82x the Flate's size. 128 px is ~16 mm on the page (forms,
 * large print, wide-ruled paper). Those pages are in the corpus now, with
 * pages near parity (Flate 0.8x to 1.0x the JPEG), where a margin set too
 * low turns into a wrong skip: margins of 1.0, 0.7 and 0.5 all passed the
 * old corpus.
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

/**
 * Lines of "words" every `pitch` rows on paper clipped to white, the way
 * documentPlane leaves a scanned page, with sensor noise (+-`noise`) only on
 * the 16 ink rows of each line (the reviewer's adversarial page).
 */
function linedPlane(pitch: number, noise: number): Uint8Array {
  const r = lcg(11);
  const p = new Uint8Array(W * H).fill(255);
  const from = 56 % pitch;
  for (let y = 0; y < H; y += 1) {
    const offset = y % pitch;
    if (offset < from || offset >= from + 16) continue;
    for (let x = 150; x < W - 150; x += 1) {
      const ink = x % 37 < 28 && (x * 7 + y * 3) % 11 < 6 ? 30 : 230;
      const v = Math.round(ink + ((r() / 255) * 2 - 1) * noise);
      p[y * W + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return p;
}

/** Noise ONLY on the rows the probe samples: built to fool it. */
function foolingPlane(): Uint8Array {
  const r = lcg(5);
  const p = new Uint8Array(W * H).fill(255);
  // The sampled rows, from the probe itself, never a copy of its layout.
  for (const [row, count] of flateProbeRows(H)!)
    for (let y = row; y < row + count; y += 1)
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

const CORPUS: readonly (readonly [string, () => Uint8Array])[] = [
  ["photo", photoPlane],
  ["clean text page", textPlane],
  ["half photo, half blank", halfPlane],
  // Lines repeating at or near the first fix's sample stride (wrong skips,
  // 1.82x to 1.22x, there), and pages near parity.
  ["lines every 127 px, faint noise", () => linedPlane(127, 2)],
  ["lines every 128 px, faint noise", () => linedPlane(128, 2)],
  ["lines every 64 px, faint noise", () => linedPlane(64, 2)],
  ["lines every 127 px, noise 6", () => linedPlane(127, 6)],
  ["lines every 128 px, noise 6 (Flate = JPEG)", () => linedPlane(128, 6)],
  ["lines every 130 px, noise 12", () => linedPlane(130, 12)],
  ["lines every 30 px, faint noise", () => linedPlane(30, 2)],
];

describe("scan Flate skip · smaller still wins", () => {
  it("samples about one row in eight, spread down the page, and none of a short plane", () => {
    const rows = flateProbeRows(H)!;
    const sampled = rows.reduce((n, [, count]) => n + count, 0);
    expect(sampled / H).toBeGreaterThan(0.1);
    expect(sampled / H).toBeLessThan(0.15);
    // From the top of the page to the bottom, in order, never overlapping.
    expect(rows[0]![0]).toBeLessThan(H / 20);
    expect(rows.at(-1)![0]).toBeGreaterThan(H - H / 20);
    for (let k = 1; k < rows.length; k += 1)
      expect(rows[k]![0]).toBeGreaterThanOrEqual(
        rows[k - 1]![0] + rows[k - 1]![1],
      );
    expect(flateProbe(new Uint8Array(W * H), W, H)!.length).toBe(sampled * W);
    expect(flateProbe(new Uint8Array(160 * 120), 160, 120)).toBeNull();
  });

  it("skips only past the margin", () => {
    expect(flateCannotWin(1000 * FLATE_SKIP_MARGIN, 1000)).toBe(false);
    expect(flateCannotWin(1000 * FLATE_SKIP_MARGIN + 1, 1000)).toBe(true);
  });

  it.each(CORPUS)(
    "%s: the estimate over-states the true Flate by less than the margin",
    async (_, make) => {
      const { flate, estimate } = await measured(make());
      expect(estimate / flate).toBeLessThan(FLATE_SKIP_MARGIN);
      // An under-estimate only costs time (a Flate made and thrown away),
      // but a sample that saw nothing would skip nothing: bound it too.
      expect(estimate / flate).toBeGreaterThan(0.5);
    },
    30_000,
  );

  it("a fine ruling at ANY row phase is not over-stated past the margin", async () => {
    // Two noisy rows in every 16, at each of the 16 phases in turn: whatever
    // fixed spot in its stride a sampler took, one of these lines up with it
    // (the first fix's 127 px failure, in miniature). Derived from the
    // probe's own stride, so a change of layout moves the corpus with it.
    const stride = Math.floor(H / flateProbeRows(H)!.length);
    expect(stride).toBe(16);
    const doc = await PDFDocument.create();
    const worst = { ratio: 0, phase: -1 };
    for (let phase = 0; phase < stride; phase += 1) {
      const r = lcg(13);
      const p = new Uint8Array(W * H).fill(255);
      for (let y = 0; y < H; y += 1)
        if ((y - phase + stride) % stride < 2)
          for (let x = 0; x < W; x += 1) p[y * W + x] = r();
      const flate = doc.context.flateStream(p, {}).contents.length;
      const probe = flateProbe(p, W, H)!;
      const estimate = estimateFlateBytes(
        doc.context.flateStream(probe, {}).contents.length,
        probe.length,
        p.length,
      );
      if (estimate / flate > worst.ratio)
        Object.assign(worst, { ratio: estimate / flate, phase });
    }
    // Health check: the loop measured something.
    expect(worst.phase).toBeGreaterThanOrEqual(0);
    expect(worst.ratio, `phase ${worst.phase}`).toBeLessThan(FLATE_SKIP_MARGIN);
  }, 60_000);

  it("the corpus has pages near parity, where the margin decides (health check)", async () => {
    // Without them a margin of 0.5 passed every test (review 2026-11-18).
    const even = await measured(linedPlane(128, 6));
    expect(even.flate / even.jpeg).toBeGreaterThan(0.9);
    expect(even.flate / even.jpeg).toBeLessThan(1.1);
    const under = await measured(linedPlane(130, 12));
    expect(under.flate / under.jpeg).toBeGreaterThan(0.7);
    expect(under.flate / under.jpeg).toBeLessThan(0.95);
  }, 30_000);

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
      // Where Flate won, it was made and stored (smaller wins).
      if (flate <= jpeg) expect(page.encoding).toBe("gray-flate");
    },
    30_000,
  );

  it("control: a plane noisy only on the sampled rows is mis-estimated past the margin", async () => {
    const { flate, estimate } = await measured(foolingPlane());
    expect(estimate / flate).toBeGreaterThan(FLATE_SKIP_MARGIN);
  }, 30_000);
});
