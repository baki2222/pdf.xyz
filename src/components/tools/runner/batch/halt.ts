/**
 * Said when the browser runs out of memory on a file: the files after it
 * would fail the same way, so the batch stops there and keeps every
 * finished row (`haltOn`). Shared by every browser batch: the settings
 * batch, the images batch, Text to PDF's.
 */
export const BATCH_OUT_OF_MEMORY =
  "This browser ran out of memory on that file, so the batch stopped there. The finished files are kept; close other tabs, or run the rest in a smaller batch.";

/** `useBatchRunner`'s `haltOn`: a `RangeError` is the browser out of memory. */
export function batchHalt(error: unknown): string | null {
  return error instanceof RangeError ? BATCH_OUT_OF_MEMORY : null;
}
