import { describe, expect, it } from "vitest";
import { MAX_GRID_COLUMNS } from "@/lib/workers/pdf-office-export/docx-structure";
import { LONG_CELL_WORDS } from "./flow";
import {
  chainColumns,
  isNumberCell,
  MAX_TABLE_CELLS,
  MAX_TABLE_CELLS_PER_PAGE,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_SLOTS_PER_PAGE,
  MAX_TEXT_TABLE_CELL_WIDTH,
  MAX_TEXT_TABLE_CELL_WORDS,
  MIN_TEXT_TABLE_COLUMNS,
  MIN_TEXT_TABLE_ROWS,
  MIN_WORD_TABLE_ROWS,
  tableGrid,
  wordTableDoubt,
  type GridCellInput,
} from "./table-grid";

/**
 * #28 slice 2 (tables): the grid a recognised table is written on. Each
 * row's cells arrive in xMin order (flow.ts sorts them); the grid's spans are
 * `columns()`'s chained x-ranges, and `col[r][c]` is the span cell c of row r
 * falls in.
 */
const cell = (xMin: number, xMax: number): GridCellInput => ({ xMin, xMax });
const PAGE = {
  cells: MAX_TABLE_CELLS_PER_PAGE,
  slots: MAX_TABLE_SLOTS_PER_PAGE,
};

describe("tableGrid", () => {
  it("chains overlapping x-ranges into spans and puts each cell in its own", () => {
    const grid = tableGrid(
      [
        [cell(50, 85), cell(160, 175), cell(270, 285)],
        [cell(50, 77), cell(160, 184), cell(270, 294)],
      ],
      PAGE,
    );
    expect(grid).toEqual({
      spans: [
        [50, 85],
        [160, 184],
        [270, 294],
      ],
      col: [
        [0, 1, 2],
        [0, 1, 2],
      ],
    });
  });

  it("an empty column in a row keeps the next value in ITS column, not shifted left", () => {
    const grid = tableGrid(
      [
        [cell(72, 100), cell(300, 320), cell(420, 450)],
        [cell(72, 110), cell(420, 452)],
      ],
      PAGE,
    );
    if (typeof grid === "string") throw new Error(grid);
    expect(grid.col[1]).toEqual([0, 2]);
  });

  it("two cells of one row that chain into one span share it, in xMin order", () => {
    // SPANNING_TABLE's shape: a header cell over two sub-columns.
    const grid = tableGrid(
      [
        [cell(60, 95), cell(200, 314)],
        [cell(200, 215), cell(280, 295), cell(360, 375)],
        [cell(60, 87), cell(200, 224), cell(280, 304), cell(360, 384)],
      ],
      PAGE,
    );
    if (typeof grid === "string") throw new Error(grid);
    expect(grid.spans).toEqual([
      [60, 95],
      [200, 314],
      [360, 384],
    ]);
    expect(grid.col).toEqual([
      [0, 1],
      [1, 1, 2],
      [0, 1, 1, 2],
    ]);
  });

  it("refuses a grid of one column, and one of more than Word's 63", () => {
    expect(tableGrid([[cell(0, 10)], [cell(5, 20)]], PAGE)).toBe("one-column");
    const wide = (n: number) =>
      Array.from({ length: n }, (_, k) => cell(k * 10, k * 10 + 5));
    const at = tableGrid([wide(63), wide(63)], PAGE);
    expect(typeof at === "string" ? at : at.spans.length).toBe(63);
    expect(tableGrid([wide(64), wide(64)], PAGE)).toBe("columns");
  });

  it("refuses a table over the cell cap, or over what the page has left, before chaining", () => {
    const row = [cell(0, 5), cell(10, 15)];
    const rows = Array.from({ length: MAX_TABLE_CELLS / 2 + 1 }, () => row);
    expect(tableGrid(rows, PAGE)).toBe("cells");
    expect(tableGrid([row, row], { cells: 3, slots: 100 })).toBe("cells");
    // Slots count the empties: 2 rows x 3 spans = 6 slots.
    expect(
      tableGrid(
        [
          [cell(0, 5), cell(10, 15)],
          [cell(0, 5), cell(20, 25)],
        ],
        { cells: 100, slots: 5 },
      ),
    ).toBe("cells");
  });

  it('refuses ("order") rather than throws when a row is not in xMin order', () => {
    expect(
      tableGrid(
        [
          [cell(100, 120), cell(0, 10)],
          [cell(0, 10), cell(100, 120)],
        ],
        PAGE,
      ),
    ).toBe("order");
  });

  it("a 10,000-cell table is gridded in bounded time", () => {
    const rows = Array.from({ length: 5_000 }, () => [
      cell(0, 5),
      cell(10, 15),
    ]);
    const t0 = performance.now();
    const grid = tableGrid(rows, PAGE);
    const ms = performance.now() - t0;
    expect(typeof grid === "string" ? grid : grid.col.length).toBe(5_000);
    // A control-relative bound: chaining the same cells by hand.
    const c0 = performance.now();
    chainColumns(rows.flat());
    const control = performance.now() - c0;
    expect(ms).toBeLessThan(50 * Math.max(control, 1));
  });

  it("holds Word's limit equal to the reader's", () => {
    expect(MAX_TABLE_COLUMNS).toBe(MAX_GRID_COLUMNS);
  });
});

/**
 * Review round 2 (2026-11-15): a grid whose geometry is sound is still kept
 * as tabbed rows when the table is doubtful (`wordTableDoubt`). Each case is
 * one the review built as a FALSE Word table on the branch; each reason is
 * shown firing on its own, and a real table passing all of them.
 */
describe("wordTableDoubt", () => {
  /** Rows of [x, text] cells, gridded by the real tableGrid. */
  const doubt = (rows: [number, string][][]) => {
    const cells = rows.map((row) =>
      row.map(([x, text]) => ({ xMin: x, xMax: x + 6 * text.length, text })),
    );
    const grid = tableGrid(cells, PAGE);
    if (typeof grid === "string") throw new Error(grid);
    return wordTableDoubt(cells, grid);
  };

  it("POSITIVE CONTROL: an invoice table with a figure column is a Word table", () => {
    expect(
      doubt([
        [
          [72, "Item"],
          [300, "Qty"],
          [420, "Price"],
        ],
        [
          [72, "Widget"],
          [300, "2"],
          [420, "9.50"],
        ],
        [
          [72, "Gadget"],
          [420, "12.00"],
        ],
        [
          [72, "Gizmo"],
          [300, "5"],
          [420, "3.25"],
        ],
      ]),
    ).toBeNull();
  });

  it('"rows": a two-line running header is not a Word table', () => {
    expect(MIN_WORD_TABLE_ROWS).toBe(3);
    expect(
      doubt([
        [
          [50, "Annual Report 2026"],
          [470, "2026"],
        ],
        [
          [50, "Section 3 Results"],
          [470, "4"],
        ],
      ]),
    ).toBe("rows");
  });

  it('"numbers": a letterhead has no column of figures', () => {
    expect(
      doubt([
        [
          [50, "ACME Corporation"],
          [430, "Invoice 1042"],
        ],
        [
          [50, "12 Harbour Road"],
          [430, "Date 2026-11-15"],
        ],
        [
          [50, "Dhaka 1207"],
          [430, "Due 2026-12-15"],
        ],
      ]),
    ).toBe("numbers");
  });

  it('"numbers": a sidebar of names beside prose of a caseless script', () => {
    expect(
      doubt([
        [
          [50, "Rahim"],
          [200, "আমাদের প্রতিষ্ঠান গত বছর অনেক নতুন"],
        ],
        [
          [50, "Karim"],
          [200, "গ্রাহকের কাছে পৌঁছেছে এবং সেবার মান"],
        ],
        [
          [50, "Salma"],
          [200, "আরও উন্নত করেছে যা সবার কাছে"],
        ],
      ]),
    ).toBe("numbers");
  });

  it('"numbers": a list numbered "1." "2." "3." is not a figure column', () => {
    expect(
      doubt([
        [
          [50, "1."],
          [120, "Open the file"],
        ],
        [
          [50, "2."],
          [120, "Choose a page"],
        ],
        [
          [50, "3."],
          [120, "Press Save"],
        ],
      ]),
    ).toBe("numbers");
  });

  it('"prose": sentences set beside a table are not its third column', () => {
    expect(
      doubt([
        [
          [50, "Item"],
          [150, "Qty"],
          [330, "Sales rose sharply."],
        ],
        [
          [50, "Widget"],
          [150, "2"],
          [330, "Margins held firm."],
        ],
        [
          [50, "Gadget"],
          [150, "7"],
          [330, "Outlook remains good."],
        ],
      ]),
    ).toBe("prose");
  });

  it('"header": a heading that does not overlap its values heads no column alone', () => {
    // REPORT_TABLES_BBOX's second table, its words' x-ranges as captured.
    const cells = [
      [
        { xMin: 60, xMax: 90, text: "Office" },
        { xMin: 160, xMax: 184, text: "Staff" },
        { xMin: 240, xMax: 285, text: "Manager" },
      ],
      [
        { xMin: 60, xMax: 92, text: "London" },
        { xMin: 203, xMax: 215, text: "12" },
        { xMin: 240, xMax: 300, text: "Ada Lovelace" },
      ],
      [
        { xMin: 60, xMax: 100, text: "New York" },
        { xMin: 203, xMax: 215, text: "30" },
        { xMin: 240, xMax: 300, text: "Grace Hopper" },
      ],
    ];
    const grid = tableGrid(cells, PAGE);
    if (typeof grid === "string") throw new Error(grid);
    // The geometry alone puts "Staff" over an empty column of its own.
    expect(grid.spans).toHaveLength(4);
    expect(grid.col[0]).toEqual([0, 1, 3]);
    expect(grid.col[1]).toEqual([0, 2, 3]);
    expect(wordTableDoubt(cells, grid)).toBe("header");
  });

  it("isNumberCell: figures, dates, codes and amounts; not words, list numbers or labels", () => {
    const yes = [
      "12",
      "1,250.00",
      "$3,400.50",
      "41%",
      "2026-01-05",
      "A-100",
      "Q1",
      "(300)",
      "$ 4.50",
      "1 200",
      "১২৩",
    ];
    const no = [
      "Total",
      "Page 4",
      "Invoice 1042",
      "12 Harbour Road",
      "1.",
      "a)",
      "iv.",
      "Due 2026-12-15",
      "收入增长了20%左右",
    ];
    expect(yes.filter((t) => !isNumberCell(t))).toEqual([]);
    expect(no.filter((t) => isNumberCell(t))).toEqual([]);
  });
});

/**
 * Audit wave 2 pdf-to-word#2 (2026-11-28): a table with NO column of figures
 * — a staff list of names and roles — was
 * always tabbed rows ("numbers"). It is now a Word table when it is clearly
 * a table of short entries (`isTextTable`): at least MIN_TEXT_TABLE_ROWS
 * rows, every cell short, every row with an entry in the first column, and
 * no column that is only list numbering or bullets. Each false table the
 * round-2 review built stays refused, each on the leg named.
 */
describe("text-only tables (pdf-to-word#2)", () => {
  const doubt = (rows: [number, string][][]) => {
    const cells = rows.map((row) =>
      row.map(([x, text]) => ({ xMin: x, xMax: x + 6 * text.length, text })),
    );
    const grid = tableGrid(cells, PAGE);
    if (typeof grid === "string") throw new Error(grid);
    return wordTableDoubt(cells, grid);
  };
  const STAFF: [number, string][][] = [
    [
      [72, "Name"],
      [220, "City"],
      [380, "Role"],
    ],
    [
      [72, "Ada"],
      [220, "London"],
      [380, "Engineer"],
    ],
    [
      [72, "Grace"],
      [220, "Arlington"],
      [380, "Admiral"],
    ],
    [
      [72, "Jamal"],
      [220, "Dhaka"],
      [380, "Physicist"],
    ],
  ];

  it("a staff list of names, cities and roles (four rows, no figures) is a Word table", () => {
    expect(MIN_TEXT_TABLE_ROWS).toBe(4);
    expect(doubt(STAFF)).toBeNull();
  });

  // INVERTED 2026-11-28 (review of pdf-to-word#2): this held a two-column
  // form grid as a Word table (toBeNull). The same rule turned a four-line
  // letterhead and a signature block into bordered tables, so a table with
  // no figures now needs MIN_TEXT_TABLE_COLUMNS columns, and a form's
  // labels and values, two columns, stays tabbed rows.
  it('"numbers": a two-column form grid of labels and values stays tabbed', () => {
    expect(MIN_TEXT_TABLE_COLUMNS).toBe(3);
    expect(
      doubt([
        [
          [72, "Full name"],
          [240, "Rahim Uddin"],
        ],
        [
          [72, "Email"],
          [240, "rahim@example.com"],
        ],
        [
          [72, "Department"],
          [240, "Accounts"],
        ],
        [
          [72, "Manager"],
          [240, "Salma Begum"],
        ],
      ]),
    ).toBe("numbers");
  });

  it('"numbers": a two-column signature block of four lines stays tabbed', () => {
    expect(
      doubt(
        [
          ["Yours sincerely,", "Approved by"],
          ["Rahim Uddin", "Salma Begum"],
          ["Head of Accounts", "Managing Director"],
          ["Acme Trading Ltd", "Acme Trading Ltd"],
        ].map(([a, b]) => [
          [72, a!],
          [340, b!],
        ]),
      ),
    ).toBe("numbers");
  });

  it('"numbers": the same staff list with three rows stays tabbed', () => {
    expect(doubt(STAFF.slice(0, 3))).toBe("numbers");
  });

  it('"numbers": a cell of four or more words is text, not a table entry', () => {
    const long = STAFF.map((r) => [...r]);
    long[2]![2] = [380, "Admiral of the fleet"];
    expect(MAX_TEXT_TABLE_CELL_WORDS).toBe(3);
    // One fewer than flow.ts's LONG_CELL_WORDS, as its docblock says.
    expect(MAX_TEXT_TABLE_CELL_WORDS).toBe(LONG_CELL_WORDS - 1);
    expect(doubt(long)).toBe("numbers");
  });

  it('"numbers": a cell wider than the character limit is text', () => {
    const wide = STAFF.map((r) => [...r]);
    wide[1]![1] = [220, "Llanfairpwllgwyngyllgogery"];
    expect([..."Llanfairpwllgwyngyllgogery"].length).toBeGreaterThan(
      MAX_TEXT_TABLE_CELL_WIDTH,
    );
    expect(doubt(wide)).toBe("numbers");
  });

  it('"numbers": two columns of Chinese prose, four lines each, stay tabbed', () => {
    expect(
      doubt(
        [
          ["我们公司去年取得了很好的成绩", "今年我们将继续扩大市场份额"],
          ["收入增长了百分之二十左右", "并在亚洲开设新的分公司"],
          ["成本也得到了有效的控制", "同时加强研发投入和人才"],
          ["员工人数也有所增加", "培养计划以支持长期发展"],
        ].map(([a, b]) => [
          [50, a!],
          [320, b!],
        ]),
      ),
    ).toBe("numbers");
  });

  // Three columns since 2026-11-28 (MIN_TEXT_TABLE_COLUMNS); the same two
  // columns alone are "numbers", the case below.
  it("POSITIVE CONTROL: short Chinese entries in a four-row, three-column grid are a Word table", () => {
    expect(
      doubt(
        [
          ["姓名", "部门", "职位"],
          ["王伟", "财务部", "经理"],
          ["李娜", "市场部", "主管"],
          ["张敏", "研发部", "工程师"],
        ].map(([a, b, c]) => [
          [50, a!],
          [220, b!],
          [400, c!],
        ]),
      ),
    ).toBeNull();
  });

  it('"numbers": the same Chinese entries in two columns stay tabbed', () => {
    expect(
      doubt(
        [
          ["姓名", "部门"],
          ["王伟", "财务部"],
          ["李娜", "市场部"],
          ["张敏", "研发部"],
        ].map(([a, b]) => [
          [50, a!],
          [320, b!],
        ]),
      ),
    ).toBe("numbers");
  });

  it('"numbers": a numbered list of four short steps stays tabbed', () => {
    expect(
      doubt(
        ["Open the file", "Choose a page", "Press Save", "Close it"].map(
          (t, k) => [
            [50, `${k + 1}.`],
            [120, t],
          ],
        ),
      ),
    ).toBe("numbers");
  });

  it('"numbers": a bulleted list of four short items stays tabbed', () => {
    expect(
      doubt(
        ["Milk", "Bread", "Eggs", "Rice"].map((t) => [
          [50, "•"],
          [70, t],
        ]),
      ),
    ).toBe("numbers");
  });

  it('"numbers": a row with nothing in the first column stays tabbed', () => {
    const gap: [number, string][][] = STAFF.map((r) => [...r]);
    gap[2] = gap[2]!.slice(1);
    expect(doubt(gap)).toBe("numbers");
  });

  it('"rows", "prose" and "header" still come first', () => {
    expect(doubt(STAFF.slice(0, 2))).toBe("rows");
    const prose = STAFF.map((r) => [...r]);
    prose[1]![2] = [380, "Sales rose."];
    prose[2]![2] = [380, "Costs fell."];
    expect(doubt(prose)).toBe("prose");
  });
});

describe("the copy's numbers are the rule's (pdf-to-word#2)", () => {
  it("PDF_TO_WORD_TEXT_TABLE names MIN_TEXT_TABLE_ROWS and MAX_TEXT_TABLE_CELL_WORDS", async () => {
    const { PDF_TO_WORD_TEXT_TABLE } = await import("@/lib/tools/tool-facts");
    const spelled = ["zero", "one", "two", "three", "four", "five", "six"];
    expect(PDF_TO_WORD_TEXT_TABLE).toContain(
      `at least ${spelled[MIN_TEXT_TABLE_ROWS]} rows`,
    );
    expect(PDF_TO_WORD_TEXT_TABLE).toContain(
      `up to ${spelled[MAX_TEXT_TABLE_CELL_WORDS]} words`,
    );
    expect(PDF_TO_WORD_TEXT_TABLE).toContain(
      `${spelled[MIN_TEXT_TABLE_ROWS]} rows and ${spelled[MIN_TEXT_TABLE_COLUMNS]} columns`,
    );
  });

  /**
   * Review of pdf-to-word#2 (2026-11-28): the tables FAQ's refusal list and
   * the guides' sentences were literals, held only by pinned constants, so a
   * constant changed with the derived phrase left them stale. This test
   * DISCOVERS every served sentence of each shape (every tool page and every
   * guide) and reads its numbers back against the rule's constants. A
   * "rows of short entries" with no column count is an over-claim since
   * MIN_TEXT_TABLE_COLUMNS, and is refused wherever it appears.
   */
  it("every served sentence of the rule's shapes states the rule's numbers", async () => {
    const { toolContent } = await import("@/lib/tools/content");
    const { guides } = await import("@/lib/guides");
    const corpus = JSON.stringify([toolContent, guides]);
    const spelled = ["zero", "one", "two", "three", "four", "five", "six"];
    const n = (word: string) => spelled.indexOf(word);
    const grid = [
      ...corpus.matchAll(
        /at least ([a-z]+) rows and ([a-z]+) columns of short entries/g,
      ),
    ];
    const refusals = [
      ...corpus.matchAll(
        /no column of figures that has fewer than ([a-z]+) rows or ([a-z]+) columns, an entry of more than ([a-z]+) words/g,
      ),
    ];
    const words = [
      ...corpus.matchAll(/short entries of up to ([a-z]+) words/g),
    ];
    // Health: the intro, the two FAQ answers, the keep answer and two
    // guides; the tables FAQ's refusal list; the long form's word limit.
    expect(grid.length).toBeGreaterThanOrEqual(5);
    expect(refusals.length).toBeGreaterThanOrEqual(1);
    expect(words.length).toBeGreaterThanOrEqual(1);
    expect(
      grid.filter(
        (m) =>
          n(m[1]!) !== MIN_TEXT_TABLE_ROWS ||
          n(m[2]!) !== MIN_TEXT_TABLE_COLUMNS,
      ),
    ).toEqual([]);
    expect(
      refusals.filter(
        (m) =>
          n(m[1]!) !== MIN_TEXT_TABLE_ROWS ||
          n(m[2]!) !== MIN_TEXT_TABLE_COLUMNS ||
          n(m[3]!) !== MAX_TEXT_TABLE_CELL_WORDS,
      ),
    ).toEqual([]);
    expect(words.filter((m) => n(m[1]!) !== MAX_TEXT_TABLE_CELL_WORDS)).toEqual(
      [],
    );
    expect(
      [...corpus.matchAll(/at least [a-z]+ rows of short entries/g)].map(
        (m) => m[0],
      ),
    ).toEqual([]);
  });
});
