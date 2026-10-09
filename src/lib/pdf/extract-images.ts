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
 *    component, DeviceGray at 1 bit, or an `Indexed` palette over one of those
 *    at 1/2/4/8 bits → the raw samples are inflated, any Flate predictor is
 *    reversed, palette indices are looked up, and the pixels are re-wrapped
 *    losslessly as a PNG at the image's native size.
 *  - Transparency travels with the pixels: an `/SMask`, a colour-key `/Mask`
 *    array or an explicit stencil `/Mask` becomes the PNG's alpha channel.
 *    Where it cannot be applied (a JPEG keeps its original bytes, or the mask
 *    is pre-blended, a different size, or in a form we don't read), the image
 *    is still extracted, opaque, and carries a `note` saying so.
 *
 * Anything we can't reconstruct faithfully — JPEG 2000, CCITT/JBIG2 fax bitmaps,
 * CMYK/Separation/DeviceN/Lab (including palettes over them), unusual bit
 * depths, custom `/Decode` arrays, stencil image masks, and inline images
 * (`BI … ID … EI` in a content stream) — is reported as *skipped* with a
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
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
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
  /**
   * Set when the file differs from how the PDF shows the image — today, only
   * when its transparency could not be carried over. This is NOT a skip: the
   * image was extracted, so it is never also counted in `skipped`.
   */
  note?: string;
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
    note?: string;
  }
  const records: RawRecord[] = [];

  const emit: EmitFn = (
    page,
    bytes,
    format,
    width,
    height,
    colorSpace,
    note,
  ) => {
    const seq = (perPage.get(page) ?? 0) + 1;
    perPage.set(page, seq);
    if (seq > maxSeq) maxSeq = seq;
    records.push({
      page,
      seq,
      bytes,
      format,
      width,
      height,
      colorSpace,
      ...(note ? { note } : {}),
    });
  };

  const skip = (page: number, filter: string, reason: string) => {
    skipped.push({ page, reason, filter });
  };

  // Inline images live in content streams, not in /XObject resources, so the
  // resource walk alone cannot see them. Each one found is reported as skipped:
  // a page (or form) whose only images are inline would otherwise read as
  // "this PDF has no images".
  const scanContent = (streams: PDFObject | undefined, page: number) => {
    for (const stream of contentStreams(streams, doc.context, seen)) {
      let data: Uint8Array;
      try {
        data = decodePDFRawStream(stream).decode();
      } catch {
        continue;
      }
      for (const inline of findInlineImages(data)) {
        skip(
          page,
          inline.filter,
          inline.stencil
            ? "Stencil image mask (not a standalone image)"
            : "Inline image (not yet supported)",
        );
      }
    }
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
        scanContent(obj, page);
        const formResources = obj.dict.lookupMaybe(
          PDFName.of("Resources"),
          PDFDict,
        );
        walk(formResources, page, depth + 1);
      }
    }
  };

  pages.forEach((page, i) => {
    walk(page.node.Resources(), i + 1, 0);
    scanContent(page.node.get(PDFName.of("Contents")), i + 1);
  });

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
      ...(r.note ? { note: r.note } : {}),
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
  note?: string,
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
    // The JPEG is kept byte-for-byte, and a JPEG has no alpha channel, so a
    // mask beside it cannot travel with it. Say so, rather than hand over an
    // opaque image as if it were the whole picture.
    const masked =
      dict.lookup(PDFName.of("SMask")) instanceof PDFRawStream ||
      dict.lookup(PDFName.of("Mask")) !== undefined;
    emit(
      page,
      jpeg,
      "jpg",
      width,
      height,
      label,
      masked
        ? noTransparency(
            "a JPEG is saved exactly as embedded and cannot carry the PDF's separate mask",
          )
        : undefined,
    );
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
  const color = classifyColorSpace(dict);
  if (color.kind === "cmyk") {
    skip(page, filterLabel, `CMYK ${color.label} image is not supported`);
    return;
  }
  if (color.kind === "unsupported") {
    skip(
      page,
      filterLabel,
      color.reason ?? `Unsupported colour space: ${color.label}`,
    );
    return;
  }

  const bpc = numberOf(dict, "BitsPerComponent");
  const depthOk =
    color.kind === "indexed"
      ? bpc === 1 || bpc === 2 || bpc === 4 || bpc === 8
      : color.kind === "rgb"
        ? bpc === 8
        : bpc === 1 || bpc === 8;
  if (!depthOk) {
    skip(page, filterLabel, `Unsupported ${bpc}-bit ${color.label} image`);
    return;
  }

  const decodeArray = dict.lookup(PDFName.of("Decode"));
  if (
    decodeArray instanceof PDFArray &&
    !isDefaultDecode(decodeArray, color, bpc)
  ) {
    // A custom /Decode remaps sample values (e.g. inverts); honouring it is out
    // of scope, so skip rather than emit wrong colours. The DEFAULT array is
    // the identity and is accepted: some writers spell it out.
    skip(page, filterLabel, "Custom /Decode array is not supported");
    return;
  }

  const packed = decodeSamples(stream, width, height, color.channels, bpc);
  if (typeof packed === "string") {
    skip(page, filterLabel, packed);
    return;
  }

  // Raw component values, one byte each: what a colour-key /Mask compares
  // against (for a palette image that is the INDEX, not the looked-up colour).
  const raw = () =>
    bpc === 8
      ? packed
      : unpackSamples(packed, width, height, color.channels, bpc);

  let kind: PngKind;
  let pixels: Uint8Array;
  if (color.kind === "indexed") {
    pixels = expandPalette(raw(), color.palette);
    kind = color.palette.baseChannels === 3 ? "rgb8" : "gray8";
  } else if (color.kind === "rgb") {
    pixels = packed;
    kind = "rgb8";
  } else if (bpc === 8) {
    pixels = packed;
    kind = "gray8";
  } else {
    pixels = packed;
    kind = "gray1";
  }

  const transparency = readTransparency(dict, width, height, color, bpc, raw);
  if (transparency.alpha) {
    if (kind === "gray1") {
      // PNG has no 1-bit gray+alpha, so widen the bitmap to 8-bit first.
      pixels = unpackSamples(pixels, width, height, 1, 1).map((v) =>
        v ? 255 : 0,
      );
      kind = "gray8";
    }
    pixels = interleaveAlpha(
      pixels,
      kind === "rgb8" ? 3 : 1,
      transparency.alpha,
    );
    kind = kind === "rgb8" ? "rgba8" : "ga8";
  }

  const png = encodePng(width, height, kind, pixels);
  emit(page, png, "png", width, height, color.label, transparency.note);
}

/**
 * Inflate an image's samples, reverse any predictor, and check there are
 * enough of them. Returns the packed rows, or a skip reason.
 */
function decodeSamples(
  stream: PDFRawStream,
  width: number,
  height: number,
  channels: number,
  bpc: number,
): Uint8Array | string {
  const dict = stream.dict;
  const filterLabel = normalizeFilters(dict).join(", ") || "(none)";
  let samples: Uint8Array;
  try {
    samples = decodePDFRawStream(stream).decode();
  } catch {
    return `Could not decode stream (${filterLabel})`;
  }

  const geom = readPredictorGeometry(dict, width, channels, bpc);
  if (geom.predictor > 1) {
    const reconstructed = reversePredictor(samples, geom);
    if (!reconstructed) {
      return `Predictor ${geom.predictor} is not supported at ${geom.bitsPerComponent}-bit`;
    }
    samples = reconstructed;
  }

  const needed = Math.ceil((width * channels * bpc) / 8) * height;
  if (samples.length < needed) {
    return `Truncated image data (${samples.length}/${needed} bytes)`;
  }
  return samples.subarray(0, needed);
}

/**
 * Split byte-aligned rows of `bpc`-bit samples (MSB first) into one byte per
 * sample. Row padding below 8 bits is dropped.
 */
function unpackSamples(
  packed: Uint8Array,
  width: number,
  height: number,
  channels: number,
  bpc: number,
): Uint8Array {
  const perRow = width * channels;
  const rowBytes = Math.ceil((perRow * bpc) / 8);
  const out = new Uint8Array(perRow * height);
  const mask = (1 << bpc) - 1;
  for (let y = 0; y < height; y++) {
    const rowOff = y * rowBytes;
    for (let i = 0; i < perRow; i++) {
      const bit = i * bpc;
      const byte = packed[rowOff + (bit >> 3)] ?? 0;
      out[y * perRow + i] = (byte >> (8 - bpc - (bit & 7))) & mask;
    }
  }
  return out;
}

/** Look every index up in the palette, clamping to `hival` as readers do. */
function expandPalette(indices: Uint8Array, palette: Palette): Uint8Array {
  const n = palette.baseChannels;
  const out = new Uint8Array(indices.length * n);
  for (let i = 0; i < indices.length; i++) {
    const entry = Math.min(indices[i] ?? 0, palette.hival) * n;
    for (let c = 0; c < n; c++) out[i * n + c] = palette.table[entry + c] ?? 0;
  }
  return out;
}

/** Interleave one alpha byte after each pixel's `channels` colour bytes. */
function interleaveAlpha(
  pixels: Uint8Array,
  channels: number,
  alpha: Uint8Array,
): Uint8Array {
  const count = alpha.length;
  const stride = channels + 1;
  const out = new Uint8Array(count * stride);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < channels; c++)
      out[i * stride + c] = pixels[i * channels + c] ?? 0;
    out[i * stride + channels] = alpha[i] ?? 255;
  }
  return out;
}

// ─────────────────────────────── Transparency ────────────────────────────────

interface Transparency {
  /** One alpha byte per pixel (0 = transparent), when it could be applied. */
  alpha?: Uint8Array;
  /** Why the image was saved without the transparency the PDF gives it. */
  note?: string;
}

function noTransparency(why: string): string {
  return `Saved without its transparency: ${why}`;
}

/**
 * Turn whatever transparency the PDF attaches to an image into an alpha
 * channel. `/SMask` wins over `/Mask`, as it does when a reader paints it.
 * Anything we cannot apply faithfully comes back as a `note`, never as a
 * reason to drop the image: an opaque copy is still worth having.
 */
function readTransparency(
  dict: PDFDict,
  width: number,
  height: number,
  color: ColorSpaceInfo,
  bpc: number,
  raw: () => Uint8Array,
): Transparency {
  const smask = dict.lookup(PDFName.of("SMask"));
  if (smask instanceof PDFRawStream) {
    return softMaskAlpha(smask, width, height);
  }

  const mask = dict.lookup(PDFName.of("Mask"));
  if (mask instanceof PDFArray) {
    return colourKeyAlpha(mask, raw(), color.channels, bpc);
  }
  if (mask instanceof PDFRawStream) {
    return stencilMaskAlpha(mask, width, height);
  }
  return {};
}

/** The checks both kinds of mask stream share: size, and a filter we read. */
function maskStreamProblem(
  mask: PDFRawStream,
  width: number,
  height: number,
): string | null {
  const mw = numberOf(mask.dict, "Width");
  const mh = numberOf(mask.dict, "Height");
  if (mw !== width || mh !== height) {
    return `the mask is ${mw}×${mh} but the image is ${width}×${height}`;
  }
  const codec = normalizeFilters(mask.dict).find((f) => !PIXEL_FILTERS.has(f));
  if (codec) return `the mask is stored as ${codec}, which isn't read`;
  return null;
}

/** Read a mask stream's `/Decode`: identity, inverted, or something else. */
function maskDecode(mask: PDFRawStream): "identity" | "inverted" | "other" {
  const decode = mask.dict.lookup(PDFName.of("Decode"));
  if (decode === undefined) return "identity";
  if (!(decode instanceof PDFArray) || decode.size() !== 2) return "other";
  const lo = decode.lookup(0);
  const hi = decode.lookup(1);
  if (!(lo instanceof PDFNumber) || !(hi instanceof PDFNumber)) return "other";
  if (lo.asNumber() === 0 && hi.asNumber() === 1) return "identity";
  if (lo.asNumber() === 1 && hi.asNumber() === 0) return "inverted";
  return "other";
}

/** `/SMask`: a grayscale image whose samples ARE the alpha. */
function softMaskAlpha(
  mask: PDFRawStream,
  width: number,
  height: number,
): Transparency {
  if (mask.dict.lookup(PDFName.of("Matte")) !== undefined) {
    return {
      note: noTransparency(
        "its mask is pre-blended (/Matte), which isn't supported",
      ),
    };
  }
  const problem = maskStreamProblem(mask, width, height);
  if (problem) return { note: noTransparency(problem) };

  const declared = mask.dict.lookup(PDFName.of("ColorSpace")) !== undefined;
  if (declared && classifyColorSpace(mask.dict).kind !== "gray") {
    return { note: noTransparency("its mask is not grayscale") };
  }
  const bpc = numberOf(mask.dict, "BitsPerComponent");
  if (bpc !== 1 && bpc !== 2 && bpc !== 4 && bpc !== 8) {
    return { note: noTransparency(`its ${bpc}-bit mask isn't supported`) };
  }
  const decode = maskDecode(mask);
  if (decode === "other") {
    return { note: noTransparency("its mask has a custom /Decode array") };
  }

  const packed = decodeSamples(mask, width, height, 1, bpc);
  if (typeof packed === "string") {
    return { note: noTransparency("its mask could not be decoded") };
  }
  const max = (1 << bpc) - 1;
  const values =
    bpc === 8 ? packed : unpackSamples(packed, width, height, 1, bpc);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    const v = Math.round(((values[i] ?? 0) * 255) / max);
    alpha[i] = decode === "inverted" ? 255 - v : v;
  }
  return { alpha };
}

/**
 * Explicit `/Mask` stream: a 1-bit stencil where, under the default `/Decode`,
 * a sample of 1 masks the image OUT (transparent) and 0 lets it paint.
 */
function stencilMaskAlpha(
  mask: PDFRawStream,
  width: number,
  height: number,
): Transparency {
  const problem = maskStreamProblem(mask, width, height);
  if (problem) return { note: noTransparency(problem) };
  const bpc = numberOr(mask.dict, "BitsPerComponent", 1);
  if (bpc !== 1) {
    return { note: noTransparency(`its ${bpc}-bit stencil mask isn't read`) };
  }
  const decode = maskDecode(mask);
  if (decode === "other") {
    return { note: noTransparency("its mask has a custom /Decode array") };
  }
  const packed = decodeSamples(mask, width, height, 1, 1);
  if (typeof packed === "string") {
    return { note: noTransparency("its mask could not be decoded") };
  }
  const bits = unpackSamples(packed, width, height, 1, 1);
  const maskedOut = decode === "inverted" ? 0 : 1;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = bits[i] === maskedOut ? 0 : 255;
  }
  return { alpha };
}

/**
 * Colour-key `/Mask [min₁ max₁ …]`: a pixel is transparent when EVERY raw
 * component falls inside its range. Compared on the raw samples, so for a
 * palette image the range is over the index.
 */
function colourKeyAlpha(
  ranges: PDFArray,
  raw: Uint8Array,
  channels: number,
  bpc: number,
): Transparency {
  const bounds: number[] = [];
  for (let i = 0; i < ranges.size(); i++) {
    const n = ranges.lookup(i);
    if (!(n instanceof PDFNumber)) break;
    bounds.push(n.asNumber());
  }
  if (bounds.length !== channels * 2) {
    return {
      note: noTransparency(
        `its colour-key mask has ${bounds.length} bounds, not ${channels * 2}`,
      ),
    };
  }
  const max = (1 << bpc) - 1;
  const lo = bounds.filter((_, i) => i % 2 === 0);
  const hi = bounds.filter((_, i) => i % 2 === 1).map((v) => Math.min(max, v));
  const pixelCount = raw.length / channels;
  const alpha = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    let keyed = true;
    for (let c = 0; c < channels && keyed; c++) {
      const v = raw[p * channels + c] ?? 0;
      if (v < (lo[c] ?? 0) || v > (hi[c] ?? max)) keyed = false;
    }
    alpha[p] = keyed ? 0 : 255;
  }
  return { alpha };
}

// ─────────────────────────────── Inline images ───────────────────────────────

/** PDF whitespace: NUL, TAB, LF, FF, CR, SPACE. */
function isWhite(c: number | undefined): boolean {
  return (
    c === 0x20 ||
    c === 0x0a ||
    c === 0x0d ||
    c === 0x09 ||
    c === 0x0c ||
    c === 0
  );
}

/** PDF delimiters: ( ) < > [ ] { } / % */
function isDelim(c: number | undefined): boolean {
  return (
    c === 0x28 ||
    c === 0x29 ||
    c === 0x3c ||
    c === 0x3e ||
    c === 0x5b ||
    c === 0x5d ||
    c === 0x7b ||
    c === 0x7d ||
    c === 0x2f ||
    c === 0x25
  );
}

/**
 * Every content stream that can draw for a page or form: `/Contents` may be a
 * single stream, a reference to one, or an array of them. A stream reached by
 * reference is yielded once per document, like an image shared by pages.
 */
function contentStreams(
  value: PDFObject | undefined,
  context: PDFContext,
  seen: Set<string>,
): PDFRawStream[] {
  const out: PDFRawStream[] = [];
  const add = (entry: PDFObject | undefined, nested: boolean) => {
    if (entry instanceof PDFRef) {
      const key = `content:${entry.tag}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    const obj = entry instanceof PDFRef ? context.lookup(entry) : entry;
    if (obj instanceof PDFRawStream) {
      out.push(obj);
    } else if (obj instanceof PDFArray && !nested) {
      for (let i = 0; i < obj.size(); i++) add(obj.get(i), true);
    }
  };
  add(value, false);
  return out;
}

interface InlineImage {
  /** The inline dictionary's `/F` (`/Filter`) chain, or `inline`. */
  filter: string;
  /** `/IM true`: a stencil mask, reported the way an XObject stencil is. */
  stencil: boolean;
}

/**
 * Find the inline images (`BI <dict> ID <data> EI`) in a decoded content
 * stream, by tokenizing rather than substring-matching: `BI` inside a string
 * `( … )`, a hex string, a comment or a name (`/BI`) is not an operator, and
 * once `ID` is reached the image's binary data is skipped to its closing `EI`,
 * so sample bytes can never be mistaken for another image.
 */
function findInlineImages(data: Uint8Array): InlineImage[] {
  const found: InlineImage[] = [];
  const n = data.length;
  let i = 0;

  /** Read the next token, or null at end of data. Advances `i`. */
  const next = (): string | null => {
    while (i < n) {
      const c = data[i];
      if (isWhite(c)) {
        i++;
      } else if (c === 0x25) {
        // % comment, to end of line
        while (i < n && data[i] !== 0x0a && data[i] !== 0x0d) i++;
      } else {
        break;
      }
    }
    if (i >= n) return null;
    const c = data[i]!;
    if (c === 0x28) {
      // ( literal string ), balanced parentheses, backslash escapes
      let depth = 0;
      while (i < n) {
        const d = data[i];
        if (d === 0x5c) {
          i += 2;
          continue;
        }
        if (d === 0x28) depth++;
        else if (d === 0x29 && --depth === 0) {
          i++;
          break;
        }
        i++;
      }
      return "(string)";
    }
    if (c === 0x3c) {
      if (data[i + 1] === 0x3c) {
        i += 2;
        return "<<";
      }
      while (i < n && data[i] !== 0x3e) i++; // <hex string>
      i++;
      return "(hex)";
    }
    if (c === 0x3e) {
      i += data[i + 1] === 0x3e ? 2 : 1;
      return ">>";
    }
    if (c === 0x2f) {
      // /Name — its own token, so `/BI` or `/ID` is never an operator.
      const start = i++;
      while (i < n && !isWhite(data[i]) && !isDelim(data[i])) i++;
      return latin1(data, start, i);
    }
    if (isDelim(c)) {
      i++;
      return String.fromCharCode(c);
    }
    const start = i;
    while (i < n && !isWhite(data[i]) && !isDelim(data[i])) i++;
    return latin1(data, start, i);
  };

  for (let token = next(); token !== null; token = next()) {
    if (token !== "BI") continue;

    // The inline dictionary, up to the ID operator.
    const dict: string[] = [];
    let reachedId = false;
    for (let t = next(); t !== null; t = next()) {
      if (t === "ID") {
        reachedId = true;
        break;
      }
      dict.push(t);
    }
    if (!reachedId) break;

    found.push({
      filter: inlineFilter(dict),
      stencil: inlineFlag(dict, "/IM") || inlineFlag(dict, "/ImageMask"),
    });

    // ID is followed by exactly one whitespace byte, then binary data. The
    // image ends at the first `EI` that stands alone: whitespace before it,
    // whitespace, a delimiter or end of data after it.
    i++;
    let end = -1;
    for (let j = i; j + 1 < n; j++) {
      if (
        data[j] === 0x45 &&
        data[j + 1] === 0x49 &&
        isWhite(data[j - 1]) &&
        (j + 2 >= n || isWhite(data[j + 2]) || isDelim(data[j + 2]))
      ) {
        end = j;
        break;
      }
    }
    if (end < 0) break;
    i = end + 2;
  }
  return found;
}

/** The value after `/F` or `/Filter` in an inline dictionary's tokens. */
function inlineFilter(tokens: string[]): string {
  const at = tokens.findIndex((t) => t === "/F" || t === "/Filter");
  if (at < 0) return "inline";
  const value = tokens[at + 1];
  if (value === "[") {
    const names: string[] = [];
    for (let k = at + 2; k < tokens.length && tokens[k] !== "]"; k++)
      names.push(tokens[k]!.replace(/^\//, ""));
    return names.length ? `inline, ${names.join(", ")}` : "inline";
  }
  return value?.startsWith("/") ? `inline, ${value.slice(1)}` : "inline";
}

/** Whether a boolean key (e.g. `/IM`) is `true` in an inline dictionary. */
function inlineFlag(tokens: string[], key: string): boolean {
  const at = tokens.indexOf(key);
  return at >= 0 && tokens[at + 1] === "true";
}

function latin1(data: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let k = start; k < end; k++) out += String.fromCharCode(data[k]!);
  return out;
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

/** A palette's lookup table, resolved to raw bytes and checked for length. */
interface Palette {
  /** Bytes per entry: 3 for an RGB base, 1 for a gray one. */
  baseChannels: number;
  /** Highest valid index; larger indices are clamped to it. */
  hival: number;
  /** `(hival + 1) * baseChannels` bytes at least. */
  table: Uint8Array;
}

type ColorSpaceInfo =
  | {
      kind: "rgb" | "gray" | "cmyk";
      /** Channel count (3, 1, 4). */
      channels: number;
      /** Human label for reporting. */
      label: string;
    }
  | {
      kind: "indexed";
      /** ONE sample (the index) per pixel, whatever the base colour space. */
      channels: 1;
      label: string;
      palette: Palette;
    }
  | {
      kind: "unsupported";
      channels: 0;
      label: string;
      /** A specific skip reason, when the generic one would say too little. */
      reason?: string;
    };

/** Classify an image's `/ColorSpace` into what we can (or can't) render. */
function classifyColorSpace(dict: PDFDict): ColorSpaceInfo {
  return classifyColorSpaceObject(dict.lookup(PDFName.of("ColorSpace")), true);
}

function classifyColorSpaceObject(
  cs: PDFObject | undefined,
  allowIndexed: boolean,
): ColorSpaceInfo {
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
    if (family === "Indexed" || family === "I") {
      if (!allowIndexed)
        return { kind: "unsupported", channels: 0, label: "Indexed" };
      return classifyIndexed(cs);
    }
    return { kind: "unsupported", channels: 0, label: family };
  }

  return { kind: "unsupported", channels: 0, label: "unknown" };
}

/**
 * `[/Indexed base hival lookup]`. Expanding a palette is an exact table
 * lookup, so it is lossless whenever the base is one we already write (RGB or
 * gray); a palette over CMYK, Lab, Separation or DeviceN stays skipped.
 */
function classifyIndexed(cs: PDFArray): ColorSpaceInfo {
  const base = classifyColorSpaceObject(cs.lookup(1), false);
  const label = `Indexed (${base.label})`;
  const unsupported = (reason: string): ColorSpaceInfo => ({
    kind: "unsupported",
    channels: 0,
    label,
    reason,
  });
  if (base.kind !== "rgb" && base.kind !== "gray") {
    return unsupported(
      `Indexed (palette) image over ${base.label} is not supported`,
    );
  }
  const hivalObj = cs.lookup(2);
  const hival =
    hivalObj instanceof PDFNumber ? Math.floor(hivalObj.asNumber()) : -1;
  if (hival < 0 || hival > 255) {
    return unsupported("Indexed (palette) image with an invalid palette size");
  }
  const table = paletteBytes(cs.lookup(3));
  if (!table) {
    return unsupported("Indexed (palette) image whose palette can't be read");
  }
  if (table.length < (hival + 1) * base.channels) {
    return unsupported(
      "Indexed (palette) image whose palette is shorter than it declares",
    );
  }
  return {
    kind: "indexed",
    channels: 1,
    label,
    palette: { baseChannels: base.channels, hival, table },
  };
}

/**
 * A palette table's raw bytes. Strings are read with `asBytes`, never as
 * text: a palette entry is a byte, and text decoding would rewrite the high
 * ones.
 */
function paletteBytes(obj: PDFObject | undefined): Uint8Array | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return obj.asBytes();
  }
  if (obj instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(obj).decode();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Whether an image's `/Decode` is the default one, i.e. the identity: `[0 1]`
 * per component, or `[0 2^bpc−1]` for a palette index.
 */
function isDefaultDecode(
  decode: PDFArray,
  color: ColorSpaceInfo,
  bpc: number,
): boolean {
  const expected =
    color.kind === "indexed"
      ? [0, (1 << bpc) - 1]
      : Array.from({ length: color.channels }, () => [0, 1]).flat();
  if (decode.size() !== expected.length) return false;
  return expected.every((value, i) => {
    const n = decode.lookup(i);
    return n instanceof PDFNumber && n.asNumber() === value;
  });
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
 * (predictor 2) at 8 bits per component, and the PNG predictors (10–15) at 1,
 * 2, 4 or 8 bits. PNG filters work on BYTES, with "the pixel to the left"
 * meaning `ceil(bits per pixel / 8)` bytes back, so sub-byte rows (a PNG-8
 * palette embedded by pdfTeX, say) reverse exactly like 8-bit ones. Returns
 * null for anything else so the caller can skip honestly instead of producing
 * wrong pixels.
 */
export function reversePredictor(
  data: Uint8Array,
  geom: PredictorGeometry,
): Uint8Array | null {
  const { predictor, colors, columns, bitsPerComponent } = geom;
  if (predictor <= 1) return data;
  const subByte =
    bitsPerComponent === 1 || bitsPerComponent === 2 || bitsPerComponent === 4;
  if (bitsPerComponent !== 8 && !(subByte && predictor >= 10)) return null;
  const bitsPerPixel = Math.max(1, colors) * bitsPerComponent;
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const rowBytes = Math.ceil((columns * bitsPerPixel) / 8);
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

export type PngKind = "rgb8" | "rgba8" | "gray8" | "ga8" | "gray1";

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
  if (kind === "rgba8")
    return { bitDepth: 8, colorType: 6, rowBytes: width * 4 };
  if (kind === "gray8") return { bitDepth: 8, colorType: 0, rowBytes: width };
  if (kind === "ga8") return { bitDepth: 8, colorType: 4, rowBytes: width * 2 };
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
