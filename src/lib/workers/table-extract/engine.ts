import JSZip from "jszip";
import { CSV_BOM, toCsv } from "../ooxml/csv";
import {
  SheetStyles,
  STYLES_CONTENT_TYPE_OVERRIDE,
  stylesRelationship,
  worksheetXml,
  xmlEscape,
} from "../ooxml/sheet-cells";
import { classifyPdfTextFailure } from "../pdf-office-export/encryption";
import {
  rethrowIfAttemptAbort,
  signalOption,
  type RunControl,
} from "../attempt-abort";
import {
  detectTablesOnPage,
  type DetectedTable,
  type PdfLayoutPage,
} from "./detect";

// Detection lives in `./detect` (moved 2026-11-08) so PDF to Markdown's
// in-browser reader can use the same detector without this module's ZIP and
// XLSX writers. Re-exported so every existing importer keeps its path.
export {
  detectTablesOnPage,
  LOOSE_EDGE_PITCHES,
  PHRASE_GAP_HEIGHTS,
  TABLE_BREAK_PITCHES,
} from "./detect";
export type {
  DetectedTable,
  PdfLayoutPage,
  PositionedTextItem,
} from "./detect";

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
 * exposes"* and *"the production worker wires the pdfjs-backed extractor"*. That
 * extractor loads pdfjs's main build, which throws under Node before reading a
 * byte, which is the whole reason `pdf-text/native` exists. The two extractors also do not agree on the
 * text: see `pdf-text/parse.ts`.
 */

export const EXTRACT_TABLES_TOOL = "extract-tables" as const;
/**
 * The engine name that ships inside every extract-tables job result.
 *
 * RENAMED 2026-08-11 from `pdfjs-layout-tables`, which named an extractor this
 * worker does not use — the pdfjs extractor it named loads pdfjs's main build,
 * which throws under Node before reading a byte. A contract that misdescribes itself is worse than
 * a contract change, and this is an opaque string only our own surfaces consume.
 * Job records written before that date carry the old value.
 */
export const EXTRACT_TABLES_ENGINE = "pdftotext-layout-tables" as const;

/** The positioned-text layout of a whole PDF. */
export interface PdfLayout {
  pageCount: number;
  pages: PdfLayoutPage[];
}

/** Pull the positioned layout of a PDF; absent ⇒ the engine fails as `unsupported`. */
export type PdfLayoutExtractor = (
  bytes: Uint8Array,
  run?: RunControl,
) => Promise<PdfLayout>;

export interface TableExtractDeps {
  extractLayout?: PdfLayoutExtractor;
  /**
   * Asked only after the extractor REFUSED the document: does it need a
   * password? Injectable for tests; defaults to the pdf-lib + byte-scan probe.
   */
  isEncrypted?: (bytes: Uint8Array) => Promise<boolean>;
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
      kind:
        | "unsupported"
        | "no_text"
        | "no_tables"
        | "too_large"
        | "password_protected"
        | "unreadable"
        | "failed";
      limitBytes?: number;
      message: string;
    };

// ---------------------------------------------------------------------------
// CSV / XLSX serialization
// ---------------------------------------------------------------------------

// The CSV writer is shared with AI Data Extraction's in-browser CSV
// (`ai-extract-package.ts`), so both files neutralise formulas the same way.
export { CSV_BOM, CSV_FORMULA_LEADS, toCsv } from "../ooxml/csv";

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
 *
 * Each CSV starts with {@link CSV_BOM}. Without it, Excel opens a
 * double-clicked CSV in the legacy code page and accented, Bengali or Cyrillic
 * text comes out garbled; pandas (`utf-8-sig`) and R read the mark and drop it.
 * Until 2026-11-06 the files had none (audit #31).
 */
export async function buildTablesZip(
  tables: DetectedTable[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  tables.forEach((table, i) =>
    zip.file(`table-${i + 1}.csv`, CSV_BOM + toCsv(table.rows)),
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
  /** The attempt's abort signal, passed to pdftotext. */
  signal?: AbortSignal,
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
    const layout = await extractLayout(input, signalOption(signal));
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
      // Deterministic: the same PDF builds the same archive on every attempt,
      // so a retryable `failed` here could only fail again.
      return {
        ok: false,
        kind: "too_large",
        limitBytes: maxOutput,
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
  } catch (error) {
    rethrowIfAttemptAbort(error);
    // Every throw used to land here as one retryable `failed`, so a
    // password-protected statement was requeued twice with nothing changed
    // and then reported as "could not be processed". Ask the shared
    // classifier what the failure says about the DOCUMENT first; only a run
    // that did not finish stays retryable.
    switch (await classifyPdfTextFailure(error, input, deps.isEncrypted)) {
      case "too_large":
        return {
          ok: false,
          kind: "too_large",
          message:
            "The text layout extracted from this PDF exceeds the worker's limit.",
        };
      case "password_protected":
        return {
          ok: false,
          kind: "password_protected",
          message:
            "This PDF is password-protected. Unlock it with Unlock PDF, then extract its tables.",
        };
      case "unreadable":
        return {
          ok: false,
          kind: "unreadable",
          message:
            "This PDF could not be opened. It may be damaged; Repair PDF can often fix that.",
        };
      default:
        return {
          ok: false,
          kind: "failed",
          message: "The PDF could not be processed for table extraction.",
        };
    }
  }
}
