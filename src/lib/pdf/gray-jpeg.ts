/**
 * A baseline JPEG encoder for ONE component: an 8-bit luminance plane in, a
 * JFIF file whose frame header declares a single component out.
 *
 * WHY THIS EXISTS. The browser's canvas encoder can only emit YCbCr JPEGs —
 * `canvas.toBlob("image/jpeg")` writes `SOF0 … components = 3` whatever the
 * pixels are — and pdf-lib derives the image's colour space from that count
 * (`1 → DeviceGray`, `3 → DeviceRGB`). So a page that had been desaturated
 * pixel by pixel still went into the PDF as a DeviceRGB image: grey to the eye,
 * COLOUR to every print driver, preflight check and "Output Preview" panel —
 * which is the one property someone choosing "grayscale PDF" is buying.
 * There is no canvas API that produces a one-component JPEG, so we write one.
 *
 * Scope, deliberately small: sequential DCT (SOF0), 8-bit samples, one
 * component at 1×1 sampling, no restart intervals. Huffman tables are OPTIMAL
 * for the image (two passes, ITU T.81 Annex K.2) rather than the Annex K.3
 * examples — measured on 1275×1650 pages, the example tables cost 14–60% more
 * bytes than libjpeg-turbo's optimized output, and Chrome's own encoder already
 * optimizes, so the standard tables would have made this fix a size regression.
 * Quality maps to the quantizer exactly as libjpeg's `jpeg_quality_scaling`
 * does, so `0.88` here means what `toBlob(…, 0.88)` meant before.
 *
 * Pure and DOM-free: the browser tool and the Node unit tests run this same
 * code, and the tests decode its output with an independent decoder (pdf.js).
 */

/** ITU T.81 Table K.1 — the example luminance quantizer, natural order. */
const BASE_LUMINANCE_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16,
  24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109,
  103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

/** Zigzag position → natural (row-major) index within an 8×8 block. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

/** `COS[u * 8 + x] = C(u)/2 · cos((2x+1)uπ/16)` — one 1-D orthonormal DCT row. */
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

/**
 * libjpeg's quality → quantizer mapping (`jpeg_quality_scaling` +
 * `jpeg_add_quant_table` with `force_baseline`), for a quality in [0, 1].
 * Returned in NATURAL order.
 */
export function grayJpegQuantTable(quality: number): Uint8Array {
  const q = Math.min(
    100,
    Math.max(1, Math.round((Number.isFinite(quality) ? quality : 0.88) * 100)),
  );
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const table = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const value = Math.floor((BASE_LUMINANCE_QUANT[i]! * scale + 50) / 100);
    table[i] = Math.min(255, Math.max(1, value));
  }
  return table;
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

interface HuffmanTable {
  /** `bits[l]` = number of codes of length l, for l = 1..16 (index 0 unused). */
  bits: Uint8Array;
  /** Symbols in order of increasing code length. */
  values: number[];
  /** Code and length for every symbol that has one. */
  code: Uint32Array;
  size: Uint8Array;
}

/**
 * Build the optimal length-limited Huffman table for `freq` (256 symbols),
 * exactly as T.81 Annex K.2 prescribes — including the reserved code point that
 * guarantees no symbol is assigned an all-ones code.
 */
export function optimalHuffmanTable(freq: ArrayLike<number>): HuffmanTable {
  const f = new Float64Array(257);
  for (let i = 0; i < 256; i++) f[i] = freq[i] ?? 0;
  f[256] = 1; // the reserved code point
  const codesize = new Int32Array(257);
  const others = new Int32Array(257).fill(-1);

  for (;;) {
    // c1: smallest nonzero frequency (ties go to the larger symbol); c2: next.
    let c1 = -1;
    let v = Infinity;
    for (let i = 0; i <= 256; i++) {
      if (f[i]! > 0 && f[i]! <= v) {
        v = f[i]!;
        c1 = i;
      }
    }
    let c2 = -1;
    v = Infinity;
    for (let i = 0; i <= 256; i++) {
      if (f[i]! > 0 && f[i]! <= v && i !== c1) {
        v = f[i]!;
        c2 = i;
      }
    }
    if (c2 < 0) break;
    f[c1] = f[c1]! + f[c2]!;
    f[c2] = 0;
    codesize[c1]!++;
    while (others[c1]! >= 0) {
      c1 = others[c1]!;
      codesize[c1]!++;
    }
    others[c1] = c2;
    codesize[c2]!++;
    while (others[c2]! >= 0) {
      c2 = others[c2]!;
      codesize[c2]!++;
    }
  }

  const counts = new Int32Array(33);
  for (let i = 0; i <= 256; i++) {
    if (codesize[i]! > 0) counts[codesize[i]!]!++;
  }
  // Limit code lengths to 16 bits (Annex K.2, Figure K.3).
  for (let i = 32; i > 16; i--) {
    while (counts[i]! > 0) {
      let j = i - 2;
      while (counts[j] === 0) j--;
      counts[i]! -= 2;
      counts[i - 1]!++;
      counts[j + 1]! += 2;
      counts[j]!--;
    }
  }
  // Drop the reserved code point: it holds the longest code.
  let longest = 16;
  while (counts[longest] === 0) longest--;
  counts[longest]!--;

  const values: number[] = [];
  for (let length = 1; length <= 32; length++) {
    for (let symbol = 0; symbol < 256; symbol++) {
      if (codesize[symbol] === length) values.push(symbol);
    }
  }

  const bits = new Uint8Array(17);
  for (let l = 1; l <= 16; l++) bits[l] = counts[l]!;

  // Canonical code assignment (T.81 Annex C).
  const code = new Uint32Array(256);
  const size = new Uint8Array(256);
  let next = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let n = 0; n < bits[l]!; n++) {
      const symbol = values[k++]!;
      code[symbol] = next++;
      size[symbol] = l;
    }
    next <<= 1;
  }
  return { bits, values: values.slice(0, k), code, size };
}

/** Append-only byte buffer with JPEG entropy-coded-segment bit packing. */
class ByteSink {
  private buf = new Uint8Array(1 << 16);
  private len = 0;
  private acc = 0;
  private nbits = 0;

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(value: number): void {
    this.ensure(1);
    this.buf[this.len++] = value & 0xff;
  }

  word(value: number): void {
    this.byte(value >> 8);
    this.byte(value);
  }

  bytes(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.byte(values[i]!);
  }

  /** Emit the low `count` bits of `value`, stuffing a 0x00 after every 0xFF. */
  bits(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      if (++this.nbits === 8) {
        this.byte(this.acc);
        if (this.acc === 0xff) this.byte(0);
        this.acc = 0;
        this.nbits = 0;
      }
    }
  }

  /** Pad the final partial byte with 1-bits, as T.81 F.1.2.3 requires. */
  flushBits(): void {
    if (this.nbits > 0) this.bits((1 << (8 - this.nbits)) - 1, 8 - this.nbits);
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/**
 * Encode an 8-bit luminance plane (`width * height` bytes, row-major, top row
 * first) as a baseline, single-component JPEG. `quality` is in [0, 1], with the
 * same meaning as the canvas encoder's `quality` argument.
 */
export function encodeGrayJpeg(
  plane: Uint8Array,
  width: number,
  height: number,
  quality = 0.88,
): Uint8Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 0xffff ||
    height > 0xffff
  ) {
    throw new RangeError(`Invalid JPEG dimensions ${width}×${height}.`);
  }
  if (plane.length !== width * height) {
    throw new RangeError(
      `Luminance plane holds ${plane.length} samples, expected ${width * height}.`,
    );
  }

  const quant = grayJpegQuantTable(quality);
  const blocksX = Math.ceil(width / 8);
  const blocksY = Math.ceil(height / 8);
  const blockCount = blocksX * blocksY;
  // Pass 1: transform + quantize every block (kept, zigzag order, for pass 2).
  const coefficients = new Int16Array(blockCount * 64);
  const block = new Float64Array(64);
  const rows = new Float64Array(64);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Level-shifted samples; the right/bottom edge is padded by replication.
      for (let y = 0; y < 8; y++) {
        const sy = Math.min(by * 8 + y, height - 1) * width;
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(bx * 8 + x, width - 1);
          block[y * 8 + x] = plane[sy + sx]! - 128;
        }
      }
      // Separable 2-D DCT-II: rows, then columns.
      for (let y = 0; y < 8; y++) {
        for (let u = 0; u < 8; u++) {
          let sum = 0;
          for (let x = 0; x < 8; x++)
            sum += COS[u * 8 + x]! * block[y * 8 + x]!;
          rows[y * 8 + u] = sum;
        }
      }
      const base = (by * blocksX + bx) * 64;
      for (let k = 0; k < 64; k++) {
        const natural = ZIGZAG[k]!;
        const v = natural >> 3;
        const u = natural & 7;
        let sum = 0;
        for (let y = 0; y < 8; y++) sum += COS[v * 8 + y]! * rows[y * 8 + u]!;
        coefficients[base + k] = Math.round(sum / quant[natural]!);
      }
    }
  }

  // Pass 1b: symbol statistics for the optimal Huffman tables.
  const dcFreq = new Float64Array(256);
  const acFreq = new Float64Array(256);
  let previousDc = 0;
  for (let b = 0; b < blockCount; b++) {
    const base = b * 64;
    const dc = coefficients[base]!;
    dcFreq[category(dc - previousDc)]!++;
    previousDc = dc;
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const c = coefficients[base + k]!;
      if (c === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        acFreq[0xf0]!++;
        run -= 16;
      }
      acFreq[(run << 4) | category(c)]!++;
      run = 0;
    }
    if (run > 0) acFreq[0x00]!++;
  }
  const dcTable = optimalHuffmanTable(dcFreq);
  const acTable = optimalHuffmanTable(acFreq);

  const out = new ByteSink();
  out.word(0xffd8); // SOI
  // APP0 / JFIF 1.01, no thumbnail, 1:1 aspect.
  out.word(0xffe0);
  out.word(16);
  out.bytes([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  // DQT: one 8-bit table, id 0, zigzag order.
  out.word(0xffdb);
  out.word(67);
  out.byte(0x00);
  for (let k = 0; k < 64; k++) out.byte(quant[ZIGZAG[k]!]!);
  // SOF0: baseline, 8-bit, ONE component — the whole point of this module.
  out.word(0xffc0);
  out.word(11);
  out.byte(8);
  out.word(height);
  out.word(width);
  out.byte(1); // number of components
  out.byte(1); // component id
  out.byte(0x11); // 1×1 sampling
  out.byte(0); // quantizer 0
  // DHT: DC table 0 and AC table 0.
  for (const [klass, table] of [
    [0x00, dcTable],
    [0x10, acTable],
  ] as const) {
    out.word(0xffc4);
    out.word(2 + 1 + 16 + table.values.length);
    out.byte(klass);
    for (let l = 1; l <= 16; l++) out.byte(table.bits[l]!);
    out.bytes(table.values);
  }
  // SOS: one component, full spectral range, no approximation.
  out.word(0xffda);
  out.word(8);
  out.byte(1);
  out.byte(1);
  out.byte(0x00);
  out.byte(0);
  out.byte(63);
  out.byte(0);

  // Pass 2: entropy-code.
  previousDc = 0;
  for (let b = 0; b < blockCount; b++) {
    const base = b * 64;
    const dc = coefficients[base]!;
    const diff = dc - previousDc;
    previousDc = dc;
    const dcSize = category(diff);
    out.bits(dcTable.code[dcSize]!, dcTable.size[dcSize]!);
    if (dcSize) out.bits(diff < 0 ? diff + (1 << dcSize) - 1 : diff, dcSize);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const c = coefficients[base + k]!;
      if (c === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        out.bits(acTable.code[0xf0]!, acTable.size[0xf0]!);
        run -= 16;
      }
      const acSize = category(c);
      const symbol = (run << 4) | acSize;
      out.bits(acTable.code[symbol]!, acTable.size[symbol]!);
      out.bits(c < 0 ? c + (1 << acSize) - 1 : c, acSize);
      run = 0;
    }
    if (run > 0) out.bits(acTable.code[0x00]!, acTable.size[0x00]!);
  }
  out.flushBits();
  out.word(0xffd9); // EOI
  return out.result();
}

/** Component count declared by a JPEG's frame header, or null if none is found. */
export function jpegComponentCount(jpeg: Uint8Array): number | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 4 <= jpeg.length) {
    if (jpeg[pos] !== 0xff) return null;
    const marker = jpeg[pos + 1]!;
    if (marker === 0xff) {
      pos++;
      continue;
    }
    const length = (jpeg[pos + 2]! << 8) | jpeg[pos + 3]!;
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return pos + 9 < jpeg.length ? jpeg[pos + 9]! : null;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    pos += 2 + length;
  }
  return null;
}
