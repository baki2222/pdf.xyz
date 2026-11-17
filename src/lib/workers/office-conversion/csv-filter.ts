/**
 * The LibreOffice CSV import filter a .csv is opened with, built from the
 * job's choices (`./csv-import`) and, where a choice is Auto, from the file.
 *
 * ── THE TOKEN ────────────────────────────────────────────────────────────────
 * `--infilter=Text - txt - csv (StarCalc):<seps>,<quote>,<charset>,<line>`,
 * the first four of the CSV filter's comma-separated option tokens, as
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
 *   4. the line to start reading on: 1.
 *
 * With NO filter options, `ScDocShell::ConvertFrom` imports a CSV as
 * MS_1252, comma, double quote (sc/source/ui/docshell/docsh.cxx) — the
 * Western default production measured on 2026-11-07. So a CSV whose choices
 * are both Auto and whose bytes are not UTF-8 gets `44,34,1,1`: the same
 * import as before this module, spelled out. Every .csv now gets a token;
 * nothing else ever does.
 *
 * ── AUTO ─────────────────────────────────────────────────────────────────────
 * Character set: UTF-16 when the file starts with a UTF-16 byte-order mark,
 * UTF-8 when it holds non-ASCII bytes that decode as UTF-8 (the 2026-11-07
 * rule, unchanged), Windows-1252 otherwise.
 *
 * Delimiter ({@link sniffCsvDelimiter}): deterministic and bounded. It reads
 * at most {@link CSV_SNIFF_MAX_BYTES} bytes and {@link CSV_SNIFF_MAX_RECORDS}
 * records, counts each candidate OUTSIDE double quotes per record, and keeps
 * the candidates found the same, non-zero number of times on every record.
 * The most frequent wins; a tie goes to the earlier of tab, semicolon, comma,
 * pipe (a file with one semicolon and one decimal comma on every line is a
 * European export, so semicolon beats comma). No consistent candidate: comma,
 * the filter's own default.
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

/** The option string for one delimiter and character set. */
export function csvFilterOptions(
  delimiter: CsvDelimiter,
  charset: CsvCharset,
): string {
  return `${CSV_DELIMITER_CODES[delimiter]},${TEXT_DELIMITER_CODE},${CSV_CHARSET_IDS[charset]},1`;
}

/** The whole `--infilter` value for one delimiter and character set. */
export function csvInfilter(
  delimiter: CsvDelimiter,
  charset: CsvCharset,
): string {
  return `${CSV_FILTER_NAME}:${csvFilterOptions(delimiter, charset)}`;
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

/** Auto-detect's delimiter for these bytes. See the header. */
export function sniffCsvDelimiter(
  input: Uint8Array,
  charset: CsvCharset,
): CsvDelimiter {
  const records = countCsvDelimiters(input, charset);
  let best: CsvDelimiter | null = null;
  let bestCount = 0;
  for (const name of CSV_SNIFF_ORDER) {
    const first = records[0]?.[name] ?? 0;
    if (first === 0) continue;
    if (!records.every((r) => r[name] === first)) continue;
    if (first > bestCount) {
      best = name;
      bestCount = first;
    }
  }
  return best ?? "comma";
}

/** What the file is read with, each Auto resolved. */
export function resolveCsvImport(
  input: Uint8Array,
  choice: CsvImportChoice | undefined,
): { delimiter: CsvDelimiter; charset: CsvCharset } {
  const charset = choice?.charset ?? detectCsvCharset(input);
  const delimiter = choice?.delimiter ?? sniffCsvDelimiter(input, charset);
  return { delimiter, charset };
}
