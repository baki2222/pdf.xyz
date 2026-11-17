import JSZip from "jszip";
import {
  COMBINED_CSV_NAME,
  MAX_PREVIEW_TABLES,
  TABLE_PREVIEW_ROWS,
} from "@/lib/jobs/extract-tables-options";

/**
 * The first rows of each table Extract Tables found, read IN THE BROWSER from
 * the ZIP the panel has already downloaded (competitor audit #22,
 * 2026-11-17). Until then the result card said how many tables and on which
 * pages, and nothing of what was in them, short of opening the ZIP.
 *
 * Cell text never leaves the page this way: the job record keeps counts and
 * page numbers only (`@/lib/jobs/table-extract-results`, "never a cell"), and
 * this module reads the bytes the browser already holds. It is loaded with
 * the result, behind the preview's own `next/dynamic` boundary, so JSZip and
 * this parser never ride the Extract Tables page's first load.
 *
 * The archive's layout is the engine's (`buildTablesZip`):
 * `table-1.csv` … `table-N.csv` and `tables.xlsx` with sheets named
 * "Table N (pP)", or, combined, one {@link COMBINED_CSV_NAME}. The page of
 * each table is read from those sheet names, the only place the archive
 * records it. `table-extract-preview.test.ts` builds its ZIPs with the real
 * engine, so a renamed file or sheet fails there, not here.
 *
 * How many rows and tables are shown ({@link TABLE_PREVIEW_ROWS},
 * {@link MAX_PREVIEW_TABLES}) is defined in the options leaf, which the tool
 * page quotes.
 */

/** Characters a cell shows before it is cut and ends with an ellipsis. */
export const MAX_PREVIEW_CELL_CHARS = 80;

const ELLIPSIS = String.fromCharCode(0x2026);
const BOM = String.fromCharCode(0xfeff);

export interface TablePreview {
  /** The ZIP entry, e.g. `table-3.csv`. */
  file: string;
  /** 1-based table number in the ZIP; null for the combined CSV. */
  table: number | null;
  /** The page the table came from, when the workbook says; else null. */
  page: number | null;
  /** The first {@link TABLE_PREVIEW_ROWS} rows, each padded to {@link columns}. */
  rows: string[][];
  /** The widest of the shown rows: ragged rows are padded with "". */
  columns: number;
  /** Rows in the whole CSV. */
  totalRows: number;
}

export interface TablePreviewSet {
  /** The tables shown, in ZIP order. */
  tables: TablePreview[];
  /** Table CSVs in the ZIP (1 for a combined run, 0 when there are none). */
  tableFiles: number;
  /** True when, past {@link MAX_PREVIEW_TABLES}, one table per page was picked. */
  perPage: boolean;
  /** Pages with at least one table, when the workbook says; else 0. */
  pagesWithTables: number;
  /** True for a combined run's one CSV. */
  combined: boolean;
}

/** RFC-4180, as `toCsv` writes it: CRLF rows, doubled quotes, a leading BOM. */
export function parseCsv(csv: string): string[][] {
  const text = csv.startsWith(BOM) ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      /* the LF ends the row */
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A cell as shown: cut at {@link MAX_PREVIEW_CELL_CHARS} code points. */
export function previewCell(value: string): string {
  const points = Array.from(value);
  return points.length > MAX_PREVIEW_CELL_CHARS
    ? points.slice(0, MAX_PREVIEW_CELL_CHARS - 1).join("") + ELLIPSIS
    : value;
}

/** The first rows of a grid, ragged rows padded to the widest shown. */
export function previewRows(grid: readonly string[][]): {
  rows: string[][];
  columns: number;
} {
  const shown = grid.slice(0, TABLE_PREVIEW_ROWS);
  const columns = shown.reduce((n, row) => Math.max(n, row.length), 0);
  return {
    rows: shown.map((row) =>
      Array.from({ length: columns }, (_, i) => previewCell(row[i] ?? "")),
    ),
    columns,
  };
}

const TABLE_FILE = /^table-(\d+)\.csv$/;
const SHEET_PAGE = /^Table (\d+) \(p(\d+)\)$/;

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Table number → page, from `tables.xlsx`'s sheet names; empty if unread. */
async function pagesFromWorkbook(zip: JSZip): Promise<Map<number, number>> {
  const pages = new Map<number, number>();
  const book = zip.file("tables.xlsx");
  if (!book) return pages;
  try {
    const inner = await JSZip.loadAsync(await book.async("uint8array"));
    const xml = await inner.file("xl/workbook.xml")?.async("string");
    for (const m of (xml ?? "").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)) {
      const name = SHEET_PAGE.exec(unescapeXml(m[1]!));
      if (name) pages.set(Number(name[1]), Number(name[2]));
    }
  } catch {
    // No pages, then: the preview still shows the tables.
  }
  return pages;
}

/**
 * Which tables to show: all of them up to {@link MAX_PREVIEW_TABLES}; past
 * it, the first table on each page (pages known), else the first ones.
 */
export function pickPreviewTables(
  tables: readonly number[],
  pages: ReadonlyMap<number, number>,
): { picked: number[]; perPage: boolean } {
  if (tables.length <= MAX_PREVIEW_TABLES)
    return { picked: [...tables], perPage: false };
  if (tables.every((t) => pages.has(t))) {
    const seen = new Set<number>();
    const firsts = tables.filter((t) => {
      const page = pages.get(t)!;
      if (seen.has(page)) return false;
      seen.add(page);
      return true;
    });
    return { picked: firsts.slice(0, MAX_PREVIEW_TABLES), perPage: true };
  }
  return { picked: tables.slice(0, MAX_PREVIEW_TABLES), perPage: false };
}

/** Read the preview from the result ZIP's bytes. Throws on a broken ZIP. */
export async function readTablePreview(
  bytes: Uint8Array,
): Promise<TablePreviewSet> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (
    file: string,
    table: number | null,
    page: number | null,
  ): Promise<TablePreview> => {
    const grid = parseCsv(await zip.file(file)!.async("string"));
    return { file, table, page, ...previewRows(grid), totalRows: grid.length };
  };
  if (zip.file(COMBINED_CSV_NAME)) {
    return {
      tables: [await read(COMBINED_CSV_NAME, null, null)],
      tableFiles: 1,
      perPage: false,
      pagesWithTables: 0,
      combined: true,
    };
  }
  const numbers = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => TABLE_FILE.exec(f.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  const pages = await pagesFromWorkbook(zip);
  const { picked, perPage } = pickPreviewTables(numbers, pages);
  const tables: TablePreview[] = [];
  for (const n of picked)
    tables.push(await read(`table-${n}.csv`, n, pages.get(n) ?? null));
  return {
    tables,
    tableFiles: numbers.length,
    perPage,
    pagesWithTables: numbers.every((n) => pages.has(n))
      ? new Set(numbers.map((n) => pages.get(n))).size
      : 0,
    combined: false,
  };
}
