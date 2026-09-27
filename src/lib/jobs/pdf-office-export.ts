/**
 * What the PDF → Excel export does to a line of text, defined once so the
 * engine that writes the sheet and the tool page that describes it read the
 * same thing.
 *
 * A leaf on purpose: no imports, so `tool-facts.ts` (which ships in the client
 * bundle) can name the sheet and the separators without pulling the engine or
 * JSZip along. `worker-tool-answers.test.ts` RUNS the engine and decodes the
 * XLSX it writes to hold the page's sentence to it — the separators below are
 * checked one by one against the cells that come out, not against this file.
 */

/** The one worksheet the export writes. */
export const XLSX_SHEET_NAME = "Extracted text";

/** Where a line of text is split into cells. */
export const XLSX_CELL_BREAK = /\t| {2,}|,/;

/**
 * {@link XLSX_CELL_BREAK} in words, for the tool page. The test splits a line
 * holding each separator (and a single space, which must NOT split) through
 * the real engine, so this phrase cannot name a separator the engine ignores
 * or leave out one it uses.
 */
export const XLSX_CELL_BREAK_PHRASE =
  "tabs, runs of two or more spaces, and commas";
