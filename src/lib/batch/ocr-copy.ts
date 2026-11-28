/**
 * What OCR PDF's batch says (batch plan P5), beside the worker batch's own
 * words (`./worker-copy`). One definition for the batch and the tool page,
 * so the page cannot describe a batch the code does not run.
 *
 * Each sentence is true of `runner/batch/ocr-batch.tsx`:
 *
 *   - the recognition settings (languages, output, the three boxes) are the
 *     single-file panel's own, drawn above the list; pressing Run copies
 *     them into a ref that every file's job body is built from, so a change
 *     after Run reaches no file of that run;
 *   - each file is today's single OCR job, with one input, so each scan
 *     comes back as its own download, unless "Combine into one PDF" is
 *     ticked: then the browser makes every file, in the order listed, into
 *     one PDF, sent as one job (audit ocr-pdf#3, 2026-11-22; until then
 *     "photos are never combined");
 *   - "Straighten crooked pages" and "Turn pages upright" reach a JPG or
 *     PNG too: with either ticked, the photo is put on a PDF page in the
 *     browser and sent as a PDF (audit ocr-pdf#2, 2026-11-22; until then
 *     both were sent off for an image);
 *   - a finished row whose job reported low confidence says so
 *     (`ocrConfidenceLooksLow`, the single-file summary's own test).
 *
 * Read by the batch's own chunk and by the tool page's content on the
 * server; never by a first-load module.
 */
import { workerFileCeilingBytes } from "@/lib/workers/engine-file-ceilings";

/**
 * What one combined PDF can be at most: the per-file ceiling the server
 * enforces for an OCR job (`engine-file-ceilings`, a leaf, so the tool
 * registry stays out of this chunk). The batch's refusal and this page's
 * sentence both read it; ocr-combine.dom.test.tsx holds it equal to the
 * server's and that the batch defines no ceiling of its own.
 */
export const OCR_COMBINE_CEILING = workerFileCeilingBytes("ocr-pdf");

/** Said before Run, under the settings: one language choice for every file. */
export function ocrBatchLanguageSentence(languages: string): string {
  return `Every file in this batch is read as ${languages}. The wrong language does not fail: it gives plausible-looking gibberish in every file, so check the languages above before you run it.`;
}

/** A finished row whose job reported low recognition confidence. */
export const OCR_BATCH_LOW_CONFIDENCE_NOTE =
  "Recognition confidence was low: the scan may be blurry, skewed or low-resolution, or not in the language you selected.";

/** The combined PDF's ceiling, in MB: the per-file ceiling it must fit. */
const COMBINED_CEILING_MB = Math.round(OCR_COMBINE_CEILING / (1024 * 1024));

/** OCR PDF's page: what its batch shares, and what it never does. */
export function ocrBatchPageSentence(): string {
  return `In a batch, the languages, the output and the boxes you tick are set once, before you press the button under the list, and apply to every file. Each scan is its own job and comes back as its own download, unless you tick “Combine into one PDF”: then your browser puts every file, in the order listed, into one PDF, each photo a page and each PDF all its pages, and it is recognised as one job and comes back as one searchable PDF. Together the files can be at most ${COMBINED_CEILING_MB} MB; above that the button stays off, and the page asks you to remove some files or untick the box. Straighten crooked pages and Turn pages upright apply to every file in a batch, photos included.`;
}
