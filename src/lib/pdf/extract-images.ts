/**
 * True embedded-image extraction from a PDF — this is NOT page rasterization.
 *
 * We walk each page's `/Resources /XObject` dictionary (recursing through Form
 * XObjects) and pull the *original* image streams out at their own embedded,
 * native resolution:
 *
 *  - `DCTDecode` → the stream bytes already ARE a JPEG file, so they're written
 *    verbatim as `.jpg` (byte-for-byte the embedded image — nothing re-encoded).
 *  - `FlateDecode` / `LZWDecode` (± `ASCII85`/`ASCIIHex`/`RunLength`) over
 *    DeviceRGB / DeviceGray / CalRGB / CalGray / ICCBased(N=1|3) at 8 bits per
 *    component, or DeviceGray at 1 bit → the raw samples are inflated, any Flate
 *    predictor is reversed, and the pixels are re-wrapped losslessly as a PNG at
 *    the image's native size.
 *
 * Anything we can't reconstruct faithfully — JPEG 2000, CCITT/JBIG2 fax bitmaps,
 * Indexed palettes, CMYK/Separation/DeviceN/Lab, unusual bit depths, custom
 * `/Decode` arrays, or stencil image masks — is reported as *skipped* with a
 * concrete reason instead of being guessed at, rasterized, or silently dropped.
 * No page is ever rendered, which is exactly why extracted images keep their
 * real embedded pixels and resolution.
 *
 * Pure and DOM-free (pdf-lib only), so the browser runner and Node unit tests
 * exercise the identical code path.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";
import { pdfLoadError } from "./engine";

/** Image container we can emit — an original JPEG or a losslessly-wrapped PNG. */
export type ExtractedImageFormat = "jpg" | "png";

export interface ExtractedImage {
  /** Deterministic download name, e.g. `page-001-image-002.png`. */
  name: string;
  /** The image file bytes (a real JPEG or PNG). */
  bytes: Uint8Array;
  format: ExtractedImageFormat;
  /** Native embedded width in pixels (from the image's own `/Width`). */
  width: number;
  /** Native embedded height in pixels (from the image's own `/Height`). */
  height: number;
  /** 1-based page the image was first found on. */
  page: number;
  /** Human colour-space label, e.g. `DeviceRGB`, `ICCBased(3)`, `CMYK (JPEG)`. */
  colorSpace: string;
}

export interface SkippedImage {
  /** 1-based page the image was found on. */
  page: number;
  /** Concrete, honest reason we didn't extract it. */
  reason: string;
  /** The stream's filter chain, e.g. `JPXDecode` or `FlateDecode`. */
  filter: string;
}

export interface ExtractImagesResult {
  /** Every image we could faithfully recover, in page + resource order. */
  images: ExtractedImage[];
  /** Images we found but deliberately did not extract, each with a reason. */
  skipped: SkippedImage[];
  /** Number of pages scanned. */
  pageCount: number;
}

/** Decode filters that produce pixel samples (i.e. are not an image codec). */
const PIXEL_FILTERS = new Set([
  "FlateDecode",
  "LZWDecode",
  "ASCII85Decode",
  "ASCIIHexDecode",
  "RunLengthDecode",
]);

/** Guard against pathological dimensions blowing up memory (100 megapixels). */
const MAX_PIXELS = 100_000_000;

/** Deepest Form-XObject nesting we'll follow (cycle / runaway guard). */
const MAX_XOBJECT_DEPTH = 24;

/**
 * Extract every embedded raster image we can faithfully recover from a PDF,
 * reporting the rest as skipped-with-reason. Purely structural: it reads image
 * XObject streams and never renders a page.
 */
export async function extractPdfImages(
  pdfBytes: Uint8Array,
): Promise<ExtractImagesResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, { throwOnInvalidObject: false });
  } catch (err) {
    throw await pdfLoadError(err, pdfBytes);
  }
  const pages = doc.getPages();
  const pageCount = pages.length;

  const images: ExtractedImage[] = [];
  const skipped: SkippedImage[] = [];
  // Dedupe by indirect-object tag so an image (or form) reused across pages is
  // handled exactly once, attributed to the first page it appears on.
  const seen = new Set<string>();
  // Per-page running image counter, so names are contiguous within a page.
  const perPage = new Map<number, number>();
  let maxSeq = 0;

  // Collected as raw records first; download names need totals for zero-pad
  // width, which we only know once every page has been scanned.
  interface RawRecord {
    page: number;
    seq: number;
    bytes: Uint8Array;
    format: ExtractedImageFormat;
    width: number;
    height: number;
    colorSpace: string;
  }
  const records: RawRecord[] = [];

  const emit = (
    page: number,
    bytes: Uint8Array,
    format: ExtractedImageFormat,
    width: number,
    height: number,
    colorSpace: string,
  ) => {
    const seq = (perPage.get(page) ?? 0) + 1;
    perPage.set(page, seq);
    if (seq > maxSeq) maxSeq = seq;
    records.push({ page, seq, bytes, format, width, height, colorSpace });
  };

  const skip = (page: number, filter: string, reason: string) => {
    skipped.push({ page, reason, filter });
  };

  const walk = (
    resources: PDFDict | undefined,
    page: number,
    depth: number,
  ) => {
    if (!resources || depth > MAX_XOBJECT_DEPTH) return;
    const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return;
    for (const [key] of xobjects.entries()) {
      const rawValue = xobjects.get(key);
      const dedupeKey =
        rawValue instanceof PDFRef ? rawValue.tag : `${page}:${key.asString()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const obj = xobjects.lookup(key);
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = obj.dict.lookup(PDFName.of("Subtype"));
      if (subtype === PDFName.of("Image")) {
        handleImage(obj, page, emit, skip);
      } else if (subtype === PDFName.of("Form")) {
        const formResources = obj.dict.lookupMaybe(
          PDFName.of("Resources"),
          PDFDict,
        );
        walk(formResources, page, depth + 1);
      }
    }
  };

  pages.forEach((page, i) => walk(page.node.Resources(), i + 1, 0));

  const pageWidth = Math.max(3, String(pageCount).length);
  const imageWidth = Math.max(3, String(maxSeq).length);
  for (const r of records) {
    images.push({
      name: `page-${pad(r.page, pageWidth)}-image-${pad(r.seq, imageWidth)}.${r.format}`,
      bytes: r.bytes,
      format: r.format,
      width: r.width,
      height: r.height,
      page: r.page,
      colorSpace: r.colorSpace,
    });
  }

  return { images, skipped, pageCount };
}

type EmitFn = (
  page: number,
  bytes: Uint8Array,
  format: ExtractedImageFormat,
  width: number,
  height: number,
  colorSpace: string,
) => void;
type SkipFn = (page: number, filter: string, reason: string) => void;

/** Decide what to do with one image XObject: extract it, or skip with a reason. */
function handleImage(
  stream: PDFRawStream,
  page: number,
  emit: EmitFn,
  skip: SkipFn,
): void {
  const dict = stream.dict;
  const filters = normalizeFilters(dict);
  const filterLabel = filters.length ? filters.join(", ") : "(none)";

  // Stencil masks are 1-bit paint masks, not standalone images.
  const imageMask = dict.lookup(PDFName.of("ImageMask"));
  if (imageMask && imageMask.toString() === "true") {
    skip(page, filterLabel, "Stencil image mask (not a standalone image)");
    return;
  }

  const width = numberOf(dict, "Width");
  const height = numberOf(dict, "Height");
  if (width < 1 || height < 1) {
    skip(page, filterLabel, "Missing or invalid dimensions");
    return;
  }
  if (width * height > MAX_PIXELS) {
    skip(page, filterLabel, `Image too large to process (${width}×${height})`);
    return;
  }

  const codec = filters.length ? filters[filters.length - 1] : undefined;

  // ── JPEG: the stream already holds a complete JPEG file. ──
  if (codec === "DCTDecode") {
    const jpeg = jpegBytesFromChain(stream, filters);
    if (!jpeg) {
      skip(page, filterLabel, "JPEG behind an unsupported filter chain");
      return;
    }
    const label = jpegColorLabel(dict);
    emit(page, jpeg, "jpg", width, height, label);
    return;
  }

  // ── Other image codecs we can't faithfully turn into JPG/PNG. ──
  if (codec === "JPXDecode") {
    skip(page, filterLabel, "JPEG 2000 (JPXDecode) is not supported");
    return;
  }
  if (codec === "CCITTFaxDecode") {
    skip(page, filterLabel, "CCITT Group 3/4 fax image is not supported");
    return;
  }
  if (codec === "JBIG2Decode") {
    skip(page, filterLabel, "JBIG2 image is not supported");
    return;
  }
  if (codec && !PIXEL_FILTERS.has(codec)) {
    skip(page, filterLabel, `Unsupported filter: ${codec}`);
    return;
  }

  // ── Pixel image (Flate/LZW/RunLength/ASCII or uncompressed). ──
  if (dict.lookup(PDFName.of("Decode")) instanceof PDFArray) {
    // A custom /Decode remaps sample values (e.g. inverts); honouring it is out
    // of scope, so skip rather than emit wrong colours.
    skip(page, filterLabel, "Custom /Decode array is not supported");
    return;
  }

  const color = classifyColorSpace(dict);
  if (color.kind === "cmyk") {
    skip(page, filterLabel, `CMYK ${color.label} image is not supported`);
    return;
  }
  if (color.kind === "unsupported") {
    skip(page, filterLabel, `Unsupported colour space: ${color.label}`);
    return;
  }

  const bpc = numberOf(dict, "BitsPerComponent");
  let pngKind: PngKind;
  let rowBytes: number;
  if (color.kind === "rgb" && bpc === 8) {
    pngKind = "rgb8";
    rowBytes = width * 3;
  } else if (color.kind === "gray" && bpc === 8) {
    pngKind = "gray8";
    rowBytes = width;
  } else if (color.kind === "gray" && bpc === 1) {
    pngKind = "gray1";
    rowBytes = Math.ceil(width / 8);
  } else {
    skip(page, filterLabel, `Unsupported ${bpc}-bit ${color.label} image`);
    return;
  }

  let samples: Uint8Array;
  try {
    samples = decodePDFRawStream(stream).decode();
  } catch {
    skip(page, filterLabel, `Could not decode stream (${filterLabel})`);
    return;
  }

  const geom = readPredictorGeometry(dict, width, color.channels, bpc);
  if (geom.predictor > 1) {
    const reconstructed = reversePredictor(samples, geom);
    if (!reconstructed) {
      skip(
        page,
        filterLabel,
        `Predictor ${geom.predictor} is not supported at ${geom.bitsPerComponent}-bit`,
      );
      return;
    }
    samples = reconstructed;
  }

  const needed = rowBytes * height;
  if (samples.length < needed) {
    skip(
      page,
      filterLabel,
      `Truncated image data (${samples.length}/${needed} bytes)`,
    );
    return;
  }

  const png = encodePng(width, height, pngKind, samples.subarray(0, needed));
  emit(page, png, "png", width, height, color.label);
}

// ─────────────────────────────── Stream helpers ──────────────────────────────

/** Normalize `/Filter` (a name or an array of names) to plain strings. */
function normalizeFilters(dict: PDFDict): string[] {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter instanceof PDFName) return [nameStr(filter)];
  if (filter instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < filter.size(); i++) {
      const name = filter.lookupMaybe(i, PDFName);
      if (name) out.push(nameStr(name));
    }
    return out;
  }
  return [];
}

/**
 * Recover the JPEG bytes for a `DCTDecode` image. When DCT is the only filter
 * the raw stream contents *are* the JPEG; when it sits behind decodable stream
 * filters (e.g. `[/ASCII85Decode /DCTDecode]`) we run those first. Returns null
 * if a preceding filter isn't one we can decode.
 */
function jpegBytesFromChain(
  stream: PDFRawStream,
  filters: string[],
): Uint8Array | null {
  if (filters.length <= 1) return stream.contents;
  const preceding = filters.slice(0, -1);
  if (!preceding.every((f) => PIXEL_FILTERS.has(f))) return null;

  const ctx = stream.dict.context;
  const synthetic = PDFDict.withContext(ctx);
  const filterArray = PDFArray.withContext(ctx);
  for (const f of preceding) filterArray.push(PDFName.of(f));
  synthetic.set(PDFName.of("Filter"), filterArray);

  // Carry the matching DecodeParms slice when present as a parallel array.
  const parms = stream.dict.lookup(PDFName.of("DecodeParms"));
  if (parms instanceof PDFArray) {
    const slice = PDFArray.withContext(ctx);
    for (let i = 0; i < preceding.length; i++) {
      slice.push(i < parms.size() ? parms.get(i) : ctx.obj(null));
    }
    synthetic.set(PDFName.of("DecodeParms"), slice);
  }

  try {
    return decodePDFRawStream(
      PDFRawStream.of(synthetic, stream.contents),
    ).decode();
  } catch {
    return null;
  }
}

interface ColorSpaceInfo {
  kind: "rgb" | "gray" | "cmyk" | "unsupported";
  /** Channel count (3, 1, 4) — 0 when unsupported. */
  channels: number;
  /** Human label for reporting. */
  label: string;
}

/** Classify an image's `/ColorSpace` into what we can (or can't) render. */
function classifyColorSpace(dict: PDFDict): ColorSpaceInfo {
  const cs = dict.lookup(PDFName.of("ColorSpace"));

  if (cs instanceof PDFName) {
    const n = nameStr(cs);
    if (n === "DeviceRGB" || n === "CalRGB" || n === "RGB")
      return { kind: "rgb", channels: 3, label: n };
    if (n === "DeviceGray" || n === "CalGray" || n === "G")
      return { kind: "gray", channels: 1, label: n };
    if (n === "DeviceCMYK" || n === "CMYK")
      return { kind: "cmyk", channels: 4, label: n };
    return { kind: "unsupported", channels: 0, label: n };
  }

  if (cs instanceof PDFArray && cs.size() > 0) {
    const head = cs.lookupMaybe(0, PDFName);
    const family = head ? nameStr(head) : "array";
    if (family === "ICCBased") {
      const profile = cs.lookup(1);
      const n =
        profile instanceof PDFRawStream ? numberOf(profile.dict, "N") : 0;
      if (n === 1) return { kind: "gray", channels: 1, label: "ICCBased(1)" };
      if (n === 3) return { kind: "rgb", channels: 3, label: "ICCBased(3)" };
      if (n === 4) return { kind: "cmyk", channels: 4, label: "ICCBased(4)" };
      return {
        kind: "unsupported",
        channels: 0,
        label: `ICCBased(${n || "?"})`,
      };
    }
    if (family === "CalRGB")
      return { kind: "rgb", channels: 3, label: "CalRGB" };
    if (family === "CalGray")
      return { kind: "gray", channels: 1, label: "CalGray" };
    if (family === "Indexed" || family === "I")
      return { kind: "unsupported", channels: 0, label: "Indexed (palette)" };
    return { kind: "unsupported", channels: 0, label: family };
  }

  return { kind: "unsupported", channels: 0, label: "unknown" };
}

/** A metadata label for a JPEG, which we extract regardless of colour space. */
function jpegColorLabel(dict: PDFDict): string {
  const color = classifyColorSpace(dict);
  if (color.kind === "cmyk") return "CMYK (JPEG)";
  if (color.kind === "unsupported") return "JPEG";
  return color.label;
}

// ─────────────────────────────── Predictors ──────────────────────────────────
// pdf-lib decodes Flate/LZW but does NOT reverse the optional predictor step, so
// we do it here. Without this, predictor-encoded images (the common case for
// image XObjects written by many tools) would decode to garbage.

interface PredictorGeometry {
  predictor: number;
  colors: number;
  columns: number;
  bitsPerComponent: number;
}

/**
 * Read predictor geometry from `/DecodeParms` (a dict, or the parallel array
 * entry that carries `/Predictor`). Colours/columns/bit-depth default to the
 * image's own values, which is what real images use. `predictor: 1` = none.
 */
function readPredictorGeometry(
  dict: PDFDict,
  width: number,
  channels: number,
  bpc: number,
): PredictorGeometry {
  const parms =
    dict.lookup(PDFName.of("DecodeParms")) ?? dict.lookup(PDFName.of("DP"));
  let params: PDFDict | undefined;
  if (parms instanceof PDFDict) {
    params = parms;
  } else if (parms instanceof PDFArray) {
    for (let i = 0; i < parms.size(); i++) {
      const entry = parms.lookupMaybe(i, PDFDict);
      if (entry && entry.lookup(PDFName.of("Predictor"))) {
        params = entry;
        break;
      }
    }
  }
  if (!params) {
    return {
      predictor: 1,
      colors: channels,
      columns: width,
      bitsPerComponent: bpc,
    };
  }
  return {
    predictor: numberOr(params, "Predictor", 1),
    colors: numberOr(params, "Colors", channels),
    columns: numberOr(params, "Columns", width),
    bitsPerComponent: numberOr(params, "BitsPerComponent", bpc),
  };
}

/**
 * Reverse a Flate/LZW predictor. Supports TIFF horizontal differencing
 * (predictor 2) and the PNG predictors (10–15), both at 8 bits per component —
 * the depths we emit. Returns null for anything else so the caller can skip
 * honestly instead of producing wrong pixels.
 */
export function reversePredictor(
  data: Uint8Array,
  geom: PredictorGeometry,
): Uint8Array | null {
  const { predictor, colors, columns, bitsPerComponent } = geom;
  if (predictor <= 1) return data;
  if (bitsPerComponent !== 8) return null;
  const bpp = Math.max(1, colors);
  const rowBytes = columns * colors;
  if (rowBytes <= 0) return null;

  // TIFF predictor 2: per-row horizontal differencing, no filter-type byte.
  if (predictor === 2) {
    const rows = Math.floor(data.length / rowBytes);
    const out = data.slice(0, rows * rowBytes);
    for (let r = 0; r < rows; r++) {
      const off = r * rowBytes;
      for (let i = bpp; i < rowBytes; i++) {
        out[off + i] = ((out[off + i] ?? 0) + (out[off + i - bpp] ?? 0)) & 0xff;
      }
    }
    return out;
  }

  // PNG predictors 10–15: each scanline is prefixed by a filter-type byte.
  if (predictor < 10) return null;
  const stride = rowBytes + 1;
  const rows = Math.floor(data.length / stride);
  const out = new Uint8Array(rows * rowBytes);
  let prev = new Uint8Array(rowBytes);
  for (let r = 0; r < rows; r++) {
    const filterType = data[r * stride];
    const srcOff = r * stride + 1;
    const cur = out.subarray(r * rowBytes, r * rowBytes + rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? (cur[i - bpp] ?? 0) : 0;
      const up = prev[i] ?? 0;
      const upLeft = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
      let value = data[srcOff + i] ?? 0;
      switch (filterType) {
        case 0:
          break;
        case 1:
          value = (value + left) & 0xff;
          break;
        case 2:
          value = (value + up) & 0xff;
          break;
        case 3:
          value = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          value = (value + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          return null;
      }
      cur[i] = value;
    }
    prev = cur;
  }
  return out;
}

/** PNG Paeth predictor: pick the neighbour closest to the linear estimate. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ─────────────────────────── Pure PNG encoder ────────────────────────────────
// Dependency-free and deterministic: raw samples are wrapped in a valid PNG
// using stored (uncompressed) DEFLATE blocks. The output is a genuine lossless
// PNG of the embedded pixels — callers may re-compress it inside a ZIP.

export type PngKind = "rgb8" | "gray8" | "gray1";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** Encode raw image samples as a lossless PNG at the given native dimensions. */
export function encodePng(
  width: number,
  height: number,
  kind: PngKind,
  samples: Uint8Array,
): Uint8Array {
  const { bitDepth, colorType, rowBytes } = pngLayout(width, kind);

  // Prefix each scanline with filter type 0 ("None").
  const stride = rowBytes + 1;
  const scanlines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * stride] = 0;
    scanlines.set(
      samples.subarray(y * rowBytes, y * rowBytes + rowBytes),
      y * stride + 1,
    );
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  // ihdr[10..12] = compression / filter / interlace = 0 (already zeroed).

  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibStore(scanlines)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function pngLayout(
  width: number,
  kind: PngKind,
): { bitDepth: number; colorType: number; rowBytes: number } {
  if (kind === "rgb8")
    return { bitDepth: 8, colorType: 2, rowBytes: width * 3 };
  if (kind === "gray8") return { bitDepth: 8, colorType: 0, rowBytes: width };
  return { bitDepth: 1, colorType: 0, rowBytes: Math.ceil(width / 8) };
}

/** Build a length-prefixed, CRC-suffixed PNG chunk. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);

  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);

  const crcData = new Uint8Array(4 + data.length);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcData));
  return out;
}

/** Wrap bytes in a zlib stream using stored (type 0) DEFLATE blocks. */
function zlibStore(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blocks = Math.max(1, Math.ceil(data.length / MAX_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  let p = 0;
  out[p++] = 0x78; // CMF: deflate, 32K window
  out[p++] = 0x01; // FLG: check bits, no dict, fastest

  if (data.length === 0) {
    out[p++] = 0x01; // final, stored
    out[p++] = 0x00;
    out[p++] = 0x00;
    out[p++] = 0xff;
    out[p++] = 0xff;
  } else {
    let offset = 0;
    while (offset < data.length) {
      const len = Math.min(MAX_BLOCK, data.length - offset);
      out[p++] = offset + len >= data.length ? 0x01 : 0x00;
      out[p++] = len & 0xff;
      out[p++] = (len >>> 8) & 0xff;
      out[p++] = ~len & 0xff;
      out[p++] = (~len >>> 8) & 0xff;
      out.set(data.subarray(offset, offset + len), p);
      p += len;
      offset += len;
    }
  }

  const adler = adler32(data);
  out[p++] = (adler >>> 24) & 0xff;
  out[p++] = (adler >>> 16) & 0xff;
  out[p++] = (adler >>> 8) & 0xff;
  out[p++] = adler & 0xff;
  return out.subarray(0, p);
}

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
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  let i = 0;
  while (i < bytes.length) {
    // Process in chunks so the sums can't overflow a 32-bit int before % MOD.
    let n = Math.min(bytes.length - i, 5552);
    while (n-- > 0) {
      a += bytes[i++]!;
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ──────────────────────────────── Utilities ──────────────────────────────────

function nameStr(name: PDFName): string {
  return name.asString().replace(/^\//, "");
}

function numberOf(dict: PDFDict, key: string): number {
  return numberOr(dict, key, 0);
}

function numberOr(dict: PDFDict, key: string, fallback: number): number {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
