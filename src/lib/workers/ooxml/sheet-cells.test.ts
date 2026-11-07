import { describe, expect, it } from "vitest";
import {
  columnRef,
  parseSheetNumber,
  SheetStyles,
  worksheetXml,
} from "./sheet-cells";
import { decodeCellRef } from "./sheet-read";

describe("columnRef", () => {
  it("matches the reader's independent decoding for every column Excel has", () => {
    // 16,384 columns (A…XFD). The reader decodes letters on its own, so a
    // writer that clamps (the old `Math.min(ci, 25)`) or skips cannot agree.
    const seen = new Set<string>();
    for (let i = 0; i < 16_384; i++) {
      const ref = columnRef(i);
      expect(decodeCellRef(`${ref}1`).column).toBe(i);
      seen.add(ref);
    }
    expect(seen.size).toBe(16_384);
    expect(columnRef(16_383)).toBe("XFD");
  });

  it("names the boundaries Excel users know", () => {
    expect([0, 25, 26, 27, 29, 51, 52, 701, 702].map(columnRef)).toEqual([
      "A",
      "Z",
      "AA",
      "AB",
      "AD",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });
});

describe("parseSheetNumber — a number only when the WHOLE text is one", () => {
  // Both directions of the corpus: every shape that must become a number, and
  // every near-miss that must stay text exactly as printed.
  const NUMBERS: [string, string, string][] = [
    ["0", "0", "0"],
    ["7", "7", "0"],
    ["2026", "2026", "0"],
    ["0.5", "0.5", "0.0"],
    ["980.25", "980.25", "0.00"],
    ["1,250.00", "1250.00", "#,##0.00"],
    ["1,234,567", "1234567", "#,##0"],
    ["-42", "-42", "0"],
    ["−3.5", "-3.5", "0.0"],
    ["$3,400.50", "3400.50", '"$"#,##0.00'],
    ["-$3.00", "-3.00", '"$"0.00'],
    ["$-3.00", "-3.00", '"$"0.00'],
    ["£12", "12", '"£"0'],
    ["€1,000", "1000", '"€"#,##0'],
    ["৳500", "500", '"৳"0'],
    ["12.5%", "0.125", "0.0%"],
    ["100%", "1", "0%"],
    ["0.5%", "0.005", "0.0%"],
    ["-7%", "-0.07", "0%"],
    ["123456789012345", "123456789012345", "0"],
    // Audit pdf-to-excel#4 (2026-11-08): lakh grouping, accounting negatives
    // and real dates. Each was in TEXTS below until then.
    ["₹1,25,000.00", "125000.00", LAKH('"₹"', ".00")],
    ["৳12,50,000", "1250000", LAKH('"৳"', "")],
    ["12,34,567", "1234567", LAKH("", "")],
    ["1,23,45,678", "12345678", LAKH("", "")],
    ["-1,25,000", "-125000", "#,##0"],
    ["(1,250.00)", "-1250.00", "#,##0.00;(#,##0.00)"],
    ["(1,250)", "-1250", "#,##0;(#,##0)"],
    ["(12.50)", "-12.50", "0.00;(0.00)"],
    ["($3,400.50)", "-3400.50", '"$"#,##0.00;("$"#,##0.00)'],
    ["(₹1,25,000)", "-125000", '"₹"#,##0;("₹"#,##0)'],
    ["1,250.00-", "-1250.00", "#,##0.00;#,##0.00-"],
    ["980.25-", "-980.25", "0.00;0.00-"],
  ];
  /** The display format of a lakh-grouped amount: 1,25,000 and 1,00,00,000. */
  function LAKH(currency: string, fraction: string): string {
    return `[>=10000000]${currency}##\\,##\\,##\\,##0${fraction};[>=100000]${currency}##\\,##\\,##0${fraction};${currency}##,##0${fraction}`;
  }
  const DATES: [string, string, string][] = [
    ["2026-01-05", "46027", "yyyy-mm-dd"],
    ["1900-03-01", "61", "yyyy-mm-dd"],
    ["2024-02-29", "45351", "yyyy-mm-dd"],
    ["12 March 2024", "45363", "d mmmm yyyy"],
    ["05 Jan 2026", "46027", "dd mmm yyyy"],
  ];
  const TEXTS = [
    "",
    "00123",
    "0012",
    "0,123",
    "1,25",
    "1.250,00",
    "1 250",
    "01/05/2026",
    // Grouping that is neither thousands nor lakh, consistently, stays text.
    "1,23,4567",
    "12,345,67",
    "1,2,345",
    "1,234,56,789",
    "123,45,678",
    // A bracket or a trailing minus only around an amount: a bare (3) is a
    // note mark, and signs never double up.
    "(3)",
    "(12)",
    "(abc)",
    "((1.00))",
    "(-1.00)",
    "-(1.00)",
    "(1.00)-",
    "-1.00-",
    "1.00--",
    "5-",
    "(12.5%)",
    "(1.250,00)",
    // Dates only when unambiguous and real.
    "2026-02-30",
    "2026-13-01",
    "2025-02-29",
    "1899-12-31",
    "1900-02-28",
    "2026-1-5",
    "31 April 2026",
    "5 Sept 2026",
    "5 march 2026",
    "Jan 5, 2026",
    "05.01.2026",
    "--5",
    "-$-5",
    "$12%",
    "12.",
    ".5",
    "1e5",
    "0x1F",
    "12 USD",
    "1234567890123456",
    "Widgets, blue",
    "Q1",
  ];

  it.each(NUMBERS)("%s → %s shown as %s", (text, value, format) => {
    expect(parseSheetNumber(text)).toEqual({ value, format });
  });

  it.each(DATES)(
    "%s is the date serial %s shown as %s",
    (text, value, format) => {
      expect(parseSheetNumber(text)).toEqual({ value, format });
    },
  );

  it("HEALTH: the date serials are Excel's own (1900 system, 1899-12-30 epoch)", () => {
    // Independent of the parser: days since Excel's day 0, by Date.UTC.
    const serial = (iso: string) =>
      (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
    for (const [text, value] of DATES.filter(([t]) => /^\d{4}-/.test(t)))
      expect(String(serial(text)), text).toBe(value);
    expect(serial("2024-03-12")).toBe(45363);
  });

  it.each(TEXTS)("%j stays text", (text) => {
    expect(parseSheetNumber(text)).toBeNull();
  });

  it("writes numbers as <v> with their format, and text as inline strings", () => {
    const styles = new SheetStyles();
    const xml = worksheetXml([["1,250.00", "00123", null, "x < y"]], styles);
    expect(xml).toContain('<c r="A1" s="1"><v>1250.00</v></c>');
    expect(xml).toContain(
      '<c r="B1" t="inlineStr"><is><t xml:space="preserve">00123</t></is></c>',
    );
    expect(xml).not.toContain('r="C1"');
    expect(xml).toContain("x &lt; y");
    // Built-in #,##0.00 is id 4: nothing custom to declare.
    expect(styles.xml()).toContain('<xf numFmtId="4"');
    expect(styles.xml()).not.toContain("<numFmts");
  });

  it("declares every custom format it hands out, once", () => {
    const styles = new SheetStyles();
    worksheetXml([["$1.00", "$2.00", "12.5%"]], styles);
    const xml = styles.xml();
    expect(xml).toContain('<numFmts count="2">');
    expect(xml).toContain('formatCode="&quot;$&quot;0.00"');
    expect(xml).toContain('formatCode="0.0%"');
    expect(xml).toContain('<cellXfs count="3">');
  });

  it("drops characters XML cannot carry instead of writing a file Excel refuses", () => {
    const xml = worksheetXml([["a\u0001b\u000Cc"]], new SheetStyles());
    expect(xml).toContain(">abc<");
  });
});
