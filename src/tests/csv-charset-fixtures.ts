import type { CsvCharsetCase } from "@/lib/workers/office-conversion/input-proof";

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
