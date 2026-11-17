"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { MAX_PREVIEW_TABLES } from "@/lib/jobs/table-preview-limits";
import {
  readTablePreview,
  type TablePreview,
  type TablePreviewSet,
} from "@/lib/workers/table-extract-preview";

/**
 * The first rows of each table, on Extract Tables' result card (competitor
 * audit #22, 2026-11-17). Read in the browser from the ZIP the panel already
 * downloaded: no cell text is sent anywhere or kept in the job record.
 *
 * Its own chunk, behind the panel's `next/dynamic`: fetched when a result
 * arrives, never with the page. `lazy-chunks.test.ts` holds it there by
 * {@link TABLE_PREVIEW_CHUNK}, which only this view renders. It imports
 * nothing from `@/lib/jobs/extract-tables-options` (in the page's first
 * load): the combined sheet's name is read from the ZIP's workbook.
 */
export const TABLE_PREVIEW_CHUNK = "pdfxyz:lazy:table-preview";

type State =
  | { phase: "reading" }
  | { phase: "read"; set: TablePreviewSet }
  | { phase: "failed" };

/** "first 5 of 37 rows", "all 3 rows", "1 row". */
export function rowsNote(shown: number, total: number): string {
  if (total > shown) return `first ${shown} of ${total} rows`;
  return total === 1 ? "1 row" : `all ${total} rows`;
}

/** The line above a table: which table, its page, and how much is shown. */
export function previewCaption(table: TablePreview): string {
  const name =
    table.table === null
      ? (table.sheet ?? table.file)
      : `Table ${table.table}${table.page === null ? "" : `, page ${table.page}`}`;
  return table.totalRows === 0
    ? `${name}: this table is empty.`
    : `${name}: ${rowsNote(table.rows.length, table.totalRows)}`;
}

/** The sentence under the heading when not every table is shown, or none. */
export function previewSelectionNote(set: TablePreviewSet): string | null {
  const n = set.tableFiles;
  if (set.tables.length >= n) return null;
  if (set.perPage)
    return set.pagesWithTables <= MAX_PREVIEW_TABLES
      ? `There are ${n} tables, so this shows the first table on each page. Every table is in the ZIP.`
      : `There are ${n} tables, so this shows the first table on each of the first ${set.tables.length} pages that have one. Every table is in the ZIP.`;
  return `There are ${n} tables; this shows the first ${set.tables.length}. Every table is in the ZIP.`;
}

/** What to do when the ZIP holds no table to show. */
export function noTablesPreviewSentence(ocrRan: boolean): string {
  return ocrRan
    ? "The ZIP holds no table to preview. PDF to Excel puts every line of the text into a sheet instead."
    : "The ZIP holds no table to preview. If the pages are scans, turn on “Recognise text in scans (OCR)” above and run it again, or try PDF to Excel, which puts every line of the text into a sheet.";
}

export const PREVIEW_HEADING = "Preview of the first rows";
export const PREVIEW_FAILED =
  "The preview could not be read. The ZIP itself is not affected.";

function PreviewTable({ table }: { table: TablePreview }) {
  const id = useId();
  const caption = previewCaption(table);
  if (table.totalRows === 0)
    return <p className="text-muted text-xs">{caption}</p>;
  const [head = [], ...body] = table.rows;
  return (
    <div className="flex flex-col gap-1">
      <p id={id} className="text-muted text-xs">
        {caption}
      </p>
      {/* Scrolls sideways inside the card, never the page; focusable, so a
          keyboard can scroll it too (axe scrollable-region-focusable). */}
      <div
        role="region"
        aria-labelledby={id}
        tabIndex={0}
        data-table-preview={table.file}
        className="border-line bg-canvas rounded-panel border"
        style={{ overflowX: "auto", maxWidth: "100%" }}
      >
        <table
          aria-labelledby={id}
          className="text-sm"
          style={{ borderCollapse: "collapse", minWidth: "100%" }}
        >
          <thead>
            <tr className="text-left">
              {head.map((cell, i) => (
                <th
                  key={i}
                  scope="col"
                  dir="auto"
                  className="text-fg px-3 py-2 font-medium"
                  style={{ whiteSpace: "nowrap" }}
                >
                  {cell === "" ? (
                    <span className="sr-only">Column {i + 1}</span>
                  ) : (
                    cell
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-line border-t">
                {row.map((cell, i) => (
                  <td
                    key={i}
                    dir="auto"
                    className="text-muted px-3 py-2"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TableExtractPreview({
  zip,
  ocrRan,
}: {
  /** The result ZIP's bytes, as downloaded for the Download button. */
  zip: Uint8Array;
  /** The job ran OCR first: the OCR switch is then not a next step. */
  ocrRan: boolean;
}) {
  // Keyed by the bytes it was read from: a new result reads as "reading"
  // until its own read settles.
  const [read, setRead] = useState<{ zip: Uint8Array; state: State } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    readTablePreview(zip).then(
      (set) => live && setRead({ zip, state: { phase: "read", set } }),
      () => live && setRead({ zip, state: { phase: "failed" } }),
    );
    return () => {
      live = false;
    };
  }, [zip]);
  const state: State =
    read && read.zip === zip ? read.state : { phase: "reading" };

  let body;
  if (state.phase === "reading") body = null;
  else if (state.phase === "failed")
    body = <p className="text-muted text-sm">{PREVIEW_FAILED}</p>;
  else if (state.set.tableFiles === 0)
    body = (
      <div className="flex flex-col gap-1">
        <p className="text-muted text-sm leading-relaxed">
          {noTablesPreviewSentence(ocrRan)}
        </p>
        <Link
          href="/tools/pdf-to-excel"
          className="text-fg text-sm font-medium underline underline-offset-4"
        >
          Open PDF to Excel
        </Link>
      </div>
    );
  else {
    const note = previewSelectionNote(state.set);
    body = (
      <>
        {note && <p className="text-muted text-xs leading-relaxed">{note}</p>}
        {state.set.tables.map((table) => (
          <PreviewTable key={table.file} table={table} />
        ))}
      </>
    );
  }

  return (
    <section
      data-chunk={TABLE_PREVIEW_CHUNK}
      aria-label={PREVIEW_HEADING}
      aria-busy={state.phase === "reading" || undefined}
      className="flex flex-col gap-3"
    >
      <p className="text-fg text-sm font-medium">{PREVIEW_HEADING}</p>
      {body}
    </section>
  );
}
