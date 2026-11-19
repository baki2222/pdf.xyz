/**
 * Each character's advance inside a pdf.js text item, read from the glyphs
 * the page's operator list shows. Part of the Create Forms field finder:
 * `./form-detect` places an underscore run, a row of dots or a box symbol
 * inside its text item from these, instead of from a guess per character.
 *
 * WHY. pdf.js gives one width for a whole text item ("Name: ________"), not
 * one per character. The finder used to share that width out by a table of
 * typical advances per font family, which is close for the standard fonts
 * and far off for an embedded one: on Noto Sans, the face pdf.xyz itself
 * embeds, an underscore is 0.444 em where the table says 0.556, and a run
 * of twelve after "Name:" started 16 pt to the right of where it is drawn
 * (measured by form-detect-precision.test.ts, which keeps the estimate's
 * error on record beside this module's).
 *
 * WHAT IT READS (pdfjs-dist 6): `setFont` carries the font's loaded name
 * first, the same name a text item's `fontName` gives, and every text
 * operator arrives as `showText` with an array of glyph objects
 * `{ unicode, width }` (width in glyph units, 1000 to the em for every font
 * whose matrix is the usual 0.001) and numbers for TJ spacing. The table is
 * per font: one character, one advance. A character shown with two
 * different advances in one font (two encodings, a Type 3 font redefining
 * it) is dropped, so it can never be placed by the wrong one.
 *
 * Pure: `OPS` is a parameter, as in `./form-detect-paths`.
 */

/** The operator codes this reads; pdf.js's `OPS` has both. */
export interface GlyphOps {
  setFont?: number;
  showText?: number;
}

/** Per font (pdf.js's loaded name): each character's advance, glyph units. */
export type GlyphTable = Map<string, Map<string, number>>;

/**
 * Tolerances for {@link itemAdvances}. Held literally by
 * form-detect-precision.test.ts.
 */
export const ADVANCES = {
  /**
   * Glyph units per em: the advance in points is units x size / 1000, true
   * of every font whose matrix is 0.001 (all but some Type 3 fonts, which
   * the proportional path still places correctly).
   */
  UNITS_PER_EM: 1000,
  /**
   * The item's width differs from its glyphs' by more than this many ems:
   * the difference is space between words (word spacing, or the gap pdf.js
   * writes as one space between two pieces of text it joined, wider or
   * narrower than the font's space), so it goes to the spaces. Measured on
   * corpus P53: "Email:" and its dots drawn 6 pt apart are one item whose
   * space is 2.7 pt (0.22 em) wider than Helvetica's, and scaling every
   * character instead put the dots 2 pt early. Under it the difference is
   * shared by every character: pdf.js measures an item holding a space up
   * to 0.05 em wider than its glyphs with no gap at all (Helvetica
   * "Name: ____", 2026-11-19), and giving that to the space moved the run
   * 0.6 pt off where it is drawn.
   */
  SPACE_EXTRA_MIN_EMS: 0.1,
  /**
   * ...but only while the glyphs make up at least this share of the item
   * (and no space is left narrower than nothing): otherwise the units are
   * not points x 1000 (a Type 3 font with another matrix) and every advance
   * is scaled to the width instead.
   */
  GLYPH_SHARE_MIN: 0.5,
} as const;

/**
 * The glyph table of one page's operator list. Linear in the operators and
 * glyphs shown; never throws on a shape it does not expect (a glyph that is
 * not an object, a width that is not a finite number), it skips it.
 */
export function glyphTable(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  OPS: GlyphOps,
): GlyphTable {
  const table: GlyphTable = new Map();
  const conflicted = new Map<string, Set<string>>();
  if (OPS.setFont === undefined || OPS.showText === undefined) return table;
  let font: string | null = null;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.setFont) {
      const args = argsArray[i] as unknown[] | null | undefined;
      font =
        Array.isArray(args) && typeof args[0] === "string" ? args[0] : null;
      continue;
    }
    if (fn !== OPS.showText || font === null) continue;
    const args = argsArray[i] as unknown[] | null | undefined;
    const glyphs = Array.isArray(args) ? args[0] : null;
    if (!Array.isArray(glyphs)) continue;
    let widths = table.get(font);
    if (!widths) table.set(font, (widths = new Map()));
    let bad = conflicted.get(font);
    if (!bad) conflicted.set(font, (bad = new Set()));
    for (const g of glyphs) {
      if (!g || typeof g !== "object") continue;
      const { unicode, width } = g as { unicode?: unknown; width?: unknown };
      if (typeof unicode !== "string" || typeof width !== "number") continue;
      if (!isFinite(width) || width < 0) continue;
      // One code point only: a ligature's "fi" is two characters of the
      // text item and one advance here, which cannot be shared out.
      if (Array.from(unicode).length !== 1) continue;
      if (bad.has(unicode)) continue;
      const had = widths.get(unicode);
      if (had === undefined) widths.set(unicode, width);
      else if (Math.abs(had - width) > 1e-6) {
        widths.delete(unicode);
        bad.add(unicode);
      }
    }
  }
  return table;
}

const SPACE = /\s/;

/**
 * Each code point's advance in points, summing to `width`, or undefined
 * when the table cannot place every character (one not in its font's
 * table, other than a space pdf.js wrote for a gap, which takes its share
 * of the gap).
 *
 * The glyphs' own advances (units x size / 1000) are used as they are, and
 * whatever the item is wider (or narrower) by goes to its spaces, shared
 * equally, when there are spaces, the difference is over
 * {@link ADVANCES.SPACE_EXTRA_MIN_EMS}, the glyphs make up at least
 * {@link ADVANCES.GLYPH_SHARE_MIN} of the width and no space ends up
 * narrower than nothing. Otherwise every advance is scaled by one factor to
 * the width (horizontal scaling, a Type 3 font's own matrix).
 */
export function itemAdvances(
  str: string,
  width: number,
  size: number,
  widths: ReadonlyMap<string, number> | undefined,
): number[] | undefined {
  if (!widths || !(width > 0) || !(size > 0)) return undefined;
  const chars = Array.from(str);
  if (chars.length === 0) return undefined;
  const own: (number | null)[] = [];
  const spaces: number[] = [];
  for (const [i, ch] of chars.entries()) {
    const w = widths.get(ch);
    const space = SPACE.test(ch);
    if (space) spaces.push(i);
    if (w === undefined) {
      if (!space) return undefined;
      own.push(null);
    } else own.push((w * size) / ADVANCES.UNITS_PER_EM);
  }
  const glyphs = own.reduce<number>((s, a) => s + (a ?? 0), 0);
  if (!(glyphs > 0)) return undefined;
  const extra = width - glyphs;
  if (
    spaces.length > 0 &&
    Math.abs(extra) > ADVANCES.SPACE_EXTRA_MIN_EMS * size &&
    glyphs >= ADVANCES.GLYPH_SHARE_MIN * width
  ) {
    const share = extra / spaces.length;
    const out = own.map((a) => a ?? 0);
    for (const i of spaces) out[i]! += share;
    if (spaces.every((i) => out[i]! >= 0)) return out;
  }
  // A space pdf.js wrote, with no glyph of its own and no extra to take:
  // it cannot be placed.
  if (own.some((a) => a === null)) return undefined;
  const k = width / glyphs;
  return own.map((a) => a! * k);
}
