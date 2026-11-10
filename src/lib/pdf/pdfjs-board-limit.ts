/**
 * The page limit of the upload board every reader:'pdfjs' tool reads (PDF
 * Viewer, PDF to JPG/PNG, PDF to Text, PDF to Markdown), on its own so the
 * tool pages' copy can state it without loading the pdf.js guard
 * (`./pdfjs-guard`, which enforces it and says why the figure is what it
 * is: see PDFJS_BOARD_MAX_PAGES there, which is this constant).
 */
export const PDFJS_BOARD_MAX_PAGES = 10_000;

/**
 * The tool pages' sentence for the limit. "Opened on its own": the batch
 * lists of PDF to JPG/PNG never read the board. Split PDF reads a flat
 * 10,001-page file in 1.4 s (measured, 2026-11-10), and the refusal's alert
 * links it (`ErrorNote`). `board-page-limit-claims.test.ts` holds every
 * reader:'pdfjs' tool's page to saying it.
 */
export const BOARD_PAGE_LIMIT_SENTENCE = `A PDF opened on its own may have up to ${PDFJS_BOARD_MAX_PAGES.toLocaleString("en-US")} pages; a longer one is refused before any page is read, with a link to Split PDF to save it in parts.`;
