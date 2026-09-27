/**
 * Generated PDFs for Extract Tables, the grids each one must come back as, and
 * a reader for the ZIP a user downloads.
 *
 * The expected grids are the SAME constants the PDFs are drawn from, so a
 * fixture and its answer cannot drift apart. The reader parses the CSVs with
 * its own RFC-4180 parser — nothing shared with the engine's writer — so a
 * writer bug cannot certify itself.
 *
 * Used by the engine's unit tests (over captured poppler output), by the
 * real-poppler test, and by `scripts/worker-prove-tools.ts` against a
 * deployment: one fixture, one answer, three points in time. Every fixture is
 * registered in {@link TABLE_EXTRACT_FIXTURES} with its answer; the tests
 * walk that registry, and a builder exported without an entry fails them.
 */
import JSZip from "jszip";
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import {
  INVOICE_FOOTER,
  INVOICE_LONE_TOTAL_ROWS,
  INVOICE_ROWS,
  invoicePdf,
  STATEMENT_ROWS,
  SKU_ROWS,
  TABLE_ROWS,
} from "./pdf-office-fixtures";

/** The heading and paragraph {@link reportTablesPdf} prints above its tables. */
export const REPORT_TITLE = "Quarterly Report";
export const REPORT_PROSE = [
  "Revenue grew in every region this quarter, led by North America and",
  "the new online store. The tables below give the figures in dollars.",
] as const;
/** The line between the two tables, flush left like a caption. */
export const REPORT_CAPTION = "Table 2: Staff by office";
/**
 * A note one and a half row pitches below the second table, in two runs: its
 * left run crosses the table's first gutter, its right run sits under the
 * last column. Close enough to be a row by distance alone; it is not one.
 */
export const REPORT_NOTE = [
  "Staff counts as of 30 June",
  "Source: HR",
] as const;
/** The page footer, centred well below the second table. */
export const REPORT_FOOTER = "Page 1 of 1";

/**
 * The first table: multi-word cells in the first column and in the headers,
 * headers set flush LEFT over amounts set flush RIGHT — the shapes a
 * word-by-word extractor splits into phantom columns.
 */
export const SALES_TABLE = [
  ["Region", "Units sold", "Unit price", "Revenue"],
  ["North America", "1,200", "$4.50", "$5,400.00"],
  ["South East", "980", "$4.75", "$4,655.00"],
  ["West", "1,560", "$4.25", "$6,630.00"],
] as const;

/**
 * The second table: a multi-word name column, and a count set flush RIGHT so
 * far from its heading, set flush left, that the two never overlap — white
 * space runs between them on every row.
 */
export const STAFF_TABLE = [
  ["Office", "Staff", "Manager"],
  ["London", "12", "Ada Lovelace"],
  ["New York", "30", "Grace Hopper"],
  ["Dhaka", "18", "Jamal Nazrul Islam"],
] as const;

/** Every table {@link reportTablesPdf} holds, in page order. */
export const REPORT_TABLES: readonly (readonly (readonly string[])[])[] = [
  SALES_TABLE,
  STAFF_TABLE,
];

const SIZE = 11;

/**
 * Draw a table: column `c` starts at `left[c]`; where `right[c]` is set, the
 * body cells of that column end there instead (flush right) while its header
 * stays flush left, the way reports set numeric columns. Rows are `pitch`
 * apart, with `headerGap` more below the first; `""` draws nothing.
 */
function drawTable(
  page: PDFPage,
  rows: readonly (readonly string[])[],
  top: number,
  left: readonly number[],
  right: readonly (number | null)[],
  font: PDFFont,
  bold: PDFFont,
  pitch = 16,
  headerGap = 0,
): void {
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell) return;
      const face = r === 0 ? bold : font;
      const edge = right[c];
      const x =
        r > 0 && edge != null
          ? edge - face.widthOfTextAtSize(cell, SIZE)
          : left[c]!;
      const y = top - r * pitch - (r > 0 ? headerGap : 0);
      page.drawText(cell, { x, y, size: SIZE, font: face });
    }),
  );
}

/**
 * An ordinary report page: a title, a two-line paragraph, a table, a caption,
 * a second table, a two-run note under it, and a footer — every non-table line
 * on the page is one the detector must leave out, and the page holds two
 * tables, not one.
 */
export async function reportTablesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const all = [
    REPORT_TITLE,
    ...REPORT_PROSE,
    REPORT_CAPTION,
    ...REPORT_NOTE,
    REPORT_FOOTER,
    ...REPORT_TABLES.flat(2),
  ];
  const font = await embedDrawingFont(doc, all);
  const bold = await embedDrawingFont(doc, all, "sans-bold");
  const page = doc.addPage([612, 792]);
  page.drawText(REPORT_TITLE, { x: 50, y: 740, size: 18, font: bold });
  REPORT_PROSE.forEach((line, i) =>
    page.drawText(line, { x: 50, y: 710 - i * 14, size: SIZE, font }),
  );
  drawTable(
    page,
    SALES_TABLE,
    660,
    [50, 200, 300, 400],
    [null, 260, 355, 470],
    font,
    bold,
  );
  page.drawText(REPORT_CAPTION, { x: 50, y: 580, size: SIZE, font: bold });
  drawTable(
    page,
    STAFF_TABLE,
    556,
    [50, 160, 240],
    [null, 215, null],
    font,
    bold,
  );
  page.drawText(REPORT_NOTE[0], { x: 50, y: 484, size: SIZE, font });
  page.drawText(REPORT_NOTE[1], { x: 240, y: 484, size: SIZE, font });
  const footerWidth = font.widthOfTextAtSize(REPORT_FOOTER, 9);
  page.drawText(REPORT_FOOTER, {
    x: (612 - footerWidth) / 2,
    y: 40,
    size: 9,
    font,
  });
  return doc.save();
}

/**
 * The deployment proof's table as it shipped until 2026-09-27: a 16pt bold
 * title 40pt above a 4-column grid set 24pt apart. The engine of that day
 * returned the title as a data row and an empty column in every row, and the
 * proof passed, because it checked that a ZIP came back.
 */
export const TITLED_TITLE = "Quarterly results";
export const TITLED_TABLE = [
  ["Region", "Q1", "Q2", "Q3"],
  ["North", "1200", "1350", "1410"],
  ["South", "980", "1020", "1105"],
  ["East", "1560", "1490", "1620"],
  ["West", "720", "860", "915"],
] as const;

/** {@link TITLED_TABLE} under {@link TITLED_TITLE}, as the old proof drew it. */
export async function titledTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const all = [TITLED_TITLE, ...TITLED_TABLE.flat()];
  const font = await embedDrawingFont(doc, all);
  const bold = await embedDrawingFont(doc, all, "sans-bold");
  const page = doc.addPage([595, 842]);
  page.drawText(TITLED_TITLE, { x: 60, y: 780, size: 16, font: bold });
  drawTable(page, TITLED_TABLE, 740, [60, 200, 330, 450], [], font, bold, 24);
  return doc.save();
}

/**
 * A header cell that SPANS the three columns under it, above a row of their
 * own headings: `""` draws nothing. The spanning cell crosses two gutters
 * every other row leaves empty, and must not merge the columns under it.
 */
export const SPANNING_TABLE = [
  ["Region", "Sales by quarter (units)", "", ""],
  ["", "Q1", "Q2", "Q3"],
  ["North", "1200", "1350", "1410"],
  ["South", "980", "1020", "1105"],
  ["East", "1560", "1490", "1620"],
] as const;

/**
 * {@link SPANNING_TABLE}, every cell flush left, in one face, the spanning
 * row 3pt further from the rest than their 16pt pitch — close, but not at it.
 */
export async function spanningHeaderPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, SPANNING_TABLE.flat());
  const page = doc.addPage([595, 842]);
  drawTable(
    page,
    SPANNING_TABLE,
    740,
    [60, 200, 280, 360],
    [],
    font,
    font,
    16,
    3,
  );
  return doc.save();
}

/** The note {@link surroundedInvoicePdf} sets beside the address line. */
export const INVOICE_ASIDE = "Period: January 2026";

/**
 * PDF to Excel's invoice with its rows set 24pt apart, a `Period: …` note
 * right-aligned on the address line 36pt above the header, and a two-run page
 * footer. The address line is only one and a half row pitches above the
 * header — too close to be cut off by distance alone — and its two runs
 * straddle the table's first gutter.
 */
export async function surroundedInvoicePdf(): Promise<Uint8Array> {
  return invoicePdf(24, INVOICE_ROWS, {
    aside: INVOICE_ASIDE,
    footer: INVOICE_FOOTER,
  });
}

/**
 * An AUTO-SIZED table, the way an HTML table prints: each column exactly as
 * wide as its widest cell — here always its heading — plus the same padding.
 * So the heading row's gaps are all one width, like the stretched spaces of
 * a justified line, and only its alignment with the rows under it says it is
 * a row of cells.
 */
export const AUTO_SIZED_TABLE = [
  ["Product", "Quantity", "Price", "Amount"],
  ["Pen", "12", "1.20", "14.40"],
  ["Ink", "3", "4.50", "13.50"],
  ["Pad", "10", "2.00", "20.00"],
] as const;

/**
 * {@link AUTO_SIZED_TABLE}, flush left, 8pt of padding between columns: under
 * one line height, as tight as an HTML table's cell padding prints.
 */
export async function autoSizedTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, AUTO_SIZED_TABLE.flat());
  const page = doc.addPage([612, 792]);
  const left = [50];
  AUTO_SIZED_TABLE[0].forEach((_, c) => {
    const widest = Math.max(
      ...AUTO_SIZED_TABLE.map((row) => font.widthOfTextAtSize(row[c]!, SIZE)),
    );
    left.push(left[c]! + widest + 8);
  });
  drawTable(page, AUTO_SIZED_TABLE, 700, left, [], font, font);
  return doc.save();
}

/**
 * Two tables one above the other with nothing between them but white space
 * three row pitches tall: no caption, no title, and different columns.
 */
export const STACKED_TABLES = [
  [
    ["Branch", "Opened", "Staff"],
    ["Leeds", "2019", "14"],
    ["York", "2021", "9"],
  ],
  [
    ["Product line", "Share"],
    ["Paper goods", "41%"],
    ["Office furniture", "59%"],
  ],
] as const;

/** {@link STACKED_TABLES}, the second 48pt below the first. */
export async function stackedTablesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, STACKED_TABLES.flat(2));
  const page = doc.addPage([612, 792]);
  const [first, second] = STACKED_TABLES;
  drawTable(page, first, 700, [50, 170, 290], [], font, font);
  drawTable(page, second, 620, [50, 230], [], font, font);
  return doc.save();
}

/**
 * PDF to Excel's invoice ending on an amount-only total: one run, under the
 * Amount column, directly below the last row.
 */
export async function loneTotalInvoicePdf(): Promise<Uint8Array> {
  return invoicePdf(16, INVOICE_LONE_TOTAL_ROWS);
}

/** A fixture PDF and every table Extract Tables must return for it. */
export interface TableExtractFixture {
  build: () => Promise<Uint8Array>;
  tables: readonly (readonly (readonly string[])[])[];
}

/**
 * Every PDF this module builds, with its answer. The tests discover the
 * module's `*Pdf` exports and require each to be here, so a new fixture
 * cannot be exported and silently left unchecked.
 */
export const TABLE_EXTRACT_FIXTURES: Record<string, TableExtractFixture> = {
  reportTablesPdf: { build: reportTablesPdf, tables: REPORT_TABLES },
  titledTablePdf: { build: titledTablePdf, tables: [TITLED_TABLE] },
  spanningHeaderPdf: { build: spanningHeaderPdf, tables: [SPANNING_TABLE] },
  surroundedInvoicePdf: { build: surroundedInvoicePdf, tables: [INVOICE_ROWS] },
  autoSizedTablePdf: { build: autoSizedTablePdf, tables: [AUTO_SIZED_TABLE] },
  stackedTablesPdf: { build: stackedTablesPdf, tables: STACKED_TABLES },
  loneTotalInvoicePdf: {
    build: loneTotalInvoicePdf,
    tables: [INVOICE_LONE_TOTAL_ROWS],
  },
};

/**
 * The tables in the PDF to Office fixtures (`./pdf-office-fixtures`), by
 * builder name, drawn from the same constants those PDFs are drawn from.
 * Every other builder there is prose, lists or a single row, and must come
 * back as `no_tables`; the tests walk that module's `*Pdf` exports.
 */
export const OFFICE_FIXTURE_TABLES: Record<
  string,
  readonly (readonly (readonly string[])[])[]
> = {
  quarterlyTablePdf: [TABLE_ROWS],
  incomeStatementPdf: [STATEMENT_ROWS],
  skuTablePdf: [SKU_ROWS],
  invoicePdf: [INVOICE_ROWS],
};

// ───────────────────────────── reading the ZIP ──────────────────────────────

/**
 * Parse RFC-4180 CSV: CRLF (or LF) between records, `"`-quoted fields with
 * `""` for a quote. Written here, not imported, so the engine's `toCsv` is
 * checked by something that shares no code with it.
 */
export function parseCsv(text: string): string[][] {
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
      /* the LF ends the record */
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (text.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The `table-N.csv` grids of an Extract Tables ZIP, in N order. */
export async function readTablesZip(
  bytes: Uint8Array,
): Promise<{ tables: string[][][]; hasWorkbook: boolean }> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .map((name) => /^table-(\d+)\.csv$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const tables: string[][][] = [];
  for (const m of names)
    tables.push(parseCsv(await zip.file(m[0])!.async("string")));
  return { tables, hasWorkbook: zip.file("tables.xlsx") !== null };
}

/**
 * Where an Extract Tables ZIP differs from the grids it must hold, one line
 * per difference: a missing workbook, a wrong table count, a row the table
 * should not have (a title, a caption, a footer), a column empty in every row,
 * and every cell that is not the expected text. Empty means exactly right.
 */
export function tablesMismatches(
  tables: readonly (readonly (readonly string[])[])[],
  expected: readonly (readonly (readonly string[])[])[] = REPORT_TABLES,
): string[] {
  const out: string[] = [];
  if (tables.length !== expected.length)
    out.push(`${tables.length} table(s), expected ${expected.length}`);
  expected.forEach((want, t) => {
    const got = tables[t];
    if (!got) return;
    const name = `table-${t + 1}.csv`;
    if (got.length !== want.length)
      out.push(`${name}: ${got.length} row(s), expected ${want.length}`);
    const width = Math.max(0, ...got.map((row) => row.length));
    for (let c = 0; c < width; c++)
      if (got.every((row) => (row[c] ?? "") === ""))
        out.push(`${name}: column ${c + 1} is empty in every row`);
    const rows = Math.max(got.length, want.length);
    for (let r = 0; r < rows; r++) {
      const cols = Math.max(got[r]?.length ?? 0, want[r]?.length ?? 0);
      for (let c = 0; c < cols; c++) {
        const g = got[r]?.[c] ?? "";
        const w = want[r]?.[c] ?? "";
        if (g !== w)
          out.push(
            `${name} row ${r + 1} col ${c + 1}: ${JSON.stringify(g)}, expected ${JSON.stringify(w)}`,
          );
      }
    }
  });
  return out;
}

/**
 * The deployment proof's verdict on an Extract Tables ZIP of
 * {@link reportTablesPdf}: every cell of both tables, and nothing else.
 * `scripts/worker-prove-tools.ts` calls exactly this; a `PK` at byte 0 was
 * true of the title-merged, phantom-column table the engine shipped.
 */
export async function tablesProofVerdict(
  bytes: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  const { tables } = await readTablesZip(bytes);
  const problems = await tablesZipMismatches(bytes);
  return problems.length === 0
    ? {
        ok: true,
        detail: `${tables.length} table(s), ${tables.map((t) => `${t.length}x${t[0]?.length ?? 0}`).join(" + ")}, every cell matches`,
      }
    : {
        ok: false,
        detail: `the ZIP differs from the report's tables in ${problems.length} place(s): ${problems.slice(0, 4).join("; ")}`,
      };
}

/** {@link tablesMismatches} over the bytes a user downloads. */
export async function tablesZipMismatches(
  bytes: Uint8Array,
  expected: readonly (readonly (readonly string[])[])[] = REPORT_TABLES,
): Promise<string[]> {
  const { tables, hasWorkbook } = await readTablesZip(bytes);
  return [
    ...(hasWorkbook ? [] : ["tables.xlsx is missing"]),
    ...tablesMismatches(tables, expected),
  ];
}
