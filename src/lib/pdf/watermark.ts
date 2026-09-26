import { loadPdfLib } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import type { PDFPage } from "pdf-lib";
import {
  clamp,
  embedStampFont,
  loadPdf,
  normalizeRotation,
  placeCenteredStamp,
  stampProducer,
  toRgb,
  WATERMARK_INK,
  type RGB,
} from "./stamp";

/**
 * Stamp a diagonal text watermark centered on every page, fully in-browser.
 * Opacity and rotation are adjustable; the watermark stays visually centered
 * and correctly tilted even on pages that carry a `/Rotate` flag.
 *
 * The requested font size is a CEILING, not a promise. A fixed point size does
 * not fit every page: "Property of Acme Corporation" is ~860pt wide at 60pt and
 * an A4 page is 595pt wide, so drawing it as asked cuts letters off both ends —
 * which is what this tool did, under "Stamped on all N pages", until the fit
 * below. Each page gets the largest size, up to the requested one, at which the
 * tilted text fits the box a reader sees, and the caller is told how many pages
 * needed it so the result can say so. `watermark.test.ts` reads the output back
 * through pdfjs over every page size pdf-lib defines.
 */

/**
 * Share of the visible box the tilted text may span on each axis, so a shrunk
 * watermark keeps a margin instead of touching the page edges.
 */
export const WATERMARK_FIT = 0.9;

export interface WatermarkOptions {
  /**
   * Font size in points, as an upper bound. Defaults to 60. A page too small to
   * hold the text at this size gets the largest size that fits.
   */
  fontSize?: number;
  /** Opacity, 0–1. Defaults to 0.18 so page content stays readable. */
  opacity?: number;
  /** Tilt in degrees (counter-clockwise). Defaults to 45. */
  rotation?: number;
  /** Ink color (0–1 channels). Defaults to a medium gray. */
  color?: RGB;
}

export function validateWatermarkText(text: string): void {
  if (text.trim().length === 0) {
    throw new PdfEngineError("Enter the watermark text to stamp.");
  }
}

export function watermarkedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "watermarked");
}

export interface WatermarkReport {
  bytes: Uint8Array;
  /** Pages stamped — every page of the document. */
  pages: number;
  /** Pages where the requested size did not fit and a smaller one was drawn. */
  shrunkPages: number;
  /** The smallest size actually drawn, in points. */
  smallestFontSize: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeBox(box: Box): Box {
  return {
    x: Math.min(box.x, box.x + box.width),
    y: Math.min(box.y, box.y + box.height),
    width: Math.abs(box.width),
    height: Math.abs(box.height),
  };
}

/**
 * The box a viewer shows: the CropBox clipped to the MediaBox, falling back to
 * the MediaBox when they do not overlap — the same rule pdfjs applies to
 * `page.view`. Neither box has to start at the origin.
 */
export function visibleBox(page: PDFPage): Box {
  const media = normalizeBox(page.getMediaBox());
  const crop = normalizeBox(page.getCropBox());
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return media;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The factor (at most 1) by which text of the given size must shrink so that,
 * turned by `theta` degrees, its bounding box spans no more than
 * {@link WATERMARK_FIT} of the box on either axis.
 *
 * `theta` and the box are in the page's STORED (content) frame: `theta` is the
 * page's `/Rotate` plus the user's tilt, exactly what `placeCenteredStamp`
 * draws with. That is the same fit as "the tilt, in the reader's frame, with
 * width and height swapped on a quarter-turned page" — composed once, here,
 * instead of twice.
 */
export function fitWatermarkScale(input: {
  boxWidth: number;
  boxHeight: number;
  textWidth: number;
  textHeight: number;
  theta: number;
}): number {
  const rad = (input.theta * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const spanX = input.textWidth * cos + input.textHeight * sin;
  const spanY = input.textWidth * sin + input.textHeight * cos;
  return Math.min(
    1,
    (WATERMARK_FIT * input.boxWidth) / spanX,
    (WATERMARK_FIT * input.boxHeight) / spanY,
  );
}

export async function addWatermark(
  bytes: Uint8Array,
  text: string,
  options: WatermarkOptions = {},
): Promise<Uint8Array> {
  return (await watermarkPdf(bytes, text, options)).bytes;
}

/**
 * {@link addWatermark}, plus what happened on the way: how many pages needed a
 * smaller size than the one asked for. A runner that only has the bytes can
 * only say "Stamped on all N pages".
 */
export async function watermarkPdf(
  bytes: Uint8Array,
  text: string,
  options: WatermarkOptions = {},
): Promise<WatermarkReport> {
  validateWatermarkText(text);

  const value = text.trim();
  const fontSize = clamp(options.fontSize ?? 60, 8, 240);
  const opacity = clamp(options.opacity ?? 0.18, 0.02, 1);
  const tilt = clamp(options.rotation ?? 45, -90, 90);
  const { degrees, rgb } = await loadPdfLib();
  const color = toRgb(rgb, options.color ?? WATERMARK_INK);

  const doc = await loadPdf(bytes);
  // One string, drawn on every page — the whole corpus this document stamps.
  const font = await embedStampFont(doc, [value], "bold");
  const textWidth = font.widthOfTextAtSize(value, fontSize);
  const textHeight = font.heightAtSize(fontSize);

  const pages = doc.getPages();
  let shrunkPages = 0;
  let smallestFontSize = fontSize;

  for (const page of pages) {
    const box = visibleBox(page);
    const pageRotation = page.getRotation().angle;
    const scale = fitWatermarkScale({
      boxWidth: box.width,
      boxHeight: box.height,
      textWidth,
      textHeight,
      theta: normalizeRotation(pageRotation) + tilt,
    });
    // Font metrics are linear in size, so the scaled box is exact.
    const size = fontSize * scale;
    if (scale < 1) shrunkPages += 1;
    smallestFontSize = Math.min(smallestFontSize, size);

    // Centred on the visible box, not on (0,0)-(w,h): a CropBox, or a
    // MediaBox that does not start at the origin, moves what a reader sees.
    const placement = placeCenteredStamp({
      pageWidth: box.width,
      pageHeight: box.height,
      pageRotation,
      textWidth: textWidth * scale,
      textHeight: textHeight * scale,
      tilt,
    });

    page.drawText(value, {
      x: box.x + placement.x,
      y: box.y + placement.y,
      size,
      font,
      color,
      opacity,
      rotate: degrees(placement.rotate),
    });
  }

  stampProducer(doc);
  return {
    bytes: await doc.save(),
    pages: pages.length,
    shrunkPages,
    smallestFontSize,
  };
}
