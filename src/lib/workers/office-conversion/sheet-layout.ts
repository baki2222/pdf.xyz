/**
 * Excel to PDF's one layout option (audit excel-to-pdf#1, 2026-11-08): put
 * each sheet on ONE page, so wide columns are never split across pages.
 *
 * A LEAF, no imports: the browser panel reads the option key and its label
 * from here, and the worker parses the job's option bag with the same
 * function, so the two cannot disagree about the name or the type. Nothing
 * that every page loads imports it: only the Office panel (Excel's page) and
 * the worker's processor.
 *
 * The worker turns `onePagePerSheet: true` into LibreOffice's own PDF export
 * filter option `SinglePageSheets` (`pdfConvertTarget` in `./native`), which
 * its PDF dialog calls "Whole sheet export". It is a filter option on
 * `--convert-to`, so the workbook itself is never edited and no macro runs.
 * What that option does, as LibreOffice documents it, is what the hint and
 * the page's FAQ say: each sheet's paper size and print ranges are ignored,
 * and every sheet, hidden ones included, becomes exactly one page as large as
 * its content.
 *
 * NOT offered, and why: an orientation choice, or "fit all columns to the
 * page width" with rows still flowing onto further pages. LibreOffice has no
 * export option for either; both are page-style settings, reachable only by
 * a macro or by rewriting the workbook before conversion, which this change
 * does not do.
 *
 * `{}` is the job exactly as it ran before the option existed.
 */

/** The key in the job's `options` bag. */
export const ONE_PAGE_PER_SHEET_OPTION = "onePagePerSheet";

/** The checkbox's visible name, on the panel and in the page copy. */
export const ONE_PAGE_PER_SHEET_LABEL = "Put each sheet on one page";

/** The sentence under the checkbox. True of LibreOffice's SinglePageSheets. */
export const ONE_PAGE_PER_SHEET_HINT =
  "Nothing is split across pages: each sheet becomes one page as large as its content, so a long sheet makes a long page. Print areas are ignored and hidden sheets are included.";

export interface SheetLayout {
  onePagePerSheet: boolean;
}

export const DEFAULT_SHEET_LAYOUT: SheetLayout = { onePagePerSheet: false };

export type SheetLayoutParse =
  { ok: true; value: SheetLayout } | { ok: false; message: string };

/**
 * Read the option from a job's raw option bag. Absent is the default; any
 * value other than a boolean is refused rather than coerced, because "the
 * string 'false'" read as truthy would change a user's output.
 */
export function parseSheetLayout(
  options: Record<string, unknown>,
): SheetLayoutParse {
  const raw = options[ONE_PAGE_PER_SHEET_OPTION];
  if (raw === undefined) return { ok: true, value: DEFAULT_SHEET_LAYOUT };
  if (typeof raw !== "boolean")
    return {
      ok: false,
      message: `\`options.${ONE_PAGE_PER_SHEET_OPTION}\` must be true or false.`,
    };
  return { ok: true, value: { onePagePerSheet: raw } };
}

/**
 * The panel's checkboxes, as a list it maps over: today one. A list so the
 * copy guard that holds "tick X" sentences to real checkboxes
 * (`tick-label-claims.test.ts`) reads the label the panel renders from here,
 * not a typed copy of it.
 */
export const SHEET_LAYOUT_CHECKBOXES = [
  {
    option: ONE_PAGE_PER_SHEET_OPTION,
    label: ONE_PAGE_PER_SHEET_LABEL,
    hint: ONE_PAGE_PER_SHEET_HINT,
  },
] as const;
