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

  describe("a two-run line a BLANK line away from the table never merges its columns", () => {
    // 1287f42 named this "does not let a prose line with a double space
    // collapse the table below it" and passed only because the fixture's
    // one-run "Invoice" and address lines sat between the prose and the
    // table. With nothing but a blank line between them the prose joined the
    // table's block (blank lines were let through unconditionally) and its
    // runs bridged the gutters: Qty and Amount shared one cell, and a page
    // footer below the table did the same from underneath. So the corpus puts
    // the line DIRECTLY above the header and a footer DIRECTLY below the last
    // row, each one blank line away, in every captured invoice layout
    // (discovered, as the property test below discovers them).
    const prose =
      "Payment is due within thirty days  of the invoice date shown below.";
    const layouts = Object.entries(popplerSamples)
      .filter(([name]) => /^INVOICE\w*_LAYOUT$/.test(name))
      .map(([name, text]) => {
        const lines = String(text).replace(/\f$/, "").trimEnd().split("\n");
        const at = lines.findIndex((l) => l.startsWith(INVOICE_ROWS[0][0]));
        return { name, table: lines.slice(at) };
      });
    /**
     * Two footers, both starting in column A: one whose second run lands
     * under Amount (the union LOSES a column), and one whose second run sits
     * past the table's right edge (the union loses a column AND gains one,
     * so a count of columns alone would call it compatible).
     */
    function footers(table: string[]) {
      const lead = "Thank you for your business.";
      const amount = table[0]!.indexOf(INVOICE_ROWS[0].at(-1)!);
      const edge = Math.max(...table.map((l) => l.length));
      return [
        `${lead.padEnd(amount)}Page 1 of 1`,
        `${lead.padEnd(edge + 4)}Page 1 of 1`,
      ];
    }
    const pages = layouts.flatMap(({ name, table }) =>
      footers(table).flatMap((footer, f) => [
        { name: `${name} + prose above`, lines: [prose, "", ...table] },
        { name: `${name} + footer ${f}`, lines: [...table, "", footer] },
        {
          name: `${name} + prose above + footer ${f}`,
          lines: [prose, "", ...table, "", footer],
        },
      ]),
    );

    it("HEALTH: two captures, and each added line really bridges a gutter of the table", () => {
      expect(layouts.map((l) => l.name).sort()).toEqual([
        "INVOICE_LAYOUT",
        "INVOICE_SPACED_LAYOUT",
      ]);
      expect(pages).toHaveLength(2 * 2 * 3);
      // Each added line has a run that covers two different headings'
      // positions: joined to the table, it cannot help but merge them.
      for (const { table } of layouts) {
        const header = table[0]!;
        const headings = INVOICE_ROWS[0].map((h) => header.indexOf(h));
        for (const line of [prose, ...footers(table)]) {
          const bridges = [...line.matchAll(/[^ ]+(?: [^ ]+)*/g)].some(
            (run) =>
              headings.filter(
                (h) => h >= run.index && h < run.index + run[0].length,
              ).length >= 2,
          );
          expect(bridges, line).toBe(true);
        }
      }
    });

    /**
     * The grid rows of the table's lines. The grid holds one row per
     * non-blank line, so the header's row is found by LINE, not by its first
     * cell — a merged header ("Invoice No Date") must still be compared.
     */
    function tableOf(lines: string[], grid: (string | null)[][]) {
      const nonBlank = lines.filter((l) => l !== "");
      const at = nonBlank.findIndex((l) => l.startsWith(INVOICE_ROWS[0][0]));
      return grid.slice(at, at + INVOICE_ROWS.length);
    }

    it("the table's rows are INVOICE_ROWS, cell for cell, and the added lines keep their text", () => {
      const wrong = pages.flatMap(({ name, lines }) => {
        const grid = layoutGrid(lines.join("\n"));
        const got = tableOf(lines, grid);
        return JSON.stringify(got) ===
          JSON.stringify(INVOICE_ROWS.map(expected))
          ? []
          : [`${name}: ${JSON.stringify(got)}`];
      });
      expect(wrong).toEqual([]);
      for (const { name, lines } of pages) {
        const all = layoutGrid(lines.join("\n")).flat().join(" ");
        for (const line of lines.filter((l) => l !== ""))
          for (const run of line.trim().split(/ {2,}/))
            expect(all, name).toContain(run);
      }
    });

    it("POSITIVE CONTROL: with no blank line between them, the same lines ARE taken as rows and merge columns", () => {
      // What the blank line is worth: adjacent to the table, a two-run line
      // is a row by every measure `-layout` gives, and it merges columns.
      // This is the documented limit, and it shows each added line is
      // capable of the damage the blank-line rule has to keep out.
      for (const { name, table } of layouts)
        for (const footer of footers(table)) {
          const rows = table.filter((l) => l !== "");
          for (const lines of [
            [prose, ...rows],
            [...rows, footer],
          ])
            expect(
              tableOf(lines, layoutGrid(lines.join("\n"))),
              name,
            ).not.toEqual(INVOICE_ROWS.map(expected));
        }
    });
  });

  describe("a row with one cell straddling the next column moves no value, rows together or a blank line apart", () => {
    // Once a blank line stopped carrying a block, a straddling row in a
    // widely spaced table was REFUSED by the table above it (its union merges
    // two columns) — and laid out on its own four columns, which numbered its
    // cells in order again: Qty's value under Description, Amount's under Qty.
    // Corpus: every captured invoice layout (discovered), every data row with
    // a printed cell followed by an EMPTY one, that cell's text extended to
    // run three characters into the empty column's heading.
    const cases = Object.entries(popplerSamples)
      .filter(([name]) => /^INVOICE\w*_LAYOUT$/.test(name))
      .flatMap(([name, text]) => {
        const lines = String(text).replace(/\f$/, "").trimEnd().split("\n");
        const at = lines.findIndex((l) => l.startsWith(INVOICE_ROWS[0][0]));
        const header = lines[at]!;
        const rowLine = (r: number) =>
          lines.findIndex(
            (l, i) => i > at && l.startsWith(INVOICE_ROWS[r]![0]),
          );
        return INVOICE_ROWS.slice(1).flatMap((cells, k) =>
          cells.flatMap((cell, c) => {
            if (cell === "" || cells[c + 1] !== "") return [];
            const index = rowLine(k + 1);
            const line = lines[index]!;
            const start = line.indexOf(cell);
            const end = header.indexOf(INVOICE_ROWS[0][c + 1]!) + 3;
            const long = `${cell} ${"x".repeat(end - start - cell.length - 1)}`;
            const next = line.slice(start + cell.length).search(/[^ ]/);
            if (start + long.length + 2 > start + cell.length + next)
              throw new Error(`${name}: no room to straddle on row ${k + 1}`);
            const mutated = [...lines];
            mutated[index] =
              line.slice(0, start) + long + line.slice(start + long.length);
            const values = cells.map((v, i) => (i === c ? long : v));
            return [{ name, row: k + 1, column: c, lines: mutated, values }];
          }),
        );
      });

    it("HEALTH: two captures, two straddling rows each (1002's Date, the Total label)", () => {
      expect(cases.map((c) => `${c.name} ${c.row}:${c.column}`).sort()).toEqual(
        [
          "INVOICE_LAYOUT 2:1",
          "INVOICE_LAYOUT 4:0",
          "INVOICE_SPACED_LAYOUT 2:1",
          "INVOICE_SPACED_LAYOUT 4:0",
        ],
      );
    });

    /** Every value not under a heading cell that holds its own heading. */
    function movedValues(
      grid: (string | null)[][],
      lines: string[],
      rows: readonly (readonly string[])[],
    ) {
      const nonBlank = lines.filter((l) => l !== "");
      const at = nonBlank.findIndex((l) => l.startsWith(INVOICE_ROWS[0][0]));
      const heading = grid[at]!;
      const holds = (cell: string | null | undefined, v: string) =>
        cell != null &&
        (cell === v ||
          cell.startsWith(`${v} `) ||
          cell.endsWith(` ${v}`) ||
          cell.includes(` ${v} `));
      return rows.flatMap((cells, r) =>
        cells.flatMap((v, c) => {
          if (v === "") return [];
          const got = grid[at + r + 1]!;
          const k = got.findIndex((cell) => holds(cell, v));
          return k >= 0 && holds(heading[k], INVOICE_ROWS[0][c]!)
            ? []
            : [
                `${v} (${INVOICE_ROWS[0][c]}) in ${JSON.stringify(got)} under ${JSON.stringify(heading)}`,
              ];
        }),
      );
    }

    it("every value of every row sits under a heading cell holding its own heading", () => {
      const wrong = cases.flatMap(({ name, row, lines, values }) => {
        const rows = INVOICE_ROWS.slice(1).map((r, i) =>
          i + 1 === row ? values : r,
        );
        return movedValues(layoutGrid(lines.join("\n")), lines, rows).map(
          (p) => `${name} row ${row}: ${p}`,
        );
      });
      expect(wrong).toEqual([]);
    });

    it("POSITIVE CONTROL: the straddling row laid out on its own columns is caught", () => {
      const own = (page: string) =>
        page
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((l) => l.trim().split(/ {2,}/));
      const { lines, row, values } = cases.find(
        (c) => c.name === "INVOICE_SPACED_LAYOUT" && c.row === 2,
      )!;
      const rows = INVOICE_ROWS.slice(1).map((r, i) =>
        i + 1 === row ? values : r,
      );
      expect(movedValues(own(lines.join("\n")), lines, rows)).not.toEqual([]);
    });
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
    // A two-run footer further down, straddling the Qty gutter, is not the
    // table's: with prose between, it is refused and laid out on its own,
    // and the prose between keeps its lines whole, in column A.
    const footer = `${"Thank you for your order.".padEnd(30)}Page 1`;
    expect(
      layoutGrid([...table, ...below, "", footer].join("\n")).slice(2),
    ).toEqual([
      ["Thank you for your business."],
      ["Payment within 30 days."],
      ["Thank you for your order.", "Page 1"],
    ]);
  });

  it("gives a second, smaller table a blank line below the first its own columns", () => {
    // Its runs straddle the first table's gutters, so it is refused, and two
    // rows together are a table, not a straddling row: laid out on the first
    // table's columns its dates would sit under Amount, a column apart.
    const table = ["Item       Qty    Amount", "Widgets      2    100.00"];
    const second = [
      "Paid by card        2026-01-09",
      "Ref ABC-12           2026-01-10",
    ];
    expect(layoutGrid([...table, "", ...second].join("\n"))).toEqual([
      ["Item", "Qty", "Amount"],
      ["Widgets", "2", "100.00"],
      ["Paid by card", "2026-01-09"],
      ["Ref ABC-12", "2026-01-10"],
    ]);
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
