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
 * CHARACTER SPACING AND HORIZONTAL SCALING (review round 1 of slice S3,
 * finding 5). pdf.js's item width includes both, and the split once gave
 * the whole difference to the spaces, so Tc = 1 put a run 11 pt late and
 * Tz = 120 16 pt. Horizontal scaling is in the item's transform (its x
 * scale over its y scale; pdf.js multiplies the font size by it), and
 * `setCharSpacing` is in the operator list: the table keeps, per font, the
 * Tc it was shown with (following `save` / `restore`), so each advance
 * becomes (glyph + Tc) x scale, as a reader draws it.
 *
 * TC PER CHARACTER, NOT PER FONT (review round 2 of slice S3). Kept per
 * font, one letter-spaced heading in the body font made the font's Tc
 * unknown, and unknown was read as 0: every run below it 11 pt late at
 * Tc 1. The table now also keeps, per font, the order its characters were
 * shown in with each one's Tc (`shown`), and {@link itemCharSpacing}
 * reads a text item's characters off that queue in turn, so each
 * character carries the Tc it was drawn with, even when one item joins
 * two pieces of text drawn at two values. pdf.js makes its text items
 * from the same content stream in the same order, so each font's items,
 * read in order, consume that font's queue in order. The queue holds one
 * entry per code point of a glyph's `unicode`, spaces left out (pdf.js
 * writes spaces of its own between pieces of text, which no glyph drew).
 *
 * Pure: `OPS` is a parameter, as in `./form-detect-paths`.
 */

/** The operator codes this reads; pdf.js's `OPS` has them all. */
export interface GlyphOps {
  setFont?: number;
  showText?: number;
  /** Tc, and the graphics-state stack that saves and restores it. */
  setCharSpacing?: number;
  save?: number;
  restore?: number;
}

/**
 * Per font (pdf.js's loaded name): each character's advance, glyph units;
 * and `charSpacing`, per font, the character spacing (Tc) it was shown
 * with, in ems of its size, or null when it was shown with more than one.
 */
export type GlyphTable = Map<string, Map<string, number>> & {
  charSpacing: Map<string, number | null>;
  /**
   * Per font, every character it showed other than a space, in the order
   * shown, with the Tc each was shown with in ems of the size (NaN when
   * there was no size to measure it by), and how far its text items have
   * read it ({@link itemCharSpacing}).
   */
  shown: Map<string, { ch: string[]; tc: number[]; at: number }>;
};

/**
 * How many characters of a font's queue {@link itemCharSpacing} skips, at
 * most, to find where a text item starts: a glyph pdf.js's text content
 * writes differently (a ligature it spells out) is passed over, and the
 * search stays linear. Held literally by form-detect-precision.test.ts.
 */
export const SHOWN_RESYNC = 64;

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
   * The item's width differs from its glyphs' (after Tc and Tz) by more
   * than this many ems: the difference is space between words (word
   * spacing, TJ kerning, or the gap pdf.js writes as one space between two
   * pieces of text it joined), so it goes to the spaces. Measured on corpus
   * P53: "Email:" and its dots drawn 6 pt apart are one item whose space is
   * 2.7 pt (0.22 em) wider than Helvetica's, and scaling every character
   * instead put the dots 2 pt early. Under it the difference is shared by
   * every character.
   *
   * WHAT IT DECIDES, MEASURED (review round 1 of slice S3, finding 6; the
   * docblock once said pdf.js measures plain items up to 0.05 em wider
   * than their glyphs, which is false: 28 plain items on Helvetica, Times,
   * Courier and Noto Sans differ by 0.0000 em, 2026-11-19). So on plain
   * text it decides nothing, and above it, the joined gap and TJ kerning
   * of the MEASURED spacing sheets are placed within 1 pt only because the
   * difference goes to the spaces. Below it is a difference of under 1.2 pt
   * at 12 pt, which either way moves a run by less than that: the value is
   * held by its unit test and the literal table, not by a measurement.
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

const SPACE = /\s/;

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
  const table: GlyphTable = Object.assign(
    new Map<string, Map<string, number>>(),
    {
      charSpacing: new Map<string, number | null>(),
      shown: new Map<string, { ch: string[]; tc: number[]; at: number }>(),
    },
  );
  const conflicted = new Map<string, Set<string>>();
  if (OPS.setFont === undefined || OPS.showText === undefined) return table;
  type State = { font: string | null; size: number; tc: number };
  let st: State = { font: null, size: 0, tc: 0 };
  const stack: State[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null | undefined;
    if (fn === OPS.save) {
      stack.push({ ...st });
      continue;
    }
    if (fn === OPS.restore) {
      st = stack.pop() ?? st;
      continue;
    }
    if (fn === OPS.setCharSpacing) {
      const tc = Array.isArray(args) ? args[0] : undefined;
      st.tc = typeof tc === "number" && isFinite(tc) ? tc : 0;
      continue;
    }
    if (fn === OPS.setFont) {
      st.font =
        Array.isArray(args) && typeof args[0] === "string" ? args[0] : null;
      const size = Array.isArray(args) ? args[1] : undefined;
      st.size = typeof size === "number" && isFinite(size) ? size : 0;
      continue;
    }
    if (fn !== OPS.showText || st.font === null) continue;
    const font = st.font;
    const glyphs = Array.isArray(args) ? args[0] : null;
    if (!Array.isArray(glyphs)) continue;
    // Tc in ems of the font size; unknown (null) once two differ, or when
    // there is no size to measure it by.
    const tcEms = st.size !== 0 ? st.tc / Math.abs(st.size) : null;
    const had = table.charSpacing.get(font);
    if (had === undefined) table.charSpacing.set(font, tcEms);
    else if (had !== null && (tcEms === null || Math.abs(had - tcEms) > 1e-9))
      table.charSpacing.set(font, null);
    let queue = table.shown.get(font);
    if (!queue) table.shown.set(font, (queue = { ch: [], tc: [], at: 0 }));
    for (const g of glyphs) {
      const u =
        g && typeof g === "object" ? (g as { unicode?: unknown }).unicode : 0;
      if (typeof u !== "string") continue;
      for (const cp of u)
        if (!SPACE.test(cp)) {
          queue.ch.push(cp);
          queue.tc.push(tcEms ?? NaN);
        }
    }
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

/**
 * Each code point's Tc (ems of the size) in a text item of `font`, read
 * off the font's queue from where its last item stopped, or undefined when
 * the item's characters are not found there within {@link SHOWN_RESYNC}
 * (the queue is then left where it was). A space takes the Tc of the
 * character before it (the one after, at the start). Call it once per
 * text item, in pdf.js's order: it moves the queue on.
 */
export function itemCharSpacing(
  table: GlyphTable,
  font: string,
  str: string,
): number[] | undefined {
  const chars = Array.from(str);
  const want = chars.filter((ch) => !SPACE.test(ch));
  if (want.length === 0) return undefined;
  const q = table.shown.get(font);
  if (!q) return undefined;
  let start = -1;
  const last = Math.min(q.at + SHOWN_RESYNC, q.ch.length - want.length);
  for (let s = q.at; s <= last && start < 0; s++) {
    let k = 0;
    while (k < want.length && q.ch[s + k] === want[k]) k++;
    if (k === want.length) start = s;
  }
  if (start < 0) return undefined;
  q.at = start + want.length;
  const own = want.map((_, k) => q.tc[start + k]!);
  if (own.some((t) => !isFinite(t))) return undefined;
  const out: number[] = [];
  let k = 0;
  for (const ch of chars) {
    if (SPACE.test(ch)) out.push(own[Math.max(0, k - 1)]!);
    else out.push(own[k++]!);
  }
  return out;
}

/**
 * Each code point's advance in points, summing to `width`, or undefined
 * when the table cannot place every character (one not in its font's
 * table, other than a space pdf.js wrote for a gap, which takes its share
 * of the gap).
 *
 * Each glyph's advance is (units x size / 1000 + Tc) x the horizontal
 * scale (`spacing`: Tc in ems of the size, one for the item or one per
 * code point, and the scale, 0 / 1 when not given), and
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
  spacing: {
    charSpacingEms?: number | readonly number[];
    hScale?: number;
  } = {},
): number[] | undefined {
  if (!widths || !(width > 0) || !(size > 0)) return undefined;
  const hs = spacing.hScale ?? 1;
  if (!(hs > 0) || !isFinite(hs)) return undefined;
  const chars = Array.from(str);
  if (chars.length === 0) return undefined;
  const given = spacing.charSpacingEms ?? 0;
  const tcs = typeof given === "number" ? chars.map(() => given) : given;
  if (tcs.length !== chars.length || !tcs.every((t) => isFinite(t)))
    return undefined;
  const own: (number | null)[] = [];
  const spaces: number[] = [];
  for (const [i, ch] of chars.entries()) {
    const w = widths.get(ch);
    const space = SPACE.test(ch);
    if (space) spaces.push(i);
    if (w === undefined) {
      if (!space) return undefined;
      own.push(null);
    } else own.push((w / ADVANCES.UNITS_PER_EM + tcs[i]!) * size * hs);
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
