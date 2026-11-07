/**
 * Extract Tables' one option, "Combine tables into one sheet", in the words
 * the panel and the tool page use — and the parser the worker runs on the
 * job's options bag. One definition, so the label a user ticks, the sentence
 * the page says about it, and the file the worker writes cannot drift apart.
 *
 * A leaf on purpose (it imports only `./responses`, which imports nothing):
 * the Extract Tables panel imports it, and nothing first-load or shared does.
 *
 * Added 2026-11-08 (audit extract-tables#2). Until then every detected table
 * became its own CSV and sheet, so a 12-page statement came back as 12 or
 * more sheets each repeating the header, and the FAQ told users to stack them
 * by hand.
 */
import { apiError, type ParseResult } from "./responses";

/**
 * The checkbox's label, quoted by the page. The panel renders the same words
 * as JSX text, which `tick-label-claims.test.ts` reads: a page telling the
 * reader to tick this label fails there unless a checkbox renders it.
 */
export const COMBINE_TABLES_LABEL = "Combine tables into one sheet";

/** The sheet the combined workbook holds. */
export const COMBINED_SHEET_NAME = "All tables";
/**
 * The ZIP entry the combined CSV is written to — a record, so
 * `output-honesty.test.ts` can resolve the name the engine passes to
 * `zip.file`.
 */
export const COMBINED_ZIP_FILES = { csv: "tables.csv" } as const;
export const COMBINED_CSV_NAME = COMBINED_ZIP_FILES.csv;

/** What the option does, under its label and on the page. */
export const COMBINE_TABLES_HINT = `Every table goes on one sheet, “${COMBINED_SHEET_NAME}”, and into one ${COMBINED_CSV_NAME}, in page order with an empty row between tables. A table that carries on onto the next page under the same header row is joined into one, and the repeated header is left out.`;

export interface ExtractTablesOptions {
  combine: boolean;
}

/**
 * Parse an `extract-tables` job's options. An empty bag is today's request
 * (one sheet and one CSV per table); `combine` must be a boolean when sent.
 */
export function parseExtractTablesOptions(
  options: Record<string, unknown>,
): ParseResult<ExtractTablesOptions> {
  const raw = options.combine;
  if (raw !== undefined && typeof raw !== "boolean") {
    const message = "`options.combine` must be a boolean.";
    return {
      ok: false,
      error: apiError("invalid_request", message, [
        { field: "options.combine", message },
      ]),
    };
  }
  return { ok: true, value: { combine: raw === true } };
}
