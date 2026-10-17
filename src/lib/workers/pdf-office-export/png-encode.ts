/**
 * A compressed PNG from raw pixels, on the worker.
 *
 * `@/lib/pdf/extract-images` has the browser's encoder, which writes STORED
 * deflate blocks (no compression) so it can stay dependency-free. Pictures in
 * a deck are downloaded by a person, so here the rows are deflated with
 * `node:zlib`: a two-tone scanned page at 300 dpi is tens of kilobytes as a
 * 1-bit PNG and megabytes as 32-bit RGBA. The layout matches what pdf.js
 * hands back (rows top first, a 1-bit row padded to a whole byte, a set bit
 * white), so its 1-bit images go in untouched.
 */
import { deflateSync } from "node:zlib";

export type PngLayout = "gray1" | "gray8" | "rgb8" | "rgba8";

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encode `samples` as a PNG. For `gray1` the input is already packed (rows
 * padded to a byte); for the others it is one byte per channel. RGBA input is
 * accepted for `gray8` and `rgb8` too, and narrowed (R for grey, RGB for RGB):
 * pass `channels` as the input's own channel count when it differs.
 */
export function encodePngImage(
  width: number,
  height: number,
  layout: PngLayout,
  samples: ArrayLike<number>,
  channels: number = layout === "gray1"
    ? 0
    : layout === "gray8"
      ? samples.length >= width * height * 4
        ? 4
        : 1
      : layout === "rgb8"
        ? samples.length >= width * height * 4
          ? 4
          : 3
        : 4,
): Uint8Array {
  const outChannels =
    layout === "gray1" ? 0 : layout === "gray8" ? 1 : layout === "rgb8" ? 3 : 4;
  const rowBytes = layout === "gray1" ? (width + 7) >> 3 : width * outChannels;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0; // filter: none
    if (layout === "gray1") {
      for (let i = 0; i < rowBytes; i++)
        raw[row + 1 + i] = samples[y * rowBytes + i]!;
      continue;
    }
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const dst = row + 1 + x * outChannels;
      for (let c = 0; c < outChannels; c++) raw[dst + c] = samples[src + c]!;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = layout === "gray1" ? 1 : 8;
  ihdr[9] =
    layout === "gray1" || layout === "gray8" ? 0 : layout === "rgb8" ? 2 : 6;
  const parts = [
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 6 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
