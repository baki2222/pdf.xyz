import { loadPdfLib } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { canDrawInOneFace } from "./unicode-font";
import {
  applyTokens,
  clamp,
  embedStampFont,
  INK,
  loadPdf,
  placeStamp,
  stampProducer,
  toRgb,
  visibleBox,
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

/**
 * Invisible bidi controls. Intl wraps the separators of right-to-left dates in
 * U+200F (some locales use U+061C / U+200E). A reader sees nothing of them, and
 * left in they are not WinAnsi, so an otherwise all-Latin "27/9/2026" (`ar`)
 * would leave the free built-in face for a downloaded Unicode one.
 */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function localIsoDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The ways `{date}` can be written for `locale`, best first:
 *
 *  1. the reader's own locale format, exactly as the browser writes it —
 *     Bengali digits for a Bengali reader, a Buddhist year for a Thai one;
 *  2. the same locale's order, in Latin digits on the Gregorian calendar —
 *     `ar-EG` writes "٢٧/٩/٢٠٢٦" and `fa-IR` "۱۴۰۵/۷/۵", neither of which any
 *     face we ship can draw, and both of which the header tool used to refuse
 *     after a preview that showed them without complaint;
 *  3. ISO 8601 (local date), which every face can draw.
 *
 * Bidi controls are removed from all of them; duplicates collapse.
 */
export function stampDateCandidates(
  now: Date = new Date(),
  locale?: string | readonly string[],
): string[] {
  const out: string[] = [];
  const add = (format: () => string) => {
    try {
      const value = format().replace(BIDI_CONTROLS, "").trim();
      if (value.length > 0 && !out.includes(value)) out.push(value);
    } catch {
      // An engine without this locale or option: fall through to the next.
    }
  };
  const locales = locale as string | string[] | undefined;
  add(() => new Intl.DateTimeFormat(locales).format(now));
  add(() =>
    new Intl.DateTimeFormat(locales, {
      numberingSystem: "latn",
      calendar: "gregory",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(now),
  );
  add(() => localIsoDate(now));
  return out;
}

/**
 * The `{date}` value to stamp: the first of {@link stampDateCandidates} that,
 * substituted into the header and footer templates the user wrote, can be
 * drawn with one shipped face. The choice depends on the templates because the
 * whole run shares one font — a Bengali date beside a Japanese header is two
 * scripts, however drawable each is alone.
 *
 * When no candidate fits, the ISO form is returned and the embed refuses on
 * the TEMPLATE's own characters, which is the honest error: the date is no
 * longer the thing it cannot draw.
 */
export async function resolveStampDate(
  templates: readonly string[],
  now: Date = new Date(),
  locale?: string | readonly string[],
): Promise<string> {
  const candidates = stampDateCandidates(now, locale);
  const fallback = candidates[candidates.length - 1] ?? localIsoDate(now);
  for (const date of candidates) {
    const drawn = templates.map((t) =>
      applyTokens(t, { n: 1, total: 1, date }),
    );
    if (await canDrawInOneFace(drawn)) return date;
  }
  return fallback;
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
        box,
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
