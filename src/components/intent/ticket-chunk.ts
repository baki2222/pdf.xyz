/**
 * A string only the ticket's chunk carries. The view renders it as its root's
 * `data-chunk` (`./ticket-view`), which keeps it through minification, so
 * `lazy-chunks.test.ts` can find the chunk by content and hold that no page
 * loads it with the page. Alone in its module so that test can import it
 * without importing the view.
 */
export const TICKET_CHUNK_MARKER = "pdfxyz:lazy:ticket";
