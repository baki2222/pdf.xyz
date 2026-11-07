import type { Rect } from "./model";

/**
 * Text markup: the four ISO 32000-1 §12.5.6.10 kinds a reviewer marks words
 * with — highlight, underline, strike-out and squiggly underline — and the
 * geometry the editor's overlay, the flattened export and the comment
 * writer (`comments.ts`) all draw them from, so the three cannot disagree.
 *
 * A text markup is a `highlight` object with a `markup` (absent on objects
 * made before 2026-11-08: a highlight). Its marked area is the box drawn —
 * saved as a comment, snapped to the text lines under it
 * (`snapHighlightQuads`), as a highlight always was.
 *
 * Feature-scoped on purpose: only the editor's lazy chunk and its export
 * import this, never a first-load module (the bundle budget, 2026-11-07).
 */

export const TEXT_MARKUPS = [
  "highlight",
  "underline",
  "strikeout",
  "squiggly",
] as const;
export type TextMarkup = (typeof TEXT_MARKUPS)[number];

/** What the toolbar buttons, the Style menu and the page copy call each. */
export const TEXT_MARKUP_LABEL: Record<TextMarkup, string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "Strikethrough",
  squiggly: "Squiggly",
};

/** The annotation subtype each is saved as (ISO 32000-1 Table 169). */
export const TEXT_MARKUP_SUBTYPE: Record<TextMarkup, string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "StrikeOut",
  squiggly: "Squiggly",
};

export function markupOf(obj: { markup?: TextMarkup }): TextMarkup {
  return obj.markup ?? "highlight";
}

/*
 * Where a line sits in a quad. A run's box spans its font's descent (0.22
 * of the size) to its ascent (0.92) — `runs.ts` places it so — which puts
 * the baseline 0.92 / 1.14 of the way down. An underline sits just under
 * the baseline; a strike-out at the middle of the lower-case letters.
 */
const SPAN = 1.14;
const UNDERLINE_AT = (0.92 + 0.07) / SPAN;
const STRIKE_AT = (0.92 - 0.3) / SPAN;
const SQUIGGLE_AT = (0.92 + 0.1) / SPAN;

/** The stroke's width for a quad of this height, points. */
export function markupThickness(quadHeight: number): number {
  return Math.max(0.75, quadHeight * 0.06);
}

/**
 * The polyline a line markup draws across one quad, in the quad's own
 * frame (viewer points, horizontal text), and its width. Null for a
 * highlight, which fills the quad.
 */
export function markupStroke(
  quad: Rect,
  markup: TextMarkup,
): { points: { x: number; y: number }[]; width: number } | null {
  if (markup === "highlight") return null;
  const width = markupThickness(quad.height);
  const x0 = quad.x;
  const x1 = quad.x + quad.width;
  if (markup !== "squiggly") {
    const y =
      quad.y +
      quad.height * (markup === "underline" ? UNDERLINE_AT : STRIKE_AT);
    return {
      points: [
        { x: x0, y },
        { x: x1, y },
      ],
      width,
    };
  }
  const mid = quad.y + quad.height * SQUIGGLE_AT;
  const amp = Math.max(0.75, quad.height * 0.05);
  const step = Math.max(1.5, quad.height * 0.14);
  const points: { x: number; y: number }[] = [];
  let up = true;
  for (let x = x0; x < x1; x += step) {
    points.push({ x, y: mid + (up ? -amp : amp) });
    up = !up;
  }
  points.push({ x: x1, y: mid + (up ? -amp : amp) });
  return { points, width };
}
