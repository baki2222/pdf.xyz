import type { isolatePageContent as IsolatePageContent } from "./content-isolation";
import { loadPdfLib } from "./pdf-lib";
import { PdfEngineError } from "./engine";
import { outputName } from "./files";
import { numberingPlan, type PagePlanOptions } from "./page-plan";
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
  viewerSize,
  visibleBox,
  type HAlign,
  type RGB,
  type StampFontFamily,
  type VAlign,
} from "./stamp";

/**
 * Content isolation (`./content-isolation`) runs only when a page is written,
 * so it is imported at call time: a static import put it in the first load of
 * every page whose runner imports this engine (hostile lane l06, 2026-11-08).
 */
const isolatePageContent = async (
  page: Parameters<typeof IsolatePageContent>[0],
): ReturnType<typeof IsolatePageContent> =>
  (await import("./content-isolation")).isolatePageContent(
    page,
    await loadPdfLib(),
  );

/**
 * Stamp running headers and/or footers onto an existing PDF, fully in-browser.
 * Each band has independent left / center / right slots, and every slot supports
 * dynamic `{n}`, `{total}`, and `{date}` tokens. A slot wider than the page
 * between its margins is refused, never clipped at the edge. Which pages get
 * the bands, and what `{n}` and `{total}` count, follow {@link numberingPlan}
 * — the same arithmetic as Add Page Numbers.
 */

/** Left / center / right text slots for one band (header or footer). */
export interface HeaderFooterZone {
  left?: string;
  center?: string;
  right?: string;
}

/** The font sizes the runner offers, in points, and the one it starts at. */
export const HEADER_FOOTER_SIZES = { min: 6, max: 28 } as const;
export const DEFAULT_HEADER_FOOTER_SIZE = 10;

/**
 * The margin presets the runner offers, in points from the page edge. Medium
 * is the 32 pt every run used before the margin could be chosen.
 */
export const HEADER_FOOTER_MARGINS = {
  small: 18,
  medium: 32,
  large: 60,
} as const;

export type HeaderFooterMargin = keyof typeof HEADER_FOOTER_MARGINS;

/**
 * The presets as the runner labels them, smallest first. Here rather than in
 * the runner so the tool page can name them from the list the buttons are
 * drawn from.
 */
export const HEADER_FOOTER_MARGIN_LABELS: Record<HeaderFooterMargin, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export interface HeaderFooterOptions extends PagePlanOptions {
  header?: HeaderFooterZone;
  footer?: HeaderFooterZone;
  /** Font size in points, clamped to 6–72. Defaults to 10. */
  fontSize?: number;
  /** Margin from the page edge in points. Defaults to 32 (medium). */
  margin?: number;
  /** Value substituted for `{date}` tokens (runner supplies the locale string). */
  date?: string;
  /** Ink color (0–1 channels). Defaults to a dark slate. */
  color?: RGB;
  /** Type family for Western text. Defaults to Helvetica. */
  font?: StampFontFamily;
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
 * The pages the bands go on and the `{n}` each shows, `{total}` being the last
 * `{n}` printed. Exported so the runner's preview, summary and Run gate use
 * the engine's own arithmetic.
 */
export function headerFooterPlan(
  pageCount: number,
  options: PagePlanOptions = {},
) {
  return numberingPlan(pageCount, options);
}

/** The refusal (and the runner's Run reason) when no page would be stamped. */
export const NO_PAGE_STAMPED =
  "No page gets the header or footer with these page settings.";

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

  const fontSize = clamp(options.fontSize ?? DEFAULT_HEADER_FOOTER_SIZE, 6, 72);
  const margin = clamp(options.margin ?? HEADER_FOOTER_MARGINS.medium, 0, 240);
  // A smaller size is a way out only while there is a smaller size to pick.
  const orSmaller =
    fontSize > HEADER_FOOTER_SIZES.min ? " or pick a smaller font size" : "";
  const { degrees, rgb } = await loadPdfLib();
  const color = toRgb(rgb, options.color ?? INK);
  const slots = [
    ...zoneSlots(options.header, "top"),
    ...zoneSlots(options.footer, "bottom"),
  ];

  const doc = await loadPdf(bytes);
  const all = doc.getPages();
  const plan = headerFooterPlan(all.length, options);
  if (plan.stamps.length === 0) throw new PdfEngineError(NO_PAGE_STAMPED);
  const total = plan.total;
  // Only the planned pages, each with the `{n}` it shows and its place in
  // the file (`at`, 0-based) for messages a reader can find.
  const pages = plan.stamps.map(({ index, n }) => ({
    page: all[index]!,
    n,
    at: index,
  }));

  // Every slot on every page, tokens already substituted. `{date}` is supplied
  // by the runner as a locale string, so a Bengali or Japanese date can arrive
  // in a header whose template is pure ASCII — the font has to be chosen from
  // what will be DRAWN, not from what was typed.
  const drawn: string[] = [];
  pages.forEach(({ n }) => {
    const tokens = { n, total, date: options.date };
    for (const slot of slots) {
      const text = applyTokens(slot.text, tokens);
      if (text.trim().length > 0) drawn.push(text);
    }
  });
  const font = await embedStampFont(
    doc,
    drawn,
    "regular",
    options.font ?? "helvetica",
  );

  // Every slot must fit between the margins of the page as a reader sees it,
  // checked on every page before anything is drawn. Unbounded, a centred
  // 151-character notice on A4 started 44 pt off the left edge and the run
  // reported success over a clipped file (audit #27).
  pages.forEach(({ page, n, at }) => {
    const tokens = { n, total, date: options.date };
    const across = viewerSize(visibleBox(page), page.getRotation().angle).width;
    const room = Math.max(0, across - 2 * margin);
    for (const slot of slots) {
      const text = applyTokens(slot.text, tokens);
      if (text.trim().length === 0) continue;
      const width = font.widthOfTextAtSize(text, fontSize);
      if (width <= room) continue;
      const band = slot.v === "top" ? "header" : "footer";
      // The longest opening that fits at this size, measured, not averaged,
      // so the message can say how much to cut; a smaller size is the other
      // remedy, named while one is offered.
      const chars = Array.from(text);
      let lo = 0;
      let hi = chars.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const part = chars.slice(0, mid).join("");
        if (font.widthOfTextAtSize(part, fontSize) <= room) lo = mid;
        else hi = mid - 1;
      }
      throw new PdfEngineError(
        `The ${band}'s ${slot.h} text is too wide for page ${at + 1}: it needs ${Math.ceil(width)} pt and the page has ${Math.floor(room)} pt between its margins, room for ${lo} of its ${chars.length} characters. Shorten it${orSmaller}.`,
      );
    }
  });

  // Two slots of one band, each of which fits alone, can still meet: a long
  // left line runs under the centred one. Measured as placeStamp lays them out
  // across the page as a reader sees it, with a space's width between them,
  // and refused rather than drawn as an overprint (audit header-footer#3).
  const gap = font.widthOfTextAtSize(" ", fontSize);
  pages.forEach(({ page, n, at }) => {
    const tokens = { n, total, date: options.date };
    const across = viewerSize(visibleBox(page), page.getRotation().angle).width;
    for (const v of ["top", "bottom"] as const) {
      const spans = slots
        .filter((slot) => slot.v === v)
        .map((slot) => {
          const text = applyTokens(slot.text, tokens);
          const width =
            text.trim().length === 0
              ? 0
              : font.widthOfTextAtSize(text, fontSize);
          const start =
            slot.h === "left"
              ? margin
              : slot.h === "right"
                ? across - margin - width
                : (across - width) / 2;
          return { h: slot.h, start, end: start + width, width };
        })
        .filter((span) => span.width > 0);
      // SLOT_ALIGN order: left, center, right — each pair once.
      for (let i = 0; i < spans.length; i += 1) {
        for (let j = i + 1; j < spans.length; j += 1) {
          const a = spans[i]!;
          const b = spans[j]!;
          if (a.end + gap <= b.start) continue;
          const band = v === "top" ? "header" : "footer";
          throw new PdfEngineError(
            `The ${band}'s ${a.h} and ${b.h} text overlap on page ${at + 1}: each fits alone, but together they need more room than the line has. Shorten one of them${orSmaller}.`,
          );
        }
      }
    }
  });

  for (const { page } of pages) await isolatePageContent(page);
  pages.forEach(({ page, n }) => {
    const tokens = { n, total, date: options.date };
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
