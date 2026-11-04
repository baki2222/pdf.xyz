/**
 * TIFF fixtures for JPG / PNG to PDF's TIFF input (`src/lib/pdf/tiff.ts`),
 * shared by the Node proof (`src/lib/pdf/tiff.test.ts`) and the browser
 * proof (`e2e/client-proof/cases.ts`), so both read the same bytes.
 *
 * ── COMMITTED FILES (real encoder output, provenance known) ────────────────
 *
 * Two files in `./tiff-fixtures/`, written by GPL Ghostscript 10.0.0 on
 * 2026-11-04 from one two-page PostScript file: page 1 says "TIFFPAGEONE" in
 * black; page 2 says "TIFFPAGETWO" in black and "RED" in red. Each page is
 * 400 × 300 pixels at 100 dpi, so 288 × 216 points on paper.
 *
 *   g4.tif   1,590 B   gs -sDEVICE=tiffg4 -r100
 *                       1-bit, CCITT Group 4, WhiteIsZero (the red prints black)
 *   lzw.tif 22,712 B   gs -sDEVICE=tiff24nc -sCompression=lzw -r100
 *                       24-bit RGB, LZW (carries a 3 KB ICC profile)
 *   sha256 g4  d947b20bbb1f44bbebc240aad6ebc44bba8227d55dae7a517ad43b578e3d8f19
 *   sha256 lzw 055b62e793582aadc54b98aac72b53a0ef12f3a7debc9218ebe74ab844091399
 *
 * G4 is the one that cannot sensibly be built here (a CCITT encoder is a
 * project), and LZW is kept as a real encoder's output so the decoder is not
 * checked only against an encoder written beside it. Every other case is
 * built below, byte by byte, by {@link tiffOf}: uncompressed, PackBits and
 * Deflate, bilevel, gray, RGB, palette, alpha, tiles, a predictor, both byte
 * orders — and the damaged and over-ceiling headers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const DIR = path.join(__dirname, "tiff-fixtures");

/** A committed fixture's bytes, as a fresh `Uint8Array` at offset 0. */
export function tiffFixture(name: "g4.tif" | "lzw.tif"): Uint8Array {
  return new Uint8Array(readFileSync(path.join(DIR, name)));
}

/** What both committed fixtures hold, for assertions to read. */
export const GS_FIXTURE = {
  pages: 2,
  width: 400,
  height: 300,
  dpi: 100,
  widthPt: 288,
  heightPt: 216,
} as const;

/** One IFD entry: a tag, its TIFF type, its values. */
export type TiffEntry = [
  tag: number,
  type: 3 | 4 | 5 | 2 | 7,
  values: number[],
];

export interface TiffPageSpec {
  width: number;
  height: number;
  /** Bits per sample, one entry per sample. */
  bits: number[];
  photometric: number;
  compression?: 1 | 5 | 8 | 32773 | 4 | 3 | number;
  /** The page's samples as stored rows (before compression). */
  rows: Uint8Array;
  rowsPerStrip?: number;
  /** Tile size: rows are then split into tiles (row-major), padded. */
  tile?: { width: number; height: number };
  /** XResolution/YResolution (dpi) and unit; omit for none. */
  dpi?: { x: number; y: number; unit?: number };
  /** Any extra entries (overrides the written ones by tag). */
  extra?: TiffEntry[];
  predictor?: 2;
}

/** PackBits, as literal runs of up to 128 bytes and repeats of 3+. */
export function packBits(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && run < 128 && data[i + run] === data[i])
      run++;
    if (run >= 3) {
      out.push(257 - run, data[i]!);
      i += run;
      continue;
    }
    const start = i;
    while (
      i < data.length &&
      i - start < 128 &&
      !(
        i + 2 < data.length &&
        data[i] === data[i + 1] &&
        data[i] === data[i + 2]
      )
    )
      i++;
    out.push(i - start - 1, ...data.subarray(start, i));
  }
  return new Uint8Array(out);
}

const compress = (code: number, data: Uint8Array): Uint8Array =>
  code === 32773 ? packBits(data) : code === 8 ? deflateSync(data) : data;

/** Row bytes for a page's samples. */
export const rowBytesOf = (width: number, bits: number[]) =>
  Math.ceil((width * bits.reduce((a, b) => a + b, 0)) / 8);

/** Horizontal differencing (Predictor 2) for 8-bit samples. */
function difference(rows: Uint8Array, rowBytes: number, spp: number) {
  const out = new Uint8Array(rows);
  for (let r = 0; r < rows.length / rowBytes; r++)
    for (let i = rowBytes - 1; i >= spp; i--)
      out[r * rowBytes + i] =
        (rows[r * rowBytes + i]! - rows[r * rowBytes + i - spp]!) & 255;
  return out;
}

/**
 * A TIFF of the given pages, in either byte order: header, then each page's
 * data, then its IFD (entries sorted), chained in order.
 */
export function tiffOf(
  pages: TiffPageSpec[],
  { bigEndian = false }: { bigEndian?: boolean } = {},
): Uint8Array {
  const chunks: number[] = [];
  const le = !bigEndian;
  const u16 = (n: number) => (le ? [n & 255, n >>> 8] : [n >>> 8, n & 255]);
  const u32 = (n: number) =>
    le
      ? [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]
      : [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const set32 = (at: number, n: number) =>
    u32(n).forEach((b, i) => (chunks[at + i] = b));
  chunks.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(0));
  let link = 4;
  for (const page of pages) {
    const code = page.compression ?? 1;
    const spp = page.bits.length;
    const rowBytes = rowBytesOf(page.width, page.bits);
    const source =
      page.predictor === 2 ? difference(page.rows, rowBytes, spp) : page.rows;
    const pieces: Uint8Array[] = [];
    if (page.tile) {
      const { width: tw, height: th } = page.tile;
      const tileRow = rowBytesOf(tw, page.bits);
      for (let ty = 0; ty < Math.ceil(page.height / th); ty++)
        for (let tx = 0; tx < Math.ceil(page.width / tw); tx++) {
          const tile = new Uint8Array(tileRow * th);
          for (let r = 0; r < th; r++) {
            const y = ty * th + r;
            if (y >= page.height) break;
            const from = y * rowBytes + tx * tileRow;
            tile.set(
              source.subarray(
                from,
                Math.min(from + tileRow, (y + 1) * rowBytes),
              ),
              r * tileRow,
            );
          }
          pieces.push(compress(code, tile));
        }
    } else {
      const rps = page.rowsPerStrip ?? page.height;
      for (let y = 0; y < page.height; y += rps)
        pieces.push(
          compress(
            code,
            source.subarray(
              y * rowBytes,
              Math.min(page.height, y + rps) * rowBytes,
            ),
          ),
        );
    }
    const offsets: number[] = [];
    for (const piece of pieces) {
      offsets.push(chunks.length);
      chunks.push(...piece);
      if (chunks.length % 2) chunks.push(0);
    }
    const entries = new Map<number, TiffEntry>();
    const add = (e: TiffEntry) => entries.set(e[0], e);
    add([256, 4, [page.width]]);
    add([257, 4, [page.height]]);
    add([258, 3, page.bits]);
    add([259, 3, [code]]);
    add([262, 3, [page.photometric]]);
    add([277, 3, [spp]]);
    if (page.tile) {
      add([322, 4, [page.tile.width]]);
      add([323, 4, [page.tile.height]]);
      add([324, 4, offsets]);
      add([325, 4, pieces.map((p) => p.length)]);
    } else {
      add([273, 4, offsets]);
      add([278, 4, [page.rowsPerStrip ?? page.height]]);
      add([279, 4, pieces.map((p) => p.length)]);
    }
    if (page.dpi) {
      add([282, 5, [page.dpi.x]]);
      add([283, 5, [page.dpi.y]]);
      add([296, 3, [page.dpi.unit ?? 2]]);
    }
    if (page.predictor) add([317, 3, [page.predictor]]);
    for (const e of page.extra ?? []) add(e);
    const sorted = [...entries.values()].sort((a, b) => a[0] - b[0]);
    // Out-of-line values first, then the IFD.
    const valueAt = new Map<number, number>();
    for (const [tag, type, values] of sorted) {
      const size = { 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[type] * values.length;
      if (size <= 4) continue;
      valueAt.set(tag, chunks.length);
      for (const v of values) {
        if (type === 3) chunks.push(...u16(v));
        else if (type === 4) chunks.push(...u32(v));
        else if (type === 5)
          chunks.push(...u32(Math.round(v * 1000)), ...u32(1000));
        else chunks.push(v);
      }
      if (chunks.length % 2) chunks.push(0);
    }
    const ifd = chunks.length;
    set32(link, ifd);
    chunks.push(...u16(sorted.length));
    for (const [tag, type, values] of sorted) {
      chunks.push(...u16(tag), ...u16(type), ...u32(values.length));
      const at = valueAt.get(tag);
      if (at !== undefined) chunks.push(...u32(at));
      else {
        const inline: number[] = [];
        for (const v of values)
          inline.push(...(type === 3 ? u16(v) : type === 4 ? u32(v) : [v]));
        while (inline.length < 4) inline.push(0);
        chunks.push(...inline);
      }
    }
    link = chunks.length;
    chunks.push(...u32(0));
  }
  return new Uint8Array(chunks);
}

/**
 * A page that paints a dark block on light ground, so "the page was drawn"
 * is a pixel question: the block is the top-left quarter.
 */
export function blockRows(
  width: number,
  height: number,
  bits: 1 | 8,
  { inkIsOne }: { inkIsOne: boolean },
): Uint8Array {
  const rowBytes = rowBytesOf(width, [bits]);
  const rows = new Uint8Array(rowBytes * height);
  const ink = inkIsOne ? 1 : 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inBlock = x < width / 2 && y < height / 2;
      const on = inBlock ? ink : 1 - ink;
      if (bits === 8) rows[y * rowBytes + x] = on ? 255 : 0;
      else if (on)
        rows[y * rowBytes + (x >> 3)] =
          rows[y * rowBytes + (x >> 3)]! | (0x80 >> (x & 7));
    }
  return rows;
}

/** RGB rows of one colour, with a second colour in the top-left quarter. */
export function rgbRows(
  width: number,
  height: number,
  ground: [number, number, number],
  block: [number, number, number],
  channels: 3 | 4 = 3,
  alpha = 255,
): Uint8Array {
  const rows = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = x < width / 2 && y < height / 2 ? block : ground;
      const at = (y * width + x) * channels;
      rows.set(c, at);
      if (channels === 4) rows[at + 3] = alpha;
    }
  return rows;
}
