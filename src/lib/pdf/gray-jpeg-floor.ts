/**
 * The fewest bytes `encodeGrayJpeg` (`./gray-jpeg`) can write for a
 * `width × height` plane, WHATEVER its pixels. Grayscale PDF's builder uses
 * it to skip a JPEG that could not win (`./grayscale-builder`).
 *
 * Derived from the encoder's structure, not measured:
 *  - Headers, written for every image: SOI (2) + APP0/JFIF (18) + DQT (69) +
 *    SOF0 (13) + SOS (10) + EOI (2) = 114 bytes, plus two DHT segments of at
 *    least 2 + 2 + 1 + 16 + 1 = 22 bytes each (every table holds at least one
 *    real symbol: there is always a DC difference, and every block ends in
 *    either EOB or a coefficient), so 158 in all.
 *  - Entropy-coded data: every 8×8 block (the edges are padded up to whole
 *    blocks) writes one DC code and at least one AC code (EOB, or the symbol
 *    of its last coefficient). The tables are built per T.81 Annex K.2 with
 *    a reserved code point, so no code is shorter than 1 bit: at least 2 bits
 *    a block. Magnitude bits and 0xFF stuffing only add to that.
 *
 * `gray-jpeg-floor.test.ts` holds it from both sides: below the encoder's
 * real output for every plane it tries, and within a few bytes of it for a
 * flat plane (the cheapest content there is), so the floor cannot drift to a
 * value that is true and useless.
 */
const HEADER_BYTES = 158;

export function grayJpegFloorBytes(width: number, height: number): number {
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  return HEADER_BYTES + Math.ceil((2 * blocks) / 8);
}
