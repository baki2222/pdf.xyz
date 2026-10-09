/**
 * What the PDF → Excel export does to a line of text, in the words the tool
 * page uses — kept here so the page's sentences and the test that runs the
 * engine against them read one definition.
 *
 * A leaf on purpose: no imports, so `tool-facts.ts` (which ships in the client
 * bundle) can name the sheet, the cell breaks and the examples without pulling
 * the engine or JSZip along. `worker-tool-answers.test.ts` RUNS the engine and
 * decodes the XLSX it writes: every break named below must split a cell, a
 * break NOT named (a comma, a single space) must not, and every example must
 * come out as the kind of cell the page says it does.
 *
 * HISTORY. Until the wave-1 L03 merge (2026-09-28) this module also held the
 * engine's split regex, `\t| {2,}|,`, which the engine read and the page
 * described ("tabs, runs of two or more spaces, and commas"). L03 replaced
 * that split with column placement by position
 * (`workers/pdf-office-export/layout-grid.ts`), which never splits at a comma
 * and keeps an empty cell in its column. The regex had no reader left and was
 * removed; the phrase now describes what the grid does, and is held to it by
 * running the engine, not by reading a constant.
 */

/** The one worksheet the export writes. */
export const XLSX_SHEET_NAME = "Extracted text";

/** Where a line of text breaks into cells, for the tool page. */
export const XLSX_CELL_BREAK_PHRASE = "tabs and runs of two or more spaces";

/** Values the page says are stored as numbers — each one run by the test. */
export const XLSX_NUMBER_EXAMPLES = ["1,250.00", "$4.20", "15%"] as const;

/**
 * The limits `workers/pdf-office-export/layout-grid.ts` lists as NOT
 * promised, said wherever the page describes the grid.
 * `claims-vs-capability.test.ts` runs a straddling cell through the engine and
 * requires the merge this sentence warns about.
 */
export const XLSX_MERGE_CAVEAT =
  "Where one cell runs across a column boundary, or a table starts on a page's first line, columns can merge — check them against the PDF.";

/** A value the page says stays text — run by the same test. */
export const XLSX_TEXT_EXAMPLE = "2026-01-05";
