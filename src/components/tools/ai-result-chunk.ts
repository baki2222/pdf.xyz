/**
 * A string only the AI result views chunk carries (`./ai-result-views`): the
 * extraction table and its copy and spreadsheet actions, the conversation's
 * copy and Markdown download, and the capped long-text box. Every view in it
 * renders this as its root's `data-chunk`, which keeps it through
 * minification, so `src/deploy/lazy-chunks.test.ts` can find the chunk by
 * content and hold that no page loads it with the page. Alone in its module
 * so tests can import it without importing the views.
 */
export const AI_RESULT_CHUNK = "pdfxyz:lazy:ai-result";
