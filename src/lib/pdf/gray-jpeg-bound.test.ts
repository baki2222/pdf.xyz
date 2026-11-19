// @vitest-environment node
/**
 * The lower bound Grayscale PDF's builder uses to skip a JPEG that cannot win
 * (`./gray-jpeg-bound`). A "no" from `grayJpegCanBeat` drops the JPEG
 * without making it, so the bound must never be above what the encoder
 * writes — and must be close enough to it to settle real text pages, or it is
 * true and useless (review of PR perf/grayscale-cancel-encode: the size floor
 * alone settled only nearly blank pages; 6 lines of text already passed it).
 *
 * Three relationships, each held from both sides:
 *  1. `quantizeGrayBlock` reproduces the encoder's coefficients: the
 *     encoder's byte count is rebuilt from them EXACTLY (headers, optimal
 *     tables, magnitude bits, padding, and the 0xFF stuffing counted from the
 *     real output). A drift in the copied DCT, table or rounding breaks the
 *     equality, not just a margin.
 *  2. The bound is never above the encoder's output, on every shape, size and
 *     quality tried — including shapes made to sit near it.
 *  3. On text it is within reach of the real size, so a "no" actually happens.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  encodeGrayJpeg,
  grayJpegQuantTable,
  optimalHuffmanTable,
} from "./gray-jpeg";
import {
  grayJpegCanBeat,
  grayJpegLowerBound,
  quantizeGrayBlock,
} from "./gray-jpeg-bound";
import { grayJpegFloorBytes } from "./gray-jpeg-floor";

const W = 1275;
const H = 1650;

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s;
  };
}

/** Lines of glyph-like strokes with grey (anti-aliased) edges. */
function textPlane(width: number, height: number, lines: number): Uint8Array {
  const out = new Uint8Array(width * height).fill(255);
  const next = lcg(lines * 7 + width);
  for (let line = 0; line < lines; line++) {
    const top = 60 + line * 28;
    if (top + 14 > height) break;
    let x = 50;
    while (x < width - 60) {
      const glyph = 4 + (next() % 9);
      if (next() % 6 === 0) {
        x += 7; // a word space
        continue;
      }
      for (let y = top; y < top + 14; y++) {
        for (let dx = 0; dx < glyph; dx++) {
          const ink = (dx + y + line) % 4 === 0 || dx === 0 || y === top + 13;
          if (ink) out[y * width + x + dx] = next() % 3 === 0 ? 120 : 0;
        }
      }
      x += glyph + 2;
    }
  }
  return out;
}

function photoPlane(width: number, height: number, seed = 12345): Uint8Array {
  const out = new Uint8Array(width * height);
  const next = lcg(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wave = 90 * Math.sin(x / 9) * Math.cos(y / 13);
      out[y * width + x] = Math.max(
        0,
        Math.min(255, 128 + wave + (next() % 48)),
      );
    }
  }
  return out;
}

function gradientPlane(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out[y * width + x] = Math.floor((255 * x) / Math.max(1, width - 1));
  return out;
}

function checkerPlane(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++)
    out[i] = ((i % width) + Math.floor(i / width)) % 2 ? 255 : 0;
  return out;
}

/** A photo inside a wide white border: flat blocks and busy blocks mixed. */
function borderedPhoto(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height).fill(255);
  const inner = photoPlane(width, height, 99);
  const mx = Math.floor(width / 4);
  const my = Math.floor(height / 4);
  for (let y = my; y < height - my; y++)
    for (let x = mx; x < width - mx; x++)
      out[y * width + x] = inner[y * width + x]!;
  return out;
}

function sparseDither(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height).fill(255);
  const next = lcg(5);
  for (let i = 0; i < out.length; i++) if (next() % 50 === 0) out[i] = 0;
  return out;
}

const SHAPES: [string, (w: number, h: number) => Uint8Array][] = [
  ["text 6 lines", (w, h) => textPlane(w, h, 6)],
  ["text 50 lines", (w, h) => textPlane(w, h, 50)],
  ["photo", (w, h) => photoPlane(w, h)],
  ["photo, white border", borderedPhoto],
  ["gradient", gradientPlane],
  ["checker", checkerPlane],
  ["2% dither", sparseDither],
  ["flat white", (w, h) => new Uint8Array(w * h).fill(255)],
  ["flat black", (w, h) => new Uint8Array(w * h).fill(0)],
];

const SIZES: [number, number][] = [
  [1, 1],
  [7, 3],
  [64, 1],
  [9, 17],
  [200, 150],
  [W, H],
];

/**
 * The shape × size grid, ONE TEST PER CELL. It was one test over all 54
 * cells, and timed out at vitest's 5,000 ms on the Linux CI runner inside the
 * full suite (PR #382, run 44373418087). Measured on Windows (Node 24) for
 * this split: that single test took 2,633 ms with the file alone, and the
 * whole file 5,861 ms inside `vitest run --no-file-parallelism`. The heaviest
 * cell (photo, a full Letter page, three qualities, JPEG + bound each) takes
 * 472 ms alone and 821 ms inside the full suite; the heaviest test that is
 * not a cell ("says no on text pages") 304 and 757 ms. CELL_TIMEOUT is 18×
 * the worst full-suite figure: a runner 3× slower still has 6× headroom. The
 * grid is the same 54 cells; the health check below bounds its size, so a
 * cell lost from it fails rather than passing vacuously.
 */
const CELL_TIMEOUT = 15_000;
const CELLS = SHAPES.flatMap(([label, make]) =>
  SIZES.map(([w, h]) => ({ name: `${label} ${w}×${h}`, make, w, h })),
);

it("health: the grid is every shape at every size, 9 × 6 cells, no two alike", () => {
  expect(SHAPES.length).toBe(9);
  expect(SIZES.length).toBe(6);
  expect(CELLS.length).toBe(54);
  expect(new Set(CELLS.map((c) => c.name)).size).toBe(54);
});

/** Count 0xFF 0x00 pairs between the SOS header and EOI: the stuffed bytes. */
function stuffedBytes(jpeg: Uint8Array): number {
  let i = 2;
  while (i < jpeg.length) {
    const marker = jpeg[i + 1]!;
    const length = (jpeg[i + 2]! << 8) | jpeg[i + 3]!;
    if (marker === 0xda) {
      i += 2 + length;
      break;
    }
    i += 2 + length;
  }
  let stuffed = 0;
  for (; i < jpeg.length - 2; i++)
    if (jpeg[i] === 0xff && jpeg[i + 1] === 0x00) stuffed++;
  return stuffed;
}

function category(value: number): number {
  let m = Math.abs(value);
  let bits = 0;
  while (m) {
    bits++;
    m >>= 1;
  }
  return bits;
}

/** The encoder's size, rebuilt from `quantizeGrayBlock` alone (no stuffing). */
function rebuiltSize(
  plane: Uint8Array,
  width: number,
  height: number,
  quality: number,
): number {
  const quant = grayJpegQuantTable(quality);
  const blocksX = Math.ceil(width / 8);
  const blocksY = Math.ceil(height / 8);
  const coefficients = new Int16Array(64);
  const scratch = new Float64Array(128);
  const dcFreq = new Float64Array(256);
  const acFreq = new Float64Array(256);
  const symbols: [number, number, number][] = []; // [table, symbol, extra]
  let previousDc = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      quantizeGrayBlock(
        plane,
        width,
        height,
        bx,
        by,
        quant,
        coefficients,
        scratch,
      );
      const dcSize = category(coefficients[0]! - previousDc);
      previousDc = coefficients[0]!;
      dcFreq[dcSize]!++;
      symbols.push([0, dcSize, dcSize]);
      let run = 0;
      for (let k = 1; k < 64; k++) {
        const c = coefficients[k]!;
        if (c === 0) {
          run++;
          continue;
        }
        while (run > 15) {
          acFreq[0xf0]!++;
          symbols.push([1, 0xf0, 0]);
          run -= 16;
        }
        const size = category(c);
        acFreq[(run << 4) | size]!++;
        symbols.push([1, (run << 4) | size, size]);
        run = 0;
      }
      if (run > 0) {
        acFreq[0]!++;
        symbols.push([1, 0, 0]);
      }
    }
  }
  const tables = [optimalHuffmanTable(dcFreq), optimalHuffmanTable(acFreq)];
  let bits = 0;
  for (const [t, symbol, extra] of symbols)
    bits += tables[t]!.size[symbol]! + extra;
  const headers =
    114 + (21 + tables[0]!.values.length) + (21 + tables[1]!.values.length);
  return headers + Math.ceil(bits / 8);
}

describe("quantizeGrayBlock is the encoder's own transform", () => {
  // One test per shape (it was one test over all nine; see CELL_TIMEOUT).
  for (const [label, make] of SHAPES) {
    it(
      `rebuilds encodeGrayJpeg's byte count exactly: ${label}`,
      () => {
        const sizes: [number, number][] = [
          [1, 1],
          [9, 17],
          [200, 150],
          [640, 480],
        ];
        let checked = 0;
        for (const [w, h] of sizes) {
          for (const q of [0.5, 0.88, 1]) {
            const plane = make(w, h);
            const jpeg = encodeGrayJpeg(plane, w, h, q);
            expect(
              rebuiltSize(plane, w, h, q) + stuffedBytes(jpeg),
              `${label} ${w}×${h} q${q}`,
            ).toBe(jpeg.length);
            checked++;
          }
        }
        // Health check: the loop ran over the whole grid for this shape.
        expect(checked).toBe(4 * 3);
      },
      CELL_TIMEOUT,
    );
  }

  it("POSITIVE CONTROL: the rebuild sees a one-step change in the quantizer", () => {
    const plane = textPlane(200, 150, 4);
    const jpeg = encodeGrayJpeg(plane, 200, 150, 0.88);
    expect(rebuiltSize(plane, 200, 150, 0.87) + stuffedBytes(jpeg)).not.toBe(
      jpeg.length,
    );
  });
});

describe("grayJpegLowerBound", () => {
  for (const { name, make, w, h } of CELLS) {
    it(
      `is never above what the encoder writes: ${name}, at every quality`,
      () => {
        const plane = make(w, h);
        let checked = 0;
        for (const q of [0.5, 0.88, 1]) {
          const actual = encodeGrayJpeg(plane, w, h, q).length;
          const bound = grayJpegLowerBound(plane, w, h, q);
          expect(bound, `${name} q${q}`).toBeLessThanOrEqual(actual);
          expect(bound).toBeGreaterThanOrEqual(grayJpegFloorBytes(w, h));
          checked++;
        }
        expect(checked).toBe(3);
      },
      CELL_TIMEOUT,
    );
  }

  it("POSITIVE CONTROL: on text it reaches at least half the real size, far above the floor", () => {
    for (const lines of [6, 15, 50]) {
      const plane = textPlane(W, H, lines);
      const actual = encodeGrayJpeg(plane, W, H, 0.88).length;
      const bound = grayJpegLowerBound(plane, W, H, 0.88);
      expect(bound / actual, `${lines} lines`).toBeGreaterThanOrEqual(0.5);
      expect(bound, `${lines} lines`).toBeGreaterThan(
        3 * grayJpegFloorBytes(W, H),
      );
    }
  });
});

describe("grayJpegCanBeat", () => {
  async function flateBytes(plane: Uint8Array): Promise<number> {
    const doc = await PDFDocument.create();
    return doc.context.flateStream(plane, {}).contents.length;
  }

  it(
    "says no on text pages of every density, where Flate wins",
    async () => {
      for (const lines of [1, 6, 15, 50]) {
        const plane = textPlane(W, H, lines);
        const flate = await flateBytes(plane);
        // Health check: the shape the review named — Flate wins, above the floor.
        expect(flate).toBeLessThan(encodeGrayJpeg(plane, W, H, 0.88).length);
        if (lines >= 6) expect(flate).toBeGreaterThan(grayJpegFloorBytes(W, H));
        expect(
          grayJpegCanBeat(plane, W, H, 0.88, flate),
          `${lines} lines`,
        ).toBe(false);
      }
    },
    CELL_TIMEOUT,
  );

  for (const { name, make, w, h } of CELLS) {
    it(
      `says maybe wherever the JPEG is the smaller one, so it never drops a winner: ${name}`,
      async () => {
        const plane = make(w, h);
        const flate = await flateBytes(plane);
        const jpeg = encodeGrayJpeg(plane, w, h, 0.88).length;
        // Every budget at or above the JPEG must be answered "maybe".
        for (const budget of [jpeg, flate].filter((b) => b >= jpeg))
          expect(
            grayJpegCanBeat(plane, w, h, 0.88, budget),
            `${name} budget ${budget}`,
          ).toBe(true);
      },
      CELL_TIMEOUT,
    );
  }
});
