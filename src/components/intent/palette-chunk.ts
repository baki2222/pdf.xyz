/**
 * A string only the command palette's chunk carries. The palette renders it
 * as its dialog's `data-chunk` (`./command-palette`), which keeps it through
 * minification, so `lazy-chunks.test.ts` can find the chunk by content and
 * hold that no page loads it with the page — the header's trigger, which
 * every page loads, fetches it on approach or when it is opened. Alone in
 * its module so that test can import it without importing the palette.
 */
export const PALETTE_CHUNK_MARKER = "pdfxyz:lazy:command-palette";
