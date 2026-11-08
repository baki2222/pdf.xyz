/**
 * Hostile inputs for the "conversion-in" family (JPG / PNG / TIFF / image to
 * PDF, Text and Markdown to PDF, Scan to PDF), built in code — deterministic,
 * small, nothing downloaded. Family-scoped on purpose: the shared
 * `fixtures.ts` belongs to the PDF-input families, and these are images and
 * text, not PDFs.
 *
 * Every generator here has a health check in the matrix
 * (the conversion-in matrix (branch test/hostile-matrix, not merged), "fixture health"): a hostile file that is
 * hostile in the wrong way — a PNG whose IHDR never parsed, a TIFF whose loop
 * never landed — would make every cell after it answer an easier question.
 */
import { crc32, deflateSync } from "node:zlib";
import { JPEG_30X20 } from "@/tests/jpeg-fixtures";
import { tiffOf, type TiffPageSpec } from "@/tests/tiff-fixtures";

/* ------------------------------------------------------------------ *
 *  PNG
 * ------------------------------------------------------------------ */

export const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return new Uint8Array(Buffer.concat([head, data, crc]));
}

export function ihdr(
  width: number,
  height: number,
  bitDepth = 8,
  colorType = 0,
): Uint8Array {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width >>> 0, 0);
  b.writeUInt32BE(height >>> 0, 4);
  b[8] = bitDepth;
  b[9] = colorType;
  return new Uint8Array(b);
}

const concat = (parts: readonly Uint8Array[]): Uint8Array =>
  new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));

/**
 * A PNG of `chunks` (each `[type, data]`) after the signature, IEND added
 * unless `noEnd`.
 */
export function pngOfChunks(
  chunks: readonly [string, Uint8Array][],
  { noEnd = false }: { noEnd?: boolean } = {},
): Uint8Array {
  return concat([
    PNG_SIGNATURE,
    ...chunks.map(([t, d]) => pngChunk(t, d)),
    ...(noEnd ? [] : [pngChunk("IEND", new Uint8Array())]),
  ]);
}

/** Filter-0 rows of one grey value, `width` × `height`, 8-bit grey. */
export function greyRows(width: number, height: number, value = 0): Buffer {
  const rows = Buffer.alloc((width + 1) * height, value);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0;
  return rows;
}

/** A whole, valid 8-bit grey PNG — the positive control for every PNG cell. */
export function validGreyPng(width = 4, height = 3): Uint8Array {
  return pngOfChunks([
    ["IHDR", ihdr(width, height)],
    ["IDAT", deflateSync(greyRows(width, height, 0x80))],
  ]);
}

/**
 * A PNG whose IHDR claims `width` × `height` and whose IDAT is a few bytes —
 * H11's "huge declared size, tiny stream", for PNG.
 */
export function pngClaiming(
  width: number,
  height: number,
  colorType = 0,
): Uint8Array {
  return pngOfChunks([
    ["IHDR", ihdr(width, height, 8, colorType)],
    ["IDAT", deflateSync(Buffer.alloc(16))],
  ]);
}

/**
 * A REAL decompression bomb: `width` × `height` 8-bit grey, every row whole,
 * all zero — compresses ~1000:1. 12,000 × 12,000 is 144 MP (over the 100 MP
 * ceiling `pixel-ceiling.ts` states) in ~140 KB.
 */
export function pngBomb(width: number, height: number): Uint8Array {
  return pngOfChunks([
    ["IHDR", ihdr(width, height)],
    ["IDAT", deflateSync(greyRows(width, height, 0), { level: 9 })],
  ]);
}

/** Two IHDRs: the first `a`, the second `b`, with IDAT for `b` (H19). */
export function pngTwoHeaders(
  a: [number, number],
  b: [number, number],
): Uint8Array {
  return pngOfChunks([
    ["IHDR", ihdr(a[0], a[1])],
    ["IHDR", ihdr(b[0], b[1])],
    ["IDAT", deflateSync(greyRows(b[0], b[1], 0x40))],
  ]);
}

/** A pHYs chunk: `x`, `y` pixels per unit, unit 1 = metre. */
export function phys(x: number, y: number, unit = 1): Uint8Array {
  const p = Buffer.alloc(9);
  p.writeUInt32BE(x >>> 0, 0);
  p.writeUInt32BE(y >>> 0, 4);
  p[8] = unit;
  return new Uint8Array(p);
}

/* ------------------------------------------------------------------ *
 *  JPEG
 * ------------------------------------------------------------------ */

export const VALID_JPEG = JPEG_30X20;

/** Offset of the first SOF0..SOF15 (not DHT/JPG/DAC) marker's segment. */
export function sofOffset(jpeg: Uint8Array): number {
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const m = jpeg[at + 1]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return at;
    at += 2 + ((jpeg[at + 2]! << 8) | jpeg[at + 3]!);
  }
  return -1;
}

/** The control JPEG with its SOF claiming `width` × `height` (H11, JPEG). */
export function jpegClaiming(width: number, height: number): Uint8Array {
  const out = new Uint8Array(VALID_JPEG);
  const at = sofOffset(out);
  if (at < 0) throw new Error("fixture: no SOF in the control JPEG");
  // SOF: FF Cn, len(2), precision(1), height(2), width(2)
  out[at + 5] = height >> 8;
  out[at + 6] = height & 255;
  out[at + 7] = width >> 8;
  out[at + 8] = width & 255;
  return out;
}

/** Offset of SOS (FFDA), where the entropy-coded data begins. */
export function sosOffset(jpeg: Uint8Array): number {
  for (let i = 2; i + 1 < jpeg.length; i++)
    if (jpeg[i] === 0xff && jpeg[i + 1] === 0xda) return i;
  return -1;
}

/**
 * `count` empty APP15 segments after SOI, then the control JPEG's own body —
 * H08 for a JPEG's segment walk.
 */
export function jpegManySegments(count: number): Uint8Array {
  const seg = Uint8Array.from([0xff, 0xef, 0x00, 0x02]);
  const parts: Uint8Array[] = [VALID_JPEG.subarray(0, 2)];
  for (let i = 0; i < count; i++) parts.push(seg);
  parts.push(VALID_JPEG.subarray(2));
  return concat(parts);
}

/** An APP1 "Exif" segment whose IFD0 offset points at itself (a loop). */
export function jpegExifSelfLoop(): Uint8Array {
  // TIFF header II*\0, IFD0 at 8; IFD0: 1 entry (Orientation=6), next = 8.
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  tiff.writeUInt32LE(8, 22);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Uint8Array.from([
    0xff,
    0xe1,
    (payload.length + 2) >> 8,
    (payload.length + 2) & 255,
  ]);
  return concat([
    VALID_JPEG.subarray(0, 2),
    head,
    payload,
    VALID_JPEG.subarray(2),
  ]);
}

/** An Exif APP1 whose IFD0 entry count is 65,535 with no entries behind it. */
export function jpegExifHugeCount(): Uint8Array {
  const tiff = Buffer.alloc(8 + 2 + 4);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(0xffff, 8);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Uint8Array.from([
    0xff,
    0xe1,
    (payload.length + 2) >> 8,
    (payload.length + 2) & 255,
  ]);
  return concat([
    VALID_JPEG.subarray(0, 2),
    head,
    payload,
    VALID_JPEG.subarray(2),
  ]);
}

/* ------------------------------------------------------------------ *
 *  TIFF
 * ------------------------------------------------------------------ */

const grey = (w: number, h: number, v = 0x80) => new Uint8Array(w * h).fill(v);

export function greyTiffPage(
  width = 4,
  height = 3,
  more: Partial<TiffPageSpec> = {},
): TiffPageSpec {
  return {
    width,
    height,
    bits: [8],
    photometric: 1,
    rows: grey(width, height),
    ...more,
  };
}

export const validTiff = (pages = 1) =>
  tiffOf(Array.from({ length: pages }, () => greyTiffPage()));

const u32le = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const set32le = (b: Uint8Array, at: number, v: number) => {
  b[at] = v & 255;
  b[at + 1] = (v >>> 8) & 255;
  b[at + 2] = (v >>> 16) & 255;
  b[at + 3] = (v >>> 24) & 255;
};
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);

/** Every IFD offset of a little-endian TIFF, following `next` (bounded). */
export function ifdOffsets(tiff: Uint8Array): number[] {
  const out: number[] = [];
  let at = u32le(tiff, 4);
  while (at !== 0 && at + 2 <= tiff.length && out.length < 10_000) {
    if (out.includes(at)) break;
    out.push(at);
    const n = u16le(tiff, at);
    const link = at + 2 + n * 12;
    if (link + 4 > tiff.length) break;
    at = u32le(tiff, link);
  }
  return out;
}

/** Where IFD `ifd`'s next-IFD pointer is stored. */
export function linkOf(tiff: Uint8Array, ifd: number): number {
  return ifd + 2 + u16le(tiff, ifd) * 12;
}

/** The last IFD's `next` repointed at `target` (H06 for TIFF). */
export function tiffWithLastNext(
  pages: number,
  target: "self" | "first" | number,
): Uint8Array {
  const t = validTiff(pages);
  const ifds = ifdOffsets(t);
  const last = ifds.at(-1)!;
  const value =
    target === "self" ? last : target === "first" ? ifds[0]! : target;
  set32le(t, linkOf(t, last), value);
  return t;
}

/** The entry for `tag` in the FIRST IFD: where its value lives. */
export function tagValueAt(tiff: Uint8Array, tag: number): number {
  const ifd = u32le(tiff, 4);
  const n = u16le(tiff, ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (u16le(tiff, e) === tag) {
      const type = u16le(tiff, e + 2);
      const count = u32le(tiff, e + 4);
      const size =
        ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 } as Record<number, number>)[
          type
        ]! * count;
      return size <= 4 ? e + 8 : u32le(tiff, e + 8);
    }
  }
  throw new Error(`fixture: tag ${tag} not in IFD0`);
}

/** A grey TIFF whose X/YResolution rationals are `num`/`den` (H18 for TIFF). */
export function tiffWithRational(
  num: number,
  den: number,
  {
    width = 4,
    height = 3,
    unit = 2,
  }: { width?: number; height?: number; unit?: number } = {},
): Uint8Array {
  const t = tiffOf([
    greyTiffPage(width, height, { dpi: { x: 300, y: 300, unit } }),
  ]);
  for (const tag of [282, 283]) {
    const at = tagValueAt(t, tag);
    set32le(t, at, num);
    set32le(t, at + 4, den);
  }
  return t;
}

/** The IFD0 entry count rewritten to `count` (entries behind it unchanged). */
export function tiffWithEntryCount(count: number): Uint8Array {
  const t = validTiff();
  const ifd = u32le(t, 4);
  t[ifd] = count & 255;
  t[ifd + 1] = count >> 8;
  return t;
}

/** A Deflate strip that inflates far past what the page needs (H12, TIFF). */
export function tiffDeflateBomb(inflated: number): Uint8Array {
  const page = greyTiffPage(64, 64, { compression: 8 });
  const t = tiffOf([page]);
  // Replace the strip with a bomb appended at the end; repoint offset/count.
  const bomb = deflateSync(Buffer.alloc(inflated), { level: 9 });
  const out = new Uint8Array(t.length + bomb.length);
  out.set(t);
  out.set(bomb, t.length);
  set32le(out, tagValueAt(out, 273), t.length);
  set32le(out, tagValueAt(out, 279), bomb.length);
  return out;
}

/* ------------------------------------------------------------------ *
 *  Non-image bytes under image names (H02)
 * ------------------------------------------------------------------ */

/** Deterministic noise (xorshift32), `n` bytes. */
export function noise(n: number, seed = 0x9e3779b9): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s & 255;
  }
  return out;
}

export const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** A minimal one-page PDF, as bytes. */
export const TINY_PDF = latin1(
  "%PDF-1.7\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
);

/** ZIP local-file-header magic, as a DOCX starts. */
export const ZIP_MAGIC = concat([
  Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
  noise(60, 7),
]);

export const HTML_TEXT = latin1(
  "<!doctype html><html><body><img src=x onerror=alert(1)></body></html>",
);

/** An ISO-BMFF `ftyp` box with `brand` — the start of a HEIC or AVIF. */
export function ftypOf(brand: string): Uint8Array {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(24, 0);
  b.write("ftyp", 4, "latin1");
  b.write(brand, 8, "latin1");
  b.write("mif1", 16, "latin1");
  return new Uint8Array(b);
}
