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

  it("the token: separator, double quote, character set, line 1", () => {
    expect(csvFilterOptions("semicolon", "windows-1251")).toBe("59,34,34,1");
    expect(csvFilterOptions("tab", "utf-16")).toBe("9,34,65535,1");
    expect(csvInfilter("comma", "utf-8")).toBe(
      "Text - txt - csv (StarCalc):44,34,76,1",
    );
    expect(CSV_FILTER_NAME).toBe("Text - txt - csv (StarCalc)");
  });

  it("Auto on a Windows-1252 comma CSV is LibreOffice's no-options import, spelled out (docsh.cxx: MS_1252, comma, quote)", () => {
    const bytes = Uint8Array.from([
      ...ascii("Name,Q1\nM"),
      ...U_UML_1252,
      ...ascii("ller,12\n"),
    ]);
    const { delimiter, charset } = resolveCsvImport(bytes, undefined);
    expect(csvFilterOptions(delimiter, charset)).toBe("44,34,1,1");
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

  it("CRLF line ends and a missing final newline", () => {
    expect(sniff("a;b\r\n1;2\r\n3;4")).toBe("semicolon");
  });

  it("falls back to a comma when nothing is consistent, or nothing is there", () => {
    expect(sniff("a;b;c\n1;2\n3\n")).toBe("comma");
    expect(sniff("just one column\nof words\n")).toBe("comma");
    expect(sniff("")).toBe("comma");
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
    const odd = "p;q;r;s\n";
    const bytes = ascii(`${long.repeat(cutAt + 1)}${odd}`);
    const records = countCsvDelimiters(bytes, "windows-1252");
    // The fragment of record nine would count 0 semicolons and break the
    // consistency; the odd line past the bound would count 3.
    expect(records).toHaveLength(cutAt);
    expect(records.every((r) => r.semicolon === 1)).toBe(true);
    expect(sniffCsvDelimiter(bytes, "windows-1252")).toBe("semicolon");
    // CONTROL: the same records, short enough that the odd line is inside
    // the bound, and the answer changes.
    const short = `${"x".repeat(40)};${"y".repeat(40)}\n`;
    expect(sniff(`${short.repeat(cutAt + 1)}${odd}`)).toBe("comma");
  });

  it("is bounded by records: at most 50 are read", () => {
    const text = `${"a;b\n".repeat(CSV_SNIFF_MAX_RECORDS)}a;b;c;d\n`;
    expect(countCsvDelimiters(ascii(text), "windows-1252")).toHaveLength(
      CSV_SNIFF_MAX_RECORDS,
    );
    expect(sniff(text)).toBe("semicolon");
    // CONTROL: the same odd line inside the bound breaks consistency.
    expect(sniff(`a;b;c;d\n${"a;b\n".repeat(3)}`)).toBe("comma");
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
