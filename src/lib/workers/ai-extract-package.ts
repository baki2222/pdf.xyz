import { CSV_BOM, toCsv } from "./ooxml/csv";

/**
 * AI Data Extraction's CSV, built IN THE BROWSER from the package the worker
 * already returned (audit ai-extract#3).
 *
 * The bytes are in the page — `runSecurityJob` fetches the artifact as soon as
 * the job completes — so turning extraction.json into a CSV here sends
 * nothing anywhere and costs no AI allowance. It is also true of every worker
 * image: nothing about the worker changed, so there is no deploy for this to
 * wait on (a worker-written CSV would have been advertised by the web tier the
 * day it merged and delivered only once the image was rebuilt by hand).
 *
 * The entry names are the ones the engine writes, from this record
 * (`./ai-extract/engine.ts` buildPackage), so a rename moves both.
 */
export const AI_EXTRACT_PACKAGE_FILES = {
  /** The data: the requested fields in order (schema), or the reply (prompt). */
  json: "extraction.json",
  /** The model's reply exactly as returned. */
  modelOutput: "model-output.json",
  /** The Field | Value rendering. */
  markdown: "extraction.md",
  manifest: "manifest.json",
  readme: "README.txt",
} as const;

/** What a list value's items are joined with inside one cell. */
export const CSV_LIST_SEPARATOR = "; ";

/**
 * The CSV's shape as a reader is told it — panel, tool FAQ and guide all
 * render THIS, and ai-extract-package.test.ts holds each clause to the code.
 */
export const AI_EXTRACT_CSV_SHAPE = `one row per record, the keys as the header (with a field schema, your field names in your order), and a list's items in one cell separated by "${CSV_LIST_SEPARATOR.trim()}"`;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One cell: null is empty, a list is joined, a nested object is its JSON. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        isRow(item) || Array.isArray(item)
          ? JSON.stringify(item)
          : cellText(item),
      )
      .join(CSV_LIST_SEPARATOR);
  }
  return JSON.stringify(value);
}

/**
 * extraction.json as a header row plus data rows, or `null` when it has no
 * table shape:
 *  - an object (every field schema, most prompts) is ONE row, its keys the
 *    header in the order the file holds them — a schema's order is yours;
 *  - a list of objects is one row per object, the header every key in the
 *    order first seen;
 *  - anything else (a list of plain values, an empty object) is `null`, and
 *    the panel offers no CSV rather than a CSV that misrepresents it.
 */
export function extractionRows(data: unknown): string[][] | null {
  const records = isRow(data)
    ? [data]
    : Array.isArray(data) && data.length > 0 && data.every(isRow)
      ? data
      : null;
  if (!records) return null;
  const header: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        header.push(key);
      }
    }
  }
  if (header.length === 0) return null;
  return [
    header,
    ...records.map((record) =>
      header.map((key) =>
        cellText(Object.hasOwn(record, key) ? record[key] : null),
      ),
    ),
  ];
}

/** The CSV text (byte-order mark included, as Extract Tables writes it). */
export function extractionCsv(data: unknown): string | null {
  const rows = extractionRows(data);
  return rows ? CSV_BOM + toCsv(rows) : null;
}

/** extraction.json read from the package, as a CSV; `null` when there is none. */
export async function readExtractionCsv(
  output: Uint8Array,
): Promise<string | null> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(output);
    const entry = zip.file(AI_EXTRACT_PACKAGE_FILES.json);
    if (!entry) return null;
    return extractionCsv(JSON.parse(await entry.async("string")) as unknown);
  } catch {
    return null;
  }
}

/** `invoice-extraction.zip` becomes `invoice-extraction.csv`. */
export function extractionCsvName(zipName: string): string {
  return `${zipName.replace(/\.zip$/i, "") || "extraction"}.csv`;
}
