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
  // Batch plan P2: one grayscale PDF per file, at the raster cap.
  "grayscale-pdf": { zipName: "pdfxyz-grayscale.zip" },
} as const satisfies Record<string, { zipName: `pdfxyz-${string}.zip` }>;

export type SettingsBatchSlug = keyof typeof SETTINGS_BATCH_TOOLS;

/**
 * The tools whose batch makes MANY images of each file, through
 * `runner/batch/images-batch-runner.tsx` (batch plan P2): every page drawn
 * as an image, or every embedded image pulled out. In the ZIP each file's
 * images sit in a folder named after it (`IMAGE_BATCH_FOLDERS`).
 */
export const IMAGE_BATCH_TOOLS = {
  "pdf-to-jpg": { zipName: "pdfxyz-jpg.zip" },
  "pdf-to-png": { zipName: "pdfxyz-png.zip" },
  "extract-images": { zipName: "pdfxyz-images.zip" },
} as const satisfies Record<string, { zipName: `pdfxyz-${string}.zip` }>;

/**
 * Text to PDF's batch (batch plan P2): one PDF per text file, through
 * `runner/batch/text-to-pdf-batch.tsx`, from its own drop box.
 */
export const TEXT_BATCH_TOOLS = {
  "text-to-pdf": { zipName: "pdfxyz-text-pdfs.zip" },
} as const satisfies Record<string, { zipName: `pdfxyz-${string}.zip` }>;

/**
 * The batches that draw pages as images or pull images out, so one input
 * becomes many images held until the ZIP: they take
 * `BATCH_LIMITS.rasterMaxFiles` files, every other batch
 * `BATCH_LIMITS.clientMaxFiles`. Held to the batch modules by
 * `batch-claims.test.ts` (each raster batch caps at this number, and only
 * they do).
 */
export const RASTER_BATCH_TOOLS: readonly string[] = [
  "grayscale-pdf",
  ...Object.keys(IMAGE_BATCH_TOOLS),
];

/** How many files one batch of `slug` takes. */
export function batchMaxFilesFor(slug: string): number {
  return RASTER_BATCH_TOOLS.includes(slug)
    ? BATCH_LIMITS.rasterMaxFiles
    : BATCH_LIMITS.clientMaxFiles;
}

/**
 * Where an images batch puts each file's images in its ZIP. Said on the
 * batch and on the tool's page.
 */
export const IMAGE_BATCH_FOLDERS =
  "In a batch of two or more PDFs, each one's images sit in a folder of the ZIP named after it.";

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

/** Text to PDF's drop box opens the same way, for the files it takes. */
export const BATCH_TEXT_HINT_LEAD = "One or more TXT files";

const MB = 1024 * 1024;

/**
 * A batch's limits as a tool page states them, from `BATCH_LIMITS` itself:
 * "A batch takes up to 20 PDFs, 200 MB in all." — 10 for a raster batch
 * (`batchMaxFilesFor`), and "text files" for Text to PDF. With no slug, the
 * settings batches' sentence.
 */
export function batchLimitsSentence(slug?: string): string {
  const noun = slug && slug in TEXT_BATCH_TOOLS ? "text files" : "PDFs";
  const max = slug ? batchMaxFilesFor(slug) : BATCH_LIMITS.clientMaxFiles;
  return `A batch takes up to ${max} ${noun}, ${Math.round(
    BATCH_LIMITS.clientMaxTotalBytes / MB,
  )} MB in all.`;
}
