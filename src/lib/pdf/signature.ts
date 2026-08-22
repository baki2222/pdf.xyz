import { embedRasterImage, loadPdfLib } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import {
  clamp,
  INK,
  loadPdf,
  resolveAlign,
  stampProducer,
  toRgb,
  type RGB,
  type StampPosition,
} from "./stamp";
import { embedDrawingFont } from "./unicode-font";

/**
 * Apply a *visual* electronic signature to a PDF page, fully in-browser. A
 * signature is either typed text (drawn with a standard font) or a PNG image (a
 * canvas-drawn or uploaded signature). Placement geometry is a pure function so
 * it can be unit-tested with plain numbers.
 *
 * HONESTY: this draws a signature onto the page — it is NOT a cryptographic or
 * digital-certificate signature. There is no PKI, no certificate, and no
 * tamper-evidence. The runner UI states this plainly.
 */

export type SignaturePosition = StampPosition;

/** Typed-signature look: a script-like serif italic, or a clean print face. */
export type SignatureStyle = "signature" | "print";

export interface TypedSignature {
  kind: "typed";
  text: string;
  style: SignatureStyle;
  /** Ink color (0–1 channels). Defaults to a dark slate. */
  color?: RGB;
}

export interface ImageSignature {
  kind: "image";
  /** PNG bytes, from a drawn canvas or an uploaded/converted image. */
  png: Uint8Array;
}

export type SignatureInput = TypedSignature | ImageSignature;

export interface SignaturePlacement {
  /** 0-based target page. */
  pageIndex: number;
  /** Which of the nine anchor points to pin the signature to. */
  position: SignaturePosition;
  /** Target signature width in points; height follows the aspect ratio. */
  width: number;
  /** Inset from the page edges in points. Defaults to 24. */
  margin?: number;
}

export const DEFAULT_SIGNATURE_WIDTH = 200;
export const MIN_SIGNATURE_WIDTH = 48;
export const MAX_SIGNATURE_WIDTH = 600;

/** A sensible download name for a signed document, derived from the source. */
export function signatureOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "signed");
}

/** Reject an empty signature with a typed, user-facing message. */
export function validateSignature(input: SignatureInput): void {
  if (input.kind === "typed") {
    if (input.text.trim().length === 0) {
      throw new PdfEngineError("Type your signature before placing it.");
    }
  } else if (input.png.byteLength === 0) {
    throw new PdfEngineError("Draw or upload a signature before placing it.");
  }
}

export interface PlaceBoxInput {
  pageWidth: number;
  pageHeight: number;
  boxWidth: number;
  boxHeight: number;
  h: "left" | "center" | "right";
  v: "top" | "middle" | "bottom";
  margin: number;
}

/**
 * Position a signature box of size `boxWidth`×`boxHeight` at one of nine anchors
 * in the page's content space (bottom-left origin). Returns the bottom-left
 * corner where the image/text should be drawn.
 */
export function placeSignatureBox(input: PlaceBoxInput): {
  x: number;
  y: number;
} {
  const x =
    input.h === "left"
      ? input.margin
      : input.h === "right"
        ? input.pageWidth - input.margin - input.boxWidth
        : (input.pageWidth - input.boxWidth) / 2;
  const y =
    input.v === "bottom"
      ? input.margin
      : input.v === "top"
        ? input.pageHeight - input.margin - input.boxHeight
        : (input.pageHeight - input.boxHeight) / 2;
  return { x, y };
}

/**
 * Font size that renders `unitWidth` (the width of the text at size 1) to
 * `targetWidth`, clamped to a legible range. Guards against a zero unit width.
 */
export function fontSizeForWidth(
  unitWidth: number,
  targetWidth: number,
  min = 8,
  max = 96,
): number {
  if (unitWidth <= 0) return min;
  return clamp(targetWidth / unitWidth, min, max);
}

/**
 * Draw a signature onto one page of a PDF and return the new bytes. Typed
 * signatures are auto-sized to the requested width; image signatures preserve
 * their aspect ratio. Throws typed errors for an empty signature, an
 * out-of-range page, or an unreadable image.
 */
export async function signPdf(
  bytes: Uint8Array,
  input: SignatureInput,
  placement: SignaturePlacement,
): Promise<Uint8Array> {
  validateSignature(input);

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const { pageIndex } = placement;
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= pages.length
  ) {
    throw new PdfEngineError("Choose a page that exists in the document.");
  }
  const page = pages[pageIndex]!;
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const { h, v } = resolveAlign(placement.position);
  const margin = clamp(
    placement.margin ?? 24,
    0,
    Math.min(pageWidth, pageHeight) / 2,
  );
  const targetWidth = clamp(
    placement.width,
    MIN_SIGNATURE_WIDTH,
    Math.max(MIN_SIGNATURE_WIDTH, pageWidth - margin * 2),
  );

  if (input.kind === "image") {
    let image;
    try {
      image = await embedRasterImage(doc, input.png, "png");
    } catch {
      throw new PdfEngineError(
        "That signature image couldn't be read. Use a PNG image.",
      );
    }
    const boxWidth = targetWidth;
    const boxHeight = (image.height / image.width) * targetWidth;
    const { x, y } = placeSignatureBox({
      pageWidth,
      pageHeight,
      boxWidth,
      boxHeight,
      h,
      v,
      margin,
    });
    page.drawImage(image, { x, y, width: boxWidth, height: boxHeight });
  } else {
    const text = input.text.trim();
    // A typed signature is a person's name. Refusing to draw it because the
    // name is written in Bengali or Korean was the sharpest edge of the WinAnsi
    // ceiling: a signature tool that cannot spell the signer. Western names
    // still take Times-Italic or Helvetica and download nothing.
    const font = await embedDrawingFont(
      doc,
      [text],
      input.style === "signature" ? "serif-italic" : "sans",
    );
    const size = fontSizeForWidth(font.widthOfTextAtSize(text, 1), targetWidth);
    const boxWidth = font.widthOfTextAtSize(text, size);
    const boxHeight = font.heightAtSize(size);
    const { x, y } = placeSignatureBox({
      pageWidth,
      pageHeight,
      boxWidth,
      boxHeight,
      h,
      v,
      margin,
    });
    const { rgb } = await loadPdfLib();
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: toRgb(rgb, input.color ?? INK),
    });
  }

  stampProducer(doc);
  return doc.save();
}
