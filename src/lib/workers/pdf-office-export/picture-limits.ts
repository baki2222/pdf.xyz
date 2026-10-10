/**
 * The sizes PDF to PowerPoint writes pictures at — in a module with no
 * imports, so the tool's page can state them from the constant that owns
 * them (`@/lib/tools/content/pdf-to-powerpoint`) without pulling the page
 * reader into the browser. `./page-scan` re-exports both and is the only
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
