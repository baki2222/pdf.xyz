/**
 * GIF and BMP fixtures, written byte by byte — for JPG / PNG to PDF's WebP,
 * GIF and BMP input (`src/lib/pdf/image-transcode.ts`). Shared by the Node
 * proof (`src/lib/pdf/image-formats.test.ts`) and the browser proof
 * (`e2e/client-proof/cases.ts`), so both decode the same bytes. No encoder
 * library, no committed sample file: each is a few dozen bytes built here.
 */

export type RGB = [number, number, number];
export const RED: RGB = [255, 0, 0];
export const BLUE: RGB = [0, 0, 255];

/**
 * A GIF89a of `w`×`h`, one solid colour per frame, so "the first frame" is
 * checkable by colour. LZW with a 2-bit minimum code size and a Clear code
 * before every pixel: the code width never grows past 3 bits, so the encoder
 * is a bit-packer and nothing else.
 */
export function gifOf(w: number, h: number, frames: RGB[]): Buffer {
  const palette: RGB[] = [RED, BLUE, [255, 255, 255], [0, 0, 0]];
  const u16 = (n: number) => [n & 0xff, n >> 8];
  const out: number[] = [
    ...Buffer.from("GIF89a"),
    ...u16(w),
    ...u16(h),
    0x81, // a global colour table of 2^(1+1) = 4 entries
    0,
    0,
    ...palette.flat(),
  ];
  for (const colour of frames) {
    const index = palette.findIndex((p) => p.join() === colour.join());
    if (index < 0) throw new Error(`no palette entry for ${colour.join()}`);
    // Graphic control: a 10 cs delay, no transparency.
    out.push(0x21, 0xf9, 0x04, 0x00, 10, 0, 0, 0);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(w), ...u16(h), 0);
    const codes: number[] = [];
    for (let i = 0; i < w * h; i++) codes.push(4, index);
    codes.push(5);
    const bytes: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const code of codes) {
      acc |= code << bits;
      bits += 3;
      while (bits >= 8) {
        bytes.push(acc & 0xff);
        acc >>= 8;
        bits -= 8;
      }
    }
    if (bits > 0) bytes.push(acc & 0xff);
    out.push(2);
    for (let i = 0; i < bytes.length; i += 255) {
      const block = bytes.slice(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}

/** A 24-bit bottom-up BMP of `w`×`h` in one colour. */
export function bmpOf(w: number, h: number, [r, g, b]: RGB): Buffer {
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const buf = Buffer.alloc(size);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const at = 54 + y * row + x * 3;
      buf[at] = b;
      buf[at + 1] = g;
      buf[at + 2] = r;
    }
  return buf;
}
