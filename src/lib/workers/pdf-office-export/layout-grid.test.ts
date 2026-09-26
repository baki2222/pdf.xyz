import { describe, expect, it } from "vitest";
import { INVOICE_LAYOUT } from "@/tests/poppler-samples";
import { INVOICE_ROWS } from "@/tests/pdf-office-fixtures";
import { layoutGrid } from "./layout-grid";

/** One page of the captured invoice, as parseLayoutText hands it over. */
const invoicePage = INVOICE_LAYOUT.replace(/\f$/, "").trimEnd();

/** The table rows of a grid: from the row whose first cell is the header. */
function tableRows(grid: (string | null)[][]) {
  const at = grid.findIndex((row) => row[0] === INVOICE_ROWS[0][0]);
  return grid.slice(at);
}
/** A drawn row as the grid must hold it: nothing drawn → null, trailing trimmed. */
function expected(row: readonly string[]) {
  const cells = row.map((cell) => (cell === "" ? null : cell));
  while (cells.at(-1) === null) cells.pop();
  return cells;
}

describe("layoutGrid", () => {
  it("places every invoice cell under the header it was printed under", () => {
    expect(tableRows(layoutGrid(invoicePage))).toEqual(
      INVOICE_ROWS.map(expected),
    );
  });

  it("keeps lines outside the table whole, in column A — commas included", () => {
    const grid = layoutGrid(invoicePage);
    expect(grid.slice(0, 2)).toEqual([
      ["Invoice"],
      ["Acme Supplies, 12 Market Street"],
    ]);
  });

  it("keeps a table whole across a one-line row (a wrapped cell) and places that line by position", () => {
    const lines = invoicePage.split("\n");
    const at = lines.findIndex((l) => l.startsWith("1001"));
    // A wrapped Description continuation under row 1001, and a row below it
    // whose Description is empty: split into two blocks, the lower one alone
    // would have no Description column and move Qty and Amount left.
    const indent = lines[at]!.indexOf("Widgets");
    lines.splice(at + 1, 0, `${" ".repeat(indent)}(continued)`);
    const grid = tableRows(layoutGrid(lines.join("\n")));
    expect(grid[2]).toEqual([null, null, "(continued)"]);
    expect(grid.slice(3)).toEqual(INVOICE_ROWS.slice(2).map(expected));
  });

  it("does not let a prose line with a double space collapse the table below it", () => {
    const prose =
      "Payment is due within thirty days  of the invoice date shown below.";
    const grid = layoutGrid(`${prose}\n\n${invoicePage}`);
    expect(tableRows(grid)).toEqual(INVOICE_ROWS.map(expected));
  });

  it("joins, never splits, text that straddles two columns' positions", () => {
    const grid = layoutGrid(
      "Name    Qty\nA very long product name  5\nBolt    2",
    );
    // The long name is ONE segment and covers the Qty heading's position, so
    // those columns merge for the block: texts share a cell, nothing is cut
    // in half, and no value is moved under a different heading.
    expect(grid).toEqual([
      ["Name Qty"],
      ["A very long product name", "5"],
      ["Bolt 2"],
    ]);
  });

  it("never splits on a comma", () => {
    expect(layoutGrid("Smith, John    1,234.50")).toEqual([
      ["Smith, John", "1,234.50"],
    ]);
  });
});
