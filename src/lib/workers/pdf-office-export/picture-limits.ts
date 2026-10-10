/**
 * The limits PDF to PowerPoint applies to pictures — in a module with no
 * imports, so the tool's page can state them from the constant that owns
 * them (`@/lib/tools/content/pdf-to-powerpoint`, `@/lib/tools/tool-facts`)
 * without pulling the page reader into the browser. `./page-scan` (and
 * `./pdfjs-node`, for the pixel ceiling) re-export them and are the only
 * code that applies them.
 */

/**
 * Longest side, in pixels, of a colour or grey picture written to the deck.
 * A plain JPEG at most this size is copied byte for byte; anything larger is
 * scaled down to it.
 */
export const MAX_PICTURE_SIDE = 2400;

/** Bilevel scans stay crisp and small as 1-bit PNGs, so they get more room. */
export const MAX_BILEVEL_PICTURE_SIDE = 3600;

/**
 * Render passes (layers) one page may take. Every layer is a full pass over
 * the page's operators, so a page alternating text and drawing — a grid of
 * cells, each text then its border — cost cells × operators: 1,440 cells was
 * 17 s on one page. Past this the page is drawn ONCE, as one picture, with
 * its text in invisible boxes over it. Moved here from `./page-scan` on
 * 2026-10-11 so the page can say where that happens (a 33-cell such table).
 */
export const MAX_LAYERS_PER_PAGE = 32;

/**
 * pdf.js's pixel ceiling for one decoded image (width × height) when the
 * reader knows nothing better. pdf.js REMOVES a larger image from the page
 * without a word (`buildPaintImageXObject`: "Image exceeded maximum allowed
 * size and was removed", a warning at most). The page scan sets the ceiling
 * per page from a byte budget over what each page is SEEN to decode
 * (`decodeBudgetPlan` in `./page-scan`), and counts what that leaves out; a
 * page whose content cannot be read (an encrypted or damaged file) never
 * gets a ceiling below this one, and a picture over it can then go
 * uncounted. Moved here from `./pdfjs-node` on 2026-10-11 so the page can
 * state that size.
 */
export const MAX_DECODED_IMAGE_PIXELS = 64_000_000;
