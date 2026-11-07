/**
 * An image as Tesseract should read it: upright, on a page of sensible size.
 *
 * Tesseract reads a JPG or PNG through Leptonica, which applies neither of the
 * two things a phone photo depends on (audit #9, 2026-11-06):
 *
 *  - **EXIF Orientation.** A phone saves a portrait shot as LANDSCAPE pixels
 *    plus a tag saying "turn me 90°" (see `@/lib/pdf/jpeg-orientation`, which
 *    JPG to PDF, Scan to PDF and the editor already honour). Tesseract read
 *    the stored pixels, so the photographed receipt the OCR page advertises
 *    was read sideways and came back as garbage, with no error. A JPEG whose
 *    tag asks for a turn, and whose pixel count is within
 *    `OCR_IMAGE_MAX_TURN_PIXELS`, is now redrawn upright and handed over as a
 *    JPEG again (not a PNG: the searchable PDF embeds this file, and a
 *    lossless copy of a photo is several times its size).
 *  - **Resolution.** Tesseract sizes the searchable PDF's page from the
 *    image's declared resolution. Leptonica reads it from a JFIF APP0 in
 *    units 1 or 2 ONLY: a camera's EXIF XResolution is never read, and a file
 *    with no JFIF segment (iPhone and Samsung cameras write Exif only) or one
 *    in units 0 (libjpeg's default, and this canvas's) declares nothing, so
 *    Tesseract falls back to an estimate no lower than
 *    {@link TESSERACT_MIN_CREDIBLE_DPI}. Declared or not, a 4032 × 3024
 *    photo became a page some 56 inches wide. Every JPEG with a readable
 *    frame header now declares a resolution that keeps the page's longer
 *    side within A4's ({@link OCR_IMAGE_MAX_PAGE_INCHES}): a declared figure
 *    is raised, never lowered; a units-0 density is patched in place; a file
 *    with no JFIF segment gets one inserted after SOI. A JPEG whose page
 *    already fits is handed over byte for byte.
 *
 * Reviewed 2026-11-06: the first version patched only a JFIF density in
 * units 1 or 2 (the wrong corpus: most phone JPEGs carry neither), and
 * decoded any turned JPEG with no pixel bound, in the worker's own process,
 * outside Tesseract's timeout.
 *
 * NOT done here: a PNG keeps its own `pHYs` (a PNG has no turn to make; a
 * huge PNG declaring 72 dpi still makes a huge page). A JPEG over the pixel
 * ceiling is not turned (it still gets the bounded page). An image whose
 * longer side is over {@link TESSERACT_MAX_CREDIBLE_DPI} times A4's length
 * (28,063 px; no phone writes one) cannot be bounded: Tesseract replaces any
 * higher figure with its own estimate. Only the Linux worker image, with
 * Tesseract installed, can show the recognised text; the tests here check
 * the pixels and the density Tesseract is given.
 */
import {
  OCR_IMAGE_MAX_TURN_PIXELS,
  OCR_IMAGE_PAGE_BOUND,
} from "@/lib/jobs/ocr";
import {
  readJpegOrientation,
  uprightJpeg,
  swapsAxes,
  type ExifOrientation,
} from "@/lib/pdf/jpeg-orientation";
import { loadNodeCanvas } from "./pdf-office-export/pdfjs-node";

/** The longest side, in inches, a page made from an image may have. */
export const OCR_IMAGE_MAX_PAGE_INCHES =
  Math.max(...Object.values(OCR_IMAGE_PAGE_BOUND.size!)) / 72;

/** The least resolution this declares (a phone's own 72 dpi). */
const MIN_DPI = 72;

/**
 * Tesseract's credible range (`kMinCredibleResolution`,
 * `kMaxCredibleResolution`): outside it, a declared figure, or none, is
 * replaced by Tesseract's estimate, clipped to the same range.
 */
const TESSERACT_MIN_CREDIBLE_DPI = 70;
const TESSERACT_MAX_CREDIBLE_DPI = 2400;

/** Quality of the upright re-encode: high enough to keep small print. */
const UPRIGHT_JPEG_QUALITY = 92;

/**
 * The resolution to declare for a `width` × `height` image that declares
 * `declared` dpi (null: none): the declared figure, raised just enough that
 * the page's longer side fits {@link OCR_IMAGE_MAX_PAGE_INCHES} (but not past
 * what Tesseract believes), and never below {@link MIN_DPI}.
 */
export function ocrImageDpi(
  width: number,
  height: number,
  declared: number | null,
): number {
  const fit = Math.ceil(Math.max(width, height) / OCR_IMAGE_MAX_PAGE_INCHES);
  return Math.max(
    MIN_DPI,
    declared ?? 0,
    Math.min(fit, TESSERACT_MAX_CREDIBLE_DPI),
  );
}

/** Where a JPEG's JFIF APP0 density lives, and what it says in dpi. */
interface JfifDensity {
  /** Offset of the units byte; X and Y density (u16 BE) follow it. */
  at: number;
  /** Dots per inch, or null when the units are 0 (an aspect ratio only). */
  dpi: number | null;
}

/** "JFIF" and a NUL, built from char codes (a raw NUL in source is fragile). */
const JFIF_ID = String.fromCharCode(0x4a, 0x46, 0x49, 0x46, 0);

/** The JFIF APP0 wherever it sits before the scan, as libjpeg finds it. */
function readJfifDensity(bytes: Uint8Array): JfifDensity | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let pos = 2; pos + 4 <= bytes.length && bytes[pos] === 0xff;) {
    const marker = bytes[pos + 1]!;
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    if (marker === 0xe0 && length >= 16 && pos + 2 + length <= bytes.length) {
      const id = String.fromCharCode(...bytes.subarray(pos + 4, pos + 9));
      if (id === JFIF_ID) {
        const at = pos + 11;
        const units = bytes[at]!;
        const x = (bytes[at + 1]! << 8) | bytes[at + 2]!;
        if ((units !== 1 && units !== 2) || x === 0) return { at, dpi: null };
        return { at, dpi: units === 2 ? Math.round(x * 2.54) : x };
      }
    }
    pos += 2 + length;
  }
  return null;
}

/** A JFIF 1.01 APP0 declaring `dpi` per inch on both axes, no thumbnail. */
function jfifApp0(dpi: number): Uint8Array {
  const hi = dpi >> 8;
  const lo = dpi & 0xff;
  // prettier-ignore
  return Uint8Array.of(
    0xff, 0xe0, 0x00, 0x10, // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF" NUL
    0x01, 0x01, // version 1.01
    0x01, hi, lo, hi, lo, // units: inch; X and Y density
    0x00, 0x00, // no thumbnail
  );
}

/** `jpeg` declaring exactly `dpi`: its JFIF density patched, or one inserted. */
function declaringDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  const density = readJfifDensity(jpeg);
  if (density?.dpi === dpi) return jpeg;
  if (density) {
    const copy = new Uint8Array(jpeg);
    copy[density.at] = 1;
    copy[density.at + 1] = copy[density.at + 3] = dpi >> 8;
    copy[density.at + 2] = copy[density.at + 4] = dpi & 0xff;
    return copy;
  }
  const app0 = jfifApp0(dpi);
  const out = new Uint8Array(jpeg.length + app0.length);
  out.set(jpeg.subarray(0, 2));
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}

/**
 * `bytes` declaring the resolution {@link ocrImageDpi} asks for, or the same
 * array when its page already fits: a declared figure is raised in place, a
 * units-0 density is patched in place (both same length), and a file with no
 * JFIF APP0 gets one right after SOI. With nothing declared, Tesseract's own
 * estimate is never below {@link TESSERACT_MIN_CREDIBLE_DPI}, so a file whose
 * page fits even at that is left to it.
 */
function withPageBound(
  bytes: Uint8Array,
  size: { width: number; height: number },
): Uint8Array {
  const declared = readJfifDensity(bytes)?.dpi ?? null;
  const longer = Math.max(size.width, size.height);
  if (
    declared === null &&
    longer / TESSERACT_MIN_CREDIBLE_DPI <= OCR_IMAGE_MAX_PAGE_INCHES
  )
    return bytes;
  return declaringDpi(bytes, ocrImageDpi(size.width, size.height, declared));
}

/** The image's pixel size, from the JPEG frame header. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let pos = 2;
  while (pos + 9 < bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1]!;
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    )
      return {
        height: (bytes[pos + 5]! << 8) | bytes[pos + 6]!,
        width: (bytes[pos + 7]! << 8) | bytes[pos + 8]!,
      };
    pos += 2 + length;
  }
  return null;
}

/**
 * The canvas map from STORED pixels to the upright image, per the TIFF/EXIF
 * definitions, as `setTransform(a, b, c, d, e, f)`: x' = a·x + c·y + e,
 * y' = b·x + d·y + f, for a `w` × `h` stored image.
 */
function uprightTransform(
  o: ExifOrientation,
  w: number,
  h: number,
): [number, number, number, number, number, number] {
  switch (o) {
    case 1:
      return [1, 0, 0, 1, 0, 0];
    case 2:
      return [-1, 0, 0, 1, w, 0];
    case 3:
      return [-1, 0, 0, -1, w, h];
    case 4:
      return [1, 0, 0, -1, 0, h];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, h, 0];
    case 7:
      return [0, -1, -1, 0, h, w];
    case 8:
      return [0, -1, 1, 0, 0, w];
  }
}

/** What this module needs of `@napi-rs/canvas`. */
export interface OcrImageCanvas {
  loadImage(bytes: Uint8Array): Promise<{ width: number; height: number }>;
  createCanvas(
    width: number,
    height: number,
  ): {
    getContext(kind: "2d"): {
      setTransform(
        a: number,
        b: number,
        c: number,
        d: number,
        e: number,
        f: number,
      ): void;
      drawImage(image: unknown, x: number, y: number): void;
    };
    encode(format: "jpeg", quality: number): Promise<Uint8Array>;
  };
}

/** The bytes to hand Tesseract, and the extension they must be saved under. */
export interface OcrImage {
  bytes: Uint8Array;
  ext: string;
}

/**
 * Prepare an image input for Tesseract (see the module docblock). Anything
 * other than a JPEG is returned as it is, and so is a JPEG with no frame
 * header. A turned JPEG over the pixel ceiling, or one the canvas cannot
 * decode, is handed over unturned but with its page bounded: Tesseract then
 * reads it as it did before this existed, rather than a photo that converts
 * today becoming a failed job.
 */
export async function ocrReadyImage(
  bytes: Uint8Array,
  ext: string,
  // The same `@napi-rs/canvas` module; `NodeImageCanvas` types only the part
  // the decoding instruments use, not `setTransform` or `encode`.
  canvas: () => OcrImageCanvas = () =>
    loadNodeCanvas() as unknown as OcrImageCanvas,
): Promise<OcrImage> {
  if (ext !== "jpg") return { bytes, ext };
  const size = jpegSize(bytes);
  if (!size) return { bytes, ext };
  const orientation = readJpegOrientation(bytes);
  const unturned = { bytes: withPageBound(bytes, size), ext };
  if (orientation === 1) return unturned;
  // Decoding needs width × height × 4 bytes twice (image and canvas) in this
  // process, before Tesseract's own timeout and memory guard apply; a frame
  // header can declare up to 65,535 × 65,535.
  if (size.width * size.height > OCR_IMAGE_MAX_TURN_PIXELS) return unturned;
  try {
    const c = canvas();
    // The tag is set to "as stored" first, so the turn below is the only one
    // whether or not the canvas would honour EXIF itself.
    const image = await c.loadImage(uprightJpeg(bytes).bytes);
    const { width: w, height: h } = image;
    const swap = swapsAxes(orientation);
    const out = c.createCanvas(swap ? h : w, swap ? w : h);
    const ctx = out.getContext("2d");
    ctx.setTransform(...uprightTransform(orientation, w, h));
    ctx.drawImage(image, 0, 0);
    const jpeg = new Uint8Array(await out.encode("jpeg", UPRIGHT_JPEG_QUALITY));
    // The re-encode declares no resolution (JFIF units 0), so the source's
    // declared figure, if any, is carried over as the floor.
    const dpi = ocrImageDpi(w, h, readJfifDensity(bytes)?.dpi ?? null);
    return { bytes: declaringDpi(jpeg, dpi), ext };
  } catch {
    return unturned;
  }
}
