/**
 * A string only the ticket dialog's chunk carries. The dialog renders it as
 * its root's `data-chunk` (`./ticket-dialog`), which keeps it through
 * minification, so `lazy-chunks.test.ts` can find the chunk by content and
 * hold that no page loads it with the page — the drop layer, which every
 * page loads, fetches it only when a file needs it. Alone in its module so
 * that test can import it without importing the dialog.
 *
 * Not the ticket's marker with "-dialog" after it: that would CONTAIN the
 * ticket's, and `lazy-chunks.test.ts` finds a marker's module and chunk by
 * substring — the source scan found two modules defining the ticket's.
 */
export const TICKET_DIALOG_CHUNK_MARKER = "pdfxyz:lazy:drop-dialog";
