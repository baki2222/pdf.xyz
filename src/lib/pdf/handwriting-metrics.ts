/**
 * How far each handwriting face reaches above and below its baseline, in
 * ems (review of sign-pdf#1, 2026-11-09).
 *
 * A leaf on purpose: `editor/model.ts` sizes a typed signature's box from
 * these numbers, and that module is imported by page copy; nothing here
 * pulls in the coverage table or a font.
 *
 * WHY. A typed signature's box was `size × 1.2` tall with its baseline at
 * 0.85 em, the same for every face. Homemade Apple's descenders reach 0.85 em
 * below the baseline, Mr Dafoe's and Alex Brush's over 0.4 em, so a
 * signature dragged until its box touched the page's bottom edge passed
 * validation and lost a quarter of its ink at the edge. Each face's box is
 * now as tall as its ink (`handwritingLineHeight`).
 *
 * TWO REACHES, because two renderers read the face:
 *  - `ink`: the font's `head` bounding box — every glyph's outline lies
 *    inside it, which is what a PDF page clips;
 *  - `lineBox`: the furthest of the `hhea` and OS/2 `usWin` ascent and
 *    descent — what a browser may size a CSS line box from (Chrome reads
 *    one or the other by platform), which is what an `overflow: hidden`
 *    preview clips.
 * Typed numbers with no relationship to anything, so `handwriting.test.ts`
 * re-derives both from each installed TTF and fails on any difference
 * (house rule 3: a constant needs a second, independent bound).
 */
import type { HandwritingStyle } from "./offered-kinds";

export interface FaceReach {
  /** Ems above the baseline. */
  readonly above: number;
  /** Ems below the baseline, as a positive number. */
  readonly below: number;
}

export const HANDWRITING_REACH: Record<
  HandwritingStyle,
  { readonly ink: FaceReach; readonly lineBox: FaceReach }
> = {
  "dancing-script": {
    ink: { above: 1.095, below: 0.284 },
    lineBox: { above: 1.096, below: 0.306 },
  },
  "alex-brush": {
    ink: { above: 0.962, below: 0.425 },
    lineBox: { above: 0.962, below: 0.43 },
  },
  "mr-dafoe": {
    ink: { above: 0.981, below: 0.416 },
    lineBox: { above: 0.981, below: 0.416 },
  },
  "homemade-apple": {
    ink: { above: 1.296, below: 0.846 },
    lineBox: { above: 1.296, below: 0.846 },
  },
};

/**
 * Baseline of a text box's line: this many ems below the top of its slot,
 * plus half the leading (`lineBaseline` in `editor/text.ts`).
 */
export const BASELINE_EMS = 0.85;

/** The line height every other text box, and a typed signature in Script or Print, is set at. */
export const DEFAULT_LINE_HEIGHT = 1.2;

/**
 * The least line height, to 0.01, at which a one-line slot holds `reach`
 * with the baseline where `lineBaseline` puts it: `(L - 1) / 2 + B` ems from
 * the top must clear `above`, and the rest of the slot must clear `below`.
 * Never under {@link DEFAULT_LINE_HEIGHT}.
 */
export function lineHeightHolding(reach: FaceReach): number {
  const forAbove = 2 * (reach.above - BASELINE_EMS) + 1;
  const forBelow = 2 * (reach.below + BASELINE_EMS) - 1;
  const need = Math.max(DEFAULT_LINE_HEIGHT, forAbove, forBelow);
  return Math.ceil(need * 100 - 1e-9) / 100;
}

/** A typed signature's line height in a handwriting face: tall enough for all of its ink. */
export function handwritingLineHeight(style: HandwritingStyle): number {
  return lineHeightHolding(HANDWRITING_REACH[style].ink);
}
