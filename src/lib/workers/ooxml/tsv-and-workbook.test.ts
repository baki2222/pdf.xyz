// @vitest-environment node
/**
 * The TSV ("Copy as table") and the workbook ("Download XLSX") AI Data
 * Extraction builds in the browser (competitor audit #4, 2026-11-17), held to
 * the CSV's formula rule rather than to a copy of it.
 *
 * The corpus is DERIVED from the exported lead list, so a lead added to it is
 * checked here on the day it is added, and the TSV and the CSV are compared
 * in BOTH directions over the same values: a cell one neutralises and the
 * other does not fails, whichever side is wrong.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { CSV_FORMULA_LEADS, toCsv, toTsv } from "./csv";
import { buildWorkbook } from "./workbook-write";
import { readWorkbookSheets } from "./workbook-read";

/** OWASP's leads: the printable ones csv.ts exports, plus tab and CR. */
const LEADS = [...CSV_FORMULA_LEADS, "\t", "\r"];
const FORMULAS = LEADS.map((lead) => `${lead}HYPERLINK("http://x.test","y")`);
/** Values that start with a lead and are NOT formulas, by csv.ts's rule. */
const EXEMPT = ["-4", "-1,250.00", "-"];
const PLAIN = ["Invoice 7", "a=b", "total: 120.50", ""];

/** A single CSV or TSV cell's text, unquoted. */
function unquote(cell: string): string {
  return cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
}
const csvNeutralised = (v: string) => unquote(toCsv([[v]])).startsWith("'");
const tsvNeutralised = (v: string) => unquote(toTsv([[v]])).startsWith("'");

/** A minimal RFC-4180-style reader with a tab separator, to round-trip. */
function parseTsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") {
      rows.at(-1)!.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      rows.at(-1)!.push(cell);
      rows.push([]);
      cell = "";
      i += 1;
    } else cell += ch;
  }
  rows.at(-1)!.push(cell);
  return rows;
}

describe("toTsv neutralises formulas exactly as toCsv does", () => {
  it("every lead the CSV knows is neutralised in the TSV", () => {
    // Health check: the corpus is the lead list, not empty or truncated.
    expect(FORMULAS).toHaveLength(CSV_FORMULA_LEADS.length + 2);
    expect(CSV_FORMULA_LEADS.length).toBeGreaterThanOrEqual(4);
    for (const value of FORMULAS) {
      expect(tsvNeutralised(value), JSON.stringify(value)).toBe(true);
      expect(unquote(toTsv([[value]]))).toBe(`'${value}`);
    }
  });

  it("the two agree on every value, in both directions", () => {
    const corpus = [...FORMULAS, ...EXEMPT, ...PLAIN];
    for (const value of corpus) {
      expect(tsvNeutralised(value), JSON.stringify(value)).toBe(
        csvNeutralised(value),
      );
    }
    // Positive control: the corpus holds both outcomes, so agreement is not
    // the agreement of two predicates that always say the same thing.
    const yes = corpus.filter(csvNeutralised);
    const no = corpus.filter((v) => !csvNeutralised(v));
    expect(yes).toEqual(FORMULAS);
    expect(no).toEqual([...EXEMPT, ...PLAIN]);
  });

  it("a tab, a line break or a quote stays inside one cell on paste", () => {
    const rows = [
      ["name", "note"],
      ["A\tB", 'say "hi"'],
      ["line one\nline two", "plain"],
    ];
    const tsv = toTsv(rows);
    expect(tsv.split("\r\n")).toHaveLength(3);
    expect(parseTsv(tsv)).toEqual(rows);
    // Positive control: the reader does split an unquoted tab.
    expect(parseTsv("a\tb")).toEqual([["a", "b"]]);
  });
});

describe("buildWorkbook: what AI Data Extraction's Download XLSX writes", () => {
  it("stores a formula-looking value as text, never as a formula", async () => {
    const bytes = await buildWorkbook([
      {
        name: "Extraction",
        rows: [
          ["field", "value"],
          [FORMULAS[0]!, "-4"],
          ["@SUM(A1)", "INV-7"],
        ],
      },
    ]);
    const [sheet] = await readWorkbookSheets(bytes);
    expect(sheet!.name).toBe("Extraction");
    const cells = sheet!.sheet.rows.flatMap((r) => r.cells);
    const at = (ref: string) => cells.find((c) => c.ref === ref);
    expect(at("A2")).toMatchObject({ type: "text", value: FORMULAS[0] });
    expect(at("A3")).toMatchObject({ type: "text", value: "@SUM(A1)" });
    // Positive control: the reader tells a number cell from a text cell.
    expect(at("B2")).toMatchObject({ type: "number", value: "-4" });
    const xml = await (
      await JSZip.loadAsync(bytes)
    )
      .file("xl/worksheets/sheet1.xml")!
      .async("string");
    expect(xml).not.toMatch(/<f[ >]/);
    expect(xml).toContain('t="inlineStr"');
  });
});
