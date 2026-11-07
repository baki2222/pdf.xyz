/**
 * Excel to PDF's layout options (audit excel-to-pdf#1, 2026-11-08): put
 * each sheet on ONE page, or, for an .xlsx, set its orientation and fit
 * every column across the page width.
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
 * Orientation (as the file sets it, portrait or landscape) and "fit all
 * columns on the page width" (review 2026-11-08) have no export filter
 * option, so the worker writes them into each worksheet's page setup before
 * LibreOffice opens the file (`./xlsx-page-setup`). That rewrite exists only
 * for .xlsx ({@link PAGE_SETUP_EXTENSIONS}); the panel offers the two
 * controls only for such a file, and the worker refuses them on anything
 * else. They do nothing beside one page per sheet, which ignores page
 * setup, so the panel sends them only when that box is clear and the
 * worker refuses the combination.
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

/** The keys for orientation and fit-to-width in the job's `options` bag. */
export const ORIENTATION_OPTION = "orientation";
export const FIT_COLUMNS_TO_WIDTH_OPTION = "fitColumnsToWidth";

export type SheetOrientation = "portrait" | "landscape";

/** The orientation select's name, and its choices; null keeps the file's. */
export const ORIENTATION_LABEL = "Orientation";
export const SHEET_ORIENTATIONS: ReadonlyArray<{
  readonly value: SheetOrientation | null;
  readonly label: string;
}> = [
  { value: null, label: "As the file sets it" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

/** "Portrait or Landscape": the choices that change the file's, for copy. */
export const ORIENTATION_CHOICE_WORDS = SHEET_ORIENTATIONS.flatMap((o) =>
  o.value ? [o.label] : [],
).join(" or ");

/** The fit checkbox's visible name, and the sentence under it. */
export const FIT_COLUMNS_TO_WIDTH_LABEL = "Fit all columns on the page width";
export const FIT_COLUMNS_TO_WIDTH_HINT =
  "Each sheet is scaled down until every column fits across the page; rows carry on to further pages as needed.";

/** The extensions whose page setup the worker can rewrite. */
export const PAGE_SETUP_EXTENSIONS = ["xlsx"] as const;

/** True when orientation and fit-to-width can apply to a file of this name. */
export function acceptsPageSetup(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return (PAGE_SETUP_EXTENSIONS as readonly string[]).includes(ext);
}

/** Shown in place of the two controls when the chosen file is not .xlsx. */
export const PAGE_SETUP_XLSX_ONLY_NOTE = `${ORIENTATION_LABEL} and ${FIT_COLUMNS_TO_WIDTH_LABEL} work on ${PAGE_SETUP_EXTENSIONS.map((e) => `.${e}`).join(", ")} files. This file keeps the page setup saved in it.`;

export interface SheetLayout {
  onePagePerSheet: boolean;
  orientation: SheetOrientation | null;
  fitColumnsToWidth: boolean;
}

export const DEFAULT_SHEET_LAYOUT: SheetLayout = {
  onePagePerSheet: false,
  orientation: null,
  fitColumnsToWidth: false,
};

/** True when the worker must rewrite the workbook's page setup. */
export function needsPageSetup(layout: SheetLayout | undefined): boolean {
  return !!layout && (layout.orientation !== null || layout.fitColumnsToWidth);
}

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
  const one = options[ONE_PAGE_PER_SHEET_OPTION];
  const orientation = options[ORIENTATION_OPTION];
  const fit = options[FIT_COLUMNS_TO_WIDTH_OPTION];
  if (one !== undefined && typeof one !== "boolean")
    return {
      ok: false,
      message: `\`options.${ONE_PAGE_PER_SHEET_OPTION}\` must be true or false.`,
    };
  if (fit !== undefined && typeof fit !== "boolean")
    return {
      ok: false,
      message: `\`options.${FIT_COLUMNS_TO_WIDTH_OPTION}\` must be true or false.`,
    };
  if (
    orientation !== undefined &&
    orientation !== "portrait" &&
    orientation !== "landscape"
  )
    return {
      ok: false,
      message: `\`options.${ORIENTATION_OPTION}\` must be "portrait" or "landscape".`,
    };
  const value: SheetLayout = {
    onePagePerSheet: one === true,
    orientation: orientation ?? null,
    fitColumnsToWidth: fit === true,
  };
  if (value.onePagePerSheet && needsPageSetup(value))
    return {
      ok: false,
      message: `${ONE_PAGE_PER_SHEET_LABEL} ignores page setup, so it cannot be combined with ${ORIENTATION_LABEL} or ${FIT_COLUMNS_TO_WIDTH_LABEL}.`,
    };
  return { ok: true, value };
}

/**
 * The panel's checkboxes, as a list it maps over, each keyed by its own
 * option. A list so the copy guard that holds "tick X" sentences to real
 * checkboxes (`tick-label-claims.test.ts`) reads the labels the panel
 * renders from here, not typed copies of them.
 */
export const SHEET_LAYOUT_CHECKBOXES = [
  {
    option: ONE_PAGE_PER_SHEET_OPTION,
    label: ONE_PAGE_PER_SHEET_LABEL,
    hint: ONE_PAGE_PER_SHEET_HINT,
  },
  {
    option: FIT_COLUMNS_TO_WIDTH_OPTION,
    label: FIT_COLUMNS_TO_WIDTH_LABEL,
    hint: FIT_COLUMNS_TO_WIDTH_HINT,
  },
] as const;
