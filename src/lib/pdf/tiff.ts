/**
 * TIFF pages for JPG / PNG to PDF (2026-11-04) — read, checked and decoded in
 * the browser, one PDF page per TIFF page, in the file's own order.
 *
 * Loaded on the first TIFF only (`image-to-pdf.ts` and the runner import it
 * lazily), so a run of PNGs and JPEGs never fetches it or `utif`.
 *
 * ── SAFETY BEFORE DECODING ────────────────────────────────────────────────
 *
 * {@link readTiffPages} walks the IFD chain ITSELF, with every offset bounded
 * by the file, and checks each page's size, depth, colour model and
 * compression before a single sample is allocated: a 1 KB header can claim
 * 60,000 × 60,000 pixels, and UTIF's own reader (`UTIF.decode`) allocates
 * whatever a header claims. A page over {@link MAX_TIFF_PAGE_PIXELS}, a file
 * over {@link MAX_TIFF_PAGES}, an unknown compression or colour model, or an
 * offset outside the file is refused by page number. UTIF's `decodeImage`
 * is not used at all: on an unknown compression it logs and returns the page
 * ZEROED, which is a blank page in the PDF.
 *
 * ── DECODING ──────────────────────────────────────────────────────────────
 *
 * Uncompressed, LZW, PackBits and Deflate are decoded here, each counting
 * what it produced: a strip that yields fewer bytes than its rows need is a
 * damaged page, refused, never a page padded with zeros. CCITT Group 3 and 4
 * and JPEG-in-TIFF use UTIF's strip decoders, wrapped so that damage throws:
 * a code longer than any real one, a row wider than the page, or fewer rows
 * than the strip holds.
 *
 * ── EMBEDDING ─────────────────────────────────────────────────────────────
 *
 * Losslessly, as the samples are: a 1-bit fax page is a 1-bit DeviceGray
 * image (WhiteIsZero via `/Decode [1 0]`), gray is DeviceGray, a palette is
 * `/Indexed`, RGB and CMYK are themselves; an alpha channel is an `/SMask`.
 * Nothing is JPEG-recompressed. 16-bit samples are cut to 8 bits, as a
 * 16-bit PNG is.
 *
 * ── PAGE SIZE ─────────────────────────────────────────────────────────────
 *
 * A TIFF says how big it was on paper (XResolution / YResolution and
 * ResolutionUnit), and each page is laid out at THAT size: a 300-dpi A4 scan
 * is an A4 page under "Fit to image", not one 2480 points wide. A page that
 * gives no usable resolution falls back to one pixel per point, which is how
 * the tools lay out JPEG and PNG (whose DPI they do not read).
 */
import UTIF, { type UtifIfd } from "utif";
import type { PDFDocument, PDFImage } from "pdf-lib";
import { PdfEngineError } from "./engine-errors";
import { MAX_DECODED_PIXELS } from "./pixel-ceiling";
import { loadPdfLib } from "./pdf-lib";
import {
  MAX_TIFF_PAGES,
  MAX_TIFF_PAGE_PIXELS,
  TIFF_COMPRESSIONS,
  tiffRefusal,
} from "./tiff-limits";

export { MAX_TIFF_PAGES, MAX_TIFF_PAGE_PIXELS, TIFF_COMPRESSIONS, tiffRefusal };

/**
 * The most decoded sample bytes one page may need: what an RGBA canvas of
 * the largest page would hold. A 16-bit CMYK page has 8 bytes a pixel, so it
 * can be refused here while under the pixel ceiling.
 */
export const MAX_TIFF_PAGE_BYTES = MAX_DECODED_PIXELS * 4;

/**
 * Below this a stated resolution is not believed: writers that do not know
 * put 1 (or 0). Such a page is laid out at one pixel per point.
 */
export const MIN_BELIEVED_DPI = 10;

/** One page of a TIFF, as its IFD describes it, checked but not decoded. */
export interface TiffPage {
  /** 1-based, in the order the PDF will hold it. */
  number: number;
  width: number;
  height: number;
  /** Bits per sample (all samples of a page have the same depth here). */
  bits: number;
  samplesPerPixel: number;
  compression: keyof typeof TIFF_COMPRESSIONS;
  photometric: number;
  predictor: number;
  fillOrder: number;
  /** The extra sample that is alpha, by its index after the colour samples; -1 when none. */
  alphaSample: number;
  /** Strips, or tiles in row order. */
  chunks: { offset: number; length: number }[];
  /** Rows per strip; for tiles, the tile's size. */
  rowsPerStrip: number;
  tile: { width: number; height: number } | null;
  /** 16-bit palette: 3 × 2^bits values, R then G then B. */
  colorMap: number[] | null;
  jpegTables: Uint8Array | null;
  /** T4Options (tag 292). */
  t4Options: number;
  littleEndian: boolean;
  /** The page's size on paper, in points, from its resolution. */
  widthPt: number;
  heightPt: number;
  /** The resolution believed, or null when the page gave none. */
  dpi: { x: number; y: number } | null;
}

/** A decoded page, in the shape a PDF image XObject takes. */
export interface TiffRaster {
  page: number;
  width: number;
  height: number;
  widthPt: number;
  heightPt: number;
  colorSpace: "gray" | "rgb" | "cmyk" | "indexed";
  bitsPerComponent: 1 | 2 | 4 | 8;
  /** WhiteIsZero gray: a set bit (or 255) is black. */
  invert: boolean;
  /** Rows of packed samples, each row whole bytes — PDF's own layout. */
  samples: Uint8Array;
  /** One 8-bit alpha value a pixel, when the page has transparency. */
  alpha: Uint8Array | null;
  /** RGB triples for an indexed page. */
  palette: Uint8Array | null;
}

/** A structural fault inside one page, turned into a refusal by page number. */
class TiffDamage extends Error {}

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
  13: 4, // IFD
};

/** The tags a page is read from; every other entry is only bounds-checked. */
const T = {
  subfileType: 254,
  width: 256,
  height: 257,
  bits: 258,
  compression: 259,
  photometric: 262,
  fillOrder: 266,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  xResolution: 282,
  yResolution: 283,
  planar: 284,
  t4Options: 292,
  resolutionUnit: 296,
  predictor: 317,
  colorMap: 320,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  extraSamples: 338,
  sampleFormat: 339,
  jpegTables: 347,
} as const;
const READ_TAGS = new Set<number>(Object.values(T));

interface Entry {
  type: number;
  count: number;
  /** Where the value bytes are. */
  at: number;
}

class Reader {
  constructor(
    readonly bytes: Uint8Array,
    readonly le: boolean,
  ) {}
  private need(at: number, size: number) {
    if (at < 0 || at + size > this.bytes.length) throw new TiffDamage();
  }
  u8(at: number) {
    this.need(at, 1);
    return this.bytes[at]!;
  }
  u16(at: number) {
    this.need(at, 2);
    const b = this.bytes;
    return this.le ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!;
  }
  u32(at: number) {
    this.need(at, 4);
    const b = this.bytes;
    return this.le
      ? (b[at]! |
          (b[at + 1]! << 8) |
          (b[at + 2]! << 16) |
          (b[at + 3]! << 24)) >>>
          0
      : ((b[at]! << 24) |
          (b[at + 1]! << 16) |
          (b[at + 2]! << 8) |
          b[at + 3]!) >>>
          0;
  }
  /** Every value of a numeric entry; rationals as their quotient. */
  values(entry: Entry): number[] {
    const out: number[] = [];
    const size = TYPE_SIZE[entry.type]!;
    for (let i = 0; i < entry.count; i++) {
      const at = entry.at + i * size;
      switch (entry.type) {
        case 1:
        case 7:
        case 2:
          out.push(this.u8(at));
          break;
        case 6:
          out.push((this.u8(at) << 24) >> 24);
          break;
        case 3:
          out.push(this.u16(at));
          break;
        case 8:
          out.push((this.u16(at) << 16) >> 16);
          break;
        case 4:
        case 13:
          out.push(this.u32(at));
          break;
        case 9:
          out.push(this.u32(at) | 0);
          break;
        case 5:
        case 10: {
          const signed = entry.type === 10;
          const num = signed ? this.u32(at) | 0 : this.u32(at);
          const den = signed ? this.u32(at + 4) | 0 : this.u32(at + 4);
          out.push(den === 0 ? 0 : num / den);
          break;
        }
        default:
          // FLOAT and DOUBLE: no tag read here takes them.
          throw new TiffDamage();
      }
    }
    return out;
  }
}

/** The IFD at `at`: its entries (bounded by the file) and the next IFD's offset. */
function readIfd(
  reader: Reader,
  at: number,
): { entries: Map<number, Entry>; next: number } {
  const count = reader.u16(at);
  if (count === 0) throw new TiffDamage();
  const entries = new Map<number, Entry>();
  for (let i = 0; i < count; i++) {
    const base = at + 2 + i * 12;
    const tag = reader.u16(base);
    const type = reader.u16(base + 2);
    const n = reader.u32(base + 4);
    const size = TYPE_SIZE[type];
    // An unknown type cannot be skipped safely only if it is a tag we read.
    if (size === undefined) {
      if (READ_TAGS.has(tag)) throw new TiffDamage();
      continue;
    }
    const bytes = n * size;
    const valueAt = bytes <= 4 ? base + 8 : reader.u32(base + 8);
    // Every value must lie inside the file, read or not: a count of four
    // billion is a header lying about the file it is in.
    if (valueAt + bytes > reader.bytes.length) throw new TiffDamage();
    if (READ_TAGS.has(tag)) entries.set(tag, { type, count: n, at: valueAt });
  }
  return { entries, next: reader.u32(at + 2 + count * 12) };
}

/**
 * Every page of the TIFF in `bytes`, checked, nothing decoded. Throws a
 * {@link PdfEngineError} naming the file and the page it stopped at — and
 * nothing else, so a caller can show what it throws as it is.
 */
export function readTiffPages(name: string, bytes: Uint8Array): TiffPage[] {
  try {
    return readPages(name, bytes);
  } catch (problem) {
    if (problem instanceof PdfEngineError) throw problem;
    throw new PdfEngineError(tiffRefusal.damaged(name));
  }
}

function readPages(name: string, bytes: Uint8Array): TiffPage[] {
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (bytes.length < 8 || (!le && !be))
    throw new PdfEngineError(tiffRefusal.damaged(name));
  const reader = new Reader(bytes, le);
  const magic = reader.u16(2);
  if (magic === 43) throw new PdfEngineError(tiffRefusal.bigTiff(name));
  if (magic !== 42) throw new PdfEngineError(tiffRefusal.damaged(name));

  const pages: TiffPage[] = [];
  const seen = new Set<number>();
  let at = reader.u32(4);
  while (at !== 0) {
    const number = pages.length + 1;
    if (seen.has(at)) break; // a loop back to an IFD already read: the chain ends
    seen.add(at);
    let ifd: ReturnType<typeof readIfd>;
    try {
      ifd = readIfd(reader, at);
    } catch {
      throw new PdfEngineError(tiffRefusal.damaged(name, number));
    }
    const page = checkPage(name, number, reader, ifd.entries);
    if (page) {
      if (pages.length === MAX_TIFF_PAGES)
        throw new PdfEngineError(tiffRefusal.tooManyPages(name));
      pages.push(page);
    }
    at = ifd.next;
  }
  if (pages.length === 0) throw new PdfEngineError(tiffRefusal.damaged(name));
  return pages;
}

/** The colour samples each photometric interpretation carries. */
const COLOUR_SAMPLES: Record<number, number> = {
  0: 1, // WhiteIsZero
  1: 1, // BlackIsZero
  2: 3, // RGB
  3: 1, // palette
  5: 4, // CMYK
  6: 3, // YCbCr — only as JPEG decodes it
};

/** One IFD as a page, or null for a reduced-resolution copy (a thumbnail). */
function checkPage(
  name: string,
  number: number,
  reader: Reader,
  entries: Map<number, Entry>,
): TiffPage | null {
  const all = (tag: number): number[] | null => {
    const entry = entries.get(tag);
    if (!entry) return null;
    try {
      return reader.values(entry);
    } catch {
      throw new PdfEngineError(tiffRefusal.damaged(name, number));
    }
  };
  const one = (tag: number, fallback: number): number =>
    all(tag)?.[0] ?? fallback;

  // A preview the writer added beside the page, not a page of its own.
  if ((one(T.subfileType, 0) & 1) === 1) return null;

  // Size first: nothing below allocates, and nothing should be read about a
  // page this will refuse for its size anyway.
  const width = one(T.width, 0);
  const height = one(T.height, 0);
  if (width < 1 || height < 1)
    throw new PdfEngineError(tiffRefusal.damaged(name, number));
  if (width * height > MAX_TIFF_PAGE_PIXELS)
    throw new PdfEngineError(tiffRefusal.tooLarge(name, number, width, height));

  const bitsList = all(T.bits) ?? [1];
  const samplesPerPixel = one(T.samplesPerPixel, 1);
  const bits = bitsList[0]!;
  const rowBytes = Math.ceil((width * samplesPerPixel * bits) / 8);
  if (
    !Number.isFinite(rowBytes) ||
    samplesPerPixel < 1 ||
    rowBytes * height > MAX_TIFF_PAGE_BYTES
  )
    throw new PdfEngineError(tiffRefusal.tooMuchData(name, number));

  const code = one(T.compression, 1);
  if (!(code in TIFF_COMPRESSIONS))
    throw new PdfEngineError(tiffRefusal.compression(name, number, code));
  const compression = code as keyof typeof TIFF_COMPRESSIONS;

  const colours = (detail: string) =>
    new PdfEngineError(tiffRefusal.colours(name, number, detail));
  const photometric = one(
    T.photometric,
    compression >= 3 && compression <= 4 ? 0 : 1,
  );
  const colourSamples = COLOUR_SAMPLES[photometric];
  if (colourSamples === undefined)
    throw colours(`photometric interpretation ${photometric}`);
  if (photometric === 6 && compression !== 7)
    throw colours("YCbCr without JPEG");
  if (bitsList.some((b) => b !== bits)) throw colours("mixed sample depths");
  if (one(T.planar, 1) !== 1) throw colours("separate colour planes");
  if ((all(T.sampleFormat) ?? [1]).some((f) => f !== 1))
    throw colours("signed or floating-point samples");
  if (samplesPerPixel < colourSamples)
    throw colours(`${samplesPerPixel} samples for ${colourSamples} colours`);
  const extra = samplesPerPixel - colourSamples;
  const depthsFor: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    1: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    5: [8, 16],
    6: [8],
  };
  if (!depthsFor[photometric]!.includes(bits) || (extra > 0 && bits < 8))
    throw colours(`${bits}-bit samples`);
  if (
    (compression === 3 || compression === 4) &&
    (bits !== 1 || samplesPerPixel !== 1)
  )
    throw colours("fax compression on a page that is not black and white");
  if (compression === 7 && bits !== 8) throw colours(`${bits}-bit JPEG`);
  const predictor = one(T.predictor, 1);
  if (predictor !== 1 && !(predictor === 2 && (bits === 8 || bits === 16)))
    throw colours(`predictor ${predictor}`);
  const fillOrder = one(T.fillOrder, 1);
  if (fillOrder !== 1 && fillOrder !== 2)
    throw colours(`fill order ${fillOrder}`);

  // ExtraSamples: 1 associated alpha, 2 unassociated; 0 is "unspecified",
  // which is not drawn.
  const extraKinds = all(T.extraSamples) ?? [];
  const alphaSample =
    extra > 0
      ? extraKinds.slice(0, extra).findIndex((k) => k === 1 || k === 2)
      : -1;

  let colorMap: number[] | null = null;
  if (photometric === 3) {
    colorMap = all(T.colorMap);
    if (!colorMap || colorMap.length < 3 * 2 ** bits)
      throw new PdfEngineError(tiffRefusal.damaged(name, number));
  }

  // Strips or tiles, every one inside the file and as many as the page needs.
  const tileWidth = one(T.tileWidth, 0);
  const tileHeight = one(T.tileLength, 0);
  const tiled = entries.has(T.tileOffsets) || tileWidth > 0;
  let rowsPerStrip = Math.min(one(T.rowsPerStrip, height) || height, height);
  let needed: number;
  if (tiled) {
    if (
      tileWidth < 1 ||
      tileHeight < 1 ||
      (tileWidth * samplesPerPixel * bits) % 8 !== 0 ||
      tileWidth * tileHeight > MAX_TIFF_PAGE_PIXELS
    )
      throw new PdfEngineError(tiffRefusal.damaged(name, number));
    needed = Math.ceil(width / tileWidth) * Math.ceil(height / tileHeight);
    rowsPerStrip = tileHeight;
  } else {
    needed = Math.ceil(height / rowsPerStrip);
  }
  const offsets = all(tiled ? T.tileOffsets : T.stripOffsets);
  const counts = all(tiled ? T.tileByteCounts : T.stripByteCounts);
  if (!offsets || offsets.length < needed)
    throw new PdfEngineError(tiffRefusal.damaged(name, number));
  // An uncompressed single strip may omit its byte count (UTIF tolerates it).
  const chunkCounts =
    counts ?? (compression === 1 && needed === 1 ? [rowBytes * height] : null);
  if (!chunkCounts || chunkCounts.length < needed)
    throw new PdfEngineError(tiffRefusal.damaged(name, number));
  const chunks = offsets.slice(0, needed).map((offset, i) => {
    const length = chunkCounts[i]!;
    if (offset + length > reader.bytes.length)
      throw new PdfEngineError(tiffRefusal.damaged(name, number));
    return { offset, length };
  });

  const jpegEntry = entries.get(T.jpegTables);
  const jpegTables = jpegEntry
    ? reader.bytes.slice(jpegEntry.at, jpegEntry.at + jpegEntry.count)
    : null;

  const dpi = resolution(
    all(T.xResolution)?.[0],
    all(T.yResolution)?.[0],
    one(T.resolutionUnit, 2),
  );
  return {
    number,
    width,
    height,
    bits,
    samplesPerPixel,
    compression,
    photometric,
    predictor,
    fillOrder,
    alphaSample,
    chunks,
    rowsPerStrip,
    tile: tiled ? { width: tileWidth, height: tileHeight } : null,
    colorMap,
    jpegTables,
    t4Options: one(T.t4Options, 0),
    littleEndian: reader.le,
    widthPt: dpi ? (width * 72) / dpi.x : width,
    heightPt: dpi ? (height * 72) / dpi.y : height,
    dpi,
  };
}

/**
 * The resolution in dots per inch, or null when the page gives none worth
 * believing. ResolutionUnit 2 is the inch (and the default), 3 the
 * centimetre; 1 says "no absolute unit". One axis given stands for both.
 */
export function resolution(
  x: number | undefined,
  y: number | undefined,
  unit: number,
): { x: number; y: number } | null {
  if (unit !== 2 && unit !== 3) return null;
  const perInch = (v: number | undefined) =>
    v === undefined || !Number.isFinite(v)
      ? undefined
      : unit === 3
        ? v * 2.54
        : v;
  const believed = (v: number | undefined) =>
    v !== undefined && v >= MIN_BELIEVED_DPI ? v : undefined;
  const dx = believed(perInch(x));
  const dy = believed(perInch(y));
  if (dx === undefined && dy === undefined) return null;
  return { x: dx ?? dy!, y: dy ?? dx! };
}

/* ------------------------------------------------------------------ *
 *  Strip decoders
 * ------------------------------------------------------------------ */

/** LZW (TIFF's MSB-first, early-change variant); returns the bytes written. */
export function lzwDecode(
  src: Uint8Array,
  start: number,
  length: number,
  out: Uint8Array,
): number {
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const size = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
    size[i] = 1;
  }
  const end = (start + length) * 8;
  let bit = start * 8;
  let width = 9;
  let next = 258;
  let previous = -1;
  let written = 0;
  const emit = (code: number) => {
    const n = size[code]!;
    let at = written + n - 1;
    for (let c = code; c >= 0; c = prefix[c]!) {
      if (at < out.length) out[at] = suffix[c]!;
      at--;
    }
    written += n;
  };
  while (bit + width <= end && written < out.length) {
    let code = 0;
    for (let i = 0; i < width; i++, bit++)
      code = (code << 1) | ((src[bit >>> 3]! >>> (7 - (bit & 7))) & 1);
    if (code === 256) {
      width = 9;
      next = 258;
      previous = -1;
      continue;
    }
    if (code === 257) break;
    if (previous < 0) {
      if (code > 255) throw new TiffDamage();
      emit(code);
      previous = code;
      continue;
    }
    if (code > next) throw new TiffDamage();
    const known = code < next;
    if (next < 4096) {
      prefix[next] = previous;
      suffix[next] = known ? first[code]! : first[previous]!;
      first[next] = first[previous]!;
      size[next] = size[previous]! + 1;
      next++;
    }
    emit(code);
    previous = code;
    // Early change: the width grows one code before the table needs it.
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return Math.min(written, out.length);
}

/** PackBits; returns the bytes written. */
export function packBitsDecode(
  src: Uint8Array,
  start: number,
  length: number,
  out: Uint8Array,
): number {
  let i = start;
  const end = start + length;
  let written = 0;
  while (i < end && written < out.length) {
    const n = (src[i++]! << 24) >> 24;
    if (n >= 0) {
      if (i + n + 1 > end) throw new TiffDamage();
      for (let k = 0; k <= n && written < out.length; k++)
        out[written++] = src[i + k]!;
      i += n + 1;
    } else if (n !== -128) {
      if (i >= end) throw new TiffDamage();
      const value = src[i++]!;
      for (let k = 0; k <= -n && written < out.length; k++)
        out[written++] = value;
    }
  }
  return written;
}

/** zlib Deflate through the browser's own decompressor, read no further than `want`. */
async function inflate(
  src: Uint8Array,
  want: number,
): Promise<{ out: Uint8Array; written: number }> {
  const out = new Uint8Array(want);
  let written = 0;
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(src);
      controller.close();
    },
  });
  const reader = input
    .pipeThrough(
      new DecompressionStream("deflate") as unknown as TransformStream<
        Uint8Array,
        Uint8Array
      >,
    )
    .getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, want - written);
      out.set(value.subarray(0, take), written);
      written += take;
      if (written >= want) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    // A stream that ends early or is not Deflate: what arrived is counted.
  }
  return { out, written };
}

/**
 * UTIF's CCITT decoders, made to fail loudly. They index their code tables by
 * the bits read so far and append runs to a row without a bound, so damaged
 * data grows a string or a row without end. Patched once, here: a lookup
 * longer than any CCITT code, or a row wider than the page, throws; every
 * full row written is counted.
 */
const LONGEST_CODE = 64;
const ccitt = { width: 0, rows: 0 };
let hardened = false;
function hardenCcitt(): void {
  if (hardened) return;
  hardened = true;
  const d = UTIF.decode;
  const bounded = <V extends object>(table: V): V =>
    new Proxy(table, {
      get(target, key, receiver) {
        if (typeof key === "string" && key.length > LONGEST_CODE)
          throw new TiffDamage();
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
  d._dmap = bounded(d._dmap);
  d._lens = [bounded(d._lens[0]), bounded(d._lens[1])];
  const add = d._addNtimes;
  d._addNtimes = (arr, n, val) => {
    if (arr.length + n > ccitt.width) throw new TiffDamage();
    add(arr, n, val);
  };
  const write = d._writeBits;
  d._writeBits = (bits, tgt, boff) => {
    if (bits.length === ccitt.width) ccitt.rows++;
    write(bits, tgt, boff);
  };
}

const reverseBits = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let r = 0;
    for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b);
    table[i] = r;
  }
  return table;
})();

/** Undo horizontal differencing (Predictor 2) on whole rows. */
function undoPredictor(
  buf: Uint8Array,
  rows: number,
  rowBytes: number,
  spp: number,
  bits: number,
  le: boolean,
): void {
  for (let r = 0; r < rows; r++) {
    const base = r * rowBytes;
    if (bits === 8) {
      for (let i = spp; i < rowBytes; i++)
        buf[base + i] = (buf[base + i]! + buf[base + i - spp]!) & 255;
    } else {
      const step = spp * 2;
      for (let i = step; i + 1 < rowBytes; i += 2) {
        const at = base + i;
        const read = (p: number) =>
          le ? buf[p]! | (buf[p + 1]! << 8) : (buf[p]! << 8) | buf[p + 1]!;
        const v = (read(at) + read(at - step)) & 0xffff;
        if (le) {
          buf[at] = v & 255;
          buf[at + 1] = v >> 8;
        } else {
          buf[at] = v >> 8;
          buf[at + 1] = v & 255;
        }
      }
    }
  }
}

/** One strip or tile, decoded to exactly `rows` × `rowBytes`, or damage. */
async function decodeChunk(
  bytes: Uint8Array,
  page: TiffPage,
  chunk: { offset: number; length: number },
  rows: number,
  pixelsAcross: number,
  rowBytes: number,
): Promise<Uint8Array> {
  const want = rows * rowBytes;
  const { offset, length } = chunk;
  const fax = page.compression === 3 || page.compression === 4;
  let src = bytes;
  let start = offset;
  if (page.fillOrder === 2 && !fax) {
    src = bytes.slice(offset, offset + length);
    for (let i = 0; i < src.length; i++) src[i] = reverseBits[src[i]!]!;
    start = 0;
  }
  let out: Uint8Array;
  let written: number;
  switch (page.compression) {
    case 1:
      if (length < want) throw new TiffDamage();
      return src.slice(start, start + want);
    case 5:
      out = new Uint8Array(want);
      written = lzwDecode(src, start, length, out);
      break;
    case 32773:
      out = new Uint8Array(want);
      written = packBitsDecode(src, start, length, out);
      break;
    case 8:
    case 32946:
      ({ out, written } = await inflate(
        src.subarray(start, start + length),
        want,
      ));
      break;
    case 3:
    case 4: {
      hardenCcitt();
      out = new Uint8Array(want);
      ccitt.width = pixelsAcross;
      ccitt.rows = 0;
      const d = UTIF.decode;
      if (page.compression === 4)
        d._decodeG4(src, start, length, out, 0, pixelsAcross, page.fillOrder);
      else {
        d._decodeG3.allow2D = (page.t4Options & 1) === 1 ? null : false;
        d._decodeG3(src, start, length, out, 0, pixelsAcross, page.fillOrder);
      }
      if (ccitt.rows < rows) throw new TiffDamage();
      return out;
    }
    case 7: {
      out = new Uint8Array(want);
      // A copy: the decoder rewrites the photometric tag it is handed.
      const ifd: UtifIfd = {
        t262: [page.photometric],
        t258: [page.bits],
        ...(page.jpegTables ? { t347: page.jpegTables } : {}),
      };
      UTIF.decode._decodeNewJPEG(ifd, src, start, length, out, 0);
      return out;
    }
  }
  if (written < want) throw new TiffDamage();
  if (page.predictor === 2)
    undoPredictor(
      out,
      rows,
      rowBytes,
      page.samplesPerPixel,
      page.bits,
      page.littleEndian,
    );
  return out;
}

/** The page's samples as stored, whole rows of `rowBytes`. */
async function decodeSamples(
  bytes: Uint8Array,
  page: TiffPage,
): Promise<Uint8Array> {
  const { width, height, samplesPerPixel: spp, bits } = page;
  const rowBytes = Math.ceil((width * spp * bits) / 8);
  const raw = new Uint8Array(rowBytes * height);
  if (!page.tile) {
    for (const [i, chunk] of page.chunks.entries()) {
      const y = i * page.rowsPerStrip;
      const rows = Math.min(page.rowsPerStrip, height - y);
      const strip = await decodeChunk(
        bytes,
        page,
        chunk,
        rows,
        width,
        rowBytes,
      );
      raw.set(strip.subarray(0, rows * rowBytes), y * rowBytes);
    }
    return raw;
  }
  const { width: tw, height: th } = page.tile;
  const tileRowBytes = (tw * spp * bits) / 8;
  const across = Math.ceil(width / tw);
  for (const [i, chunk] of page.chunks.entries()) {
    const tx = i % across;
    const ty = Math.floor(i / across);
    const tile = await decodeChunk(bytes, page, chunk, th, tw, tileRowBytes);
    const x = tx * tileRowBytes;
    const take = Math.min(tileRowBytes, rowBytes - x);
    for (let r = 0; r < th; r++) {
      const y = ty * th + r;
      if (y >= height) break;
      raw.set(
        tile.subarray(r * tileRowBytes, r * tileRowBytes + take),
        y * rowBytes + x,
      );
    }
  }
  return raw;
}

/**
 * Decode one page from {@link readTiffPages} into a {@link TiffRaster}.
 * Throws a {@link PdfEngineError} naming the page when the data is damaged.
 */
export async function decodeTiffPage(
  name: string,
  bytes: Uint8Array,
  page: TiffPage,
): Promise<TiffRaster> {
  let raw: Uint8Array;
  try {
    raw = await decodeSamples(bytes, page);
  } catch {
    throw new PdfEngineError(tiffRefusal.damaged(name, page.number));
  }
  return toRaster(page, raw);
}

/** Stored samples → the PDF image's: 8-bit from 16, colours apart from alpha. */
function toRaster(page: TiffPage, raw: Uint8Array): TiffRaster {
  const { width, height, photometric, littleEndian } = page;
  let { bits } = page;
  const spp = page.samplesPerPixel;
  let samples = raw;
  if (bits === 16) {
    // Keep the high byte of each sample.
    samples = new Uint8Array(raw.length / 2);
    const hi = littleEndian ? 1 : 0;
    for (let i = 0; i < samples.length; i++) samples[i] = raw[i * 2 + hi]!;
    bits = 8;
  }
  const colours = photometric === 6 ? 3 : COLOUR_SAMPLES[photometric]!;
  let alpha: Uint8Array | null = null;
  if (spp > colours) {
    const pixels = width * height;
    const colour = new Uint8Array(pixels * colours);
    alpha = page.alphaSample >= 0 ? new Uint8Array(pixels) : null;
    for (let p = 0; p < pixels; p++) {
      for (let c = 0; c < colours; c++)
        colour[p * colours + c] = samples[p * spp + c]!;
      if (alpha) alpha[p] = samples[p * spp + colours + page.alphaSample]!;
    }
    samples = colour;
  }
  let palette: Uint8Array | null = null;
  if (photometric === 3) {
    const n = 2 ** bits;
    palette = new Uint8Array(n * 3);
    const map = page.colorMap!;
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 3; c++) palette[i * 3 + c] = map[c * n + i]! >> 8;
  }
  return {
    page: page.number,
    width,
    height,
    widthPt: page.widthPt,
    heightPt: page.heightPt,
    colorSpace:
      photometric === 3
        ? "indexed"
        : photometric === 5
          ? "cmyk"
          : colours === 3
            ? "rgb"
            : "gray",
    bitsPerComponent: bits as TiffRaster["bitsPerComponent"],
    invert: photometric === 0,
    samples,
    alpha,
    palette,
  };
}

/* ------------------------------------------------------------------ *
 *  Into the PDF
 * ------------------------------------------------------------------ */

/**
 * Embed a decoded page as it is — lossless, at its own depth and colour
 * model — and return it as a `PDFImage` the engine draws through
 * `drawRasterImage` like any other. The streams are compressed now, so the
 * page's raw samples can be let go before the next page is decoded.
 */
export async function embedTiffRaster(
  doc: PDFDocument,
  raster: TiffRaster,
): Promise<PDFImage> {
  const lib = await loadPdfLib();
  const context = doc.context;
  const { width, height } = raster;
  const smask = raster.alpha
    ? context.register(
        context.flateStream(raster.alpha, {
          Type: "XObject",
          Subtype: "Image",
          Width: width,
          Height: height,
          BitsPerComponent: 8,
          ColorSpace: "DeviceGray",
        }),
      )
    : undefined;
  const colorSpace =
    raster.colorSpace === "indexed"
      ? [
          "Indexed",
          "DeviceRGB",
          raster.palette!.length / 3 - 1,
          lib.PDFHexString.of(
            Array.from(raster.palette!, (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
          ),
        ]
      : raster.colorSpace === "rgb"
        ? "DeviceRGB"
        : raster.colorSpace === "cmyk"
          ? "DeviceCMYK"
          : "DeviceGray";
  const stream = context.flateStream(raster.samples, {
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    BitsPerComponent: raster.bitsPerComponent,
    ColorSpace: colorSpace,
    ...(raster.invert ? { Decode: [1, 0] } : {}),
    ...(smask ? { SMask: smask } : {}),
  });
  const ref = context.nextRef();
  // pdf-lib's PDFImage takes only its own two embedders (an `instanceof`
  // check), so this one borrows PngEmbedder's prototype for that check and
  // overrides everything the image reads of it: its size, and the one call
  // that writes the stream — which here is already built.
  const embedder = Object.assign(
    Object.create(lib.PngEmbedder.prototype) as object,
    {
      width,
      height,
      embedIntoContext: async (ctx: typeof context, at = ref) => {
        ctx.assign(at, stream);
        return at;
      },
    },
  );
  const image = lib.PDFImage.of(
    ref,
    doc,
    embedder as Parameters<typeof lib.PDFImage.of>[2],
  );
  await image.embed();
  return image;
}

/** The bytes the lossless page costs in a PDF, for the size ladder to weigh. */
export async function losslessTiffBytes(raster: TiffRaster): Promise<number> {
  const lib = await loadPdfLib();
  const scratch = await lib.PDFDocument.create();
  const size = (data: Uint8Array) =>
    scratch.context.flateStream(data, {}).getContentsSize();
  return size(raster.samples) + (raster.alpha ? size(raster.alpha) : 0);
}

/** The page as RGBA, for a canvas — what the size ladder re-encodes. */
export function tiffRasterRgba(raster: TiffRaster): Uint8ClampedArray {
  const { width, height, bitsPerComponent: bpc, samples } = raster;
  const out = new Uint8ClampedArray(width * height * 4);
  const comps =
    raster.colorSpace === "rgb" ? 3 : raster.colorSpace === "cmyk" ? 4 : 1;
  const rowBytes = Math.ceil((width * comps * bpc) / 8);
  const max = 2 ** bpc - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const sample = (c: number) => {
        if (bpc === 8) return samples[y * rowBytes + x * comps + c]!;
        const bit = (x * comps + c) * bpc;
        const byte = samples[y * rowBytes + (bit >>> 3)]!;
        return (byte >> (8 - bpc - (bit & 7))) & max;
      };
      if (raster.colorSpace === "indexed") {
        const i = sample(0) * 3;
        out[p] = raster.palette![i]!;
        out[p + 1] = raster.palette![i + 1]!;
        out[p + 2] = raster.palette![i + 2]!;
      } else if (comps === 1) {
        let v = Math.round((sample(0) * 255) / max);
        if (raster.invert) v = 255 - v;
        out[p] = out[p + 1] = out[p + 2] = v;
      } else if (comps === 3) {
        out[p] = sample(0);
        out[p + 1] = sample(1);
        out[p + 2] = sample(2);
      } else {
        const k = 1 - sample(3) / 255;
        out[p] = 255 * (1 - sample(0) / 255) * k;
        out[p + 1] = 255 * (1 - sample(1) / 255) * k;
        out[p + 2] = 255 * (1 - sample(2) / 255) * k;
      }
      out[p + 3] = raster.alpha ? raster.alpha[y * width + x]! : 255;
    }
  }
  return out;
}
