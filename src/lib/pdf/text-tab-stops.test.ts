// @vitest-environment node
/**
 * Text to PDF tab stops (audit wave 2, text-to-pdf#7). A tab used to become
 * four spaces wherever it stood, so a tab-separated table drew each column
 * at a different place on every row: "1\tJo" put "Jo" at column 5 and
 * "22\tAl" put "Al" at column 6. A tab now moves to the next tab stop, every
 * {@link TEXT_TAB_STOP} characters, as a terminal and a text editor do.
 *
 * Proved at the consumer: the SAVED PDF's text runs, with each column's x
 * computed from Courier's published advance (not pdf-lib's measurement).
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { expandTabs, textToPdf } from "./text-to-pdf";
import { TEXT_TAB_STOP } from "./text-page-options";
import { COURIER_ADVANCE_EM, drawnRuns } from "@/tests/pdf-drawn-runs";

const TAB = String.fromCharCode(9);

describe("expandTabs", () => {
  it("the stop is the 8 columns of a terminal", () => {
    expect(TEXT_TAB_STOP).toBe(8);
  });

  it("a tab moves to the next stop, counting what is already on the line", () => {
    expect(expandTabs(`a${TAB}b`)).toBe(`a${" ".repeat(7)}b`);
    expect(expandTabs(`abcdefg${TAB}b`)).toBe("abcdefg b");
    // A tab ON a stop moves a whole stop, never zero.
    expect(expandTabs(`abcdefgh${TAB}b`)).toBe(`abcdefgh${" ".repeat(8)}b`);
    expect(expandTabs(`${TAB}${TAB}x`)).toBe(`${" ".repeat(16)}x`);
    expect(expandTabs("no tabs")).toBe("no tabs");
  });

  it("counts per line, not across the text", () => {
    expect(expandTabs(`abc\nd${TAB}e`)).toBe(`abc\nd${" ".repeat(7)}e`);
  });
});

/** A tab-separated table whose cells are shorter than one stop. */
const ROWS = [
  ["id", "name", "amount", "due"],
  ["1", "Jo", "12.50", "May"],
  ["22", "Alexand", "7", "June"],
  ["333", "Bea", "1000.00", "July"],
];
const TSV = ROWS.map((r) => r.join(TAB)).join("\n");

/** The x of each cell's first glyph on each body row of page 1. */
async function columnXs(text: string): Promise<number[][]> {
  const doc = await PDFDocument.load(await textToPdf(text, { title: "table" }));
  // Title, then the "n / N" footer, then the body lines.
  const body = drawnRuns(doc, 0).slice(2);
  expect(body).toHaveLength(ROWS.length);
  return body.map((run, i) => {
    let from = 0;
    return ROWS[i]!.map((cell) => {
      const at = run.text.indexOf(cell, from);
      expect(at, `"${cell}" not drawn on row ${i + 1}`).toBeGreaterThan(-1);
      from = at + cell.length;
      return run.x + at * COURIER_ADVANCE_EM * run.size;
    });
  });
}

describe("Text to PDF: tab-separated columns line up in the saved PDF", () => {
  it("every column's first glyph is at the same x on every row", async () => {
    const xs = await columnXs(TSV);
    for (let col = 0; col < ROWS[0]!.length; col++) {
      const column = xs.map((row) => row[col]!);
      for (const x of column) expect(x).toBeCloseTo(column[0]!, 6);
    }
    // And the columns are one stop apart, not collapsed onto each other.
    const advance = COURIER_ADVANCE_EM * 11 * TEXT_TAB_STOP;
    expect(xs[0]![1]! - xs[0]![0]!).toBeCloseTo(advance, 6);
  });

  it("CONTROL: four spaces per tab (the old rule) misaligns the same table", async () => {
    const xs = await columnXs(TSV.split(TAB).join("    "));
    const second = xs.map((row) => row[1]!);
    expect(new Set(second.map((x) => x.toFixed(3))).size).toBeGreaterThan(1);
  });
});
