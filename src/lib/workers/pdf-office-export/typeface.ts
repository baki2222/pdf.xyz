/**
 * Which Office typeface a PDF font is written in — for PDF to PowerPoint
 * (`./deck-from-scan`, since 2026-10-11) and PDF to Word (`./docx-run-style`
 * and `./docx-package`, since 2026-11-15, heartbeat key `docxTypefaces`).
 * Moved here from `./deck-from-scan` on 2026-11-15 so both writers share ONE
 * mapping; the slide XML PDF to PowerPoint writes was compared byte for byte
 * before and after the move.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A family Office or Windows ships keeps its name ({@link OFFICE_FAMILIES});
 * a free metric clone of one (Liberation, Carlito, Caladea — the faces a PDF
 * made by LibreOffice on Linux is set in) becomes the family it clones; the
 * PDF standard fonts (Helvetica, Times, Courier) become Arial, Times New
 * Roman and Courier New, each cut to the same widths; any other becomes
 * Arial, Times New Roman or Courier New by the PDF font's own serif / sans /
 * monospace class ({@link CLASS_DEFAULT}). Only the NAME is written: no font
 * file is ever embedded, in either writer.
 *
 * ── WORD (since 2026-11-15) ─────────────────────────────────────────────────
 *
 * {@link docxTypefaceOf} is the same mapping with three refusals: an
 * unknown family whose kind cannot be told (see {@link docxKindOf}: pdf.js's
 * "sans" means only that nothing was marked), an invisible
 * run (an OCR layer) and a symbol or dingbat face ({@link SYMBOL_FAMILY})
 * name no typeface at all. A Word document's text is poppler's, not pdf.js's,
 * so writing Wingdings over poppler's Unicode would draw the wrong glyphs.
 * And a word whose letters are not all Latin ({@link WORD_SCRIPT_SAFE}:
 * Bengali, Greek, Arabic, CJK…) takes no typeface in `./docx-run-style`:
 * Arial, Times New Roman and Courier New have no Bengali, and naming one in
 * `w:cs` would override Word's own choice of a font for that script.
 */
import { OFFICE_METRIC_CLONES } from "../office-conversion/fonts";
import { SYMBOL_FAMILY, type FontClass, type ScannedRun } from "./page-scan";

/**
 * Families kept by name: ones Office or Windows ships, so PowerPoint and
 * Word for Windows have them. Nothing else may be here:
 * `claims-vs-capability.test.ts` holds this list to the pages' font
 * sentences (PDF to PowerPoint's and, since 2026-11-15, PDF to Word's).
 */
export const OFFICE_FAMILIES = [
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Aptos",
  "Bahnschrift",
  "Book Antiqua",
  "Bookman Old Style",
  "Calibri",
  "Calibri Light",
  "Cambria",
  "Candara",
  "Century",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Franklin Gothic Medium",
  "Garamond",
  "Georgia",
  "Gill Sans MT",
  "Impact",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Palatino Linotype",
  "Segoe UI",
  "Segoe UI Symbol",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Symbol",
  "Wingdings",
  "Wingdings 2",
  "Wingdings 3",
  "Webdings",
] as const;
const KNOWN = new Map<string, string>(
  OFFICE_FAMILIES.map((f) => [f.toLowerCase(), f]),
);
/** Each free metric clone, by the Office family it was cut to match. */
const CLONES: Readonly<Record<string, string>> = Object.fromEntries(
  OFFICE_METRIC_CLONES.map((c) => [c.clone.toLowerCase(), c.office]),
);
const ALIASES: Readonly<Record<string, string>> = {
  helvetica: "Arial",
  "helvetica neue": "Arial",
  arial: "Arial",
  times: "Times New Roman",
  "times roman": "Times New Roman",
  courier: "Courier New",
  "zapf dingbats": "Wingdings",
  "itc zapf dingbats": "Wingdings",
  ...CLONES,
};
/**
 * Aliases whose target draws the SAME advance widths (Arial was cut to
 * Helvetica's metrics, Times New Roman to Times', Courier New to Courier's,
 * and each clone to its Office family's). Only for these, and for families
 * kept by name, does the PDF's own spacing carry over (`spc`): measured
 * against another face it would be wrong.
 */
const METRIC_ALIASES = new Set([
  "helvetica",
  "times",
  "times roman",
  "courier",
  ...Object.keys(CLONES),
]);
/** The face of each class a family Office does not ship is written in. */
export const CLASS_DEFAULT: Readonly<Record<FontClass, string>> = {
  sans: "Arial",
  serif: "Times New Roman",
  mono: "Courier New",
};
/** The Private Use Area (U+E000–U+F8FF), where unmapped symbol glyphs land. */
const PRIVATE_USE = new RegExp(
  `[${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}]`,
);

/**
 * The typeface a run is written in. A symbol font whose glyphs pdf.js mapped
 * to real characters (an arrow, a check mark) is written in `fallback`, the
 * line's text face: the character is right and Wingdings would draw it wrong.
 */
export function typefaceFor(
  run: Pick<ScannedRun, "family" | "fontClass" | "text">,
  fallback?: string,
): string {
  const name = run.family.trim();
  const lower = name.toLowerCase();
  if (SYMBOL_FAMILY.test(name) && !PRIVATE_USE.test(run.text))
    return fallback ?? CLASS_DEFAULT[run.fontClass];
  return KNOWN.get(lower) ?? ALIASES[lower] ?? CLASS_DEFAULT[run.fontClass];
}

/** Does the deck draw this run in a face with the PDF font's own widths? */
export function sameWidths(run: Pick<ScannedRun, "family">): boolean {
  const lower = run.family.trim().toLowerCase();
  if (SYMBOL_FAMILY.test(lower)) return false;
  return KNOWN.has(lower) || METRIC_ALIASES.has(lower);
}

/**
 * The Office family a run's words are written in in Word, or null: an
 * invisible run (an OCR layer), a symbol or dingbat face, and an unknown
 * family whose kind cannot be told name none (see the module docblock). Never a symbol face, so always one of
 * {@link OFFICE_FAMILIES} less those.
 */
export function docxTypefaceOf(
  run: Pick<ScannedRun, "family" | "fontClass" | "text" | "invisible">,
): string | null {
  if (run.invisible) return null;
  const name = run.family.trim();
  if (SYMBOL_FAMILY.test(name)) return null;
  const lower = name.toLowerCase();
  const named = KNOWN.get(lower) ?? ALIASES[lower];
  if (named) return named;
  const kind = docxKindOf(lower, run);
  return kind ? CLASS_DEFAULT[kind] : null;
}

/*
 * ── THE KIND OF A FAMILY WORD DOES NOT KNOW (review of 2026-11-15, round 2)
 *
 * Until round 2, Word took `CLASS_DEFAULT[run.fontClass]` as PowerPoint
 * does. `fontClass` is pdf.js's `fallbackName`, and pdf.js says "serif"
 * only from the Serif flag or its own name list, "monospace" when every
 * width in the font is equal, and "sans-serif" for EVERYTHING ELSE. So
 * "sans" meant "nothing was said", and pdfTeX's CMR10 and CMTT10 (/Flags
 * 4) and pdf.xyz's own Geist Mono pack all came back in Arial, while the
 * page promised a font of the same kind. Now, in Word only:
 *  - the kind is read from the family's NAME ({@link MONO_NAME},
 *    {@link SANS_NAME}, {@link SERIF_NAME}, in that order: "Sans Mono" is
 *    monospaced, "Sans Serif" sans-serif), and from what pdf.js POSITIVELY
 *    saw: "serif", and "monospace" only when the run's own text shows a
 *    narrow and a wide letter ({@link PITCH_NARROW}, {@link PITCH_WIDE}) —
 *    equal widths over a subset of digits, or of one glyph, prove nothing;
 *  - with neither, or when the two disagree, the word names NO typeface
 *    and Word uses its own default. A guess is never written.
 * PowerPoint keeps {@link typefaceFor}: a text box must name some face.
 */
/** Family names that say monospaced. */
const MONO_NAME =
  /\bmono(?:space|spaced)?\b|\bcode\b|typewriter|consol|courier|inconsolata|menlo|monaco|^cm(?:sl|i)?tt\d|^lmmono|\bfixed\b/;
/** Family names that say sans-serif. */
const SANS_NAME = /\bsans\b|^cmss|^lmsans|grotesk|grotesque/;
/** Family names that say serif. */
const SERIF_NAME = /\bserif\b|\broman\b|^cm(?:r|bx|ti|sl|csc|b|u)\d|^lmroman/;
/** Letters narrow in every proportional face… */
const PITCH_NARROW = /[ijlI!.,:;'|]/;
/** …and letters wide in every one: both at one width is monospaced. */
const PITCH_WIDE = /[mwMW]/;

function kindByName(lower: string): FontClass | null {
  if (MONO_NAME.test(lower)) return "mono";
  if (SANS_NAME.test(lower)) return "sans";
  if (SERIF_NAME.test(lower)) return "serif";
  return null;
}

function kindByMark(run: Pick<ScannedRun, "fontClass" | "text">) {
  if (run.fontClass === "serif") return "serif";
  if (
    run.fontClass === "mono" &&
    PITCH_NARROW.test(run.text) &&
    PITCH_WIDE.test(run.text)
  )
    return "mono";
  return null;
}

/** The kind of a family Word does not know, or null when it cannot be told. */
export function docxKindOf(
  lower: string,
  run: Pick<ScannedRun, "fontClass" | "text">,
): FontClass | null {
  const byName = kindByName(lower);
  const byMark = kindByMark(run);
  if (byName && byMark && byName !== byMark) return null;
  return byName ?? byMark;
}

/**
 * A word may take a typeface in Word only if this holds of its text: every
 * letter in it is Latin (digits, punctuation, spaces and other non-letters
 * pass). Bengali, Greek, Cyrillic, Arabic, Hebrew, CJK — any letter outside
 * Latin — fails, and the word keeps its bold, italics, size and colour
 * without a font name, so Word chooses the font for that script.
 */
export const WORD_SCRIPT_SAFE = /^[\p{Script=Latin}\P{L}]*$/u;
