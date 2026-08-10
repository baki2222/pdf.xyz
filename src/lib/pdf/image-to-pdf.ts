import { loadPdfLib } from "./pdf-lib";
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

export function isLikelyJpeg(file: Pick<ImagePdfInput, "name" | "type">): boolean {
  return file.type === "image/jpeg" || file.type === "image/jpg" || /\.(jpe?g)$/i.test(file.name);
}

export function isLikelyPng(file: Pick<ImagePdfInput, "name" | "type">): boolean {
  return file.type === "image/png" || /\.png$/i.test(file.name);
}

export function isImageAllowedForKind(
  kind: ImagePdfKind,
  file: Pick<ImagePdfInput, "name" | "type">,
): boolean {
  return kind === "jpg" ? isLikelyJpeg(file) : isLikelyPng(file);
}

export function validateImagePdfInputs(kind: ImagePdfKind, files: ImagePdfInput[]): void {
  if (files.length === 0) {
    throw new PdfEngineError(`Add at least one ${kind === "jpg" ? "JPG" : "PNG"} image.`);
  }
  for (const file of files) {
    if (!isImageAllowedForKind(kind, file)) {
      throw new PdfEngineError(`"${file.name}" is not a ${kind === "jpg" ? "JPG" : "PNG"} image.`);
    }
    if (file.bytes.byteLength === 0) {
      throw new PdfEngineError(`"${file.name}" is empty.`);
    }
    if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new PdfEngineError(`"${file.name}" is too large for in-browser conversion (max ${MAX_IMAGE_MB} MB per image).`);
    }
  }
}

export function imagePdfOutputName(kind: ImagePdfKind, firstName?: string): string {
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
    let image;
    try {
      image = kind === "jpg" ? await doc.embedJpg(file.bytes) : await doc.embedPng(file.bytes);
    } catch {
      throw new PdfEngineError(`"${file.name}" could not be decoded as a ${kind === "jpg" ? "JPG" : "PNG"} image.`);
    }
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: rgb(1, 1, 1),
    });
    page.drawImage(image, fitRect(image.width, image.height));
  }

  return doc.save();
}
