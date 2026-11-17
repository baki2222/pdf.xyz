/**
 * The LibreOffice CSV import filter a .csv is opened with, built from the
 * job's choices (`./csv-import`) and, where a choice is Auto, from the file.
 *
 * ── THE TOKEN ────────────────────────────────────────────────────────────────
 * `--infilter=Text - txt - csv (StarCalc):<seps>,<quote>,<charset>,<line>,,0,false,false`,
 * the first eight of the CSV filter's comma-separated option tokens, as
 * LibreOffice 7.4 reads them (`ScAsciiOptions::ReadFromString`,
 * sc/source/ui/dbgui/asciiopt.cxx, read 2026-11-17):
 *
 *   1. field separators, each as its ASCII code (`lcl_decodeSepString`):
 *      comma 44, semicolon 59, tab 9, pipe 124;
 *   2. the text delimiter, as its code: 34, the double quote;
 *   3. the character set, as LibreOffice's numeric text-encoding id
 *      (`ScGlobal::GetCharsetValue` casts a number straight to
 *      `rtl_TextEncoding`), whose values are in include/rtl/textenc.h:
 *      RTL_TEXTENCODING_MS_1252 = 1, ISO_8859_2 = 13, MS_1251 = 34,
 *      SHIFT_JIS = 64, UTF8 = 76, UCS2 (= UNICODE, UTF-16) = 0xFFFF;
 *   4. the line to start reading on: 1, or 2 past an Excel `sep=` line;
 *   5. column formats: none (empty);
 *   6. the language numbers are read in: 0, the system's;
 *   7. quoted fields as text: false;
 *   8. detect special numbers (dates, fractions, percentages, scientific
 *      notation): false.
 *
 * Tokens 5 to 8 are what an import with NO options does, and they must be
 * written: a token string that stops after token 4 leaves "detect special
 * numbers" ON. Measured in the live worker image (sha256:78faaf08, LO
 * 7.4.7.2, 2026-11-17), the ASCII row `1/2/2026,1e5,12%,1/2` printed as
 * `01/02/26 1.00E+05 12.00% 01/02/26` with `44,34,1,1`, and as
 * `1/2/2026 100000 12% 1/2` with no options or `44,34,1,1,,0,false,false`.
 * WAS, 2026-11-07 to 2026-11-17: four tokens (`44,34,76,1` for a UTF-8 file
 * from 2026-11-07, every .csv from this module's first version), and this
 * header called that "the same import" as no options; only the option
 * string was ever compared, never the output. The in-image proof now
 * compares the output (`./input-proof`, "csv default import").
 *
 * With NO filter options, `ScDocShell::ConvertFrom` imports a CSV as
 * MS_1252, comma, double quote (sc/source/ui/docshell/docsh.cxx), the
 * Western default production measured on 2026-11-07. So a CSV whose choices
 * are both Auto and whose bytes are not UTF-8 gets
 * `44,34,1,1,,0,false,false`, which prints what no options printed. Every
 * .csv now gets a token; nothing else ever does.
 *
 * ── AUTO ─────────────────────────────────────────────────────────────────────
 * Character set: UTF-16 when the file starts with a UTF-16 byte-order mark,
 * UTF-8 when it holds non-ASCII bytes that decode as UTF-8 (the 2026-11-07
 * rule, unchanged), Windows-1252 otherwise.
 *
 * Delimiter ({@link sniffCsvDelimiter}): deterministic and bounded. A first
 * line that is Excel's `sep=X` hint, X one of the four, is the answer, and
 * reading starts on line 2 so the hint is not printed (with a chosen
 * delimiter too). Otherwise it reads at most {@link CSV_SNIFF_MAX_BYTES}
 * bytes and {@link CSV_SNIFF_MAX_RECORDS} records, counts each candidate
 * OUTSIDE double quotes per record, and drops the leading records that hold
 * no candidate at all (a title line above the table). A candidate's usual
 * count is the non-zero count found on the most records (the larger on a
 * tie), and it qualifies when MORE THAN HALF the records hold exactly that
 * count, so one short row or one note line does not throw it out. The
 * candidate on the most records wins, then the larger count, then the
 * earlier of tab, semicolon, comma, pipe (a file with one semicolon and one
 * decimal comma on every line is a European export, so semicolon beats
 * comma). None qualifies: comma, the filter's own default. WAS, until the
 * 2026-11-17 review: a candidate had to hold the same count on EVERY
 * record, so a bank export with one title line or one ragged row fell back
 * to comma and printed as one column.
 */
import type { CsvCharset, CsvDelimiter, CsvImportChoice } from "./csv-import";

/** LibreOffice's CSV import filter name, as `--infilter` takes it. */
export const CSV_FILTER_NAME = "Text - txt - csv (StarCalc)";

/** Token 1: each delimiter's ASCII code. */
export const CSV_DELIMITER_CODES: Readonly<Record<CsvDelimiter, number>> = {
  comma: 44,
  semicolon: 59,
  tab: 9,
  pipe: 124,
};

/** Token 3: each character set's LibreOffice text-encoding id (rtl/textenc.h). */
export const CSV_CHARSET_IDS: Readonly<Record<CsvCharset, number>> = {
  "utf-8": 76,
  "windows-1252": 1,
  "iso-8859-2": 13,
  "windows-1251": 34,
  "shift-jis": 64,
  "utf-16": 0xffff,
};

/** Token 2: the double quote. */
const TEXT_DELIMITER_CODE = 34;

/**
 * Tokens 5 to 8: no column formats, the system language, quoted fields not
 * forced to text, special numbers NOT detected. See the header: left out,
 * LibreOffice detects special numbers, which an import with no options
 * does not.
 */
export const CSV_NO_OPTIONS_SUFFIX = ",,0,false,false";

/** The option string for one delimiter, character set and first line. */
export function csvFilterOptions(
  delimiter: CsvDelimiter,
  charset: CsvCharset,
  firstLine = 1,
): string {
  return `${CSV_DELIMITER_CODES[delimiter]},${TEXT_DELIMITER_CODE},${CSV_CHARSET_IDS[charset]},${firstLine}${CSV_NO_OPTIONS_SUFFIX}`;
}

/** The whole `--infilter` value for one delimiter, character set and first line. */
export function csvInfilter(
  delimiter: CsvDelimiter,
  charset: CsvCharset,
  firstLine = 1,
): string {
  return `${CSV_FILTER_NAME}:${csvFilterOptions(delimiter, charset, firstLine)}`;
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Auto's character set for these bytes. See the header. */
export function detectCsvCharset(input: Uint8Array): CsvCharset {
  const [a, b] = input;
  if ((a === 0xff && b === 0xfe) || (a === 0xfe && b === 0xff)) return "utf-16";
  if (input.every((byte) => byte < 0x80)) return "windows-1252";
  try {
    STRICT_UTF8.decode(input);
  } catch {
    return "windows-1252";
  }
  return "utf-8";
}

export const CSV_SNIFF_MAX_BYTES = 64 * 1024;
export const CSV_SNIFF_MAX_RECORDS = 50;

/** Tie-break order. See the header. */
export const CSV_SNIFF_ORDER: readonly CsvDelimiter[] = [
  "tab",
  "semicolon",
  "comma",
  "pipe",
];

/** Any unit that is not an ASCII character. */
const OTHER = 0x100;

/**
 * The file's first characters as ASCII codes (anything else as one OTHER),
 * read in its character set, so a byte inside a multi-byte character is
 * never counted as a separator: the second byte of a Shift-JIS character can
 * be 0x7C, the pipe, and either byte of a UTF-16 one can be anything.
 * UTF-8 and the single-byte sets keep ASCII bytes as themselves.
 */
function asciiUnits(input: Uint8Array, charset: CsvCharset): number[] {
  const bytes = input.subarray(0, CSV_SNIFF_MAX_BYTES);
  const out: number[] = [];
  if (charset === "utf-16") {
    const big = bytes[0] === 0xfe && bytes[1] === 0xff;
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const unit = big
        ? (bytes[i]! << 8) | bytes[i + 1]!
        : bytes[i]! | (bytes[i + 1]! << 8);
      out.push(unit < 0x80 ? unit : OTHER);
    }
    return out;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    if (
      charset === "shift-jis" &&
      ((byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc))
    ) {
      out.push(OTHER);
      i += 1;
      continue;
    }
    out.push(byte < 0x80 ? byte : OTHER);
  }
  return out;
}

/** Per record, how many times each candidate appears outside quotes. */
export function countCsvDelimiters(
  input: Uint8Array,
  charset: CsvCharset,
): Array<Record<CsvDelimiter, number>> {
  const units = asciiUnits(input, charset);
  const truncated = input.byteLength > CSV_SNIFF_MAX_BYTES;
  const records: Array<Record<CsvDelimiter, number>> = [];
  const fresh = () => ({ comma: 0, semicolon: 0, tab: 0, pipe: 0 });
  let current = fresh();
  let length = 0;
  let inQuotes = false;
  for (const unit of units) {
    if (records.length >= CSV_SNIFF_MAX_RECORDS) return records;
    if (unit === TEXT_DELIMITER_CODE) {
      inQuotes = !inQuotes;
      length += 1;
      continue;
    }
    if (!inQuotes && (unit === 0x0a || unit === 0x0d)) {
      if (length > 0) records.push(current);
      current = fresh();
      length = 0;
      continue;
    }
    length += 1;
    if (inQuotes) continue;
    for (const name of CSV_SNIFF_ORDER)
      if (unit === CSV_DELIMITER_CODES[name]) current[name] += 1;
  }
  // The last record counts only if the read reached the end of the file:
  // one cut at the byte bound is a fragment.
  if (length > 0 && !truncated && records.length < CSV_SNIFF_MAX_RECORDS)
    records.push(current);
  return records;
}

/**
 * The delimiter an Excel `sep=X` first line names, or null: the line is
 * exactly `sep=` and one of the four candidates, optionally in double
 * quotes, after any byte-order mark. See the header.
 */
export function csvSepHint(
  input: Uint8Array,
  charset: CsvCharset,
): CsvDelimiter | null {
  let units = asciiUnits(input.subarray(0, 64), charset);
  if (
    charset === "utf-8" &&
    input[0] === 0xef &&
    input[1] === 0xbb &&
    input[2] === 0xbf
  )
    units = units.slice(3);
  else if (
    charset === "utf-16" &&
    ((input[0] === 0xff && input[1] === 0xfe) ||
      (input[0] === 0xfe && input[1] === 0xff))
  )
    units = units.slice(1);
  const end = units.findIndex((u) => u === 0x0a || u === 0x0d);
  if (end < 0) return null;
  const line = units.slice(0, end);
  if (line.some((u) => u === OTHER)) return null;
  const m = /^"?sep=(.)"?$/.exec(String.fromCharCode(...line));
  if (!m) return null;
  const code = m[1]!.charCodeAt(0);
  return (
    CSV_SNIFF_ORDER.find((name) => CSV_DELIMITER_CODES[name] === code) ?? null
  );
}

/** A candidate's usual count, and how many records hold exactly it. */
function usualCount(counts: readonly number[]): { count: number; on: number } {
  const tally = new Map<number, number>();
  for (const n of counts) if (n > 0) tally.set(n, (tally.get(n) ?? 0) + 1);
  let count = 0;
  let on = 0;
  for (const [n, records] of tally)
    if (records > on || (records === on && n > count)) {
      count = n;
      on = records;
    }
  return { count, on };
}

/** Auto-detect's delimiter for these bytes. See the header. */
export function sniffCsvDelimiter(
  input: Uint8Array,
  charset: CsvCharset,
): CsvDelimiter {
  const hint = csvSepHint(input, charset);
  if (hint) return hint;
  const all = countCsvDelimiters(input, charset);
  const start = all.findIndex((r) => CSV_SNIFF_ORDER.some((n) => r[n] > 0));
  if (start < 0) return "comma";
  const records = all.slice(start);
  let best: CsvDelimiter | null = null;
  let bestOn = 0;
  let bestCount = 0;
  for (const name of CSV_SNIFF_ORDER) {
    const { count, on } = usualCount(records.map((r) => r[name]));
    if (count === 0 || on * 2 <= records.length) continue;
    if (on > bestOn || (on === bestOn && count > bestCount)) {
      best = name;
      bestOn = on;
      bestCount = count;
    }
  }
  return best ?? "comma";
}

/** What the file is read with, each Auto resolved, and the line to start on. */
export function resolveCsvImport(
  input: Uint8Array,
  choice: CsvImportChoice | undefined,
): { delimiter: CsvDelimiter; charset: CsvCharset; firstLine: number } {
  const charset = choice?.charset ?? detectCsvCharset(input);
  const delimiter = choice?.delimiter ?? sniffCsvDelimiter(input, charset);
  const firstLine = csvSepHint(input, charset) ? 2 : 1;
  return { delimiter, charset, firstLine };
}
