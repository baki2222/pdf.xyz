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
  ];
  const TEXTS = [
    "",
    "00123",
    "0012",
    "0,123",
    "1,25",
    "12,34,567",
    "1.250,00",
    "1 250",
    "2026-01-05",
    "01/05/2026",
    "(1,250.00)",
    "1,250.00-",
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
