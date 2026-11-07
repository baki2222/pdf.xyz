/**
 * Images that state a resolution, for the Fit-to-image density tests (audits
 * jpg-to-pdf#4, png-to-pdf#4). Written here byte by byte rather than by the
 * code under test; each file's own parser health check is in
 * image-density.test.ts.
 */
import { crc32, deflateSync } from "node:zlib";
import { JPEG_30X20, spliceAfterSoi } from "./jpeg-fixtures";

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A `width` × `height` 8-bit greyscale PNG, mid-grey, with a pHYs chunk of
 * `ppm` pixels per metre on both axes (unit 1) — or `phys` as given.
 */
export function greyPng(
  width: number,
  height: number,
  phys?: { x: number; y: number; unit: number },
): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0; // filter: None
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
  ];
  if (phys) {
    const p = Buffer.alloc(9);
    p.writeUInt32BE(phys.x, 0);
    p.writeUInt32BE(phys.y, 4);
    p[8] = phys.unit;
    parts.push(chunk("pHYs", p));
  }
  parts.push(chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array()));
  return new Uint8Array(Buffer.concat(parts));
}

/** Pixels per metre for `dpi`, rounded as PNG writers store it. */
export const ppmOf = (dpi: number) => Math.round(dpi / 0.0254);

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (payload.length + 2) >> 8;
  out[3] = (payload.length + 2) & 0xff;
  out.set(payload, 4);
  return out;
}

/** The 30×20 fixture with a JFIF APP0 stating `x` × `y` in `units`. */
export function jpegWithJfifDensity(x: number, y = x, units = 1): Uint8Array {
  const p = Buffer.from([
    0x4a,
    0x46,
    0x49,
    0x46,
    0,
    1,
    1,
    units,
    x >> 8,
    x & 0xff,
    y >> 8,
    y & 0xff,
    0,
    0,
  ]);
  return spliceAfterSoi(JPEG_30X20, segment(0xe0, p));
}

/**
 * The 30×20 fixture with a big-endian Exif APP1 whose IFD0 holds
 * XResolution, YResolution (RATIONAL `dpi`/1) and ResolutionUnit `unit`.
 */
export function jpegWithExifResolution(dpi: number, unit = 2): Uint8Array {
  const t = Buffer.alloc(8 + 2 + 3 * 12 + 4 + 16);
  t.write("MM", 0, "latin1");
  t.writeUInt16BE(42, 2);
  t.writeUInt32BE(8, 4);
  t.writeUInt16BE(3, 8);
  const values = 8 + 2 + 3 * 12 + 4;
  const entry = (i: number, tag: number, type: number, value: number) => {
    const at = 10 + i * 12;
    t.writeUInt16BE(tag, at);
    t.writeUInt16BE(type, at + 2);
    t.writeUInt32BE(1, at + 4);
    if (type === 3) t.writeUInt16BE(value, at + 8);
    else t.writeUInt32BE(value, at + 8);
  };
  entry(0, 0x011a, 5, values);
  entry(1, 0x011b, 5, values + 8);
  entry(2, 0x0128, 3, unit);
  t.writeUInt32BE(dpi, values);
  t.writeUInt32BE(1, values + 4);
  t.writeUInt32BE(dpi, values + 8);
  t.writeUInt32BE(1, values + 12);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]);
  return spliceAfterSoi(JPEG_30X20, segment(0xe1, payload));
}
