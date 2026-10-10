/**
 * A string only the result's ending chunk carries — the receipt and
 * "Continue with" (`./result-ending`), fetched when a run starts and shown
 * when it finishes. The ending renders it as its root's `data-chunk`, which
 * keeps it through minification, so `lazy-chunks.test.ts` can find the
 * chunk by content and hold that no page loads it with the page. Alone in
 * its module so that test can import it without importing the ending.
 */
export const RESULT_ENDING_CHUNK = "pdfxyz:lazy:result-ending";
