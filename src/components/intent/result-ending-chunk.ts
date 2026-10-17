/**
 * A string only the result's ending chunk carries — the receipt and
 * "Continue with" (`./result-ending`), fetched when a run starts (Compress
 * PDF's when its file arrives) and shown when it finishes. The ending
 * renders it as its root's `data-chunk`, which keeps it through
 * minification, so `lazy-chunks.test.ts` can find the chunk by content and
 * hold that no page loads it with the page — and
 * `e2e/continue-chain.spec.ts` can hold it back by content. Alone in its
 * module so those tests can import it without importing the ending.
 */
export const RESULT_ENDING_CHUNK = "pdfxyz:lazy:result-ending";
