// @vitest-environment node
/**
 * `numberCellProblems` — the deployment proofs' question for the wave-3
 * number cells — and `readWorkbookSheets`, the reader the sheet-set proofs
 * stand on. POSITIVE: the shared writer's own sheet of the proof's rows.
 * NEGATIVE: the writer before 2026-11-08, which stored every one of them as
 * text; and a date stored as a number but shown as one. HEALTH: an empty
 * sheet fails on every row, so "every row is right" is never vacuous.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  NUMBER_CELL_EXPECTED,
  NUMBER_CELL_ROWS,
  numberCellProblems,
} from "./number-cells-proof";
import { SheetStyles, worksheetXml, xmlEscape } from "./sheet-cells";
import { readXlsxSheet } from "./sheet-read";
import { readWorkbookSheets, sheetValues } from "./workbook-read";

async function sheetOf(sheetXml: string, stylesXml: string) {
  const zip = new JSZip();
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  zip.file("xl/styles.xml", stylesXml);
  return readXlsxSheet(
    new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
  );
}

/** The writer as it stood before audit pdf-to-excel#4: every cell text. */
function textOnlySheet(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map(
            (text, c) =>
              `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

describe("numberCellProblems", () => {
  it("POSITIVE: the shared writer's sheet of the proof's rows has none", async () => {
    const styles = new SheetStyles();
    const xml = worksheetXml(NUMBER_CELL_ROWS, styles);
    expect(numberCellProblems(await sheetOf(xml, styles.xml()))).toEqual([]);
  });

  it("NEGATIVE: the old writer — every amount and date as text — fails five rows", async () => {
    const styles = new SheetStyles();
    const problems = numberCellProblems(
      await sheetOf(textOnlySheet(NUMBER_CELL_ROWS), styles.xml()),
    );
    const numberRows = Object.entries(NUMBER_CELL_EXPECTED).filter(
      ([, w]) => w.type === "number",
    );
    expect(problems).toHaveLength(numberRows.length);
    expect(problems[0]).toBe(
      'Lakh: text "₹1,25,000.00", expected number "125000.00"',
    );
  });

  it("NEGATIVE: a date stored as its serial but formatted General shows 46027", async () => {
    const styles = new SheetStyles();
    const xml = worksheetXml(NUMBER_CELL_ROWS, styles).replace(
      /(<c r="B5") s="\d+"/,
      "$1",
    );
    expect(numberCellProblems(await sheetOf(xml, styles.xml()))).toEqual([
      'ISO date: stored 46027 but formatted "General", which does not show a date',
    ]);
  });

  /** The writer's sheet with `target`'s value cell wearing `source`'s style. */
  function restyled(target: string, source: string) {
    const styles = new SheetStyles();
    const xml = worksheetXml(NUMBER_CELL_ROWS, styles);
    const styleOf = (ref: string) => {
      const m = new RegExp(`<c r="${ref}" s="([0-9]+)"`).exec(xml);
      if (!m) throw new Error(`${ref} carries no style in the writer's sheet`);
      return m[1]!;
    };
    const from = styleOf(target);
    const to = styleOf(source);
    if (from === to) throw new Error(`${target} and ${source} share a style`);
    const out = xml.replace(
      `<c r="${target}" s="${from}"`,
      `<c r="${target}" s="${to}"`,
    );
    // The mutation's own health check: the swap landed, on that cell alone.
    expect(out).not.toBe(xml);
    return { xml: out, styles };
  }

  // One negative per format check: the right stored value under the wrong
  // display format. Each targets ONE row, so its line is the only problem.
  it.each([
    ["Lakh", "B2", "B3", "lakh grouping"],
    ["Bracketed", "B3", "B4", "the negative in brackets"],
    ["Trailing minus", "B4", "B3", "the negative with a trailing minus"],
    ["Named date", "B6", "B5", "a date"],
  ])(
    "NEGATIVE: %s stored right but formatted as another row's number",
    async (label, target, source, shows) => {
      const { xml, styles } = restyled(target, source);
      const problems = numberCellProblems(await sheetOf(xml, styles.xml()));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(
        new RegExp(
          `^${label}: stored -?[0-9.]+ but formatted ".*", which does not show ${shows}$`,
        ),
      );
    },
  );

  it("HEALTH: an empty sheet fails on every expected row", async () => {
    const styles = new SheetStyles();
    expect(
      numberCellProblems(await sheetOf(worksheetXml([], styles), styles.xml())),
    ).toHaveLength(Object.keys(NUMBER_CELL_EXPECTED).length);
  });

  it("every labelled row of the fixture has an expectation, and the reverse", () => {
    expect(
      NUMBER_CELL_ROWS.slice(1)
        .map((r) => r[0])
        .sort(),
    ).toEqual(Object.keys(NUMBER_CELL_EXPECTED).sort());
  });
});

describe("readWorkbookSheets", () => {
  async function book(
    sheets: { name: string; target: string; body?: string }[],
  ): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      `<workbook xmlns:r="r"><sheets>${sheets
        .map(
          (s, i) =>
            `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("")}</sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<Relationships>${sheets
        .map(
          (s, i) =>
            `<Relationship Id="rId${i + 1}" Type="ws" Target="${s.target}"/>`,
        )
        .join("")}</Relationships>`,
    );
    sheets.forEach((s, i) => {
      if (s.body !== undefined)
        zip.file(
          `xl/worksheets/sheet${i + 1}.xml`,
          `<worksheet><sheetData>${s.body}</sheetData></worksheet>`,
        );
    });
    return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  }
  const cell = (ref: string, text: string) =>
    `<row r="${ref.slice(1)}"><c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c></row>`;

  it("follows each sheet's relationship, not its position", async () => {
    // Sheet "Page 1" is filed as sheet2.xml's relationship target.
    const bytes = await book([
      {
        name: "Page 1",
        target: "worksheets/sheet2.xml",
        body: cell("A1", "one"),
      },
      {
        name: "Page &amp; 2",
        target: "worksheets/sheet1.xml",
        body: cell("A1", "two"),
      },
    ]);
    const sheets = await readWorkbookSheets(bytes);
    expect(sheets.map((s) => [s.name, sheetValues(s.sheet)])).toEqual([
      ["Page 1", ["two"]],
      ["Page & 2", ["one"]],
    ]);
  });

  it("a broken link is unreadable, never a shorter list", async () => {
    const bytes = await book([
      {
        name: "Page 1",
        target: "worksheets/sheet9.xml",
        body: cell("A1", "x"),
      },
    ]);
    await expect(readWorkbookSheets(bytes)).rejects.toThrow(/absent/);
    const empty = new JSZip();
    await expect(
      readWorkbookSheets(
        new Uint8Array(await empty.generateAsync({ type: "uint8array" })),
      ),
    ).rejects.toThrow(/no xl\/workbook.xml/);
  });
});
