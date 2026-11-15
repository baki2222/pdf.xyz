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
 * {@link docxTypefaceOf} is the same mapping with two refusals: an invisible
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
 * invisible run (an OCR layer) and a symbol or dingbat face name none (see
 * the module docblock). Never a symbol face, so always one of
 * {@link OFFICE_FAMILIES} less those.
 */
export function docxTypefaceOf(
  run: Pick<ScannedRun, "family" | "fontClass" | "text" | "invisible">,
): string | null {
  if (run.invisible) return null;
  if (SYMBOL_FAMILY.test(run.family.trim())) return null;
  return typefaceFor(run);
}

/**
 * A word may take a typeface in Word only if this holds of its text: every
 * letter in it is Latin (digits, punctuation, spaces and other non-letters
 * pass). Bengali, Greek, Cyrillic, Arabic, Hebrew, CJK — any letter outside
 * Latin — fails, and the word keeps its bold, italics, size and colour
 * without a font name, so Word chooses the font for that script.
 */
export const WORD_SCRIPT_SAFE = /^[\p{Script=Latin}\P{L}]*$/u;
