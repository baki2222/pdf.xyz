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

/**
 * What a batch row says after the lock note when the file only restricts
 * changes. The batch refuses such a file in BOTH modes before anything of it
 * is uploaded (review of cb0eb82e): our server writes a copy without the
 * owner's restrictions, and only the single-file panel warns about that first.
 */
export const BATCH_RESTRICTED_NOTE =
  "Compress it on its own to use our secure server.";
