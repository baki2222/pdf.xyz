/**
 * Compress PDF's batch on our secure server (audit compress-pdf#5,
 * 2026-11-08): the words the batch panel shows and the tool's copy quotes,
 * named once. Feature-scoped: only the batch runner and the tool's content
 * read it.
 */

/** The batch's server choice: the single-file panel's own button label. */
export const BATCH_DEEP_LABEL = "Compress images on our server";

/** The batch's in-browser choice, the default. */
export const BATCH_LOSSLESS_LABEL = "Lossless, in your browser";

/** The legend over the two choices. */
export const BATCH_MODE_HEADING = "Where to compress";
