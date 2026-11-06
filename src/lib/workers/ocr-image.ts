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
 *    tag asks for a turn is now redrawn upright and handed over as a PNG.
 *  - **Resolution.** Tesseract sizes the searchable PDF's page from the
 *    image's declared resolution, and a phone declares 72 dpi: a 4032 × 3024
 *    photo became a page 56 inches wide. The declared resolution is raised,
 *    never lowered, until the page's longer side is no longer than A4's
 *    ({@link OCR_IMAGE_MAX_PAGE_INCHES}); a JPEG that needs no turn has its
 *    JFIF density patched in place (same length, no re-encode).
 *
 * NOT done here: a PNG keeps its own `pHYs` (a PNG has no turn to make; a
 * huge PNG declaring 72 dpi still makes a huge page), and a JPEG that
 * declares no resolution in JFIF units is left for Tesseract to estimate, as
 * before. Only the Linux worker image, with Tesseract installed, can show the
 * recognised text; the tests here check the pixels and the density Tesseract
 * is given.
 */
import { OCR_IMAGE_PAGE_BOUND } from "@/lib/jobs/ocr";
import {
  readJpegOrientation,
  uprightJpeg,
  swapsAxes,
  type ExifOrientation,
} from "@/lib/pdf/jpeg-orientation";
import { loadNodeCanvas } from "./pdf-office-export/pdfjs-node";
import { withPngDpi } from "./pdf-office-export/png-encode";

/** The longest side, in inches, a page made from an image may have. */
export const OCR_IMAGE_MAX_PAGE_INCHES =
  Math.max(...Object.values(OCR_IMAGE_PAGE_BOUND.size!)) / 72;

/** Below this Tesseract calls a resolution not credible and estimates its own. */
const MIN_DPI = 72;

/**
 * The resolution to declare for a `width` × `height` image that declares
 * `declared` dpi (null: none): the declared figure, raised just enough that
 * the page's longer side fits {@link OCR_IMAGE_MAX_PAGE_INCHES}, and never
 * below {@link MIN_DPI}.
 */
export function ocrImageDpi(
  width: number,
  height: number,
  declared: number | null,
): number {
  const fit = Math.ceil(Math.max(width, height) / OCR_IMAGE_MAX_PAGE_INCHES);
  return Math.max(MIN_DPI, declared ?? 0, fit);
}

/** Where a JPEG's JFIF APP0 density lives, and what it says in dpi. */
interface JfifDensity {
  /** Offset of the units byte; X and Y density (u16 BE) follow it. */
  at: number;
  /** Dots per inch, or null when the units are 0 (an aspect ratio only). */
  dpi: number | null;
}

function readJfifDensity(bytes: Uint8Array): JfifDensity | null {
  // SOI, then an APP0 segment whose payload starts "JFIF\0".
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes[2] !== 0xff || bytes[3] !== 0xe0 || bytes.length < 18) return null;
  const id = String.fromCharCode(...bytes.subarray(6, 11));
  if (id !== "JFIF\0") return null;
  const at = 13;
  const units = bytes[at]!;
  const x = (bytes[at + 1]! << 8) | bytes[at + 2]!;
  if (units === 0 || x === 0) return { at, dpi: null };
  return { at, dpi: units === 2 ? Math.round(x * 2.54) : x };
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
    encode(format: "png"): Promise<Uint8Array>;
  };
}

/** The bytes to hand Tesseract, and the extension they must be saved under. */
export interface OcrImage {
  bytes: Uint8Array;
  ext: string;
}

/**
 * Prepare an image input for Tesseract (see the module docblock). Anything
 * other than a JPEG is returned as it is, and so is a JPEG this cannot read
 * (no frame header, or a canvas that cannot decode it): Tesseract then reads
 * it exactly as it did before this existed, rather than a photo that
 * converts today becoming a failed job.
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
  const density = readJfifDensity(bytes);
  const orientation = readJpegOrientation(bytes);
  if (orientation === 1) {
    if (!density || density.dpi === null) return { bytes, ext };
    const dpi = ocrImageDpi(size.width, size.height, density.dpi);
    if (dpi === density.dpi) return { bytes, ext };
    const copy = new Uint8Array(bytes);
    copy[density.at] = 1;
    copy[density.at + 1] = copy[density.at + 3] = dpi >> 8;
    copy[density.at + 2] = copy[density.at + 4] = dpi & 0xff;
    return { bytes: copy, ext };
  }
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
    const png = await out.encode("png");
    const dpi = ocrImageDpi(w, h, density?.dpi ?? null);
    return { bytes: withPngDpi(new Uint8Array(png), dpi), ext: "png" };
  } catch {
    return { bytes, ext };
  }
}
