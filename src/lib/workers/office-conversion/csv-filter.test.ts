// @vitest-environment node
/**
 * The CSV import filter (competitor audit #18): the codes LibreOffice is
 * handed, Auto's character set, and Auto-detect's delimiter sniff.
 *
 * The codes are pinned against a SECOND, independent bound (CLAUDE.md rule
 * 3: a constant has no relationships to constrain): the values below were
 * read from LibreOffice 7.4's own source on 2026-11-17 and are typed here as
 * that source spells them, not copied from `./csv-filter`. The in-image
 * proof (`pnpm worker:office-input-proof`) is the third bound: the real
 * LibreOffice must read each one as the separator or character set it names.
 *
 * Non-ASCII test text is built from code points (house rule).
 */
import { describe, expect, it } from "vitest";
import { CSV_CHARSETS, CSV_DELIMITERS } from "./csv-import";
import {
  CSV_CHARSET_IDS,
  CSV_DELIMITER_CODES,
  CSV_FILTER_NAME,
  CSV_SNIFF_MAX_BYTES,
  CSV_SNIFF_MAX_RECORDS,
  CSV_SNIFF_ORDER,
  countCsvDelimiters,
  csvFilterOptions,
  csvInfilter,
  csvSepHint,
  detectCsvCharset,
  resolveCsvImport,
  sniffCsvDelimiter,
} from "./csv-filter";

const ascii = (s: string) => new TextEncoder().encode(s);
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
/** U+00FC, the u with diaeresis, in UTF-8 and in Windows-1252. */
const U_UML_UTF8 = [0xc3, 0xbc];
const U_UML_1252 = [0xfc];

describe("the codes LibreOffice is handed", () => {
  it("each delimiter is its ASCII code (sc/source/ui/dbgui/asciiopt.cxx, lcl_decodeSepString)", () => {
    expect(CSV_DELIMITER_CODES).toEqual({
      comma: ",".charCodeAt(0),
      semicolon: ";".charCodeAt(0),
      tab: "\t".charCodeAt(0),
      pipe: "|".charCodeAt(0),
    });
    // Independently: the numbers the filter documentation lists.
    expect(Object.values(CSV_DELIMITER_CODES)).toEqual([44, 59, 9, 124]);
  });

  it("each character set is its rtl_TextEncoding id (include/rtl/textenc.h, libreoffice-7-4)", () => {
    // #define RTL_TEXTENCODING_UTF8        (RTL_TEXTENC_CAST( 76 ))
    // #define RTL_TEXTENCODING_MS_1252     (RTL_TEXTENC_CAST( 1 ))
    // #define RTL_TEXTENCODING_ISO_8859_2  (RTL_TEXTENC_CAST( 13 ))
    // #define RTL_TEXTENCODING_MS_1251     (RTL_TEXTENC_CAST( 34 ))
    // #define RTL_TEXTENCODING_SHIFT_JIS   (RTL_TEXTENC_CAST( 64 ))
    // #define RTL_TEXTENCODING_UCS2        (RTL_TEXTENC_CAST( 0xFFFF ))
    //   (RTL_TEXTENCODING_UNICODE is RTL_TEXTENCODING_UCS2)
    expect(CSV_CHARSET_IDS).toEqual({
      "utf-8": 76,
      "windows-1252": 1,
      "iso-8859-2": 13,
      "windows-1251": 34,
      "shift-jis": 64,
      "utf-16": 65535,
    });
  });

  it("every choice the panel offers has a code, and every code is offered (both directions)", () => {
    const delimiters = CSV_DELIMITERS.flatMap((d) =>
      d.value ? [d.value] : [],
    );
    const charsets = CSV_CHARSETS.flatMap((c) => (c.value ? [c.value] : []));
    // Health: the lists are not empty, so the equality below is not vacuous.
    expect(delimiters.length).toBe(4);
    expect(charsets.length).toBe(6);
    expect(Object.keys(CSV_DELIMITER_CODES).sort()).toEqual(
      [...delimiters].sort(),
    );
    expect(Object.keys(CSV_CHARSET_IDS).sort()).toEqual([...charsets].sort());
    expect([...CSV_SNIFF_ORDER].sort()).toEqual([...delimiters].sort());
  });

  it("the token: separator, double quote, character set, first line, then tokens 5-8", () => {
    expect(csvFilterOptions("semicolon", "windows-1251")).toBe(
      "59,34,34,1,,0,false,false",
    );
    expect(csvFilterOptions("tab", "utf-16")).toBe(
      "9,34,65535,1,,0,false,false",
    );
    expect(csvFilterOptions("pipe", "utf-8", 2)).toBe(
      "124,34,76,2,,0,false,false",
    );
    expect(csvInfilter("comma", "utf-8")).toBe(
      "Text - txt - csv (StarCalc):44,34,76,1,,0,false,false",
    );
    expect(CSV_FILTER_NAME).toBe("Text - txt - csv (StarCalc)");
  });

  // INVERTED 2026-11-17 (review), not deleted. It read: "Auto on a
  // Windows-1252 comma CSV is LibreOffice's no-options import, spelled out
  // (docsh.cxx: MS_1252, comma, quote)" and asserted the string "44,34,1,1".
  // That compared an option STRING, never an output, and the string was not
  // the no-options import: with token 8 absent LibreOffice detects special
  // numbers, and in the live image (sha256:78faaf08) an ASCII row's "1/2"
  // printed as 01/02/26, "1e5" as 1.00E+05 and "12%" as 12.00%. Whether a
  // token prints what no options printed is a question about OUTPUT, so it
  // is now asked of output, in the image: input-proof.ts "csv default
  // import" converts value-rich CSVs both ways and requires the same text.
  // What a unit test can still say is below: Auto's token is the explicit
  // eight-token form, and never the four-token one that was measured wrong.
  it("Auto on a Windows-1252 comma CSV writes tokens 5-8 as no options sets them, never the 4-token form measured wrong", () => {
    const bytes = Uint8Array.from([
      ...ascii("Name,Q1\nM"),
      ...U_UML_1252,
      ...ascii("ller,12\n"),
    ]);
    const { delimiter, charset, firstLine } = resolveCsvImport(
      bytes,
      undefined,
    );
    const token = csvFilterOptions(delimiter, charset, firstLine);
    expect(token).toBe("44,34,1,1,,0,false,false");
    expect(token).not.toBe("44,34,1,1");
    // Token 8, detect special numbers, is spelled false: the one the
    // measurement turned on by its absence.
    expect(token.split(",")[7]).toBe("false");
  });
});

describe("Auto's character set", () => {
  it("UTF-8 for non-ASCII bytes that decode as UTF-8 (the 2026-11-07 rule)", () => {
    expect(
      detectCsvCharset(
        Uint8Array.from([...ascii("Z"), ...U_UML_UTF8, ...ascii("rich\n")]),
      ),
    ).toBe("utf-8");
    expect(
      detectCsvCharset(Uint8Array.from([0xef, 0xbb, 0xbf, ...ascii("a,b\n")])),
    ).toBe("utf-8");
  });

  it("Windows-1252 for anything else, ASCII included", () => {
    expect(detectCsvCharset(ascii("a,b\n"))).toBe("windows-1252");
    expect(
      detectCsvCharset(
        Uint8Array.from([...ascii("M"), ...U_UML_1252, ...ascii("ller\n")]),
      ),
    ).toBe("windows-1252");
  });

  it("UTF-16 for either byte-order mark", () => {
    expect(detectCsvCharset(Uint8Array.from([0xff, 0xfe, 0x61, 0x00]))).toBe(
      "utf-16",
    );
    expect(detectCsvCharset(Uint8Array.from([0xfe, 0xff, 0x00, 0x61]))).toBe(
      "utf-16",
    );
  });

  it("a chosen character set is used as chosen, whatever the bytes", () => {
    const utf8 = Uint8Array.from([
      ...ascii("Z"),
      ...U_UML_UTF8,
      ...ascii(",1\n"),
    ]);
    expect(
      resolveCsvImport(utf8, { delimiter: null, charset: "windows-1251" })
        .charset,
    ).toBe("windows-1251");
  });
});

describe("Auto-detect's delimiter", () => {
  const sniff = (text: string) =>
    sniffCsvDelimiter(ascii(text), "windows-1252");

  it("finds each delimiter on a plain file", () => {
    expect(sniff("a,b,c\n1,2,3\n")).toBe("comma");
    expect(sniff("a;b;c\n1;2;3\n")).toBe("semicolon");
    expect(sniff("a\tb\tc\n1\t2\t3\n")).toBe("tab");
    expect(sniff("a|b|c\n1|2|3\n")).toBe("pipe");
  });

  it("a European export: one semicolon per line beats a decimal comma that varies", () => {
    expect(sniff("Item;Price\nTea;1,50\nCake;12\n")).toBe("semicolon");
  });

  it("the tie-break: a semicolon and a decimal comma on EVERY line is still a European export", () => {
    expect(sniff("Item;Price\nTea;1,5\nCake;2,5\n")).toBe("semicolon");
  });

  it("the most frequent consistent candidate wins over an earlier one", () => {
    // One tab and three commas on every line: commas.
    expect(sniff("a\tb,c,d,e\n1\t2,3,4,5\n")).toBe("comma");
  });

  it("separators inside double quotes are not counted, across lines too", () => {
    expect(sniff('name,note\n"Smith; J","a;b;c"\nLee,x\n')).toBe("comma");
    expect(sniff('a;b\n"line one,\nline two,";2\nc;3\n')).toBe("semicolon");
  });

  it("CONTROL: a quoted separator that WOULD win if counted does not", () => {
    // Outside quotes one comma per line; inside, one semicolon per line,
    // which ties with the comma and would win the tie-break if counted
    // (mutation control M2, 2026-11-17: the two cases above passed with the
    // quote rule deleted).
    expect(sniff('"a;b",c' + String.fromCharCode(10) + '"d;e",f')).toBe(
      "comma",
    );
  });

  it("CRLF line ends and a missing final newline", () => {
    expect(sniff("a;b\r\n1;2\r\n3;4")).toBe("semicolon");
  });

  it("falls back to a comma when no candidate holds its count on more than half the records, or nothing is there", () => {
    expect(sniff("a;b;c\n1;2\n3\n")).toBe("comma");
    // Exactly half is not more than half.
    expect(sniff("a;b\nc;d\ne\nf\n")).toBe("comma");
    expect(sniff("just one column\nof words\n")).toBe("comma");
    expect(sniff("")).toBe("comma");
  });

  it("a title line above the table is skipped (review 2026-11-17: it fell back to comma)", () => {
    const table =
      "Date;Amount;Payee\n2026-01-01;12,50;Shop\n2026-01-02;3,10;Cafe\n";
    expect(sniff(`Account statement\n${table}`)).toBe("semicolon");
    // Two title lines, one carrying a comma: still the semicolon.
    expect(sniff(`Statement, January\nAccount 123\n${table}`)).toBe(
      "semicolon",
    );
  });

  it("one short row does not throw the separator out (review 2026-11-17: it fell back to comma)", () => {
    expect(sniff("A;B;C\n1;2;3\n4;5\n6;7;8\n")).toBe("semicolon");
  });

  it("an Excel sep= first line is the answer, and reading starts on line 2", () => {
    const hinted = "sep=;\nA,B,C;D\n1,5,6;2\n";
    expect(sniff(hinted)).toBe("semicolon");
    expect(csvSepHint(ascii(hinted), "windows-1252")).toBe("semicolon");
    expect(resolveCsvImport(ascii(hinted), undefined)).toEqual({
      delimiter: "semicolon",
      charset: "windows-1252",
      firstLine: 2,
    });
    // CONTROL: without the hint, the two commas on every line win.
    expect(sniff("A,B,C;D\n1,5,6;2\n")).toBe("comma");
    // A chosen delimiter keeps the choice and still skips the hint line.
    expect(
      resolveCsvImport(ascii(hinted), { delimiter: "comma", charset: null }),
    ).toEqual({ delimiter: "comma", charset: "windows-1252", firstLine: 2 });
    // Quoted, after a UTF-8 byte-order mark, and with CRLF: still a hint.
    const quoted = String.fromCharCode(34) + "sep=|" + String.fromCharCode(34);
    expect(
      csvSepHint(
        Uint8Array.from([0xef, 0xbb, 0xbf, ...ascii(`${quoted}\r\na|b\n`)]),
        "utf-8",
      ),
    ).toBe("pipe");
    expect(csvSepHint(ascii("sep=\t\na\tb\n"), "windows-1252")).toBe("tab");
  });

  it("CONTROL: what is not a sep= hint is not one", () => {
    // Another character, more text on the line, no line end, a later line.
    expect(csvSepHint(ascii("sep=:\na:b\n"), "windows-1252")).toBeNull();
    expect(csvSepHint(ascii("sep=;x\na;b\n"), "windows-1252")).toBeNull();
    expect(csvSepHint(ascii("sep=;"), "windows-1252")).toBeNull();
    expect(csvSepHint(ascii("a;b\nsep=;\n"), "windows-1252")).toBeNull();
    expect(resolveCsvImport(ascii("a;b\n1;2\n"), undefined).firstLine).toBe(1);
  });

  it("a one-line file", () => {
    expect(sniff("a|b|c")).toBe("pipe");
  });

  it("is deterministic: the same bytes give the same answer, every order of ties", () => {
    const text = "a;b\tc\n1;2\t3\n";
    // One semicolon and one tab on each line: tab first in the order.
    expect(sniff(text)).toBe("tab");
    for (let i = 0; i < 5; i += 1) expect(sniff(text)).toBe("tab");
  });

  it("is bounded by bytes: nothing past the first 64 KiB is read, and the record the bound cuts is dropped", () => {
    // 8,002-byte records: eight fit in 64 KiB, the bound cuts the ninth
    // inside its run of x (no semicolon there), and an odd line follows.
    const long = `${"x".repeat(4000)};${"y".repeat(4000)}\n`;
    const cutAt = Math.floor(CSV_SNIFF_MAX_BYTES / long.length);
    expect(cutAt).toBe(8);
    const commas = "p,q\n".repeat(cutAt + 2);
    const bytes = ascii(`${long.repeat(cutAt + 1)}${commas}`);
    const records = countCsvDelimiters(bytes, "windows-1252");
    // The fragment of record nine would count 0 semicolons; the comma
    // lines past the bound would outvote the semicolon if they were read.
    expect(records).toHaveLength(cutAt);
    expect(records.every((r) => r.semicolon === 1)).toBe(true);
    expect(sniffCsvDelimiter(bytes, "windows-1252")).toBe("semicolon");
    // CONTROL: the same records, short enough that the comma lines are
    // inside the bound, and the answer changes. (Until 2026-11-17 one odd
    // line was enough, when every record had to agree.)
    const short = `${"x".repeat(40)};${"y".repeat(40)}\n`;
    expect(sniff(`${short.repeat(cutAt + 1)}${commas}`)).toBe("comma");
  });

  it("is bounded by records: at most 50 are read", () => {
    const text = `${"a;b\n".repeat(CSV_SNIFF_MAX_RECORDS)}${"a,b\n".repeat(CSV_SNIFF_MAX_RECORDS + 1)}`;
    expect(countCsvDelimiters(ascii(text), "windows-1252")).toHaveLength(
      CSV_SNIFF_MAX_RECORDS,
    );
    expect(sniff(text)).toBe("semicolon");
    // CONTROL: the same mix inside the bound, and the commas outvote.
    expect(sniff(`${"a;b\n".repeat(3)}${"a,b\n".repeat(4)}`)).toBe("comma");
  });

  it("reads Shift-JIS by character: a 0x7C inside a two-byte character is not a pipe", () => {
    // U+30DD (KATAKANA PO) is 0x83 0x7C in Shift-JIS.
    const so = [0x83, 0x7c];
    const bytes = Uint8Array.from([
      ...so,
      ...ascii(","),
      ...so,
      ...ascii("\n"),
      ...so,
      ...ascii(","),
      ...so,
      ...so,
      ...ascii("\n"),
    ]);
    expect(new TextDecoder("shift_jis").decode(Uint8Array.from(so))).toBe(
      cp(0x30dd),
    );
    expect(sniffCsvDelimiter(bytes, "shift-jis")).toBe("comma");
    // CONTROL: read byte by byte, the pipe count varies and blinds nothing
    // here, but on equal counts it would win: two per line.
    const even = Uint8Array.from([
      ...so,
      ...ascii(","),
      ...so,
      ...ascii("\n"),
      ...so,
      ...ascii(","),
      ...so,
      ...ascii("\n"),
    ]);
    expect(sniffCsvDelimiter(even, "windows-1252")).toBe("pipe");
    expect(sniffCsvDelimiter(even, "shift-jis")).toBe("comma");
  });

  it("reads UTF-16 by unit, either byte order", () => {
    const le = (s: string) =>
      Uint8Array.from([
        0xff,
        0xfe,
        ...[...s].flatMap((c) => [
          c.charCodeAt(0) & 0xff,
          c.charCodeAt(0) >> 8,
        ]),
      ]);
    const be = (s: string) =>
      Uint8Array.from([
        0xfe,
        0xff,
        ...[...s].flatMap((c) => [
          c.charCodeAt(0) >> 8,
          c.charCodeAt(0) & 0xff,
        ]),
      ]);
    const text = `Name\tCity\n${cp(0x41f, 0x435)}\tRiga\n`;
    expect(sniffCsvDelimiter(le(text), "utf-16")).toBe("tab");
    expect(sniffCsvDelimiter(be(text), "utf-16")).toBe("tab");
    // U+3B2C holds both 0x2C (comma) and 0x3B (semicolon) as bytes.
    const tricky = `a\tb\n${cp(0x3b2c)}\tc\n`;
    expect(sniffCsvDelimiter(le(tricky), "utf-16")).toBe("tab");
  });
});
