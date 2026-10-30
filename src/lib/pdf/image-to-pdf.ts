import {
  drawRasterImage,
  embedRasterImage,
  loadPdfLib,
  rasterDisplaySize,
  type RasterImageFormat,
} from "./pdf-lib";
import { baseName, outputName, sanitizeSegment } from "./files";
import { PdfEngineError } from "./engine";
import {
  DEFAULT_IMAGE_PAGE_OPTIONS,
  imagePageLayout,
  type ImagePageOptions,
} from "./image-page-layout";
import type { NamedBytes } from "./types";

const PRODUCER = "pdf.xyz";
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

/**
 * The formats the BROWSER decodes and `image-transcode.ts` re-encodes as a
 * JPEG (opaque) or a PNG (with transparency) — a PDF cannot hold them as
 * they are. Same shape as {@link IMAGE_FORMATS}, so the gate and the picker
 * read both from one place. HEIC, TIFF and AVIF are absent on purpose: no
 * decoder for them ships in every browser.
 */
const DECODED_FORMATS = {
  webp: { types: ["image/webp"], extensions: [".webp"], label: "WebP" },
  gif: { types: ["image/gif"], extensions: [".gif"], label: "GIF" },
  bmp: {
    types: ["image/bmp", "image/x-ms-bmp"],
    extensions: [".bmp"],
    label: "BMP",
  },
} as const;
export type DecodedImageFormat = keyof typeof DECODED_FORMATS;

/** WebP, GIF, BMP — the decoded formats by the names the refusal note uses. */
export const DECODED_IMAGE_LABELS: readonly string[] = Object.values(
  DECODED_FORMATS,
).map((format) => format.label);

/**
 * The image kinds a file's bytes are recognised as and REFUSED, by the name
 * the refusal note gives them ({@link unsupportedImageMessage}). The type is
 * what `describeImageBytes` returns, so a guide saying "HEIC is turned away"
 * reads this list, and a format that gains a decoder must leave it.
 */
export const REFUSED_IMAGE_LABELS = ["HEIC", "TIFF", "AVIF"] as const;
type RefusedImageLabel = (typeof REFUSED_IMAGE_LABELS)[number];

/** Every format the image tools take. */
export type ImageFormat = RasterImageFormat | DecodedImageFormat;
const ALL_FORMATS: Record<
  ImageFormat,
  { types: readonly string[]; extensions: readonly string[] }
> = { ...IMAGE_FORMATS, ...DECODED_FORMATS };

/** The MIME type a sniffed image is carried under: its table's first. */
export const IMAGE_MIME = Object.fromEntries(
  Object.entries(ALL_FORMATS).map(([f, { types }]) => [f, types[0]!]),
) as Record<ImageFormat, string>;

function looksLike(
  format: ImageFormat,
  file: Pick<ImagePdfInput, "name" | "type">,
): boolean {
  const { types, extensions } = ALL_FORMATS[format];
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
  const order: ImageFormat[] =
    kind === "jpg"
      ? ["jpg", "png", "webp", "gif", "bmp"]
      : ["png", "jpg", "webp", "gif", "bmp"];
  return order
    .flatMap((f) => [...ALL_FORMATS[f].types, ...ALL_FORMATS[f].extensions])
    .join(",");
}

/**
 * Is this a file the engine embeds AS IT IS — PNG or JPEG? Scan to PDF's
 * gate: its photo pipeline reads JPEG and PNG only.
 */
export function isEmbeddableImage(
  file: Pick<ImagePdfInput, "name" | "type">,
): boolean {
  return isLikelyPng(file) || isLikelyJpeg(file);
}

/**
 * Can this file go into an image PDF? PNG and JPEG, on BOTH tools — and,
 * since 2026-10-30, WebP, GIF and BMP, which the browser decodes and the
 * engine re-encodes ({@link DECODED_FORMATS}).
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
  return (
    isEmbeddableImage(file) ||
    (Object.keys(DECODED_FORMATS) as DecodedImageFormat[]).some((f) =>
      looksLike(f, file),
    )
  );
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

/** The WebP, GIF or BMP the bytes hold, by their signature. */
function sniffDecodedFormat(bytes: Uint8Array): DecodedImageFormat | null {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  // The same signatures `intent/sniff.ts` reads, so a file the hand-off
  // sends here is the file this takes (`formats.test.ts` holds the two).
  if (ascii(0, 4) === "GIF8") return "gif";
  // "BM", a 4-byte size, then four reserved bytes that are always zero: a
  // bare "BM" starts too many text files to be a signature on its own.
  if (
    ascii(0, 2) === "BM" &&
    bytes.length >= 10 &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0 &&
    bytes[9] === 0
  ) {
    return "bmp";
  }
  return null;
}

/**
 * Every image the tools take, by its bytes: the two embedded as they are
 * ({@link sniffRasterFormat}) and the three re-encoded first. `null` for
 * anything else — HEIC, TIFF, AVIF, not an image.
 */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  return sniffRasterFormat(bytes) ?? sniffDecodedFormat(bytes);
}

/** The reader's list of what can be converted, from the two tables. */
const TAKEN = "PNG, JPG, WebP, GIF and BMP";

/** Name the format of image bytes we cannot convert, when we can tell. */
function describeImageBytes(bytes: Uint8Array): RefusedImageLabel | null {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
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
  // "an AVIF image": the one name here that starts with a vowel.
  const article = real && /^[AEIOU]/.test(real) ? "an" : "a";
  return real
    ? `"${name}" is ${article} ${real} image. Only ${TAKEN} images can be converted here.`
    : `"${name}" isn't a ${TAKEN.replace(" and ", " or ")} image.`;
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
      throw new PdfEngineError(
        `"${file.name}" isn't a ${TAKEN.replace(" and ", " or ")} image.`,
      );
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

/** Download name for the ZIP of one-PDF-per-image output. */
export function perImageZipName(
  kind: ImagePdfKind,
  firstName?: string,
): string {
  return firstName
    ? outputName(firstName, "pdfs", "zip")
    : `${kind}-images-pdfs.zip`;
}

/**
 * One name per image for the per-image PDFs: the image's own name with .pdf,
 * and a numeric suffix where two images would otherwise collide in the ZIP
 * (photo.jpg and photo.png both want photo.pdf).
 */
function perImageNames(
  files: readonly Pick<ImagePdfInput, "name">[],
): string[] {
  const used = new Set<string>();
  return files.map((file) => {
    const base = sanitizeSegment(baseName(file.name));
    let name = `${base}.pdf`;
    for (let n = 2; used.has(name.toLowerCase()); n++)
      name = `${base}-${n}.pdf`;
    used.add(name.toLowerCase());
    return name;
  });
}

type PdfLib = Awaited<ReturnType<typeof loadPdfLib>>;
type PdfDoc = Awaited<ReturnType<PdfLib["PDFDocument"]["create"]>>;

async function newImageDoc(lib: PdfLib, kind: ImagePdfKind): Promise<PdfDoc> {
  const doc = await lib.PDFDocument.create();
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setTitle(`${kind.toUpperCase()} images`);
  return doc;
}

/** Embed one image and draw it on its own page, laid out by `options`. */
async function addImagePage(
  lib: PdfLib,
  doc: PdfDoc,
  file: ImagePdfInput,
  options: ImagePageOptions,
): Promise<void> {
  let bytes = file.bytes;
  let format = sniffRasterFormat(bytes);
  if (!format) {
    const decoded = sniffDecodedFormat(bytes);
    if (!decoded) {
      throw new PdfEngineError(unsupportedImageMessage(file.name, bytes));
    }
    // Decoded by the browser and re-encoded as a JPEG or a PNG; loaded on
    // the first such image only.
    const { transcodeImage } = await import("./image-transcode");
    ({ bytes, format } = await transcodeImage(file.name, bytes, {
      mime: DECODED_FORMATS[decoded].types[0],
      label: DECODED_FORMATS[decoded].label,
    }));
  }
  let image;
  try {
    image = await embedRasterImage(doc, bytes, format);
  } catch {
    throw new PdfEngineError(
      `"${file.name}" could not be decoded as a ${format === "jpg" ? "JPG" : "PNG"} image.`,
    );
  }
  // Lay the image out as the browser SHOWED it: a portrait phone photo is
  // stored as landscape pixels plus an EXIF turn, and the preview is upright.
  const shown = rasterDisplaySize(image);
  const layout = imagePageLayout(shown.width, shown.height, options);
  const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: layout.pageWidth,
    height: layout.pageHeight,
    color: lib.rgb(1, 1, 1),
  });
  await drawRasterImage(page, image, {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
  });
}

/**
 * Convert JPG or PNG images into one paginated PDF, one image per page.
 * `options` defaults to the fixed layout the tool had before it had options
 * (US Letter, portrait, 36pt margin), so a caller that passes none gets the
 * same PDF as before.
 */
export async function imagesToPdf(
  kind: ImagePdfKind,
  files: ImagePdfInput[],
  options: ImagePageOptions = DEFAULT_IMAGE_PAGE_OPTIONS,
): Promise<Uint8Array> {
  validateImagePdfInputs(kind, files);
  const lib = await loadPdfLib();
  const doc = await newImageDoc(lib, kind);
  for (const file of files) await addImagePage(lib, doc, file, options);
  return doc.save();
}

/**
 * The same pages as {@link imagesToPdf}, one PDF per image, each named after
 * its image — what the runner zips for "One PDF per image (ZIP)".
 */
export async function imagesToPdfs(
  kind: ImagePdfKind,
  files: ImagePdfInput[],
  options: ImagePageOptions = DEFAULT_IMAGE_PAGE_OPTIONS,
): Promise<NamedBytes[]> {
  validateImagePdfInputs(kind, files);
  const lib = await loadPdfLib();
  const names = perImageNames(files);
  const out: NamedBytes[] = [];
  for (const [index, file] of files.entries()) {
    const doc = await newImageDoc(lib, kind);
    await addImagePage(lib, doc, file, options);
    out.push({ name: names[index]!, bytes: await doc.save() });
  }
  return out;
}
