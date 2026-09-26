import { describe, expect, it } from "vitest";
import * as popplerSamples from "@/tests/poppler-samples";
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

  it("puts a lone amount on a table's LAST line under Amount, as it does mid-table", () => {
    // An unlabeled total below the rows, which `-layout` prints as spaces and
    // then the number. At 1287f42 the same line was placed by position in the
    // middle of a table, and sent to column A, under "Item", as the last line.
    const table = [
      "Item       Qty    Amount",
      "Widgets      2    100.00",
      "Bolts        3     50.00",
    ];
    const lone = `${" ".repeat(18)}150.00`;
    expect(layoutGrid([...table, lone].join("\n")).at(-1)).toEqual([
      null,
      null,
      "150.00",
    ]);
    // Blank lines between it and the rows are tolerated, as between rows.
    expect(layoutGrid([...table, "", "", lone].join("\n")).at(-1)).toEqual([
      null,
      null,
      "150.00",
    ]);
    // POSITIVE CONTROL: the same line mid-table was already right.
    const nuts = "Nuts         1      9.00";
    expect(layoutGrid([...table, lone, nuts].join("\n"))[3]).toEqual([
      null,
      null,
      "150.00",
    ]);
  });

  it("still writes prose and titles below a table whole, in column A", () => {
    const table = ["Item       Qty    Amount", "Widgets      2    100.00"];
    // The second line is indented under Qty: once a line in the first column
    // has ended the table, what follows is prose, not the table's tail.
    const below = [
      "",
      "Thank you for your business.",
      `${" ".repeat(13)}Payment within 30 days.`,
    ];
    expect(layoutGrid([...table, ...below].join("\n")).slice(2)).toEqual([
      ["Thank you for your business."],
      ["Payment within 30 days."],
    ]);
    // A line past the table's right edge sits under no column: left whole.
    expect(
      layoutGrid([...table, `${" ".repeat(30)}Page 1`].join("\n")).at(-1),
    ).toEqual(["Page 1"]);
  });

  describe("values may be COMBINED, never MOVED under another header", () => {
    // The docblock's invariant, as a test. Corpus: every captured invoice
    // layout (DISCOVERED in poppler-samples, not named), every data row of
    // it, every non-empty subset of that row's printed cells, the others
    // blanked to spaces, which is how `-layout` prints an empty cell. Each
    // kept value must land under its OWN header and every other cell of the
    // row must be empty. The last row is in the corpus, so a lone value on a
    // table's last line (an unlabeled total, a balance brought forward) is
    // exercised in every column: the shape 1287f42 put in column A.
    const layouts = Object.entries(popplerSamples)
      .filter(([name]) => /^INVOICE\w*_LAYOUT$/.test(name))
      .map(([name, text]) => ({
        name,
        page: String(text).replace(/\f$/, "").trimEnd(),
      }));

    interface Case {
      name: string;
      row: number;
      kept: string[];
      page: string;
      want: (string | null)[];
    }
    const cases: Case[] = layouts.flatMap(({ name, page }) => {
      const lines = page.split("\n");
      const header = lines.findIndex((l) => l.startsWith(INVOICE_ROWS[0][0]));
      // The table's lines, header first, blank lines skipped.
      const table = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line, index }) => index >= header && line.trim() !== "");
      return INVOICE_ROWS.slice(1).flatMap((cells, k) => {
        const row = k + 1;
        const { line, index } = table[row]!;
        let from = 0;
        const printed = cells.flatMap((text, column) => {
          if (text === "") return [];
          const start = line.indexOf(text, from);
          if (start < 0) throw new Error(`${name}: ${text} is not on its line`);
          from = start + text.length;
          return [{ text, column, start }];
        });
        return Array.from({ length: (1 << printed.length) - 1 }, (_, m) => {
          const keep = printed.filter((_, bit) => (m + 1) & (1 << bit));
          const chars = Array.from(line, () => " ");
          for (const { text, start } of keep)
            chars.splice(start, text.length, ...text);
          const mutated = [...lines];
          mutated[index] = chars.join("").trimEnd();
          const want = cells.map((text, c) =>
            keep.some((p) => p.column === c) ? text : null,
          );
          while (want.at(-1) === null) want.pop();
          return {
            name,
            row,
            kept: keep.map((p) => INVOICE_ROWS[0][p.column]!),
            page: mutated.join("\n"),
            want,
          };
        });
      });
    });

    /** Every case a grid function gets wrong, one line each. */
    function moved(grid: (page: string) => (string | null)[][]): string[] {
      return cases.flatMap(({ name, row, kept, page, want }) => {
        const got = tableRows(grid(page))[row];
        return JSON.stringify(got) === JSON.stringify(want)
          ? []
          : [
              `${name} row ${row} keeping [${kept.join(", ")}]: got ${JSON.stringify(got)}`,
            ];
      });
    }

    it("HEALTH: the corpus is the size the invoice says, and holds lone last-line values", () => {
      // Two captures (16pt and 24pt gaps); per capture 31 + 15 + 31 + 7 subsets.
      expect(layouts.map((l) => l.name).sort()).toEqual([
        "INVOICE_LAYOUT",
        "INVOICE_SPACED_LAYOUT",
      ]);
      expect(cases).toHaveLength(2 * (31 + 15 + 31 + 7));
      const lastRow = INVOICE_ROWS.length - 1;
      expect(
        cases
          .filter((c) => c.row === lastRow && c.kept.length === 1)
          .map((c) => c.kept[0])
          .sort(),
      ).toEqual(["Amount", "Amount", "Invoice No", "Invoice No", "Qty", "Qty"]);
    });

    it("every kept value lands under its own header, in every row, the last included", () => {
      expect(moved(layoutGrid)).toEqual([]);
    });

    it("POSITIVE CONTROL: what shipped before 1287f42 (cells numbered in order) is caught", () => {
      const sequential = (page: string) =>
        page
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => l.trim().split(/ {2,}/));
      const problems = moved(sequential);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.some((p) => p.includes("row 4 keeping [Amount]"))).toBe(
        true,
      );
    });
  });
});
