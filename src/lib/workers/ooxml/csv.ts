import { parseSheetNumber } from "./sheet-cells";

/*
 * CSV writing, shared by Extract Tables (table-N.csv, written on our server)
 * and AI Data Extraction (extraction CSV, built in the browser from the
 * package). One definition, so a formula-neutralising rule cannot be fixed
 * in one file and left live in the other. Moved here from
 * table-extract/engine.ts on 2026-11-07, unchanged; that module re-exports it.
 */

/** The UTF-8 byte-order mark each table-N.csv starts with. */
export const CSV_BOM = String.fromCharCode(0xfeff);

/**
 * The printable characters that make Excel and LibreOffice read a CSV cell as
 * a FORMULA (OWASP, "CSV Injection"). Quoting does not stop it. Exported so
 * the Extract Tables FAQ names exactly these.
 */
export const CSV_FORMULA_LEADS = ["=", "+", "-", "@"] as const;

/** {@link CSV_FORMULA_LEADS} plus the tab and carriage return OWASP adds. */
const FORMULA_LEAD = new Set<string>([...CSV_FORMULA_LEADS, "\t", "\r"]);

/**
 * A CSV cell, RFC-4180 quoted, and never a live formula (audit #31).
 *
 * A PDF from anywhere can carry `=HYPERLINK(…)` or a DDE string, and until
 * 2026-11-06 it reached table-N.csv raw, to be evaluated on open. A cell with a
 * formula lead now gets a leading apostrophe, as OWASP recommends, unless it is
 * a value the workbook stores as a number (`-4`, `-1,250.00`, the shared
 * {@link parseSheetNumber}) or a lone `-`, the usual nil: neither is a formula,
 * and both stay exactly as printed. tables.xlsx needs none of this, since its
 * text cells are inline strings.
 */
function csvCell(value: string): string {
  const neutralised =
    FORMULA_LEAD.has(value.charAt(0)) &&
    value !== "-" &&
    !parseSheetNumber(value);
  const text = neutralised ? `'${value}` : value;
  return neutralised || /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

/**
 * Serialize rows to an RFC-4180 CSV string: CRLF row separators, no trailing
 * CRLF, formula-leading cells neutralised. The file's byte-order mark is added
 * by {@link buildTablesZip}, not here.
 */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
