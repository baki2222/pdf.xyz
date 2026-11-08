/**
 * The deployment proofs' verdicts for Extract Tables' wave-3 behaviour
 * (2026-11-08): OCR first in the same job (audit extract-tables#3), "Combine
 * tables into one sheet" (#2), the table count and pages on the job record
 * (#4), the `pdf_no_tables` code (#5), and the shared number cells
 * (pdf-to-excel#4). Pure — JSZip and text only — so the unit tests and
 * `scripts/worker-prove-tools.ts` ask the same question of the same function.
 *
 * Every verdict reads the ZIP a user downloads AND the job record as served,
 * and each can fail on the image before the feature: that image ignored
 * `ocr` (a scan failed `pdf_no_text`), ignored `combine` (a CSV and a sheet
 * per table, header repeated), wrote no `results.tables` block, failed a
 * table-less PDF as `unprocessable_entity`, and stored every amount as text.
 * An option the old worker ignores still produces a valid ZIP, so none of
 * these asks "is it a ZIP"; each reads the property the option changes.
 *
 * Fixture constants live here too (text only), and the PDFs are drawn from
 * them in `@/tests/table-proof-fixtures`: one source for the page and its
 * answer.
 */
import JSZip from "jszip";
import type { JobResults } from "@/lib/jobs/results";
import {
  COMBINED_CSV_NAME,
  COMBINED_SHEET_NAME,
  EXTRACT_TABLES_NO_TABLES_CODE,
} from "@/lib/jobs/extract-tables-options";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import type { ExpectedFailure } from "@/lib/probes/proof-outcome";
import {
  numberCellProblems,
  NUMBER_CELL_ROWS,
} from "../ooxml/number-cells-proof";
import {
  readWorkbookSheets,
  type WorkbookSheetRead,
} from "../ooxml/workbook-read";

export type Verdict = { ok: boolean; detail: string };
type Grid = readonly (readonly string[])[];

// ─────────────────────────────── fixtures' text ─────────────────────────────

/**
 * The table printed on the SCAN's first page: plain words and integers in
 * one face, gutters several ems wide, so OCR reads each cell as a word and
 * the detector sees the columns. No commas or decimals: a misread `,` is an
 * OCR question, not a table one.
 */
export const OCR_TABLE_ROWS: Grid = [
  ["Item", "Count", "Price"],
  ["Apple", "12", "340"],
  ["Bread", "30", "125"],
  ["Cheese", "18", "760"],
  ["Grapes", "25", "410"],
];
/**
 * The scan's second page: prose, no table — a page that gives none. No
 * closing stops here or in {@link STATEMENT_PROSE}: these are fixture lines,
 * not sentences a reader is shown (`copy-surface.test.ts` reads a stop as copy).
 */
export const OCR_PROSE_LINES = [
  "Thank you for shopping with us this winter",
  "Returns are accepted within thirty days",
] as const;
/** The scan's page count: a table page, then a prose page. */
export const OCR_SCAN_PAGES = 2;

/** The statement whose table carries on from page 1 onto page 2. */
export const STATEMENT_HEADER = ["Ref", "Payee", "Paid"] as const;
export const STATEMENT_PAGE_1: Grid = [
  STATEMENT_HEADER,
  ["A-101", "Northwind Traders", "410"],
  ["A-102", "Contoso Ltd", "275"],
  ["A-103", "Fabrikam Inc", "1,020"],
];
/** Page 2: the SAME header, repeated, over more rows of the same table. */
export const STATEMENT_PAGE_2: Grid = [
  STATEMENT_HEADER,
  ["A-104", "Litware Inc", "96"],
  ["A-105", "Adventure Works", "530"],
];
/** Page 4: a different table, two pages on — never joined. */
export const STATEMENT_BRANCHES: Grid = [
  ["Branch", "Staff"],
  ["Leeds", "14"],
  ["York", "9"],
];
/** Pages 3 and 5: prose only. */
export const STATEMENT_PROSE = [
  "Payments listed above cleared before the end of the month",
  "Questions about this statement go to the accounts team",
] as const;
export const STATEMENT_PAGES = 5;
export const STATEMENT_TABLE_PAGES = [1, 2, 4] as const;

/**
 * The combined sheet, written out by hand rather than computed by the
 * engine's `combineTables`: the header once, pages 1 and 2 joined, one empty
 * row, then page 4's table under its own header.
 */
export const STATEMENT_COMBINED: Grid = [
  ...STATEMENT_PAGE_1,
  ...STATEMENT_PAGE_2.slice(1),
  [],
  ...STATEMENT_BRANCHES,
];

/** Page 3 of the number-cells PDF (page 2 is blank). */
export const CLOSING_ROWS: Grid = [
  ["Entry", "Amount"],
  ["Opening", "1,250.00"],
  ["Closing", "2,500.00"],
];
export const NUMBER_PDF_PAGES = 3;
/** The pages of the number-cells PDF that hold a table. */
export const NUMBER_PDF_TABLES: readonly { page: number; rows: Grid }[] = [
  { page: 1, rows: NUMBER_CELL_ROWS },
  { page: 3, rows: CLOSING_ROWS },
];

// ─────────────────────────────── the refusals ───────────────────────────────

/** A prose-only PDF: its own code since 2026-11-08, final. */
export const NO_TABLES_FAILURE: ExpectedFailure = {
  code: EXTRACT_TABLES_NO_TABLES_CODE,
  retryable: false,
  message: /No table-like structure/,
};

/**
 * The scan with OCR OFF: the control for the OCR proofs. The fixture has no
 * text layer, so without OCR it must fail `pdf_no_text` with the advice to
 * run OCR PDF — which says the OCR-on passes were OCR, not a fixture that
 * already had text.
 */
export const SCAN_WITHOUT_OCR_FAILURE: ExpectedFailure = {
  code: OFFICE_EXPORT_ERROR_CODES.noText,
  retryable: false,
  message: /Run OCR PDF first/,
};

// ─────────────────────────────── the reader ─────────────────────────────────

/** The byte-order mark the engine writes first (built from its code). */
const BOM = String.fromCharCode(0xfeff);

/** RFC-4180, own parser (nothing shared with the engine's `toCsv`). */
export function parseCsvGrid(csv: string): string[][] {
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
      /* the LF ends it */
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

export interface TablesArchive {
  /** Every file in the ZIP, sorted. */
  entries: string[];
  /** Each CSV's grid, by entry name. */
  csv: Map<string, string[][]>;
  /** `tables.xlsx`'s sheets in workbook order; empty when it is absent. */
  sheets: WorkbookSheetRead[];
}

export async function readTablesArchive(
  bytes: Uint8Array,
): Promise<TablesArchive> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.name)
    .sort();
  const csv = new Map<string, string[][]>();
  for (const name of entries.filter((n) => n.endsWith(".csv")))
    csv.set(name, parseCsvGrid(await zip.file(name)!.async("string")));
  const book = zip.file("tables.xlsx");
  const sheets = book
    ? await readWorkbookSheets(await book.async("uint8array"))
    : [];
  return { entries, csv, sheets };
}

// ─────────────────────────────── comparisons ────────────────────────────────

const nonEmpty = (row: readonly string[]) => row.filter((c) => c.trim() !== "");
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((c, i) => c === b[i]);
/** A CSV row of empty fields is the empty row a reader sees. */
const normal = (grid: Grid) =>
  grid.map((row) => (row.every((c) => c === "") ? [] : [...row]));

/** Where `got` differs from `want`, exactly, one line each. */
export function gridDiff(name: string, got: Grid, want: Grid): string[] {
  const g = normal(got);
  const out: string[] = [];
  if (g.length !== want.length)
    out.push(`${name}: ${g.length} row(s), expected ${want.length}`);
  for (let r = 0; r < Math.max(g.length, want.length); r++)
    if (!same(g[r] ?? [], want[r] ?? []))
      out.push(
        `${name} row ${r + 1}: ${JSON.stringify(g[r] ?? null)}, expected ${JSON.stringify(want[r] ?? null)}`,
      );
  return out;
}

/**
 * The rows of `want` that no row of `got` carries, cell for cell once empty
 * cells are dropped: for OCR, where a phantom empty column is the detector's
 * business but a merged or misread cell is a miss.
 */
export function missingRows(got: Grid, want: Grid): string[] {
  return want
    .filter((w) => !got.some((g) => same(nonEmpty(g), w)))
    .map((w) => JSON.stringify(w));
}

function languagesProblem(results: JobResults | undefined): string | null {
  const langs = results?.ocr?.languages;
  if (!langs)
    return "the job record carries no OCR block: OCR did not run in this job";
  return langs.length === 1 && langs[0] === "eng"
    ? null
    : `OCR ran in ${JSON.stringify(langs)}, the job asked for ["eng"]`;
}

function tablesBlockProblems(
  results: JobResults | undefined,
  want: {
    tableCount: number;
    pageCount: number;
    tablePages: readonly number[];
    combined: boolean;
  },
): string[] {
  const block = results?.tables;
  if (!block)
    return [
      "the job record carries no tables block: this worker does not report what it found",
    ];
  const out: string[] = [];
  if (block.tableCount !== want.tableCount)
    out.push(
      `record: ${block.tableCount} table(s), expected ${want.tableCount}`,
    );
  if (block.pageCount !== want.pageCount)
    out.push(`record: ${block.pageCount} page(s), expected ${want.pageCount}`);
  if (!same(block.tablePages.map(String), want.tablePages.map(String)))
    out.push(
      `record: tables on pages ${JSON.stringify(block.tablePages)}, expected ${JSON.stringify(want.tablePages)}`,
    );
  if (block.combined !== want.combined)
    out.push(`record: combined ${block.combined}, expected ${want.combined}`);
  return out;
}

const verdict = (problems: string[], pass: string): Verdict =>
  problems.length === 0
    ? { ok: true, detail: pass }
    : {
        ok: false,
        detail: `${problems.length} problem(s): ${problems.slice(0, 4).join("; ")}`,
      };

async function archiveOf(
  bytes: Uint8Array,
): Promise<TablesArchive | { error: string }> {
  try {
    const archive = await readTablesArchive(bytes);
    if (archive.entries.length === 0) return { error: "the ZIP is empty" };
    return archive;
  } catch (error) {
    return {
      error: `the download is not a readable tables ZIP: ${(error as Error).message}`,
    };
  }
}

/** The combined layout: ONLY `tables.csv` and `tables.xlsx`, one named sheet. */
function combinedLayoutProblems(a: TablesArchive): string[] {
  const out: string[] = [];
  const want = [COMBINED_CSV_NAME, "tables.xlsx"].sort();
  if (!same(a.entries, want))
    out.push(
      `the ZIP holds ${JSON.stringify(a.entries)}, expected ${JSON.stringify(want)}`,
    );
  const names = a.sheets.map((s) => s.name);
  if (!same(names, [COMBINED_SHEET_NAME]))
    out.push(
      `the workbook's sheets are ${JSON.stringify(names)}, expected ["${COMBINED_SHEET_NAME}"]`,
    );
  return out;
}

/**
 * The per-table layout: `table-1.csv` … `table-N.csv` and `tables.xlsx`,
 * nothing else; sheet `i` named `Table i (pP)` for the page its table came
 * from (the name written out here, not imported from the engine).
 */
function perTableLayoutProblems(
  a: TablesArchive,
  pages: readonly number[],
): string[] {
  const out: string[] = [];
  const want = [
    ...pages.map((_, i) => `table-${i + 1}.csv`),
    "tables.xlsx",
  ].sort();
  if (!same(a.entries, want))
    out.push(
      `the ZIP holds ${JSON.stringify(a.entries)}, expected ${JSON.stringify(want)}`,
    );
  const names = a.sheets.map((s) => s.name);
  const wantNames = pages.map((p, i) => `Table ${i + 1} (p${p})`);
  if (!same(names, wantNames))
    out.push(
      `the workbook's sheets are ${JSON.stringify(names)}, expected ${JSON.stringify(wantNames)}`,
    );
  return out;
}

// ─────────────────────────────── the verdicts ───────────────────────────────

/**
 * OCR on + Combine, on the two-page scan: the ZIP is the combined layout, its
 * CSV carries every row of the scanned table, the record says OCR ran in
 * English and the tables were combined, from page 1 of 2.
 */
export async function ocrCombinedVerdict(
  bytes: Uint8Array,
  results: JobResults | undefined,
): Promise<Verdict> {
  const a = await archiveOf(bytes);
  if ("error" in a) return { ok: false, detail: a.error };
  const csv = a.csv.get(COMBINED_CSV_NAME) ?? [];
  const missing = missingRows(csv, OCR_TABLE_ROWS);
  const problems = [
    ...combinedLayoutProblems(a),
    ...(csv.length === 0 ? [`${COMBINED_CSV_NAME} is empty or absent`] : []),
    ...(missing.length
      ? [`${COMBINED_CSV_NAME} lacks the scanned row(s) ${missing.join(", ")}`]
      : []),
    ...[languagesProblem(results)].filter((p): p is string => p !== null),
    ...tablesBlockProblems(results, {
      tableCount: 1,
      pageCount: OCR_SCAN_PAGES,
      tablePages: [1],
      combined: true,
    }),
  ];
  return verdict(
    problems,
    `OCR (eng) then one "${COMBINED_SHEET_NAME}" sheet and ${COMBINED_CSV_NAME} holding all ${OCR_TABLE_ROWS.length} scanned rows; record: 1 table, page 1 of ${OCR_SCAN_PAGES}`,
  );
}

/**
 * OCR on, Combine off, on the same scan: one `table-1.csv` and one
 * `Table 1 (p1)` sheet carrying the scanned rows; the record names page 1 of
 * 2, so page 2 is the page that gave none — what the result card lists.
 */
export async function ocrPerTableVerdict(
  bytes: Uint8Array,
  results: JobResults | undefined,
): Promise<Verdict> {
  const a = await archiveOf(bytes);
  if ("error" in a) return { ok: false, detail: a.error };
  const csv = a.csv.get("table-1.csv") ?? [];
  const missing = missingRows(csv, OCR_TABLE_ROWS);
  const problems = [
    ...perTableLayoutProblems(a, [1]),
    ...(csv.length === 0 ? ["table-1.csv is empty or absent"] : []),
    ...(missing.length
      ? [`table-1.csv lacks the scanned row(s) ${missing.join(", ")}`]
      : []),
    ...[languagesProblem(results)].filter((p): p is string => p !== null),
    ...tablesBlockProblems(results, {
      tableCount: 1,
      pageCount: OCR_SCAN_PAGES,
      tablePages: [1],
      combined: false,
    }),
  ];
  return verdict(
    problems,
    `OCR (eng) then table-1.csv and "Table 1 (p1)" with all ${OCR_TABLE_ROWS.length} scanned rows; record: page 1 of ${OCR_SCAN_PAGES} gave a table, page 2 none`,
  );
}

/**
 * Combine on the five-page statement: the header once, pages 1 and 2 joined,
 * one empty row, then page 4's table — in the CSV AND in the sheet; and the
 * record's count and pages (3 tables, pages 1, 2 and 4 of 5), with no OCR
 * block on a text PDF.
 */
export async function combinedHeaderVerdict(
  bytes: Uint8Array,
  results: JobResults | undefined,
): Promise<Verdict> {
  const a = await archiveOf(bytes);
  if ("error" in a) return { ok: false, detail: a.error };
  const csv = a.csv.get(COMBINED_CSV_NAME) ?? [];
  const sheet = a.sheets[0]?.sheet;
  // The sheet as a reader sees it: each row's cells at their columns.
  const sheetGrid: string[][] = [];
  for (const row of sheet?.rows ?? []) {
    const cells: string[] = [];
    for (const c of row.cells) cells[c.column] = c.value;
    sheetGrid[row.r - 1] = Array.from(cells, (v) => v ?? "");
  }
  const headerRows = Array.from(sheetGrid, (r) => r ?? []).filter((r) =>
    same(nonEmpty(r), STATEMENT_HEADER),
  ).length;
  const problems = [
    ...combinedLayoutProblems(a),
    ...gridDiff(COMBINED_CSV_NAME, csv, STATEMENT_COMBINED),
    ...(headerRows === 1
      ? []
      : [
          `the sheet carries the header row ${headerRows} time(s), expected once`,
        ]),
    ...(sheetGrid.length === STATEMENT_COMBINED.length
      ? []
      : [
          `the sheet has ${sheetGrid.length} row(s), expected ${STATEMENT_COMBINED.length}`,
        ]),
    ...(results?.ocr
      ? ["the record carries an OCR block on a job that asked for none"]
      : []),
    ...tablesBlockProblems(results, {
      tableCount: 3,
      pageCount: STATEMENT_PAGES,
      tablePages: STATEMENT_TABLE_PAGES,
      combined: true,
    }),
  ];
  return verdict(
    problems,
    `the header once, pages 1+2 joined, an empty row, page 4's table (${STATEMENT_COMBINED.length} rows); record: 3 tables on pages 1, 2, 4 of ${STATEMENT_PAGES}`,
  );
}

/**
 * Defaults on the number-cells PDF: one CSV and one sheet per table, named by
 * page; each CSV exactly the printed text; the first sheet's cells typed as
 * the shared writer must type them (`numberCellProblems`); the record's
 * count and pages, `combined: false`.
 */
export async function defaultsVerdict(
  bytes: Uint8Array,
  results: JobResults | undefined,
): Promise<Verdict> {
  const a = await archiveOf(bytes);
  if ("error" in a) return { ok: false, detail: a.error };
  const pages = NUMBER_PDF_TABLES.map((t) => t.page);
  const first = a.sheets[0]?.sheet;
  const problems = [
    ...perTableLayoutProblems(a, pages),
    ...NUMBER_PDF_TABLES.flatMap((t, i) =>
      gridDiff(
        `table-${i + 1}.csv`,
        a.csv.get(`table-${i + 1}.csv`) ?? [],
        t.rows,
      ),
    ),
    ...(first
      ? numberCellProblems(first).map((p) => `sheet 1: ${p}`)
      : ["no first sheet"]),
    ...tablesBlockProblems(results, {
      tableCount: NUMBER_PDF_TABLES.length,
      pageCount: NUMBER_PDF_PAGES,
      tablePages: pages,
      combined: false,
    }),
  ];
  return verdict(
    problems,
    `${pages.length} CSVs and sheets "Table N (pP)" for pages ${pages.join(", ")}, every cell as printed; lakh, bracketed and trailing-minus amounts and both dates stored as numbers, the slashed date and (3) as text`,
  );
}
