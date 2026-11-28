/**
 * Text to PDF's page setup — the paper, its orientation and the text size —
 * as a LEAF (no pdf-lib, no DOM), so the engine that lays the text out, the
 * chips that offer each choice and the copy that describes them read one
 * table (audit backlog #5, 2026-11-16).
 *
 * Until then the page was fixed: US Letter, portrait, 11 pt text on 16 pt
 * lines. Those stay the ENGINE's defaults ({@link DEFAULT_TEXT_PAGE_OPTIONS}),
 * so a caller that passes no options gets the PDF it always got; a person
 * using the tool starts on the paper of their browser's region instead
 * (`useRegionalPaper`, the rule JPG/PNG to PDF already follow).
 *
 * The sizes are Image to PDF's own entries, not new numbers: one A4, one
 * Letter, in points, for every in-browser "to PDF" engine.
 */
import {
  IMAGE_ORIENTATIONS,
  IMAGE_PAGE_SIZES,
  type ImagePageSizeId,
} from "./image-page-layout";
import { TEXT_PAGE_MARGIN_PT } from "./page-geometry";

export type TextPageSizeId = Extract<
  ImagePageSizeId,
  "a4" | "letter" | "legal"
>;
export type TextOrientationId = "portrait" | "landscape";
export type TextMarginId = "narrow" | "normal" | "wide";

export interface TextPageSize {
  id: TextPageSizeId;
  label: string;
  /** Portrait, in points. */
  size: { width: number; height: number };
}

const TEXT_PAGE_SIZE_IDS: readonly TextPageSizeId[] = ["a4", "letter", "legal"];

/** The sizes the runner offers, in Image to PDF's order and with its labels. */
export const TEXT_PAGE_SIZES: readonly TextPageSize[] = TEXT_PAGE_SIZE_IDS.map(
  (id) => {
    const found = IMAGE_PAGE_SIZES.find((s) => s.id === id);
    if (!found?.size) throw new Error(`text-to-pdf: no page size "${id}"`);
    return { id, label: found.label, size: found.size };
  },
);

/** Portrait and Landscape: Image to PDF's choices less "Auto", which follows a picture. */
export const TEXT_ORIENTATIONS: readonly {
  id: TextOrientationId;
  label: string;
}[] = IMAGE_ORIENTATIONS.filter(
  (o): o is { id: TextOrientationId; label: string } => o.id !== "auto",
);

/** The runner's headings for the three choices, as the copy names them. */
export const TEXT_PAGE_SETUP_LABELS = {
  pageSize: "Page size",
  orientation: "Orientation",
  fontSize: "Text size",
  margin: "Margins",
} as const;

/**
 * The white space around the text block (audit wave 2, text-to-pdf#3).
 * Normal is the {@link TEXT_PAGE_MARGIN_PT} this tool always drew, and the
 * one it starts on; Narrow and Wide are the half-inch and inch most word
 * processors offer under the same names.
 */
export const TEXT_MARGINS: readonly {
  id: TextMarginId;
  label: string;
  points: number;
}[] = [
  { id: "narrow", label: "Narrow", points: 36 },
  { id: "normal", label: "Normal", points: TEXT_PAGE_MARGIN_PT },
  { id: "wide", label: "Wide", points: 72 },
];

/** A tab moves to the next multiple of this many characters on its line. */
export const TEXT_TAB_STOP = 8;

/** Text sizes offered, in points. */
export const TEXT_FONT_SIZES: readonly number[] = [9, 10, 11, 12, 14];

/**
 * The spacing every size is set at: the 16 pt lines of the 11 pt text this
 * tool always drew, as a ratio, so each size keeps the same airy look.
 */
const LEADING = { fontSize: 11, lineHeight: 16 } as const;

export interface TextPageOptions {
  pageSize: TextPageSizeId;
  orientation: TextOrientationId;
  fontSize: number;
  margin: TextMarginId;
}

/** The engine's default: the page Text to PDF drew before it had options. */
export const DEFAULT_TEXT_PAGE_OPTIONS: Readonly<TextPageOptions> = {
  pageSize: "letter",
  orientation: "portrait",
  fontSize: LEADING.fontSize,
  margin: "normal",
};

export interface TextPageGeometry {
  width: number;
  height: number;
  margin: number;
  fontSize: number;
  lineHeight: number;
  /** The width a line may take: the page less both margins. */
  maxWidth: number;
  /** Whole lines that fit between the top and bottom margins. */
  linesPerPage: number;
}

/**
 * Where the text goes on a page of these options. Throws on a size or a text
 * size the table does not list: the engine draws only what the chips offer.
 */
export function textPageGeometry(
  options: Readonly<TextPageOptions>,
): TextPageGeometry {
  const paper = TEXT_PAGE_SIZES.find((s) => s.id === options.pageSize);
  if (!paper)
    throw new Error(`text-to-pdf: no page size "${options.pageSize}"`);
  if (!TEXT_FONT_SIZES.includes(options.fontSize))
    throw new Error(`text-to-pdf: no text size ${options.fontSize}`);
  const { width: short, height: long } = paper.size;
  const [width, height] =
    options.orientation === "landscape" ? [long, short] : [short, long];
  const chosenMargin = TEXT_MARGINS.find((m) => m.id === options.margin);
  if (!chosenMargin)
    throw new Error(`text-to-pdf: no margin "${options.margin}"`);
  const margin = chosenMargin.points;
  const lineHeight = (options.fontSize * LEADING.lineHeight) / LEADING.fontSize;
  return {
    width,
    height,
    margin,
    fontSize: options.fontSize,
    lineHeight,
    maxWidth: width - margin * 2,
    linesPerPage: Math.floor((height - margin * 2) / lineHeight),
  };
}
