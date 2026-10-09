import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  buildTablesZip,
  detectTablesOnPage,
  EXTRACT_TABLES_ENGINE,
  runTableExtract,
  toCsv,
  type PdfLayout,
  type PdfLayoutPage,
  type PositionedTextItem,
} from "./engine";
import {
  cellsByRef,
  readXlsxSheet,
  sheetGridProblems,
} from "../ooxml/sheet-read";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { parseBboxLayout } from "../pdf-text/parse";
import { PdfTextExecError } from "../pdf-text/errors";
import * as popplerSamples from "@/tests/poppler-samples";
import * as officeFixtures from "@/tests/pdf-office-fixtures";
import * as tableFixtures from "@/tests/table-extract-fixtures";
import {
  OFFICE_FIXTURE_TABLES,
  REPORT_TABLES,
  TABLE_EXTRACT_FIXTURES,
  tablesMismatches,
  tablesProofVerdict,
  TITLED_TABLE,
  TITLED_TITLE,
} from "@/tests/table-extract-fixtures";

/** A positioned text item with sane defaults for width/height. */
function item(
  text: string,
  x: number,
  y: number,
  width = text.length * 5,
  height = 10,
): PositionedTextItem {
  return { text, x, y, width, height };
}

/** A 2-column, 3-row table laid out in PDF points (y grows upward). */
function tablePage(pageNumber = 1): PdfLayoutPage {
  return {
    pageNumber,
    width: 400,
    height: 300,
    items: [
      item("Name", 50, 100),
      item("Age", 200, 100),
      item("Alice", 50, 80),
      item("30", 200, 80),
      item("Bob", 50, 60),
      item("25", 200, 60),
    ],
  };
}

/**
 * A prose page: one text item per LINE, never tabular.
 *
 * Kept as a control, not as evidence. Until 2026-09-27 this was the only
 * prose this engine was tested on, and it is a shape the production extractor
 * never emits: `pdftotext -bbox-layout` gives one item per WORD. Fed words,
 * the engine of that day found a table in every two-column prose sample and
 * in no real table under a title. The word-level corpus below replaced it as
 * the evidence; this stays so that the whole-line shape keeps meaning prose.
 */
function prosePage(pageNumber = 1): PdfLayoutPage {
  return {
    pageNumber,
    width: 400,
    height: 300,
    items: [
      item("This is a single paragraph of running text.", 50, 100),
      item("It has no columns whatsoever, only prose.", 50, 85),
    ],
  };
}

function layout(pages: PdfLayoutPage[]): PdfLayout {
  return { pageCount: pages.length, pages };
}

describe("detectTablesOnPage", () => {
  it("recovers a 2-column, 3-row grid from aligned items", () => {
    const tables = detectTablesOnPage(tablePage());
    expect(tables).toHaveLength(1);
    expect(tables[0]!.pageNumber).toBe(1);
    expect(tables[0]!.rows).toEqual([
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  it("orders rows top-to-bottom regardless of item order", () => {
    const shuffled: PdfLayoutPage = {
      ...tablePage(),
      items: [
        item("25", 200, 60),
        item("Name", 50, 100),
        item("30", 200, 80),
        item("Bob", 50, 60),
        item("Age", 200, 100),
        item("Alice", 50, 80),
      ],
    };
    expect(detectTablesOnPage(shuffled)[0]!.rows).toEqual([
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "25"],
    ]);
  });

  it("finds no tables in prose", () => {
    expect(detectTablesOnPage(prosePage())).toEqual([]);
  });

  it("ignores a single-column list (needs >= 2 columns)", () => {
    const list: PdfLayoutPage = {
      pageNumber: 1,
      width: 400,
      height: 300,
      items: [
        item("first", 50, 100),
        item("second", 50, 85),
        item("third", 50, 70),
      ],
    };
    expect(detectTablesOnPage(list)).toEqual([]);
  });
});

// ─────────────── words as poppler gives them: the captured corpus ───────────────

type Tables = readonly (readonly (readonly string[])[])[];

/** A module's zero-argument `*Pdf` builders, by export name. */
function builders(module: Record<string, unknown>): string[] {
  return Object.entries(module)
    .filter(
      ([name, value]) =>
        name.endsWith("Pdf") &&
        typeof value === "function" &&
        value.length === 0,
    )
    .map(([name]) => name);
}

/** Every table the builder's PDF holds; none for prose, lists, one row. */
function expectedFor(builder: string): Tables {
  return (
    TABLE_EXTRACT_FIXTURES[builder]?.tables ??
    OFFICE_FIXTURE_TABLES[builder] ??
    []
  );
}

/**
 * Every `*_BBOX` capture in `@/tests/poppler-samples`, with the builder its
 * docblock names (`` `quarterlyTablePdf()` through `pdftotext -bbox-layout` ``).
 * DISCOVERED from the module and its source, so a capture added there is
 * judged here without anyone listing it — and one whose docblock names no
 * builder fails the health check instead of being skipped.
 */
function bboxSamples() {
  const source = readFileSync(
    fileURLToPath(
      new URL("../../../tests/poppler-samples.ts", import.meta.url),
    ),
    "utf8",
  );
  const named = new Map<string, string>();
  for (const m of source.matchAll(
    /\/\*\*\s*`(\w+)\(\)` through `pdftotext -bbox-layout`[\s\S]*?\*\/\s*export const (\w+_BBOX)\s*=/g,
  ))
    named.set(m[2]!, m[1]!);
  const samples = Object.entries(popplerSamples as Record<string, unknown>)
    .filter(([name]) => name.endsWith("_BBOX"))
    .map(([name, xhtml]) => ({
      name,
      builder: named.get(name) ?? "",
      xhtml: String(xhtml),
    }));
  return { named, samples };
}

function tablesIn(xhtml: string): string[][][] {
  return parseBboxLayout(xhtml)
    .pages.flatMap((page) => detectTablesOnPage(page))
    .map((table) => table.rows);
}

describe("detectTablesOnPage — word-level poppler output", () => {
  const { named, samples } = bboxSamples();
  const allBuilders = new Set([
    ...builders(officeFixtures as Record<string, unknown>),
    ...builders(tableFixtures as Record<string, unknown>),
  ]);

  it("HEALTH: the corpus is every capture, each tied to a real builder, and holds both tables and prose", () => {
    expect(samples.length).toBeGreaterThanOrEqual(14);
    expect(named.size).toBe(samples.length);
    for (const { name, builder } of samples)
      expect(allBuilders.has(builder), `${name} → ${builder}()`).toBe(true);
    const withTables = samples.filter((s) => expectedFor(s.builder).length);
    expect(withTables.length).toBeGreaterThanOrEqual(6);
    expect(samples.length - withTables.length).toBeGreaterThanOrEqual(6);
  });

  it("HEALTH: every fixture builder has an answer, and every answer a builder", () => {
    // Each table fixture is registered with its tables…
    expect(builders(tableFixtures as Record<string, unknown>).sort()).toEqual(
      Object.keys(TABLE_EXTRACT_FIXTURES).sort(),
    );
    // …and each office fixture named as holding tables exists.
    const office = new Set(builders(officeFixtures as Record<string, unknown>));
    for (const name of Object.keys(OFFICE_FIXTURE_TABLES))
      expect(office.has(name), name).toBe(true);
  });

  it("every captured page comes back as exactly the tables drawn on it, and nothing else", () => {
    // Titles, paragraphs (justified ones included), captions, footers, two
    // bulleted lists side by side, and an address line beside a note all stay
    // out; multi-word cells stay whole; amounts set flush right under a
    // heading set flush left stay one column; two tables on a page are two.
    for (const { name, builder, xhtml } of samples)
      expect(
        tablesMismatches(tablesIn(xhtml), expectedFor(builder)),
        name,
      ).toEqual([]);
  });

  it("the old proof's page: the title is not a row and no column is empty (was: both)", () => {
    // What the engine returned for this page until 2026-09-27, while the
    // deployment proof recorded extract-tables as proven:
    //   ["Quarterly","results","","",""], ["Region","","Q1","Q2","Q3"], …
    const [table, ...more] = tablesIn(popplerSamples.TITLED_TABLE_BBOX);
    expect(more).toEqual([]);
    expect(table!.flat()).not.toContain(TITLED_TITLE);
    expect(table).toEqual(TITLED_TABLE);
  });

  it("POSITIVE CONTROL: the comparison sees a title row, a phantom column and a lost table", () => {
    const phantom = TITLED_TABLE.map(([first, ...rest]) => [
      first,
      "",
      ...rest,
    ]);
    const shipped = [["Quarterly", "results", "", "", ""], ...phantom];
    expect(tablesMismatches([shipped], [TITLED_TABLE])).toEqual(
      expect.arrayContaining([
        "table-1.csv: 6 row(s), expected 5",
        'table-1.csv row 1 col 1: "Quarterly", expected "Region"',
      ]),
    );
    expect(tablesMismatches([phantom], [TITLED_TABLE])).toEqual(
      expect.arrayContaining(["table-1.csv: column 2 is empty in every row"]),
    );
    expect(tablesMismatches([], [TITLED_TABLE])).toEqual([
      "0 table(s), expected 1",
    ]);
    expect(
      tablesMismatches(
        [
          [
            ["a", "b"],
            ["c", "d"],
          ],
        ],
        [],
      ),
    ).toEqual(["1 table(s), expected 0"]);
  });
});

describe("detectTablesOnPage — shapes no fixture draws", () => {
  /** One item per word, as poppler gives them: 11pt, ~5.5pt a character. */
  function words(text: string, x: number, y: number): PositionedTextItem[] {
    const out: PositionedTextItem[] = [];
    let at = x;
    for (const word of text.split(" ")) {
      out.push(item(word, at, y, word.length * 5.5, 10.2));
      at += word.length * 5.5 + 3.06;
    }
    return out;
  }
  const page = (items: PositionedTextItem[]): PdfLayoutPage => ({
    pageNumber: 1,
    width: 612,
    height: 792,
    items,
  });

  it("two-run lines that share no column — a staircase — are not a table", () => {
    const staircase = [
      ...words("Acme Ltd", 50, 700),
      ...words("Tax invoice", 250, 700),
      ...words("Ref A-12", 150, 684),
      ...words("Due 1 May", 400, 684),
    ];
    expect(detectTablesOnPage(page(staircase))).toEqual([]);
    // POSITIVE CONTROL: the same runs, the second line under the first's
    // columns, are one.
    const aligned = [
      ...words("Acme Ltd", 50, 700),
      ...words("Tax invoice", 250, 700),
      ...words("Ref A-12", 50, 684),
      ...words("Due 1 May", 250, 684),
    ];
    expect(detectTablesOnPage(page(aligned)).map((t) => t.rows)).toEqual([
      [
        ["Acme Ltd", "Tax invoice"],
        ["Ref A-12", "Due 1 May"],
      ],
    ]);
  });

  /** A table row: each `[text, x]` cell's words at baseline `y`. */
  const row = (cells: [string, number][], y: number) =>
    cells.flatMap(([text, x]) => (text ? words(text, x, y) : []));
  const rowsOf = (items: PositionedTextItem[]) =>
    detectTablesOnPage(page(items)).map((t) => t.rows);

  it("a heading row and a total row set apart by extra space stay in the table", () => {
    // The heading one and a half row pitches above the body, the total one
    // and three quarters below it, as a ruled table leaves room for its
    // rules. Only a row that ALSO straddles the table's gutters is left out,
    // and only a gap of two pitches cuts a table.
    const at = [50, 160, 260];
    const cells = (texts: string[]) =>
      texts.map((t, i) => [t, at[i]!] as [string, number]);
    const table = [
      ["Item", "Qty", "Amount"],
      ["Pens", "12", "14.40"],
      ["Ink", "3", "13.50"],
      ["Pads", "10", "20.00"],
      ["Total", "", "47.90"],
    ];
    const ys = [700, 676, 660, 644, 614];
    expect(
      rowsOf(table.flatMap((texts, r) => row(cells(texts), ys[r]!))),
    ).toEqual([table]);
  });

  describe("what may follow a table's last row", () => {
    const at = [50, 160, 240, 330];
    const table = [
      ["Office", "Staff", "Open", "Rank"],
      ["Leeds", "14", "2019", "2"],
      ["York", "9", "2021", "1"],
    ];
    const body = table.flatMap((texts, r) =>
      row(
        texts.map((t, i) => [t, at[i]!]),
        700 - r * 16,
      ),
    );

    it("POSITIVE CONTROL: an amount-only line under a column is the table's", () => {
      expect(rowsOf([...body, ...row([["23", 160]], 652)])).toEqual([
        [...table, ["", "23", "", ""]],
      ]);
    });

    it("a one-run note that spans two columns is not", () => {
      expect(
        rowsOf([...body, ...row([["estimates, not audited", 160]], 652)]),
      ).toEqual([table]);
    });

    it("a mark past the table's right edge is not", () => {
      expect(rowsOf([...body, ...row([["p. 7", 420]], 652)])).toEqual([table]);
    });

    it("a value three row pitches below — a page number under a column — is not", () => {
      expect(rowsOf([...body, ...row([["12", 240]], 600)])).toEqual([table]);
    });

    it("a two-run line set apart and straddling a gutter is not, even when its first run fits a column", () => {
      const note = row(
        [
          ["Source: HR", 160],
          ["counted 30 June, all offices", 240],
        ],
        644,
      );
      expect(rowsOf([...body, ...note])).toEqual([table]);
    });
  });

  it("a cell that wraps onto a one-run line does not make its table prose", () => {
    const table = [
      ["A-100", "Water bottle with a"],
      ["", "bamboo lid and a strap"],
      ["B-200", "eBook reader case"],
      ["C-300", "Coffee dripper"],
    ];
    const items = table.flatMap(([code, text], r) =>
      row(
        [
          [code!, 50],
          [text!, 150],
        ],
        700 - r * 16,
      ),
    );
    expect(rowsOf(items)).toEqual([table]);
  });

  it("a cell a point and a half off its row's baseline is still in that row", () => {
    // A smaller face, a superscript marker, a generator's rounding.
    const items = [
      ...row(
        [
          ["Name", 50],
          ["Age", 200],
        ],
        700,
      ),
      ...row([["Alice", 50]], 684),
      ...words("30", 200, 685.5),
      ...row(
        [
          ["Bob", 50],
          ["25", 200],
        ],
        668,
      ),
    ];
    expect(rowsOf(items)).toEqual([
      [
        ["Name", "Age"],
        ["Alice", "30"],
        ["Bob", "25"],
      ],
    ]);
  });
});

describe("tablesProofVerdict — what worker-prove-tools reads off a deployment", () => {
  const zipOf = (tables: Tables) =>
    buildTablesZip(
      tables.map((rows) => ({
        pageNumber: 1,
        rows: rows.map((row) => [...row]),
      })),
    );

  it("passes the report's two tables, cell for cell", async () => {
    const verdict = await tablesProofVerdict(await zipOf(REPORT_TABLES));
    expect(verdict).toEqual({
      ok: true,
      detail: "2 table(s), 4x4 + 4x3, every cell matches",
    });
  });

  it("passes the ZIP the engine builds from the captured report page — the composed chain", async () => {
    const run = await runTableExtract(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      {
        extractLayout: async () =>
          parseBboxLayout(popplerSamples.REPORT_TABLES_BBOX),
      },
    );
    if (!run.ok) throw new Error(`extract-tables failed: ${run.kind}`);
    expect(await tablesProofVerdict(run.output)).toMatchObject({ ok: true });
  });

  it("POSITIVE CONTROL: one wrong cell, a title row, a lost table or a lost workbook fails it", async () => {
    const wrongCell = REPORT_TABLES.map((rows, t) =>
      rows.map((row, r) =>
        row.map((cell, c) => (t === 1 && r === 2 && c === 1 ? "31" : cell)),
      ),
    );
    const titled = [
      [["Quarterly Report", "", "", ""], ...REPORT_TABLES[0]!],
      REPORT_TABLES[1]!,
    ];
    const noWorkbook = await JSZip.loadAsync(await zipOf(REPORT_TABLES));
    noWorkbook.remove("tables.xlsx");
    const failing: [string, Uint8Array][] = [
      ["wrong cell", await zipOf(wrongCell)],
      ["title row", await zipOf(titled)],
      ["one table", await zipOf([REPORT_TABLES[0]!])],
      ["no workbook", await noWorkbook.generateAsync({ type: "uint8array" })],
    ];
    for (const [name, bytes] of failing)
      expect((await tablesProofVerdict(bytes)).ok, name).toBe(false);
    expect((await tablesProofVerdict(await zipOf(wrongCell))).detail).toContain(
      'table-2.csv row 3 col 2: "31", expected "30"',
    );
  });
});

describe("toCsv", () => {
  it("emits RFC-4180 rows with CRLF endings", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a,b\r\nc,d");
  });

  it("quotes cells with commas, quotes, or newlines and doubles inner quotes", () => {
    expect(
      toCsv([
        ["b,c", 'd"e'],
        ["f\ng", "h"],
      ]),
    ).toBe('"b,c","d""e"\r\n"f\ng",h');
  });
});

describe("buildTablesZip", () => {
  it("packages one CSV per table plus a combined XLSX", async () => {
    const zipBytes = await buildTablesZip([
      {
        pageNumber: 1,
        rows: [
          ["Name", "Age"],
          ["Alice", "30"],
        ],
      },
      { pageNumber: 2, rows: [["City"], ["Paris"]] },
    ]);
    const zip = await JSZip.loadAsync(zipBytes);
    expect(zip.file("table-1.csv")).not.toBeNull();
    expect(zip.file("table-2.csv")).not.toBeNull();
    expect(zip.file("tables.xlsx")).not.toBeNull();
    expect(await zip.file("table-1.csv")!.async("string")).toBe(
      "Name,Age\r\nAlice,30",
    );
  });
});

describe("tables.xlsx — cells written by the shared sheet writer", () => {
  // PDF to Excel and this engine each carried a cell writer, and they
  // disagreed. Both now use `../ooxml/sheet-cells`; this reads the workbook a
  // user opens, through a reader that shares nothing with that writer.
  async function tableSheet(rows: string[][]) {
    const zip = await JSZip.loadAsync(
      await buildTablesZip([{ pageNumber: 1, rows }]),
    );
    const xlsx = await zip.file("tables.xlsx")!.async("uint8array");
    return readXlsxSheet(xlsx);
  }

  it("stores an unambiguous number as a number, and a code as text", async () => {
    const sheet = await tableSheet([
      ["Item", "Amount"],
      ["Widgets, blue", "1,250.00"],
      ["Code", "00123"],
    ]);
    expect(sheetGridProblems(sheet)).toEqual([]);
    const cells = cellsByRef(sheet);
    expect(cells.get("A2")).toMatchObject({
      type: "text",
      value: "Widgets, blue",
    });
    expect(cells.get("B2")).toMatchObject({
      type: "number",
      value: "1250.00",
      format: "#,##0.00",
    });
    expect(cells.get("B3")).toMatchObject({ type: "text", value: "00123" });
  });

  it("leaves an empty cell empty in its own column, past Z included", async () => {
    const wide = Array.from({ length: 30 }, (_, i) => `h${i + 1}`);
    const sparse = wide.map((_, i) => (i === 1 ? "" : `v${i + 1}`));
    const sheet = await tableSheet([wide, sparse]);
    expect(sheetGridProblems(sheet)).toEqual([]);
    const cells = cellsByRef(sheet);
    expect(cells.has("B2")).toBe(false);
    expect(cells.get("AD2")).toMatchObject({ value: "v30" });
  });
});

describe("runTableExtract", () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

  it("fails honestly without a layout extractor", async () => {
    const run = await runTableExtract(PDF, {});
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("fails as no_text when the PDF has no selectable text", async () => {
    const extractLayout = vi.fn(async () =>
      layout([{ pageNumber: 1, width: 400, height: 300, items: [] }]),
    );
    const run = await runTableExtract(PDF, { extractLayout });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("no_text");
  });

  it("fails as no_tables when text has no tabular structure", async () => {
    const extractLayout = vi.fn(async () => layout([prosePage()]));
    const run = await runTableExtract(PDF, { extractLayout });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("no_tables");
  });

  it("rejects input over the size limit before extracting", async () => {
    const extractLayout = vi.fn(async () => layout([tablePage()]));
    const run = await runTableExtract(new Uint8Array(50), {
      extractLayout,
      limits: { maxInputBytes: 10 },
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
    expect(extractLayout).not.toHaveBeenCalled();
  });

  it("produces a ZIP artifact with real detected tables", async () => {
    const extractLayout = vi.fn(async () => layout([tablePage()]));
    const run = await runTableExtract(PDF, { extractLayout });
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.filenameExt).toBe("zip");
      expect(run.contentType).toBe("application/zip");
      expect(run.meta).toMatchObject({
        engine: EXTRACT_TABLES_ENGINE,
        tool: "extract-tables",
        tableCount: 1,
        pageCount: 1,
      });
      const zip = await JSZip.loadAsync(run.output);
      expect(await zip.file("table-1.csv")!.async("string")).toBe(
        "Name,Age\r\nAlice,30\r\nBob,25",
      );
    }
  });

  it("fails honestly if the extractor throws", async () => {
    const extractLayout = vi.fn(async () => {
      throw new Error("pdfjs blew up");
    });
    const run = await runTableExtract(PDF, { extractLayout });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});

/**
 * A document that will not open used to land in the extractor's bare `catch`
 * as a retryable `failed`: a password-protected bank statement — the commonest
 * source of tables — was requeued twice with nothing changed and then reported
 * as "could not be processed", with no word about the password or the tool
 * that removes it. Only a REFUSAL (poppler's exit 1 or 3) asks about
 * encryption; a timeout or a spawn error says nothing about the document.
 */
describe("runTableExtract — a PDF that will not open is classified, not retried", () => {
  const refusal = () =>
    new PdfTextExecError({ exitCode: 1, killed: false, outputTooLarge: false });
  const throwing = (error: unknown) => async (): Promise<PdfLayout> => {
    throw error;
  };

  it("names a user-password PDF as password-protected (real RC4 fixture, real pdf-lib check)", async () => {
    const locked = officeFixtures.rc4EncryptedPdf({
      userPassword: "s3cret",
      ownerPassword: "owner",
    });
    const run = await runTableExtract(locked, {
      extractLayout: throwing(refusal()),
    });
    expect(run).toMatchObject({ ok: false, kind: "password_protected" });
    if (!run.ok) expect(run.message).toMatch(/Unlock PDF/);
  });

  it("names an unencrypted PDF that will not open as unreadable", async () => {
    const plain = await (await PDFDocument.create()).save();
    const run = await runTableExtract(plain, {
      extractLayout: throwing(refusal()),
    });
    expect(run).toMatchObject({ ok: false, kind: "unreadable" });
    if (!run.ok) expect(run.message).toMatch(/Repair PDF/);
  });

  it("POSITIVE CONTROL: a timeout, a spawn failure and an unknown throw stay retryable `failed`, even on an encrypted file", async () => {
    const locked = officeFixtures.rc4EncryptedPdf({
      userPassword: "x",
      ownerPassword: "y",
    });
    for (const error of [
      new PdfTextExecError({
        exitCode: null,
        killed: true,
        outputTooLarge: false,
      }),
      new PdfTextExecError({
        exitCode: null,
        killed: false,
        outputTooLarge: false,
      }),
      new PdfTextExecError({
        exitCode: 99,
        killed: false,
        outputTooLarge: false,
      }),
      new Error("anything else"),
    ])
      await expect(
        runTableExtract(locked, { extractLayout: throwing(error) }),
      ).resolves.toMatchObject({ ok: false, kind: "failed" });
  });

  it("reports an extractor output ceiling as too_large, not as a retryable failure", async () => {
    await expect(
      runTableExtract(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        extractLayout: throwing(
          new PdfTextExecError({
            exitCode: null,
            killed: false,
            outputTooLarge: true,
          }),
        ),
      }),
    ).resolves.toMatchObject({ ok: false, kind: "too_large" });
  });

  it("reports an archive over the output ceiling as too_large — the same bytes give the same archive on every retry", async () => {
    const run = await runTableExtract(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      {
        extractLayout: async () => layout([tablePage()]),
        limits: { maxOutputBytes: 1 },
      },
    );
    expect(run).toMatchObject({ ok: false, kind: "too_large" });
  });
});
