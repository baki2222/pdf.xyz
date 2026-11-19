import { grayJpegQuantTable } from "./gray-jpeg";
import { grayJpegFloorBytes } from "./gray-jpeg-floor";

/**
 * Can a JPEG from `encodeGrayJpeg` (`./gray-jpeg`) still be smaller than
 * `budget` bytes? Grayscale PDF's builder asks this with its Flate image's
 * size as the budget, and skips the JPEG when the answer is no
 * (`./grayscale-builder`).
 *
 * WHY. A rendered text page deflates to about a third of its JPEG (measured
 * at 150 DPI on Letter pages: 6 lines of body text, Flate 29.8 KB and JPEG
 * 90.4 KB; 50 lines, 232 KB and 646 KB), so on a text PDF the JPEG was made
 * and thrown away on every page, and it was the largest single cost of the
 * run (perf sweep 2026-11-18, P3). A size floor alone (`./gray-jpeg-floor`)
 * only settles nearly blank pages: a few lines of text deflate above it.
 *
 * HOW, and why the answer "no" is EXACT. The result is a lower bound on the
 * encoder's output, grown until it passes the budget or stops looking likely
 * to:
 *  - Every block writes at least one DC code and one AC code (EOB or a
 *    coefficient), each at least 1 bit — the floor.
 *  - A block whose 64 samples are all equal (white paper) is counted at that
 *    floor and never transformed. Every other block is transformed and
 *    quantized EXACTLY as the encoder does it (same table, same arithmetic,
 *    same order: `quantizeGrayBlock` below — `gray-jpeg-bound.test.ts`
 *    rebuilds the encoder's byte count from it, exactly, as the guard). Its AC
 *    symbols and their magnitude bits are then known. Magnitude bits are
 *    written as they are, whatever the tables. The codes for the symbols
 *    cost at least 1 bit each, and at least their count times their
 *    empirical entropy: that holds for ANY prefix code (Kraft's inequality
 *    with Gibbs'), so for the tables the encoder will build too.
 *  - DC magnitude bits, 0xFF stuffing and the final padding only add, and
 *    are left out.
 * So when the bound is above the budget, the JPEG is too, and the old rule
 * (keep the smaller) would have kept the Flate image: same choice, same
 * bytes.
 *
 * ORDER. Block rows are visited in 16 interleaved passes (rows 0, 16, 32 …
 * then 8, 24 … and so on), so the bound rises evenly over the page instead
 * of only where the text starts. After each pass the bound is projected to
 * the whole page; when even the projection does not pass the budget (a
 * photograph or scan, where the JPEG wins), it stops and answers "maybe",
 * and the encoder runs. That give-up is a guess about SPEED only: the answer
 * "no" is only ever given by the bound itself.
 */
export function grayJpegCanBeat(
  plane: Uint8Array,
  width: number,
  height: number,
  quality: number,
  budget: number,
): boolean {
  return !walkBound(plane, width, height, quality, budget, true).settled;
}

/**
 * The whole lower bound, every row visited, never given up: the number
 * `grayJpegCanBeat` compares with its budget. For the tests that hold it
 * below the encoder's real output and close enough to it to be worth having.
 */
export function grayJpegLowerBound(
  plane: Uint8Array,
  width: number,
  height: number,
  quality: number,
): number {
  return walkBound(plane, width, height, quality, Infinity, false).bound;
}

function walkBound(
  plane: Uint8Array,
  width: number,
  height: number,
  quality: number,
  budget: number,
  giveUp: boolean,
): { bound: number; settled: boolean } {
  const floor = grayJpegFloorBytes(width, height);
  if (floor > budget) return { bound: floor, settled: true };

  const quant = grayJpegQuantTable(quality);
  const blocksX = Math.ceil(width / 8);
  const blocksY = Math.ceil(height / 8);
  const coefficients = new Int16Array(64);
  const scratch = new Float64Array(128);
  const acCounts = new Float64Array(256);
  let acSymbols = 0;
  let magnitudeBits = 0;
  let transformed = 0;
  let rowsSeen = 0;

  const boundBytes = (): number => {
    let distinct = 0;
    let entropy = 0;
    for (let s = 0; s < 256; s++) {
      const n = acCounts[s]!;
      if (n === 0) continue;
      distinct++;
      entropy += n * Math.log2(acSymbols / n);
    }
    // Rounded down, and a hair below, so floating error can only lower it.
    const codes = Math.max(acSymbols, Math.floor(entropy * (1 - 1e-9)));
    // The floor already holds one AC bit for every block; a transformed
    // block's codes are counted in `codes` instead.
    const bits = magnitudeBits + codes - transformed;
    return (
      floor + Math.max(0, distinct - 1) + Math.floor(Math.max(0, bits) / 8)
    );
  };

  let bound = floor;
  for (const offset of PASS_ORDER) {
    for (let by = offset; by < blocksY; by += 16) {
      rowsSeen++;
      for (let bx = 0; bx < blocksX; bx++) {
        if (isFlatBlock(plane, width, height, bx, by)) continue;
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
        transformed++;
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const c = coefficients[k]!;
          if (c === 0) {
            run++;
            continue;
          }
          while (run > 15) {
            acCounts[0xf0]!++;
            acSymbols++;
            run -= 16;
          }
          const size = category(c);
          acCounts[(run << 4) | size]!++;
          acSymbols++;
          magnitudeBits += size;
          run = 0;
        }
        if (run > 0) {
          acCounts[0x00]!++;
          acSymbols++;
        }
      }
    }
    if (rowsSeen === 0 || !giveUp) continue;
    bound = boundBytes();
    if (bound > budget) return { bound, settled: true };
    // Projected to every row: if even that stays within the budget, the
    // bound will not settle it, and the encoder must run.
    const projected = floor + ((bound - floor) * blocksY) / rowsSeen;
    if (projected <= budget) return { bound, settled: false };
  }
  bound = boundBytes();
  return { bound, settled: bound > budget };
}

/** Bit-reversed 0..15: each pass lands halfway between the rows already seen. */
const PASS_ORDER = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

/** All 64 samples of the block equal, with the encoder's edge replication. */
function isFlatBlock(
  plane: Uint8Array,
  width: number,
  height: number,
  bx: number,
  by: number,
): boolean {
  const first =
    plane[Math.min(by * 8, height - 1) * width + Math.min(bx * 8, width - 1)]!;
  for (let y = 0; y < 8; y++) {
    const sy = Math.min(by * 8 + y, height - 1) * width;
    for (let x = 0; x < 8; x++) {
      if (plane[sy + Math.min(bx * 8 + x, width - 1)] !== first) return false;
    }
  }
  return true;
}

/** Number of bits needed for |value| — the JPEG "size category". */
function category(value: number): number {
  let magnitude = value < 0 ? -value : value;
  let bits = 0;
  while (magnitude) {
    bits++;
    magnitude >>= 1;
  }
  return bits;
}

/**
 * `COS[u * 8 + x] = C(u)/2 · cos((2x+1)uπ/16)`, built exactly as
 * `./gray-jpeg` builds its own, so the products below are bit-identical.
 */
const COS = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    const c = u === 0 ? Math.SQRT1_2 : 1;
    for (let x = 0; x < 8; x++) {
      table[u * 8 + x] = (c / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return table;
})();

/** Zigzag position → natural index, as in `./gray-jpeg`. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

/**
 * The quantized coefficients of block (`bx`, `by`), in zigzag order, computed
 * with the same operations in the same order as `encodeGrayJpeg`'s pass 1.
 * `scratch` holds 128 doubles. Exported for the guard that rebuilds the
 * encoder's output size from it.
 */
export function quantizeGrayBlock(
  plane: Uint8Array,
  width: number,
  height: number,
  bx: number,
  by: number,
  quant: Uint8Array,
  out: Int16Array,
  scratch: Float64Array,
): void {
  const block = scratch.subarray(0, 64);
  const rows = scratch.subarray(64, 128);
  for (let y = 0; y < 8; y++) {
    const sy = Math.min(by * 8 + y, height - 1) * width;
    for (let x = 0; x < 8; x++) {
      const sx = Math.min(bx * 8 + x, width - 1);
      block[y * 8 + x] = plane[sy + sx]! - 128;
    }
  }
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) sum += COS[u * 8 + x]! * block[y * 8 + x]!;
      rows[y * 8 + u] = sum;
    }
  }
  for (let k = 0; k < 64; k++) {
    const natural = ZIGZAG[k]!;
    const v = natural >> 3;
    const u = natural & 7;
    let sum = 0;
    for (let y = 0; y < 8; y++) sum += COS[v * 8 + y]! * rows[y * 8 + u]!;
    out[k] = Math.round(sum / quant[natural]!);
  }
}
