/**
 * How a font's cmap is carried into the browser.
 *
 * Routing has to decide WHICH face to fetch before it can fetch one, so the
 * decision cannot ask the font — the font is the 10 MB thing we are trying not
 * to download. The alternative to guessing is to bring the answer along, and
 * the answer is "which of ~65,000 code points does this face have", which is a
 * bitmap: 8,192 bytes flat, ~11 KB as base64, a couple of KB gzipped, and the
 * same size whether a face has 445 glyphs or 30,890.
 *
 * A run-length table was measured first and rejected: exact, but 4,845 runs for
 * Noto Sans JP and 4,721 for Noto Sans KR — 96 KB of JSON for two faces,
 * because their CJK coverage is scattered rather than contiguous. The bitmap is
 * eight times smaller for the same exactness and has no worst case.
 *
 * Astral code points (above U+FFFF) stay as explicit ranges: the shipped faces
 * have few or none, and a second 8 KB plane per face to say "no" is silly.
 */

/** One face's coverage: a BMP bitmap plus any ranges above the BMP. */
export interface PackCoverage {
  /** base64 of 8,192 bytes; bit `cp & 7` of byte `cp >> 3` is set when covered. */
  readonly bmp: string;
  /** Inclusive ranges above U+FFFF, ascending. */
  readonly astral: readonly (readonly [number, number])[];
}

const BMP_BYTES = 0x10000 / 8;

/** Build a face's coverage from the code points its cmap reports. */
export function encodeCoverage(codePoints: Iterable<number>): PackCoverage {
  const bits = new Uint8Array(BMP_BYTES);
  const astral: number[] = [];
  for (const cp of codePoints) {
    if (cp < 0) continue;
    if (cp <= 0xffff) bits[cp >> 3]! |= 1 << (cp & 7);
    else astral.push(cp);
  }
  astral.sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const cp of astral) {
    const last = ranges[ranges.length - 1];
    if (last && cp === last[1] + 1) last[1] = cp;
    else ranges.push([cp, cp]);
  }
  return { bmp: toBase64(bits), astral: ranges };
}

/** Decode the BMP half once, so lookups are a bit test rather than a parse. */
export function decodeBmp(coverage: PackCoverage): Uint8Array {
  const bytes = fromBase64(coverage.bmp);
  if (bytes.length !== BMP_BYTES) {
    // A short bitmap would answer "not covered" for every code point past the
    // truncation — i.e. it would refuse silently and look like a small font.
    // Loud is the only safe direction here.
    throw new Error(
      `font coverage bitmap is ${bytes.length} bytes, expected ${BMP_BYTES}`,
    );
  }
  return bytes;
}

/** Is `cp` in this face's cmap? */
export function coverageHas(
  bmp: Uint8Array,
  astral: readonly (readonly [number, number])[],
  cp: number,
): boolean {
  if (cp <= 0xffff) return (bmp[cp >> 3]! & (1 << (cp & 7))) !== 0;
  for (const [lo, hi] of astral) if (cp >= lo && cp <= hi) return true;
  return false;
}

/** How many code points a bitmap claims — the health check for a blind table. */
export function coverageSize(
  bmp: Uint8Array,
  astral: readonly (readonly [number, number])[],
): number {
  let n = 0;
  for (const byte of bmp) {
    let b = byte;
    while (b) {
      n += b & 1;
      b >>= 1;
    }
  }
  for (const [lo, hi] of astral) n += hi - lo + 1;
  return n;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
