import { BATCH_LIMITS } from "./limits";

/**
 * The tools that run a batch through the shared settings batch
 * (`runner/batch/settings-batch-runner.tsx`, batch plan P1): one setting for
 * every file, each file in turn, in the browser. The registration the words
 * are read from — the archive's name, which the batch saves and the tool's
 * page quotes, and the drop box's opening words — so the page and the batch
 * cannot name two different files.
 *
 * Pure data. Read by the per-tool batch modules (reached through
 * `next/dynamic` once two or more files arrive) and by the tool pages'
 * content on the server; never by a first-load module. `batch-claims.test.ts`
 * holds every entry to a batch module its runner really loads, and every
 * batch module to an entry, in both directions.
 */
export const SETTINGS_BATCH_TOOLS = {
  "rotate-pdf": { zipName: "pdfxyz-rotated.zip" },
  "flatten-pdf": { zipName: "pdfxyz-flattened.zip" },
  "page-numbers": { zipName: "pdfxyz-numbered.zip" },
  "watermark-pdf": { zipName: "pdfxyz-watermarked.zip" },
  "split-pdf-pages-in-half": { zipName: "pdfxyz-halved.zip" },
} as const satisfies Record<string, { zipName: `pdfxyz-${string}.zip` }>;

export type SettingsBatchSlug = keyof typeof SETTINGS_BATCH_TOOLS;

/**
 * Add Page Numbers' batch numbers each file from its own first page (the
 * owner's ruling, 2026-11-08). Said on the batch and on the tool's page.
 */
export const PAGE_NUMBER_BATCH_RESTARTS =
  "Numbering restarts in each file, at First number.";

/**
 * Add Watermark's batch takes one page list for every file. A file it does
 * not fit is refused on its own row by the engine's own check, before any
 * page is stamped, never cut down to the pages that file has. Said on the
 * batch and on the tool's page.
 */
export const WATERMARK_BATCH_PAGES_NOTE =
  "A page list applies to every file; a file without one of those pages fails on its own row, unstamped.";

/**
 * How a batch tool's drop box opens: its caption is "One or more PDFs · …".
 * The runner's caption is first-load and types the words; the claims test
 * holds it to this.
 */
export const BATCH_HINT_LEAD = "One or more PDFs";

const MB = 1024 * 1024;

/**
 * The batch's limits as a tool page states them, from `BATCH_LIMITS` itself:
 * "A batch takes up to 20 PDFs, 200 MB in all."
 */
export function batchLimitsSentence(): string {
  return `A batch takes up to ${BATCH_LIMITS.clientMaxFiles} PDFs, ${Math.round(
    BATCH_LIMITS.clientMaxTotalBytes / MB,
  )} MB in all.`;
}
