import { loadPdfLib } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import {
  applyTokens,
  clamp,
  embedStampFont,
  INK,
  loadPdf,
  placeStamp,
  visibleBox,
  resolveAlign,
  stampProducer,
  toRgb,
  type RGB,
  type StampPosition,
} from "./stamp";

/**
 * Stamp page numbers onto an existing PDF, fully in-browser. Position defaults
 * to bottom-center with a "Page {n} of {total}" template; numbering can start
 * on a later page (e.g. skip a cover) and from an arbitrary first value.
 */

export const DEFAULT_PAGE_NUMBER_FORMAT = "Page {n} of {total}";

export interface PageNumberOptions {
  /** Template with `{n}` / `{total}` tokens. Defaults to "Page {n} of {total}". */
  format?: string;
  /** Where on the page to stamp. Defaults to bottom-center. */
  position?: StampPosition;
  /** Font size in points. Defaults to 11. */
  fontSize?: number;
  /** Margin from the page edge in points. Defaults to 36. */
  margin?: number;
  /** 1-based physical page numbering begins on (skips earlier pages). Default 1. */
  startPage?: number;
  /** First number to display. Defaults to 1. */
  startAt?: number;
  /** Ink color (0–1 channels). Defaults to a dark slate. */
  color?: RGB;
}

export function validatePageNumberFormat(format: string): void {
  if (format.trim().length === 0) {
    throw new PdfEngineError(
      'Add a page-number format, for example "Page {n} of {total}".',
    );
  }
}

export function numberedOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "numbered");
}

/** Preview the label a given page would show, without touching any PDF. */
export function previewPageNumber(
  format: string,
  n: number,
  total: number,
): string {
  return applyTokens(format, { n, total });
}

export async function addPageNumbers(
  bytes: Uint8Array,
  options: PageNumberOptions = {},
): Promise<Uint8Array> {
  const format = options.format ?? DEFAULT_PAGE_NUMBER_FORMAT;
  validatePageNumberFormat(format);

  const position = options.position ?? "bottom-center";
  const fontSize = clamp(options.fontSize ?? 11, 6, 96);
  const margin = clamp(options.margin ?? 36, 0, 240);
  const startPage = Math.max(1, Math.floor(options.startPage ?? 1));
  const startAt = Math.floor(options.startAt ?? 1);
  const { h, v } = resolveAlign(position);
  const { degrees, rgb } = await loadPdfLib();
  const color = toRgb(rgb, options.color ?? INK);

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const numberedCount = Math.max(0, pages.length - (startPage - 1));
  const total = startAt + numberedCount - 1;

  // Every label this run will draw, substituted, BEFORE a font is chosen. The
  // template is not the text: "Page {n} of {total}" is pure ASCII while
  // "পৃষ্ঠা {n}" is not, and a font picked from the template would be picked
  // from the wrong set. Choosing up front also means a refusal arrives before
  // page one is touched rather than part-way through the loop.
  const labels: string[] = [];
  pages.forEach((page, index) => {
    if (index + 1 < startPage) return;
    const n = startAt + (index - (startPage - 1));
    const text = applyTokens(format, { n, total });
    if (text.trim().length > 0) labels.push(text);
  });
  const font = await embedStampFont(doc, labels);

  pages.forEach((page, index) => {
    if (index + 1 < startPage) return;
    const n = startAt + (index - (startPage - 1));
    const text = applyTokens(format, { n, total });
    if (text.trim().length === 0) return;

    const box = visibleBox(page);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);
    const placement = placeStamp({
      pageWidth: box.width,
      pageHeight: box.height,
      boxX: box.x,
      boxY: box.y,
      pageRotation: page.getRotation().angle,
      textWidth,
      textHeight,
      h,
      v,
      margin,
    });

    page.drawText(text, {
      x: placement.x,
      y: placement.y,
      size: fontSize,
      font,
      color,
      rotate: degrees(placement.rotate),
    });
  });

  stampProducer(doc);
  return doc.save();
}
