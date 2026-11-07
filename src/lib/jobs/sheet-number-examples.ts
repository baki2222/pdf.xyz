/**
 * The values the PDF to Excel and Extract Tables pages, and their guides,
 * name when they say what becomes a number or a date in the workbook — each
 * one RUN through the writer by `worker-tool-answers.test.ts`, so a sentence
 * naming it cannot outlive the rule.
 *
 * A leaf, imported by tool pages and guides only (server-rendered). Added
 * 2026-11-08 (audit pdf-to-excel#4), when the writer
 * (`workers/ooxml/sheet-cells.ts`) began accepting lakh grouping,
 * accounting negatives and unambiguous dates. The older examples stay in
 * `./pdf-office-export`, which client code imports through `tool-facts.ts`.
 */

/** An amount in Indian lakh grouping, stored as 125000.00. */
export const SHEET_LAKH_EXAMPLE = "₹1,25,000.00";

/** Accounting negatives: a bracketed amount and a trailing minus. */
export const SHEET_NEGATIVE_EXAMPLES = ["(1,250.00)", "1,250.00-"] as const;

/** Dates that cannot be read two ways, stored as real dates. */
export const SHEET_DATE_EXAMPLES = ["2026-01-05", "12 March 2024"] as const;

/** A bare bracketed whole number: a note mark, so it stays text. */
export const SHEET_NOTE_MARK_EXAMPLE = "(3)";
