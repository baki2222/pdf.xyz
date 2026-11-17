/**
 * Excel to PDF's CSV import choices (competitor audit backlog #18): which
 * character separates the fields of a .csv, and which character set its
 * bytes are in.
 *
 * Before this, every CSV was read as comma-separated, so a semicolon CSV
 * (what Excel saves in much of Europe) printed as one column of whole lines,
 * and any CSV whose bytes were not UTF-8 was read as Windows-1252, so a
 * Cyrillic, Central European or Japanese file printed as the wrong letters.
 *
 * A LEAF, no imports, like `./sheet-layout`: the browser panel reads the
 * option keys, labels and choices from here, and the job API and the worker
 * parse the job's option bag with the same function, so the three cannot
 * disagree about a name or a value. What each choice means to LibreOffice
 * (its separator and character-set codes) and the auto-detection live on the
 * worker side, in `./csv-filter`, which the browser never loads.
 *
 * `{}` (both absent) is "Auto-detect" and "Auto": the job a page that never
 * offered the choice sends.
 */

/** The keys in the job's `options` bag. */
export const CSV_DELIMITER_OPTION = "csvDelimiter";
export const CSV_CHARSET_OPTION = "csvCharset";

/** The selects' visible names, on the panel and in the page copy. */
export const CSV_DELIMITER_LABEL = "Delimiter";
export const CSV_CHARSET_LABEL = "Character set";

/** The value that means "decide from the file"; the same as leaving it out. */
export const CSV_AUTO = "auto";

export type CsvDelimiter = "comma" | "semicolon" | "tab" | "pipe";
export type CsvCharset =
  | "utf-8"
  | "windows-1252"
  | "iso-8859-2"
  | "windows-1251"
  | "shift-jis"
  | "utf-16";

/** The delimiter select's choices, Auto-detect first. */
export const CSV_DELIMITERS: ReadonlyArray<{
  readonly value: CsvDelimiter | null;
  readonly label: string;
}> = [
  { value: null, label: "Auto-detect" },
  { value: "comma", label: "Comma" },
  { value: "semicolon", label: "Semicolon" },
  { value: "tab", label: "Tab" },
  { value: "pipe", label: "Pipe" },
];

/** The character-set select's choices, Auto first. */
export const CSV_CHARSETS: ReadonlyArray<{
  readonly value: CsvCharset | null;
  readonly label: string;
}> = [
  { value: null, label: "Auto" },
  { value: "utf-8", label: "UTF-8" },
  { value: "windows-1252", label: "Windows-1252 (Western European)" },
  { value: "iso-8859-2", label: "ISO-8859-2 (Central European)" },
  { value: "windows-1251", label: "Windows-1251 (Cyrillic)" },
  { value: "shift-jis", label: "Shift-JIS (Japanese)" },
  { value: "utf-16", label: "UTF-16" },
];

/** The sentence under the two selects. True of `./csv-filter`'s auto rules. */
export const CSV_IMPORT_HINT =
  "Auto-detect looks at the first lines and picks the separator they all share, or a comma. Auto reads UTF-8, UTF-16 that starts with a byte-order mark, and anything else as Windows-1252; choose the character set when letters come out wrong.";

/** The extensions these choices apply to. */
export const CSV_IMPORT_EXTENSIONS = ["csv"] as const;

/** True when the delimiter and character set apply to a file of this name. */
export function acceptsCsvImport(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return (CSV_IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

export interface CsvImportChoice {
  /** Null: detect it from the file. */
  delimiter: CsvDelimiter | null;
  /** Null: UTF-8 or UTF-16 when the bytes say so, Windows-1252 otherwise. */
  charset: CsvCharset | null;
}

export const DEFAULT_CSV_IMPORT: CsvImportChoice = {
  delimiter: null,
  charset: null,
};

/** True when the choice asks for something other than auto. */
export function choosesCsvImport(choice: CsvImportChoice | undefined): boolean {
  return !!choice && (choice.delimiter !== null || choice.charset !== null);
}

/** True when a job's option bag carries either key at all. */
export function carriesCsvImportOptions(
  options: Record<string, unknown> | undefined,
): boolean {
  return (
    !!options &&
    (options[CSV_DELIMITER_OPTION] !== undefined ||
      options[CSV_CHARSET_OPTION] !== undefined)
  );
}

export type CsvImportParse =
  | { ok: true; value: CsvImportChoice }
  | { ok: false; field: string; message: string };

const quoted = (values: readonly (string | null)[]) =>
  [CSV_AUTO, ...values.filter((v): v is string => v !== null)]
    .map((v) => `"${v}"`)
    .join(", ");

function pick<T extends string>(
  raw: unknown,
  choices: ReadonlyArray<{ readonly value: T | null }>,
): { ok: true; value: T | null } | { ok: false } {
  if (raw === undefined || raw === CSV_AUTO) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const found = choices.find((c) => c.value === raw);
  return found ? { ok: true, value: found.value } : { ok: false };
}

/**
 * Read the choices from a job's raw option bag. Absent, or "auto", is the
 * default; anything that is not one of the listed values is refused rather
 * than read as auto, because a mistyped "semicolon" quietly printed as one
 * column is the very defect these choices exist to fix.
 */
export function parseCsvImportChoice(
  options: Record<string, unknown>,
): CsvImportParse {
  const delimiter = pick(options[CSV_DELIMITER_OPTION], CSV_DELIMITERS);
  if (!delimiter.ok)
    return {
      ok: false,
      field: `options.${CSV_DELIMITER_OPTION}`,
      message: `\`options.${CSV_DELIMITER_OPTION}\` must be one of ${quoted(CSV_DELIMITERS.map((d) => d.value))}.`,
    };
  const charset = pick(options[CSV_CHARSET_OPTION], CSV_CHARSETS);
  if (!charset.ok)
    return {
      ok: false,
      field: `options.${CSV_CHARSET_OPTION}`,
      message: `\`options.${CSV_CHARSET_OPTION}\` must be one of ${quoted(CSV_CHARSETS.map((c) => c.value))}.`,
    };
  return {
    ok: true,
    value: { delimiter: delimiter.value, charset: charset.value },
  };
}

/** The worker's refusal of a choice on a file that is not a .csv. */
export const CSV_IMPORT_CSV_ONLY_MESSAGE = `${CSV_DELIMITER_LABEL} and ${CSV_CHARSET_LABEL} work on .csv files only, so this file was not converted. Convert it without them.`;

/**
 * The job API's refusal of a CSV choice while the running worker does not
 * prove `csvImportOptions` (`runningWorkerReadsCsvImportOptions`). An image
 * built before the choices ignores both keys and reads every CSV as
 * comma-separated, so the job is refused rather than run the wrong way.
 */
export const CSV_IMPORT_NOT_RUNNING_MESSAGE = `Choosing the ${CSV_DELIMITER_LABEL.toLowerCase()} or ${CSV_CHARSET_LABEL.toLowerCase()} is not available on our server right now. Convert the file with both on Auto, or try again later.`;
