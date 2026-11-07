/**
 * PDF to Excel's one option, "One sheet per page", in the words the panel
 * and the tool page use — and the parser the worker runs on the job's
 * options bag.
 *
 * A leaf on purpose (it imports only `./responses`): the export panel, the
 * tool page and the worker import it; `./pdf-office-export`, which client
 * code imports through `tool-facts.ts`, does not.
 *
 * Added 2026-11-08 (audit pdf-to-excel#3). Until then every page went into
 * the one sheet with no boundary, so a user could not tell where a page
 * started, and page headers and footers mixed into the data rows.
 */
import { apiError, type ParseResult } from "./responses";

/**
 * The checkbox's label, quoted by the page. The panel renders the same words
 * as JSX text, which `tick-label-claims.test.ts` reads.
 */
export const SHEET_PER_PAGE_LABEL = "One sheet per page";

/** The tab name of page `n`'s sheet when the option is on. */
export function pageSheetName(pageNumber: number): string {
  return `Page ${pageNumber}`;
}

/** What the option does, under its label and on the page. */
export const SHEET_PER_PAGE_HINT = `Each page of the PDF gets its own sheet, named ${pageSheetName(1)}, ${pageSheetName(2)} and so on, so you can see where every page starts. A page with no text gets an empty sheet, so the numbers still match.`;

export interface PdfToExcelOptions {
  sheetPerPage: boolean;
}

/**
 * Parse a `pdf-to-excel` job's options. An empty bag is today's request (one
 * sheet); `sheetPerPage` must be a boolean when sent.
 */
export function parsePdfToExcelOptions(
  options: Record<string, unknown>,
): ParseResult<PdfToExcelOptions> {
  const raw = options.sheetPerPage;
  if (raw !== undefined && typeof raw !== "boolean") {
    const message = "`options.sheetPerPage` must be a boolean.";
    return {
      ok: false,
      error: apiError("invalid_request", message, [
        { field: "options.sheetPerPage", message },
      ]),
    };
  }
  return { ok: true, value: { sheetPerPage: raw === true } };
}
