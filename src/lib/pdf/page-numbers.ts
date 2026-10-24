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
  resolveAlign,
  stampProducer,
  toRgb,
  visibleBox,
  type HAlign,
  type RGB,
  type StampFontFamily,
  type StampPosition,
} from "./stamp";

/**
 * Stamp page numbers onto an existing PDF, fully in-browser. Position defaults
 * to bottom-center with a "Page {n} of {total}" template; numbering can start
 * on a later page and from an arbitrary first value, leave the cover page or
 * the last pages unnumbered, and mirror left/right positions on even pages for
 * a printed, facing-pages layout.
 */

export const DEFAULT_PAGE_NUMBER_FORMAT = "Page {n} of {total}";

/** The margin presets the runner offers, in points from the page edge. */
export const PAGE_NUMBER_MARGINS = {
  small: 18,
  medium: 36,
  large: 60,
} as const;

export type PageNumberMargin = keyof typeof PAGE_NUMBER_MARGINS;

/** The margin used when none is given — the "medium" preset. */
export const DEFAULT_PAGE_NUMBER_MARGIN = PAGE_NUMBER_MARGINS.medium;

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
  /**
   * Leave the first page of the file without a number while still counting
   * it, so page 2 shows the number after First number. Default false.
   */
  skipCover?: boolean;
  /**
   * Leave this many pages at the end without a number. They are not counted,
   * so {total} is still the last number printed. Default 0.
   */
  skipLast?: number;
  /**
   * Facing pages: on even-numbered pages of the file, swap left and right, so
   * a number at the outer edge stays at the outer edge of a printed spread.
   * Default false.
   */
  facing?: boolean;
  /** Type family. Defaults to Helvetica. */
  font?: StampFontFamily;
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

export interface NumberingPlan {
  /** Pages that get a label: 0-based index and the number it shows. */
  stamps: { index: number; n: number }[];
  /** The last number printed — what {total} becomes. */
  total: number;
}

/**
 * Which pages carry which number — pure arithmetic, shared by the engine and
 * the runner's preview and summary so the two cannot disagree.
 *
 * Counted pages run from Start on page to the last page before the skipped
 * tail; the cover (page 1 of the file) is counted but not stamped when
 * `skipCover` is set.
 */
export function numberingPlan(
  pageCount: number,
  options: Pick<
    PageNumberOptions,
    "startPage" | "startAt" | "skipCover" | "skipLast"
  > = {},
): NumberingPlan {
  const startPage = Math.max(1, Math.floor(options.startPage ?? 1));
  const startAt = Math.floor(options.startAt ?? 1);
  const skipLast = clamp(Math.floor(options.skipLast ?? 0), 0, pageCount);
  const lastPage = pageCount - skipLast;
  const counted = Math.max(0, lastPage - (startPage - 1));
  const total = startAt + counted - 1;
  const stamps: { index: number; n: number }[] = [];
  for (let index = startPage - 1; index < lastPage; index += 1) {
    if (options.skipCover && index === 0) continue;
    stamps.push({ index, n: startAt + (index - (startPage - 1)) });
  }
  return { stamps, total };
}

const MIRROR: Record<HAlign, HAlign> = {
  left: "right",
  center: "center",
  right: "left",
};

export async function addPageNumbers(
  bytes: Uint8Array,
  options: PageNumberOptions = {},
): Promise<Uint8Array> {
  const format = options.format ?? DEFAULT_PAGE_NUMBER_FORMAT;
  validatePageNumberFormat(format);

  const position = options.position ?? "bottom-center";
  const fontSize = clamp(options.fontSize ?? 11, 6, 96);
  const margin = clamp(options.margin ?? DEFAULT_PAGE_NUMBER_MARGIN, 0, 240);
  const { h, v } = resolveAlign(position);
  const { degrees, rgb } = await loadPdfLib();
  const color = toRgb(rgb, options.color ?? INK);

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  // An empty plan draws nothing, as a Start on page past the end always did;
  // the runner disables its button when the plan is empty.
  const plan = numberingPlan(pages.length, options);

  // Every label this run will draw, substituted, BEFORE a font is chosen. The
  // template is not the text: "Page {n} of {total}" is pure ASCII while
  // "পৃষ্ঠা {n}" is not, and a font picked from the template would be picked
  // from the wrong set. Choosing up front also means a refusal arrives before
  // page one is touched rather than part-way through the loop.
  const labels = plan.stamps
    .map(({ n }) => applyTokens(format, { n, total: plan.total }))
    .filter((text) => text.trim().length > 0);
  const font = await embedStampFont(doc, labels, "regular", options.font);

  for (const { index, n } of plan.stamps) {
    const page = pages[index]!;
    const text = applyTokens(format, { n, total: plan.total });
    if (text.trim().length === 0) continue;

    // Physical page 2, 4, 6… is a left-hand page in a printed spread.
    const mirrored = options.facing === true && (index + 1) % 2 === 0;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);
    const placement = placeStamp({
      box: visibleBox(page),
      pageRotation: page.getRotation().angle,
      textWidth,
      textHeight,
      h: mirrored ? MIRROR[h] : h,
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
  }

  stampProducer(doc);
  return doc.save();
}
