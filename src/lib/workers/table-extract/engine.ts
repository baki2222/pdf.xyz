import JSZip from "jszip";
import {
  SheetStyles,
  STYLES_CONTENT_TYPE_OVERRIDE,
  stylesRelationship,
  worksheetXml,
  xmlEscape,
} from "../ooxml/sheet-cells";

/**
 * Table extraction engine for the `extract-tables` tool.
 *
 * This is a real, heuristic table detector — not an AI model and not a fabricated
 * output. It works purely from the *positioned* selectable text of a PDF (each
 * run with its page coordinates), clusters those runs into rows and columns by
 * geometry, and only reports a table when an aligned grid of at least two columns
 * and two rows actually emerges. Scanned/image-only PDFs have no selectable text
 * and fail honestly as `no_text`; prose or single-column PDFs fail honestly as
 * `no_tables`. When tables are found, it emits a real ZIP holding one RFC-4180
 * CSV per table plus a combined multi-sheet XLSX workbook.
 *
 * The engine takes its layout extractor as an injected dependency so it stays
 * node-free and unit-testable: the production worker wires the NATIVE
 * `pdftotext -bbox-layout` extractor (`./native` → `pdf-text/native`), tests wire
 * a deterministic fake.
 *
 * ⚠️ IT IS NOT pdfjs, and this docblock said it was — twice: *"the same text pdfjs
 * exposes"* and *"the production worker wires the pdfjs-backed extractor"*. pdfjs
 * is browser-only and throws under Node before reading a byte, which is the whole
 * reason `pdf-text/native` exists. The two extractors also do not agree on the
 * text: see `pdf-text/parse.ts`.
 */

export const EXTRACT_TABLES_TOOL = "extract-tables" as const;
/**
 * The engine name that ships inside every extract-tables job result.
 *
 * RENAMED 2026-08-11 from `pdfjs-layout-tables`, which named an extractor this
 * worker does not use and cannot use — pdfjs is browser-only and throws under
 * Node before reading a byte. A contract that misdescribes itself is worse than
 * a contract change, and this is an opaque string only our own surfaces consume.
 * Job records written before that date carry the old value.
 */
export const EXTRACT_TABLES_ENGINE = "pdftotext-layout-tables" as const;

/** One positioned selectable-text run. Coordinates are PDF points; y grows upward. */
export interface PositionedTextItem {
  text: string;
  /** Left edge (PDF x). */
  x: number;
  /** Baseline/bottom (PDF y); larger y is higher on the page. */
  y: number;
  /** Rendered width of the run in points. */
  width: number;
  /** Rendered (font) height of the run in points. */
  height: number;
}

/** One page's positioned text plus its media box, 1-based page number. */
export interface PdfLayoutPage {
  pageNumber: number;
  width: number;
  height: number;
  items: PositionedTextItem[];
}

/** The positioned-text layout of a whole PDF. */
export interface PdfLayout {
  pageCount: number;
  pages: PdfLayoutPage[];
}

/** A detected table: its source page and its cells as ordered rows × columns. */
export interface DetectedTable {
  pageNumber: number;
  rows: string[][];
}

/** Pull the positioned layout of a PDF; absent ⇒ the engine fails as `unsupported`. */
export type PdfLayoutExtractor = (bytes: Uint8Array) => Promise<PdfLayout>;

export interface TableExtractDeps {
  extractLayout?: PdfLayoutExtractor;
  limits?: { maxInputBytes?: number; maxOutputBytes?: number };
}

export interface TableExtractMeta {
  engine: typeof EXTRACT_TABLES_ENGINE;
  tool: typeof EXTRACT_TABLES_TOOL;
  tableCount: number;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
}

export type TableExtractRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "zip";
      contentType: "application/zip";
      meta: TableExtractMeta;
    }
  | {
      ok: false;
      kind: "unsupported" | "no_text" | "no_tables" | "too_large" | "failed";
      limitBytes?: number;
      message: string;
    };

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid];
  const lo = sorted[mid - 1];
  if (hi === undefined) return 0;
  return sorted.length % 2 === 0 && lo !== undefined ? (lo + hi) / 2 : hi;
}

/**
 * Greedily cluster 1-D values (already the anchor of a row or column) into groups
 * whose members are within `tolerance` of the running cluster mean. Returns each
 * cluster's mean, sorted ascending — a stable set of row/column anchor lines.
 */
function clusterAnchors(values: number[], tolerance: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: { sum: number; count: number }[] = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && value - last.sum / last.count <= tolerance) {
      last.sum += value;
      last.count += 1;
    } else {
      clusters.push({ sum: value, count: 1 });
    }
  }
  return clusters.map((c) => c.sum / c.count);
}

function nearestIndex(anchors: number[], value: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    if (anchor === undefined) continue;
    const dist = Math.abs(anchor - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Recover the aligned tables on a single page from its positioned text.
 *
 * Rows are the text runs clustered by their vertical anchor (y), ordered
 * top-to-bottom (descending y, since PDF y grows upward). Columns are the runs
 * clustered by their left edge (x), ordered left-to-right. A region is reported as
 * a table only when the grid has at least two columns and two rows AND enough of
 * its cells are populated to look like a real grid rather than an accidental
 * alignment of prose — so single-column lists and running text yield no tables.
 */
export function detectTablesOnPage(page: PdfLayoutPage): DetectedTable[] {
  const items = page.items.filter((item) => item.text.trim().length > 0);
  if (items.length < 4) return [];

  const medianHeight = median(items.map((item) => item.height)) || 10;
  const rowTolerance = Math.max(2, medianHeight * 0.6);
  const columnTolerance = Math.max(6, medianHeight);

  // Rows: cluster by vertical anchor, then order top-to-bottom.
  const rowAnchors = clusterAnchors(
    items.map((item) => item.y),
    rowTolerance,
  )
    .slice()
    .sort((a, b) => b - a);
  // Columns: cluster by left edge, ordered left-to-right.
  const columnAnchors = clusterAnchors(
    items.map((item) => item.x),
    columnTolerance,
  );

  if (rowAnchors.length < 2 || columnAnchors.length < 2) return [];

  // Bucket each run into its (row, column) cell.
  const grid: PositionedTextItem[][][] = rowAnchors.map(() =>
    columnAnchors.map(() => []),
  );
  for (const item of items) {
    const r = nearestIndex(rowAnchors, item.y);
    const c = nearestIndex(columnAnchors, item.x);
    grid[r]?.[c]?.push(item);
  }

  const rows = grid.map((cells) =>
    cells.map((runs) =>
      runs
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((run) => run.text.trim())
        .filter((text) => text.length > 0)
        .join(" "),
    ),
  );

  // Reject accidental grids: require most cells populated and every column and row
  // to carry real content, so prose and sparse layouts are not mistaken for tables.
  const totalCells = rows.length * columnAnchors.length;
  const filledCells = rows.reduce(
    (sum, cells) => sum + cells.filter((c) => c.length > 0).length,
    0,
  );
  if (filledCells / totalCells < 0.5) return [];

  const columnFilled = columnAnchors.map(
    (_, c) => rows.filter((cells) => (cells[c]?.length ?? 0) > 0).length,
  );
  if (columnFilled.filter((count) => count >= 2).length < 2) return [];
  if (
    rows.filter((cells) => cells.filter((c) => c.length > 0).length >= 2)
      .length < 2
  )
    return [];

  return [{ pageNumber: page.pageNumber, rows }];
}

// ---------------------------------------------------------------------------
// CSV / XLSX serialization
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize rows to an RFC-4180 CSV string: CRLF row separators, no trailing CRLF. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Build a single, multi-sheet XLSX workbook — one sheet per detected table. */
async function buildXlsx(tables: DetectedTable[]): Promise<Uint8Array> {
  // Cells, column letters and number rules are shared with PDF to Excel —
  // see `../ooxml/sheet-cells`. Sheets first: they register the formats that
  // `xl/styles.xml` must declare.
  const styles = new SheetStyles();
  const sheets = tables.map((table) => worksheetXml(table.rows, styles));
  const zip = new JSZip();
  const sheetOverrides = tables
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}${STYLES_CONTENT_TYPE_OVERRIDE}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join(
        "",
      )}${stylesRelationship(`rId${tables.length + 1}`)}</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tables
      .map(
        (table, i) =>
          `<sheet name="${xmlEscape(`Table ${i + 1} (p${table.pageNumber})`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  sheets.forEach((sheet, i) =>
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheet),
  );
  zip.file("xl/styles.xml", styles.xml());
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/**
 * Package detected tables into a real ZIP: one RFC-4180 CSV per table
 * (`table-1.csv`, `table-2.csv`, …) plus a combined `tables.xlsx` workbook.
 */
export async function buildTablesZip(
  tables: DetectedTable[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  tables.forEach((table, i) =>
    zip.file(`table-${i + 1}.csv`, toCsv(table.rows)),
  );
  zip.file("tables.xlsx", await buildXlsx(tables));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run the full table-extraction flow honestly: reject oversized input before
 * touching the extractor, fail as `unsupported` when no extractor is wired, as
 * `no_text` for scanned/image-only PDFs, as `no_tables` when no aligned grid is
 * found, and as `failed` if the extractor throws — never a fabricated ZIP. On
 * success, return a real ZIP of CSVs + a combined XLSX.
 */
export async function runTableExtract(
  input: Uint8Array,
  deps: TableExtractDeps,
): Promise<TableExtractRun> {
  const { extractLayout } = deps;
  if (!extractLayout) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "Table extraction requires the PDF layout extractor, which is not available in this environment.",
    };
  }
  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      message: "The PDF input exceeds the worker's size limit.",
    };
  }
  try {
    const layout = await extractLayout(input);
    const hasText = layout.pages.some((page) =>
      page.items.some((item) => item.text.trim().length > 0),
    );
    if (!hasText) {
      return {
        ok: false,
        kind: "no_text",
        message:
          "This PDF has no selectable text, so no tables can be extracted. Run OCR PDF first, then try again.",
      };
    }
    const tables = layout.pages.flatMap((page) => detectTablesOnPage(page));
    if (tables.length === 0) {
      return {
        ok: false,
        kind: "no_tables",
        message:
          "No table-like structure was detected in this PDF's selectable text.",
      };
    }
    const output = await buildTablesZip(tables);
    const maxOutput = deps.limits?.maxOutputBytes;
    if (maxOutput !== undefined && output.byteLength > maxOutput) {
      return {
        ok: false,
        kind: "failed",
        message: "The extracted tables archive exceeds the worker size limit.",
      };
    }
    return {
      ok: true,
      output,
      filenameExt: "zip",
      contentType: "application/zip",
      meta: {
        engine: EXTRACT_TABLES_ENGINE,
        tool: EXTRACT_TABLES_TOOL,
        tableCount: tables.length,
        pageCount: layout.pageCount,
        inputBytes: input.byteLength,
        outputBytes: output.byteLength,
      },
    };
  } catch {
    return {
      ok: false,
      kind: "failed",
      message: "The PDF could not be processed for table extraction.",
    };
  }
}
