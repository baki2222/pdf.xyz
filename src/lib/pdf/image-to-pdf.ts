import {
  drawRasterImage,
  embedRasterImage,
  loadPdfLib,
  rasterDisplaySize,
  type RasterImageFormat,
} from "./pdf-lib";
import { outputName } from "./files";
import { PdfEngineError } from "./engine";

const PRODUCER = "pdf.xyz";
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 36;
// The cap the tool page advertises, so the gate and the promise are one value.
import { MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/lib/tools/limits";

export type ImagePdfKind = "jpg" | "png";

export interface ImagePdfInput {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/**
 * The MIME types and extensions each format is recognised by. ONE table for
 * both the pick-time check ({@link isImageAllowedForKind}) and the file
 * picker's `accept` ({@link imagePickerAccept}): when they were written apart,
 * the check took PNG and JPG on both tools while the picker still hid the
 * other format, so only drag-and-drop got the fix.
 */
const IMAGE_FORMATS = {
  png: { types: ["image/png"], extensions: [".png"] },
  jpg: { types: ["image/jpeg", "image/jpg"], extensions: [".jpg", ".jpeg"] },
} as const satisfies Record<
  RasterImageFormat,
  { types: readonly string[]; extensions: readonly string[] }
>;

function looksLike(
  format: RasterImageFormat,
  file: Pick<ImagePdfInput, "name" | "type">,
): boolean {
  const { types, extensions } = IMAGE_FORMATS[format];
  const name = file.name.toLowerCase();
  return (
    (types as readonly string[]).includes(file.type) ||
    extensions.some((ext) => name.endsWith(ext))
  );
}

export function isLikelyJpeg(
  file: Pick<ImagePdfInput, "name" | "type">,
): boolean {
  return looksLike("jpg", file);
}

export function isLikelyPng(
  file: Pick<ImagePdfInput, "name" | "type">,
): boolean {
  return looksLike("png", file);
}

/**
 * The file picker's `accept` for an image tool: every format
 * {@link isImageAllowedForKind} takes, the tool's own format first.
 */
export function imagePickerAccept(kind: ImagePdfKind): string {
  const order: RasterImageFormat[] =
    kind === "jpg" ? ["jpg", "png"] : ["png", "jpg"];
  return order
    .flatMap((f) => [...IMAGE_FORMATS[f].types, ...IMAGE_FORMATS[f].extensions])
    .join(",");
}

/**
 * Can this file go into an image PDF? PNG and JPEG, on BOTH tools.
 *
 * It used to be one format per tool, while the engine could embed either: a
 * workspace with 3 PNGs and 2 JPGs was offered "Turn your 5 images into a
 * PDF", handed to JPG to PDF, and got a 2-page PDF. The decoder is now chosen
 * per file from its bytes ({@link sniffRasterFormat}), so the tool the user
 * opened no longer decides which of their images count. `kind` stays in the
 * signature because it still names the tool (titles, copy); it no longer
 * filters.
 */
export function isImageAllowedForKind(
  _kind: ImagePdfKind,
  file: Pick<ImagePdfInput, "name" | "type">,
): boolean {
  return isLikelyPng(file) || isLikelyJpeg(file);
}

/**
 * The container the bytes actually hold, whatever the file is called. A
 * `.png` saved from the web is often a JPEG (or a WebP); the name only
 * decides whether we look.
 */
export function sniffRasterFormat(bytes: Uint8Array): RasterImageFormat | null {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= PNG.length && PNG.every((b, i) => bytes[i] === b)) {
    return "png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpg";
  }
  return null;
}

/** Name the format of image bytes we cannot embed, when we can tell. */
function describeImageBytes(bytes: Uint8Array): string | null {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "WebP";
  if (ascii(0, 4) === "GIF8") return "GIF";
  if (ascii(0, 2) === "BM") return "BMP";
  const tiffLE = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a;
  const tiffBE = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a;
  if (tiffLE || tiffBE) return "TIFF";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (/^avi[fs]$/.test(brand)) return "AVIF";
    if (/^(hei[cx]|hev[cx]|mif1|msf1)$/.test(brand)) return "HEIC";
  }
  return null;
}

/** Why a file with these bytes cannot go into an image PDF, for the user. */
export function unsupportedImageMessage(
  name: string,
  bytes: Uint8Array,
): string {
  const real = describeImageBytes(bytes);
  return real
    ? `"${name}" is a ${real} image. Only PNG and JPG images can be converted here.`
    : `"${name}" isn't a PNG or JPG image.`;
}

export function validateImagePdfInputs(
  kind: ImagePdfKind,
  files: ImagePdfInput[],
): void {
  if (files.length === 0) {
    throw new PdfEngineError(
      `Add at least one ${kind === "jpg" ? "JPG" : "PNG"} image.`,
    );
  }
  for (const file of files) {
    if (!isImageAllowedForKind(kind, file)) {
      throw new PdfEngineError(`"${file.name}" isn't a PNG or JPG image.`);
    }
    if (file.bytes.byteLength === 0) {
      throw new PdfEngineError(`"${file.name}" is empty.`);
    }
    if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new PdfEngineError(
        `"${file.name}" is too large for in-browser conversion (max ${MAX_IMAGE_MB} MB per image).`,
      );
    }
  }
}

export function imagePdfOutputName(
  kind: ImagePdfKind,
  firstName?: string,
): string {
  return firstName ? outputName(firstName, "pdf", "pdf") : `${kind}-images.pdf`;
}

function fitRect(width: number, height: number) {
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const maxHeight = PAGE_HEIGHT - MARGIN * 2;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    width: drawWidth,
    height: drawHeight,
    x: (PAGE_WIDTH - drawWidth) / 2,
    y: (PAGE_HEIGHT - drawHeight) / 2,
  };
}

/** Convert JPG or PNG images into one paginated PDF, one image per page. */
export async function imagesToPdf(
  kind: ImagePdfKind,
  files: ImagePdfInput[],
): Promise<Uint8Array> {
  validateImagePdfInputs(kind, files);
  const { PDFDocument, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setTitle(`${kind.toUpperCase()} images`);

  for (const file of files) {
    const format = sniffRasterFormat(file.bytes);
    if (!format) {
      throw new PdfEngineError(unsupportedImageMessage(file.name, file.bytes));
    }
    let image;
    try {
      image = await embedRasterImage(doc, file.bytes, format);
    } catch {
      throw new PdfEngineError(
        `"${file.name}" could not be decoded as a ${format === "jpg" ? "JPG" : "PNG"} image.`,
      );
    }
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: rgb(1, 1, 1),
    });
    // Fit the image as the browser SHOWED it: a portrait phone photo is stored
    // as landscape pixels plus an EXIF turn, and the preview grid is upright.
    const shown = rasterDisplaySize(image);
    await drawRasterImage(page, image, fitRect(shown.width, shown.height));
  }

  return doc.save();
}
