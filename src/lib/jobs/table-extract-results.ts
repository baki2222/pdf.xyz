/**
 * Client-facing result metadata for `extract-tables`: **what was found, and
 * where** — counts and page numbers only, never a cell.
 *
 * The engine always counted its tables (`meta.tableCount`), but that went to
 * the log, not to the job record, so the result card said the same sentence
 * whether one table came back or forty, and a page that produced nothing (a
 * scanned page in a mixed PDF, a table the detector missed) left no trace
 * short of opening every sheet. Added 2026-11-08 (audit extract-tables#4).
 *
 * Imported by `./results` (the sanitizer) and by the Extract Tables panel;
 * the sentences the panel builds from it live beside the panel, so this
 * module carries no copy into the sanitizer's importers.
 */

/** The most page numbers a block lists; a longer list is cut and marked. */
export const MAX_TABLE_PAGES_LISTED = 2000;

export interface TableExtractResultMeta {
  /** Tables detected (before any combining). */
  tableCount: number;
  /** Pages in the PDF. */
  pageCount: number;
  /**
   * The 1-based pages at least one table came from, ascending and distinct,
   * at most {@link MAX_TABLE_PAGES_LISTED} of them.
   */
  tablePages: number[];
  /** True when `tablePages` was cut at {@link MAX_TABLE_PAGES_LISTED}. */
  tablePagesTruncated: boolean;
  /** True when the tables were written as one sheet and one CSV. */
  combined: boolean;
}

/** True when a value plausibly came from the real contract. */
export function isTableExtractResultMeta(
  value: unknown,
): value is TableExtractResultMeta {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as TableExtractResultMeta).tableCount === "number" &&
    Array.isArray((value as TableExtractResultMeta).tablePages)
  );
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

/**
 * Re-bound an untrusted block for persistence: non-negative integer counts,
 * pages that exist in the document, sorted, distinct and capped.
 */
export function buildTableExtractResultMeta(
  raw: TableExtractResultMeta,
): TableExtractResultMeta {
  const pageCount = count(raw.pageCount);
  const pages = [
    ...new Set(
      (Array.isArray(raw.tablePages) ? raw.tablePages : []).filter(
        (p): p is number =>
          typeof p === "number" &&
          Number.isSafeInteger(p) &&
          p >= 1 &&
          p <= pageCount,
      ),
    ),
  ].sort((a, b) => a - b);
  return {
    tableCount: count(raw.tableCount),
    pageCount,
    tablePages: pages.slice(0, MAX_TABLE_PAGES_LISTED),
    tablePagesTruncated:
      raw.tablePagesTruncated === true || pages.length > MAX_TABLE_PAGES_LISTED,
    combined: raw.combined === true,
  };
}
