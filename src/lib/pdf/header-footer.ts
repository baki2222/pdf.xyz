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
  stampProducer,
  toRgb,
  type HAlign,
  type RGB,
  type VAlign,
} from "./stamp";

/**
 * Stamp running headers and/or footers onto an existing PDF, fully in-browser.
 * Each band has independent left / center / right slots, and every slot supports
 * dynamic `{n}`, `{total}`, and `{date}` tokens.
 */

/** Left / center / right text slots for one band (header or footer). */
export interface HeaderFooterZone {
  left?: string;
  center?: string;
  right?: string;
}

export interface HeaderFooterOptions {
  header?: HeaderFooterZone;
  footer?: HeaderFooterZone;
  /** Font size in points. Defaults to 10. */
  fontSize?: number;
  /** Margin from the page edge in points. Defaults to 32. */
  margin?: number;
  /** Value substituted for `{date}` tokens (runner supplies the locale string). */
  date?: string;
  /** Ink color (0–1 channels). Defaults to a dark slate. */
  color?: RGB;
}

interface Slot {
  text: string;
  h: HAlign;
  v: VAlign;
}

const SLOT_ALIGN: { key: keyof HeaderFooterZone; h: HAlign }[] = [
  { key: "left", h: "left" },
  { key: "center", h: "center" },
  { key: "right", h: "right" },
];

/** Collect the non-empty slots for one band. */
function zoneSlots(zone: HeaderFooterZone | undefined, v: VAlign): Slot[] {
  if (!zone) return [];
  const slots: Slot[] = [];
  for (const { key, h } of SLOT_ALIGN) {
    const text = zone[key];
    if (text && text.trim().length > 0) slots.push({ text, h, v });
  }
  return slots;
}

/** True when at least one header or footer slot carries text. */
export function hasHeaderFooterContent(options: HeaderFooterOptions): boolean {
  return (
    zoneSlots(options.header, "top").length > 0 ||
    zoneSlots(options.footer, "bottom").length > 0
  );
}

export function validateHeaderFooter(options: HeaderFooterOptions): void {
  if (!hasHeaderFooterContent(options)) {
    throw new PdfEngineError("Add header or footer text to stamp.");
  }
}

export function headerFooterOutputName(sourceName: string): string {
  return outputName(sourceName || "document", "header-footer");
}

export async function addHeaderFooter(
  bytes: Uint8Array,
  options: HeaderFooterOptions,
): Promise<Uint8Array> {
  validateHeaderFooter(options);

  const fontSize = clamp(options.fontSize ?? 10, 6, 72);
  const margin = clamp(options.margin ?? 32, 0, 240);
  const { degrees, rgb } = await loadPdfLib();
  const color = toRgb(rgb, options.color ?? INK);
  const slots = [
    ...zoneSlots(options.header, "top"),
    ...zoneSlots(options.footer, "bottom"),
  ];

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const total = pages.length;

  // Every slot on every page, tokens already substituted. `{date}` is supplied
  // by the runner as a locale string, so a Bengali or Japanese date can arrive
  // in a header whose template is pure ASCII — the font has to be chosen from
  // what will be DRAWN, not from what was typed.
  const drawn: string[] = [];
  pages.forEach((_page, index) => {
    const tokens = { n: index + 1, total, date: options.date };
    for (const slot of slots) {
      const text = applyTokens(slot.text, tokens);
      if (text.trim().length > 0) drawn.push(text);
    }
  });
  const font = await embedStampFont(doc, drawn);

  pages.forEach((page, index) => {
    const tokens = { n: index + 1, total, date: options.date };
    const box = visibleBox(page);
    const pageRotation = page.getRotation().angle;

    for (const slot of slots) {
      const text = applyTokens(slot.text, tokens);
      if (text.trim().length === 0) continue;

      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const textHeight = font.heightAtSize(fontSize);
      const placement = placeStamp({
        pageWidth: box.width,
        pageHeight: box.height,
        boxX: box.x,
        boxY: box.y,
        pageRotation,
        textWidth,
        textHeight,
        h: slot.h,
        v: slot.v,
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
    }
  });

  stampProducer(doc);
  return doc.save();
}
