import { sanitizeNoteText, wrapText } from "../annotate";
import { loadPdfLib } from "../pdf-lib";
import { embedDrawingFont } from "../unicode-font";
import type { StandardFace } from "../font-packs";
import { allWinAnsi } from "../winansi";
import type { EditorFont, TextAlign, TextStyle } from "./model";

/**
 * Text layout shared by the overlay and the export, so a box breaks its lines
 * in the same places on screen and in the file.
 *
 * Lines are broken by {@link layoutText} with an injected `measure`. On the
 * WinAnsi path both sides measure with pdf-lib's own standard-font metrics
 * (the overlay through `createStandardMeasure`, the export through the
 * embedded `PDFFont`) — the same numbers, so the same breaks. On the Unicode
 * path the overlay measures the very Noto face the export embeds (loaded into
 * the page as a `FontFace` from the same bytes); only shaping can differ.
 *
 * Every line is then placed EXPLICITLY — its baseline at
 * {@link lineBaseline}, its left edge at {@link lineLeft} — on screen (an SVG
 * `<text>` per line) and in the PDF (`drawText` per line). Nothing is left to
 * a browser's line box, which is how a CSS rendering and a PDF drift apart.
 */

/** Baseline sits this many ems below the top of its line slot, plus half the leading. */
export const BASELINE_EMS = 0.85;

export interface LaidOutLine {
  text: string;
  /** Advance width, points. */
  width: number;
}

export interface TextLayout {
  lines: LaidOutLine[];
  /** Distance between baselines, points. */
  advance: number;
  /** Height of all line slots, points. */
  height: number;
}

/** Width of `text` at `size` points. */
export type Measure = (text: string, size: number) => number;

export function layoutText(
  text: string,
  width: number,
  style: Pick<TextStyle, "size" | "lineHeight">,
  measure: Measure,
): TextLayout {
  const size = style.size;
  const advance = size * style.lineHeight;
  const raw = wrapText(sanitizeNoteText(text), width, (s) => measure(s, size));
  const lines = (raw.length === 0 ? [""] : raw).map((line) => ({
    text: line,
    width: line.length === 0 ? 0 : measure(line, size),
  }));
  return { lines, advance, height: Math.max(1, lines.length) * advance };
}

/** Offset of line `i`'s baseline below the box top, points. */
export function lineBaseline(
  i: number,
  style: Pick<TextStyle, "size" | "lineHeight">,
): number {
  const advance = style.size * style.lineHeight;
  return i * advance + (advance - style.size) / 2 + style.size * BASELINE_EMS;
}

/** Offset of a line's left edge from the box's left edge, points. */
export function lineLeft(
  lineWidth: number,
  boxWidth: number,
  align: TextAlign,
): number {
  if (align === "center") return (boxWidth - lineWidth) / 2;
  if (align === "right") return boxWidth - lineWidth;
  return 0;
}

/** Does this text need a Unicode (Noto) face rather than a standard PDF font? */
export function needsUnicodeFace(text: string): boolean {
  return !allWinAnsi([sanitizeNoteText(text).replace(/[\r\n\t]+/g, " ")]);
}

/**
 * The face `embedDrawingFont` is asked for, for a family + weight + slant —
 * one of the chooser's own `StandardFace`s, so the editor never names a
 * pdf-lib standard font itself (`text-drawing-call-sites.test.ts`). Western
 * text is drawn in exactly that face; other scripts are asked for as "sans"
 * by the callers ({@link needsUnicodeFace}), where only the regular Noto
 * weight ships.
 */
export function standardFontKey(
  font: EditorFont,
  bold: boolean,
  italic: boolean,
): StandardFace {
  if (font === "times") {
    if (bold && italic) return "serif-bold-italic";
    if (bold) return "serif-bold";
    if (italic) return "serif-italic";
    return "serif";
  }
  const base = font === "courier" ? "mono" : "sans";
  if (bold && italic) return `${base}-bold-oblique`;
  if (bold) return `${base}-bold`;
  if (italic) return `${base}-oblique`;
  return base;
}

/** The face to ask the chooser for, for this text in this style. */
export function faceFor(
  text: string,
  style: Pick<TextStyle, "font" | "bold" | "italic">,
): StandardFace {
  return needsUnicodeFace(text)
    ? "sans"
    : standardFontKey(style.font, style.bold, style.italic);
}

/**
 * The CSS face the overlay draws a standard font with: each stack leads with
 * the metric-compatible face every desktop ships (Arial for Helvetica, Times
 * New Roman for Times, Courier New for Courier) and the Liberation clones
 * Linux ships, so glyph advances match the PDF's within a hair.
 */
export const CSS_FONT_STACK: Record<EditorFont, string> = {
  helvetica:
    'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", "Arimo", sans-serif',
  times:
    '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", "Tinos", serif',
  courier:
    '"Courier New", Courier, "Liberation Mono", "Nimbus Mono PS", "Cousine", monospace',
};

const STANDARD_FACES: readonly StandardFace[] = [
  "sans",
  "sans-bold",
  "sans-oblique",
  "sans-bold-oblique",
  "serif",
  "serif-bold",
  "serif-italic",
  "serif-bold-italic",
  "mono",
  "mono-bold",
  "mono-oblique",
  "mono-bold-oblique",
];

/**
 * A synchronous measure for the editor's twelve Western faces: each embedded
 * once, through the chooser, into a scratch document — so the widths are the
 * very numbers the export's `PDFFont.widthOfTextAtSize` returns, from the
 * very same face. Nothing is downloaded: Western text takes the chooser's
 * built-in path.
 */
export async function createStandardMeasure(): Promise<
  (face: StandardFace) => Measure
> {
  const { PDFDocument } = await loadPdfLib();
  const scratch = await PDFDocument.create();
  const fonts = new Map(
    await Promise.all(
      STANDARD_FACES.map(
        async (face) =>
          [face, await embedDrawingFont(scratch, ["A"], face)] as const,
      ),
    ),
  );
  return (face) => {
    const font = fonts.get(face) ?? fonts.get("sans")!;
    return (text, size) => font.widthOfTextAtSize(text, size);
  };
}
