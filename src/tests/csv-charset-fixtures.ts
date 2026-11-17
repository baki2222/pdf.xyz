import type {
  CsvCharsetCase,
  CsvChoiceCase,
  CsvDefaultCase,
} from "@/lib/workers/office-conversion/input-proof";
import type {
  CsvCharset,
  CsvDelimiter,
  CsvImportChoice,
} from "@/lib/workers/office-conversion/csv-import";

/**
 * CSVs in the two encodings a spreadsheet export arrives in, each carrying
 * an accented word its PDF must show. Measured in the worker image on
 * 2026-11-07: LibreOffice's default read UTF-8 "Zürich" as "ZÃ¼rich", and
 * forcing UTF-8 read a Windows-1252 "Zürich" with U+FFFD in place of the ü.
 * One case of each, plus a UTF-8 file with a byte-order mark, so a fix for
 * one breaks the proof on the other.
 */
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Windows-1252 for text inside Latin-1, the only letters these cases use. */
function windows1252(s: string): Uint8Array {
  return Uint8Array.from([...s], (ch) => {
    const code = ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`"${ch}" is outside this helper's range`);
    return code;
  });
}

export const CSV_CHARSET_CASES: readonly CsvCharsetCase[] = [
  {
    encoding: "utf-8",
    name: "towns.csv",
    word: "Zürich",
    build: () => utf8("Town,Visitors\nZürich,980\n"),
  },
  {
    encoding: "utf-8",
    name: "cheeses.csv",
    word: "Gruyère",
    build: () =>
      Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("Cheese,Kg\nGruyère,12\n")]),
  },
  {
    encoding: "windows-1252",
    name: "names.csv",
    word: "Müller",
    build: () => windows1252("Name,Q1\nMüller,12\n"),
  },
];

/* ------------------------------------------------------------------ *
 *  CSV choices (competitor audit #18, 2026-11-17)
 * ------------------------------------------------------------------ */

const AUTO: CsvImportChoice = { delimiter: null, charset: null };
const delimiter = (d: CsvDelimiter): CsvImportChoice => ({
  delimiter: d,
  charset: null,
});
const charset = (c: CsvCharset): CsvImportChoice => ({
  delimiter: null,
  charset: c,
});

/** Text from code points (house rule: no non-ASCII literal in a fixture). */
const cp = (...codes: number[]) => String.fromCharCode(...codes);
/** "Москва" (Moscow). */
const MOSKVA = cp(0x41c, 0x43e, 0x441, 0x43a, 0x432, 0x430);
/** "Łódź". */
const LODZ = cp(0x141, 0xf3, 0x64, 0x17a);
/** "東京" (Tokyo). */
const TOKYO = cp(0x6771, 0x4eac);
/** "Zürich". */
const ZURICH = cp(0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68);

/** Windows-1251 for ASCII and А-я (U+0410-U+044F to 0xC0-0xFF). */
function windows1251(s: string): Uint8Array {
  return Uint8Array.from([...s], (ch) => {
    const code = ch.charCodeAt(0);
    if (code < 0x80) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    throw new Error(`"${ch}" is outside this helper's range`);
  });
}

/** ISO-8859-2 for ASCII and the three letters of "Łódź". */
function iso88592(s: string): Uint8Array {
  const table: Record<number, number> = {
    0x141: 0xa3,
    0xf3: 0xf3,
    0x17a: 0xbc,
  };
  return Uint8Array.from([...s], (ch) => {
    const code = ch.charCodeAt(0);
    if (code < 0x80) return code;
    const byte = table[code];
    if (byte === undefined)
      throw new Error(`"${ch}" is outside this helper's range`);
    return byte;
  });
}

/** Shift-JIS for ASCII and the two characters of "東京" (0x938C, 0x8B9E). */
function shiftJis(s: string): Uint8Array {
  const table: Record<number, number[]> = {
    0x6771: [0x93, 0x8c],
    0x4eac: [0x8b, 0x9e],
  };
  return Uint8Array.from(
    [...s].flatMap((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 0x80) return [code];
      const bytes = table[code];
      if (!bytes) throw new Error(`"${ch}" is outside this helper's range`);
      return bytes;
    }),
  );
}

/** UTF-16LE with its byte-order mark. */
function utf16le(s: string): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xfe,
    ...[...s].flatMap((ch) => {
      const code = ch.charCodeAt(0);
      return [code & 0xff, code >> 8];
    }),
  ]);
}

const has =
  (...words: string[]) =>
  (text: string) =>
    words.every((w) => text.includes(w));

/**
 * One case per delimiter and per non-default character set. A split file
 * shows no separator in its text (or, for tab, keeps the comma INSIDE a
 * cell that a comma split would remove); a file read in its character set
 * shows its word. Each wrong choice is the one a reader would otherwise get:
 * a comma, or Auto (Windows-1252 for these bytes).
 */
/**
 * Value-rich CSVs for the default-import comparison (review 2026-11-17).
 * Measured in the live image: with `44,34,1,1` the ASCII row printed
 * `01/02/26 ... 1.00E+05 12.00% 01/02/26`; with no options, the marks
 * below. The marks are words both LibreOffice's no-options import and the
 * unit test's stand-in print unchanged (a leading zero and `1e5` LibreOffice
 * rewrites even then, so they are in the file but not marks).
 */
export const CSV_DEFAULT_CASES: readonly CsvDefaultCase[] = [
  {
    encoding: "ascii",
    name: "ledger.csv",
    marks: ["1/2/2026", "12%", "1/2"],
    build: () =>
      utf8(
        `Date,Amount,Code,Big,Pct,Frac,Text\n1/2/2026,${cp(34)}$1,000.50${cp(34)},00123,1e5,12%,1/2,hello\n`,
      ),
  },
  {
    encoding: "utf-8",
    name: "visits.csv",
    word: ZURICH,
    marks: ["1/2/2026", "15%", "3/4"],
    build: () => utf8(`City,Date,Frac,Pct\n${ZURICH},1/2/2026,3/4,15%\n`),
  },
];

export const CSV_CHOICE_CASES: readonly CsvChoiceCase[] = [
  {
    label: "semicolon",
    name: "regions.csv",
    build: () => utf8("Region;Total\nNorth;1200\nSouth;980\n"),
    right: [delimiter("semicolon"), AUTO],
    wrong: [delimiter("comma"), delimiter("tab")],
    reads: (t) => !t.includes(";") && has("North", "1200", "South")(t),
    want: "split into columns, no semicolon left in its text",
  },
  {
    label: "pipe",
    name: "people.csv",
    build: () => utf8("Name|City\nAnna|Riga\nOtto|Oslo\n"),
    right: [delimiter("pipe"), AUTO],
    wrong: [delimiter("comma")],
    reads: (t) => !t.includes("|") && has("Anna", "Riga")(t),
    want: "split into columns, no pipe left in its text",
  },
  {
    label: "tab",
    name: "places.csv",
    build: () => utf8("Name\tPlace\nAnna\tRiga,Latvia\nOtto\tOslo,Norway\n"),
    right: [delimiter("tab"), AUTO],
    wrong: [delimiter("comma")],
    reads: has("Riga,Latvia", "Oslo,Norway"),
    want: '"Riga,Latvia" kept whole in one cell',
  },
  {
    label: "windows-1251",
    name: "cities.csv",
    build: () => windows1251(`City,Visitors\n${MOSKVA},1200\n`),
    right: [charset("windows-1251")],
    wrong: [AUTO, charset("windows-1252")],
    reads: has(MOSKVA),
    want: "its Cyrillic word in its text",
  },
  {
    label: "iso-8859-2",
    name: "towns-pl.csv",
    build: () => iso88592(`Town,Visitors\n${LODZ},980\n`),
    right: [charset("iso-8859-2")],
    wrong: [AUTO],
    reads: has(LODZ),
    want: "its Polish word in its text",
  },
  {
    label: "shift-jis",
    name: "towns-jp.csv",
    build: () => shiftJis(`Town,Visitors\n${TOKYO},980\n`),
    right: [charset("shift-jis")],
    wrong: [AUTO],
    reads: has(TOKYO),
    want: "its Japanese word in its text",
  },
  {
    // No byte-order mark: LibreOffice reads a marked UTF-16 file as UTF-16
    // whatever character set it is handed (measured in the worker image,
    // 2026-11-17: Windows-1252 chosen, the word still came out right), so
    // only an unmarked file can show that the choice is what reads it. And a
    // Cyrillic word: an unmarked UTF-16 "Zurich" with its u-umlaut read as
    // Windows-1252 is the same letters with a NUL after each, which the PDF
    // text drops, so it read right on Auto too (measured the same day).
    label: "utf-16",
    name: "towns-16.csv",
    build: () => utf16le(`Town,Visitors\n${MOSKVA},980\n`).subarray(2),
    right: [charset("utf-16")],
    wrong: [AUTO],
    reads: has(MOSKVA, "980"),
    want: "its Cyrillic word in its text",
  },
  {
    // With the mark, Auto reads it: its character set by the mark, and its
    // comma by Auto-detect, which reads it by UTF-16 unit. The control is
    // the delimiter, since no character set can make a marked file wrong.
    label: "utf-16-bom",
    name: "towns-16bom.csv",
    build: () => utf16le(`Town,Visitors\n${ZURICH},980\n`),
    right: [AUTO, charset("utf-16")],
    wrong: [delimiter("semicolon")],
    reads: (t) => !t.includes(",") && has(ZURICH, "980")(t),
    want: "its accented word in its text, split at the comma",
  },
];
