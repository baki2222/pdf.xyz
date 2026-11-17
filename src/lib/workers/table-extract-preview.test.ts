// @vitest-environment node
/**
 * Extract Tables' result preview (competitor audit #22, 2026-11-17), read
 * from ZIPs the REAL engine writes (`buildTablesZip`), never from a ZIP this
 * file lays out by hand: a renamed CSV or sheet in the engine fails here.
 *
 * Both directions over the archive: every table CSV the engine wrote is
 * counted by the preview, and every table the preview shows is a CSV the
 * engine wrote, with the page the engine was given. The set of entries is
 * DISCOVERED from the ZIP itself (JSZip's listing), not typed.
 *
 * And the property `table-extract-results.ts` states - "never a cell" in the
 * job record - over the composed chain: the real processor's results,
 * through the real sanitizer, carry none of the cell texts the preview reads
 * from the same job's ZIP.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  buildTablesZip,
  combineTables,
  toCsv,
  type DetectedTable,
} from "@/lib/workers/table-extract/engine";
import { createTableExtractProcessor } from "@/lib/workers/processor/table-extract";
import { sanitizeJobResults } from "@/lib/jobs/results";
import {
  COMBINED_CSV_NAME,
  MAX_PREVIEW_TABLES,
  TABLE_PREVIEW_ROWS,
} from "@/lib/jobs/extract-tables-options";
import {
  MAX_PREVIEW_CELL_CHARS,
  parseCsv,
  pickPreviewTables,
  previewCell,
  readTablePreview,
} from "./table-extract-preview";

/** Built from code points (house rule). */
const cp = (...points: number[]) => String.fromCodePoint(...points);
const BN_NAME = cp(0x09a8, 0x09be, 0x09ae); // Bengali "name"
const BN_CITY = cp(0x09a2, 0x09be, 0x0995, 0x09be); // Bengali "Dhaka"
const CJK = cp(0x8868, 0x683c); // "table"
const ELLIPSIS = cp(0x2026);

const grid = (rows: number, cols: number, tag: string) =>
  Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => `${tag}${r}.${c}`),
  );

/** Several tables: a long one, a wide one, a Bengali/CJK one, a ragged one. */
const TABLES: DetectedTable[] = [
  { pageNumber: 1, rows: grid(12, 3, "a") },
  { pageNumber: 1, rows: grid(3, 30, "w") },
  {
    pageNumber: 4,
    rows: [
      [BN_NAME, CJK, ""],
      [BN_CITY, "", "3"],
    ],
  },
  { pageNumber: 5, rows: [["h1", "h2", "h3"], ["x"], ["y", "z"]] },
];

async function csvEntries(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.values(zip.files)
    .filter((f) => !f.dir && f.name.endsWith(".csv"))
    .map((f) => f.name)
    .sort();
}

describe("readTablePreview - over the engine's own archive", () => {
  it("per-table: every CSV is counted, every preview is a CSV, with its page and first rows", async () => {
    const bytes = await buildTablesZip(TABLES);
    const entries = await csvEntries(bytes);
    // Health: the listing sees the engine's files at all.
    expect(entries).toHaveLength(TABLES.length);
    const set = await readTablePreview(bytes);
    expect(set.combined).toBe(false);
    expect(set.tableFiles).toBe(entries.length);
    expect(set.tables.map((t) => t.file).sort()).toEqual(entries);
    expect(set.perPage).toBe(false);
    expect(set.pagesWithTables).toBe(3);
    set.tables.forEach((t, i) => {
      const want = TABLES[i]!;
      expect(t.table).toBe(i + 1);
      expect(t.page).toBe(want.pageNumber);
      expect(t.totalRows).toBe(want.rows.length);
      expect(t.rows.length).toBe(
        Math.min(TABLE_PREVIEW_ROWS, want.rows.length),
      );
      t.rows.forEach((row, r) => {
        expect(row).toHaveLength(t.columns);
        want.rows[r]!.forEach((cell, c) => expect(row[c]).toBe(cell));
      });
    });
    // The wide one keeps all 30 columns; the non-Latin cells survive.
    expect(set.tables[1]!.columns).toBe(30);
    expect(set.tables[2]!.rows[0]).toEqual([BN_NAME, CJK, ""]);
    expect(set.tables[2]!.rows[1]).toEqual([BN_CITY, "", "3"]);
    // Ragged rows are padded to the widest shown row.
    expect(set.tables[3]!.rows).toEqual([
      ["h1", "h2", "h3"],
      ["x", "", ""],
      ["y", "z", ""],
    ]);
  });

  it("combined: the one CSV, its first rows of the stacked grid", async () => {
    const bytes = await buildTablesZip(TABLES, { combine: true });
    const entries = await csvEntries(bytes);
    expect(entries).toEqual([COMBINED_CSV_NAME]);
    const set = await readTablePreview(bytes);
    expect(set.combined).toBe(true);
    expect(set.tableFiles).toBe(1);
    expect(set.tables.map((t) => t.file)).toEqual(entries);
    const stacked = combineTables(TABLES);
    expect(set.tables[0]!.totalRows).toBe(stacked.length);
    expect(set.tables[0]!.rows).toEqual(
      stacked.slice(0, TABLE_PREVIEW_ROWS).map((row) => {
        const width = set.tables[0]!.columns;
        return Array.from({ length: width }, (_, c) => row[c] ?? "");
      }),
    );
  });

  it("many tables on many pages: the first table on each page, up to the cap", async () => {
    const pages = [1, 1, 2, 2, 3, 3, 4, 5, 6, 7];
    const many = pages.map((pageNumber, i) => ({
      pageNumber,
      rows: grid(2, 2, `m${i}`),
    }));
    const set = await readTablePreview(await buildTablesZip(many));
    expect(set.tableFiles).toBe(many.length);
    expect(set.perPage).toBe(true);
    expect(set.pagesWithTables).toBe(7);
    expect(set.tables.map((t) => t.table)).toEqual([1, 3, 5, 7, 8, 9]);
    expect(set.tables.map((t) => t.page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(set.tables).toHaveLength(MAX_PREVIEW_TABLES);
  });

  it("many tables on few pages: one per page, every page", async () => {
    const many = [1, 1, 1, 2, 2, 2, 3, 3].map((pageNumber, i) => ({
      pageNumber,
      rows: grid(2, 2, `f${i}`),
    }));
    const set = await readTablePreview(await buildTablesZip(many));
    expect(set.perPage).toBe(true);
    expect(set.pagesWithTables).toBe(3);
    expect(set.tables.map((t) => t.page)).toEqual([1, 2, 3]);
  });

  it("POSITIVE CONTROL: the engine's archive with no table previews nothing, and says so by count", async () => {
    const bytes = await buildTablesZip([]);
    expect(await csvEntries(bytes)).toEqual([]);
    const set = await readTablePreview(bytes);
    expect(set.tableFiles).toBe(0);
    expect(set.tables).toEqual([]);
  });

  it("no workbook: no pages, and past the cap the first tables in order", async () => {
    const zip = await JSZip.loadAsync(
      await buildTablesZip(
        Array.from({ length: 9 }, (_, i) => ({
          pageNumber: i + 1,
          rows: grid(1, 1, `n${i}`),
        })),
      ),
    );
    zip.remove("tables.xlsx");
    const set = await readTablePreview(
      await zip.generateAsync({ type: "uint8array" }),
    );
    expect(set.tableFiles).toBe(9);
    expect(set.perPage).toBe(false);
    expect(set.pagesWithTables).toBe(0);
    expect(set.tables.map((t) => [t.table, t.page])).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => [n, null]),
    );
  });

  it("a broken ZIP is refused, not read as empty", async () => {
    await expect(
      readTablePreview(new Uint8Array([0x50, 0x4b, 1, 2, 3])),
    ).rejects.toThrow();
  });
});

describe("the preview's CSV reader agrees with the engine's writer", () => {
  it("round-trips quotes, commas, line breaks and non-Latin text", () => {
    const rows = [
      ['a "quoted" cell', "x,y", `two${String.fromCharCode(10)}lines`],
      [BN_NAME, CJK, ""],
    ];
    expect(parseCsv(cp(0xfeff) + toCsv(rows))).toEqual(rows);
  });

  it("shows a formula-led cell as the file holds it, apostrophe first", () => {
    expect(parseCsv(toCsv([["=1+1", "-4"]]))).toEqual([["'=1+1", "-4"]]);
  });

  it("cuts a long cell by code points, never inside a character", () => {
    const astral = cp(0x1f600);
    const long = astral.repeat(MAX_PREVIEW_CELL_CHARS + 5);
    const cut = previewCell(long);
    expect(Array.from(cut)).toHaveLength(MAX_PREVIEW_CELL_CHARS);
    expect(cut.endsWith(ELLIPSIS)).toBe(true);
    expect(cut.slice(0, -1)).toBe(astral.repeat(MAX_PREVIEW_CELL_CHARS - 1));
    const exact = BN_NAME.repeat(1).padEnd(MAX_PREVIEW_CELL_CHARS, "x");
    expect(previewCell(exact)).toBe(exact);
  });

  it("pickPreviewTables keeps every table up to the cap", () => {
    const all = Array.from({ length: MAX_PREVIEW_TABLES }, (_, i) => i + 1);
    expect(pickPreviewTables(all, new Map())).toEqual({
      picked: all,
      perPage: false,
    });
  });
});

describe("cell text reaches the browser through the ZIP, never the job record", () => {
  const MARK = `Quillon${BN_CITY}`;
  const page = (pageNumber: number) => ({
    pageNumber,
    width: 400,
    height: 300,
    items: [
      { text: "Name", x: 50, y: 100, width: 20, height: 10 },
      { text: "Age", x: 200, y: 100, width: 15, height: 10 },
      { text: MARK, x: 50, y: 80, width: 25, height: 10 },
      { text: "30", x: 200, y: 80, width: 10, height: 10 },
    ],
  });

  it("the record holds no cell the preview shows; the preview holds them all", async () => {
    const result = await createTableExtractProcessor({
      extractLayout: async () => ({ pageCount: 2, pages: [page(1), page(2)] }),
    }).process({
      tool: "extract-tables",
      options: {},
      inputs: [
        {
          fileId: "f1",
          filename: "s.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const set = await readTablePreview(result.artifacts[0]!.bytes);
    const cells = set.tables.flatMap((t) => t.rows.flat()).filter(Boolean);
    // Positive control: the preview really sees the cells, the mark included.
    expect(cells).toContain(MARK);
    expect(cells.length).toBeGreaterThanOrEqual(8);
    // What the worker hands over, and what the job record keeps of it.
    for (const record of [
      JSON.stringify(result.results),
      JSON.stringify(sanitizeJobResults(result.results)),
    ]) {
      // Health: the record is not empty, so absence below means something.
      expect(record).toContain('"tableCount":2');
      for (const cell of new Set(cells)) {
        if (/^\d+$/.test(cell)) continue; // "30" is also a count's digits
        expect(record, cell).not.toContain(cell);
      }
    }
  });
});
