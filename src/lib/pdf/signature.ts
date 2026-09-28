import {
  embedRasterImage,
  loadPdfLib,
  type RasterImageFormat,
} from "./pdf-lib";
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
import type { SignatureStyle } from "./offered-kinds";
import { viewToContent, viewerFrame } from "./page-frame";

/**
 * Apply a *visual* electronic signature to a PDF page, fully in-browser. A
 * signature is either typed text (drawn with a standard font) or an image (a
 * canvas-drawn or uploaded signature, prepared by `signature-image.ts`: cropped
 * to the ink, paper keyed out, resolution bounded). Placement geometry is a
 * pure function so it can be unit-tested with plain numbers.
 *
 * HONESTY: this draws a signature onto the page — it is NOT a cryptographic or
 * digital-certificate signature. There is no PKI, no certificate, and no
 * tamper-evidence. The runner UI states this plainly.
 */

export type SignaturePosition = StampPosition;

/**
 * Typed-signature look: a script-like serif italic, or a clean print face.
 * Defined in the `offered-kinds` leaf, which the tool page's fact also reads.
 */
export type { SignatureStyle };

export interface TypedSignature {
  kind: "typed";
  text: string;
  style: SignatureStyle;
  /** Ink color (0–1 channels). Defaults to a dark slate. */
  color?: RGB;
}

export interface ImageSignature {
  kind: "image";
  /** Encoded image bytes, from a drawn canvas or an uploaded image. */
  bytes: Uint8Array;
  /**
   * PNG for anything with transparency (a drawn signature, a keyed photo);
   * JPEG for an opaque photo whose paper was kept, so it is not inflated into
   * a lossless PNG.
   */
  format: RasterImageFormat;
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
  } else if (input.bytes.byteLength === 0) {
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
 * in the VIEWER's frame of a `pageWidth`×`pageHeight` page (bottom-left origin,
 * as displayed — see {@link viewerFrame}). Returns the box's bottom-left
 * corner in that frame; {@link signPdf} maps it into content space.
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
 * out-of-range page, an unreadable image, or a signature that cannot fit.
 *
 * Placement is in the page AS THE READER SEES IT — the visible CropBox, turned
 * by the page's `/Rotate` ({@link viewerFrame}). The box is anchored there
 * with {@link placeSignatureBox}, mapped into pdf-lib's unrotated content space
 * ({@link viewToContent}) and drawn counter-rotated, so it reads upright. Our
 * own Rotate PDF and Crop PDF write exactly those entries; before this, a
 * "bottom-right" signature on their output landed in another corner, sideways,
 * or wholly outside the visible page. `signature-placement.test.ts` reads the
 * output back through pdfjs to pin it.
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
  const frame = viewerFrame(page);
  const { width: pageWidth, height: pageHeight } = frame;
  const { h, v } = resolveAlign(placement.position);
  const margin = clamp(
    placement.margin ?? 24,
    0,
    Math.min(pageWidth, pageHeight) / 2,
  );
  const roomWidth = pageWidth - margin * 2;
  const roomHeight = pageHeight - margin * 2;
  const targetWidth = clamp(
    placement.width,
    MIN_SIGNATURE_WIDTH,
    Math.max(MIN_SIGNATURE_WIDTH, roomWidth),
  );
  const { degrees, rgb } = await loadPdfLib();
  const rotate = degrees(frame.rotation);

  if (input.kind === "image") {
    let image;
    try {
      image = await embedRasterImage(doc, input.bytes, input.format);
    } catch {
      throw new PdfEngineError(
        "That signature image couldn't be read. Use a PNG or JPEG image.",
      );
    }
    // Width is what the person asked for; a tall image (or a tiny page) is
    // shrunk until it fits the room the reader sees, keeping its shape.
    const aspect = image.height / image.width;
    const boxWidth = Math.min(targetWidth, roomWidth, roomHeight / aspect);
    const boxHeight = boxWidth * aspect;
    assertFits(boxWidth, boxHeight, roomWidth, roomHeight);
    const at = placeSignatureBox({
      pageWidth,
      pageHeight,
      boxWidth,
      boxHeight,
      h,
      v,
      margin,
    });
    // pdf-lib rotates an image about its (x, y) corner, so the viewer-frame
    // bottom-left maps to the draw origin exactly as a text baseline does.
    const { x, y } = viewToContent(at.x, at.y, frame.box, frame.rotation);
    page.drawImage(image, { x, y, width: boxWidth, height: boxHeight, rotate });
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
    let size = fontSizeForWidth(font.widthOfTextAtSize(text, 1), targetWidth);
    // The glyph box runs from the descender to the ascender; it has to fit
    // the height the reader sees as well as the width.
    const unitHeight = font.heightAtSize(1);
    if (unitHeight > 0 && size * unitHeight > roomHeight) {
      size = roomHeight / unitHeight;
    }
    const boxWidth = font.widthOfTextAtSize(text, size);
    const boxHeight = font.heightAtSize(size);
    assertFits(boxWidth, boxHeight, roomWidth, roomHeight);
    const descent = boxHeight - font.heightAtSize(size, { descender: false });
    const at = placeSignatureBox({
      pageWidth,
      pageHeight,
      boxWidth,
      boxHeight,
      h,
      v,
      margin,
    });
    // The box is the whole glyph box, so the baseline sits one descent above
    // its bottom — otherwise descenders hang below the margin (and off the
    // page at margin 0).
    const { x, y } = viewToContent(
      at.x,
      at.y + descent,
      frame.box,
      frame.rotation,
    );
    page.drawText(text, {
      x,
      y,
      size,
      font,
      rotate,
      color: toRgb(rgb, input.color ?? INK),
    });
  }

  stampProducer(doc);
  return doc.save();
}

/**
 * Refuse, by name, a signature that would not fit inside the margins of the
 * page the reader sees. The viewer would clip it silently while the tool
 * reported the PDF as signed.
 */
function assertFits(
  boxWidth: number,
  boxHeight: number,
  roomWidth: number,
  roomHeight: number,
): void {
  const EPS = 1e-6;
  if (
    !(boxWidth > 0 && boxHeight > 0) ||
    boxWidth > roomWidth + EPS ||
    boxHeight > roomHeight + EPS
  ) {
    throw new PdfEngineError(
      "That signature does not fit inside the margins of this page. Shorten it, make it smaller, or lower the margin.",
    );
  }
}
