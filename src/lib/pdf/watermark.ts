import { loadPdfLib } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import {
  clamp,
  embedStampFont,
  loadPdf,
  placeCenteredStamp,
  stampProducer,
  toRgb,
  visibleBox,
  WATERMARK_INK,
  type RGB,
} from "./stamp";

/**
 * Stamp a diagonal text watermark centered on every page, fully in-browser.
 * Opacity and rotation are adjustable; the watermark stays visually centered
 * and correctly tilted even on pages that carry a `/Rotate` flag.
 */

export interface WatermarkOptions {
  /** Font size in points. Defaults to 60. */
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

export async function addWatermark(
  bytes: Uint8Array,
  text: string,
  options: WatermarkOptions = {},
): Promise<Uint8Array> {
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

  for (const page of doc.getPages()) {
    const placement = placeCenteredStamp({
      box: visibleBox(page),
      pageRotation: page.getRotation().angle,
      textWidth,
      textHeight,
      tilt,
    });

    page.drawText(value, {
      x: placement.x,
      y: placement.y,
      size: fontSize,
      font,
      color,
      opacity,
      rotate: degrees(placement.rotate),
    });
  }

  stampProducer(doc);
  return doc.save();
}
