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
 *     comes back as its own download — photos are never combined;
 *   - "Straighten crooked pages" and "Turn pages upright" are sent for a
 *     PDF only: a JPG or PNG goes to Tesseract, which has neither, and the
 *     single-file panel turns both boxes off for one;
 *   - a finished row whose job reported low confidence says so
 *     (`ocrConfidenceLooksLow`, the single-file summary's own test).
 *
 * Read by the batch's own chunk and by the tool page's content on the
 * server; never by a first-load module.
 */

/** Said before Run, under the settings: one language choice for every file. */
export function ocrBatchLanguageSentence(languages: string): string {
  return `Every file in this batch is read as ${languages}. The wrong language does not fail: it gives plausible-looking gibberish in every file, so check the languages above before you run it.`;
}

/** Said before Run when a box only a PDF can use is ticked. */
export const OCR_BATCH_PDF_ONLY_NOTE =
  "Straighten crooked pages and Turn pages upright are applied to the PDFs in the batch; a JPG or PNG is read without them, as it is on its own.";

/** A finished row whose job reported low recognition confidence. */
export const OCR_BATCH_LOW_CONFIDENCE_NOTE =
  "Recognition confidence was low: the scan may be blurry, skewed or low-resolution, or not in the language you selected.";

/** OCR PDF's page: what its batch shares, and what it never does. */
export function ocrBatchPageSentence(): string {
  return `In a batch, the languages, the output and the boxes you tick are set once, before you press the button under the list, and apply to every file. Each scan is its own job and comes back as its own download, so several photos are never combined into one PDF. Straighten crooked pages and Turn pages upright apply to the PDFs in a batch, not to a JPG or PNG.`;
}
