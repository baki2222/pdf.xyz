/**
 * The deployment proof's question for the wave-3 number cells (audit
 * pdf-to-excel#4, 2026-11-08): does the workbook a user downloads store an
 * amount in lakh grouping, an accounting negative and an unambiguous date as
 * a NUMBER — and leave an ambiguous date and a note mark as the text printed?
 *
 * Both PDF to Excel and Extract Tables write their cells through
 * `./sheet-cells`, so one table, drawn from these rows, is sent through both
 * and judged here by the same function. The inputs are the examples the tool
 * pages name (`@/lib/jobs/sheet-number-examples`), so a page sentence and the
 * proof cannot drift apart.
 *
 * The expected values are written out here, NOT computed by the writer's
 * `parseSheetNumber`: a writer cannot certify itself. 46027 is 2026-01-05
 * counted from Excel's 1899-12-30 day zero; 45363 is 2024-03-12.
 *
 * The defect each row catches is the image before the feature: every one of
 * the five number rows came back as an inline string (`₹1,25,000.00` text,
 * `SUM` = 0), which a check of "a valid XLSX" passes.
 */
import {
  SHEET_DATE_EXAMPLES,
  SHEET_LAKH_EXAMPLE,
  SHEET_NEGATIVE_EXAMPLES,
  SHEET_NOTE_MARK_EXAMPLE,
} from "@/lib/jobs/sheet-number-examples";
import type { SheetRead } from "./sheet-read";

/** The slashed date: the 5th of January or the 1st of May, so text. */
export const SHEET_AMBIGUOUS_DATE = "05/01/2026";

/** The table both tools are sent: a label, then the printed value. */
export const NUMBER_CELL_ROWS: readonly (readonly [string, string])[] = [
  ["Entry", "Amount"],
  ["Lakh", SHEET_LAKH_EXAMPLE],
  ["Bracketed", SHEET_NEGATIVE_EXAMPLES[0]],
  ["Trailing minus", SHEET_NEGATIVE_EXAMPLES[1]],
  ["ISO date", SHEET_DATE_EXAMPLES[0]],
  ["Named date", SHEET_DATE_EXAMPLES[1]],
  ["Slashed date", SHEET_AMBIGUOUS_DATE],
  ["Note mark", SHEET_NOTE_MARK_EXAMPLE],
];

export type NumberCellExpectation =
  | {
      type: "number";
      value: string;
      /** What the display format must show, in words, and the test of it. */
      shows: string;
      format: (code: string) => boolean;
    }
  | { type: "text"; value: string };

/** What each labelled row's value cell must be, read back. */
export const NUMBER_CELL_EXPECTED: Record<string, NumberCellExpectation> = {
  Lakh: {
    type: "number",
    value: "125000.00",
    shows: "lakh grouping",
    // The lakh step: a conditional section from 1,00,000 that groups by two.
    format: (code) => code.includes("[>=100000]") && code.includes("##\\,##"),
  },
  Bracketed: {
    type: "number",
    value: "-1250.00",
    shows: "the negative in brackets",
    format: (code) => /;\(.*\)$/.test(code),
  },
  "Trailing minus": {
    type: "number",
    value: "-1250.00",
    shows: "the negative with a trailing minus",
    format: (code) => /;[^;]*-$/.test(code),
  },
  "ISO date": {
    type: "number",
    value: "46027",
    shows: "a date",
    format: (code) => /y{2,4}/.test(code) && /d/.test(code),
  },
  "Named date": {
    type: "number",
    value: "45363",
    shows: "a date",
    format: (code) => /y{2,4}/.test(code) && /m{3,4}/.test(code),
  },
  "Slashed date": { type: "text", value: SHEET_AMBIGUOUS_DATE },
  "Note mark": { type: "text", value: SHEET_NOTE_MARK_EXAMPLE },
};

/**
 * Where `sheet` differs from {@link NUMBER_CELL_EXPECTED}, one line each.
 * Each label is found as the first cell of a row; its value is the LAST cell
 * of that row (a layout may put phantom gaps between them, never after). A
 * missing label is a problem, so an empty or unreadable sheet cannot pass.
 */
export function numberCellProblems(sheet: SheetRead): string[] {
  const problems: string[] = [];
  for (const [label, want] of Object.entries(NUMBER_CELL_EXPECTED)) {
    const row = sheet.rows.find(
      (r) => r.cells[0]?.type === "text" && r.cells[0].value.trim() === label,
    );
    if (!row || row.cells.length < 2) {
      problems.push(`no "${label}" row with a value`);
      continue;
    }
    const cell = row.cells[row.cells.length - 1]!;
    if (cell.type !== want.type || cell.value !== want.value) {
      problems.push(
        `${label}: ${cell.type} ${JSON.stringify(cell.value)}, expected ${want.type} ${JSON.stringify(want.value)}`,
      );
      continue;
    }
    if (want.type === "number" && !want.format(cell.format))
      problems.push(
        `${label}: stored ${cell.value} but formatted ${JSON.stringify(cell.format)}, which does not show ${want.shows}`,
      );
  }
  return problems;
}
