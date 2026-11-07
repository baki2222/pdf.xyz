"use client";

import type { Job } from "@/lib/jobs/types";
import type { TableExtractResultMeta } from "@/lib/jobs/table-extract-results";
import { COMBINED_SHEET_NAME } from "@/lib/jobs/extract-tables-options";

/*
 * What Extract Tables found, said on its result card (audit extract-tables#4,
 * 2026-11-08). Until then the card said one sentence whatever came back, and
 * a page that produced nothing — a scan in a mixed PDF, a table the detector
 * missed — left no trace short of opening every sheet.
 *
 * Renders from `job.results.tables` and nothing else. No block means the
 * worker did not report (it deploys by hand and can be older than this
 * page), so it says nothing rather than a count it cannot know.
 */

/** The most runs of pages a sentence lists before "and N more pages". */
export const MAX_PAGE_RUNS_LISTED = 12;

/** Runs of consecutive pages: [1,2,3,5] → [[1,3],[5,5]]. */
function runsOf(pages: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const page of pages) {
    const last = runs.at(-1);
    if (last && page === last[1] + 1) last[1] = page;
    else runs.push([page, page]);
  }
  return runs;
}

/** "page 4", "pages 1–3 and 5", "pages 1, 3, 5 and 2 more pages". */
export function pagePhrase(pages: readonly number[]): string {
  const runs = runsOf(pages);
  const shown = runs.slice(0, MAX_PAGE_RUNS_LISTED);
  const listedPages = shown.reduce((n, [a, b]) => n + b - a + 1, 0);
  const rest = pages.length - listedPages;
  const parts = shown.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  if (rest > 0) parts.push(`${rest} more ${rest === 1 ? "page" : "pages"}`);
  const noun = pages.length === 1 ? "page" : "pages";
  const list =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${noun} ${list}`;
}

/** The sentences the card shows, or none when the worker did not report. */
export function tableFindingLines(
  found: TableExtractResultMeta | undefined,
): string[] {
  if (!found || found.tableCount < 1) return [];
  const n = found.tableCount;
  const tables = `${n} ${n === 1 ? "table" : "tables"}`;
  if (found.tablePagesTruncated || found.tablePages.length === 0)
    return [`Found ${tables}.`];
  const lines = [`Found ${tables} on ${pagePhrase(found.tablePages)}.`];
  const have = new Set(found.tablePages);
  const none: number[] = [];
  for (let page = 1; page <= found.pageCount; page++)
    if (!have.has(page)) none.push(page);
  if (none.length > 0)
    lines.push(
      `No table was detected on ${pagePhrase(none)}. If ${none.length === 1 ? "it is a scan" : "they are scans"}, OCR PDF can add the text first.`,
    );
  return lines;
}

/** The card's first sentence: what the ZIP holds. */
export function tablesReadySentence(job: Job | undefined): string {
  return job?.results?.tables?.combined
    ? `Your tables are ready as a ZIP of one CSV file plus an Excel workbook with one sheet, “${COMBINED_SHEET_NAME}”.`
    : "Your tables are ready as a ZIP of CSV files plus a combined Excel workbook.";
}

export function TableExtractFindings({ job }: { job: Job | undefined }) {
  const lines = tableFindingLines(job?.results?.tables);
  if (lines.length === 0) return null;
  return (
    <div className="text-muted flex flex-col gap-1 text-sm leading-relaxed">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
