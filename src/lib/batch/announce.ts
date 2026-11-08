/**
 * When the batch's live region speaks (the batch-processing plan, UX
 * "Accessibility"): a screen reader hears every file settle in a batch of up
 * to `ANNOUNCE_EVERY_FILE_UP_TO` files. Past that, one sentence per file is a
 * stream nobody can follow, so it speaks every `ANNOUNCE_STRIDE`th settle and
 * every failure — the one outcome a listener must not miss. The batch's own
 * end is always spoken, by the view, whatever this says.
 */
export const ANNOUNCE_EVERY_FILE_UP_TO = 10;
export const ANNOUNCE_STRIDE = 5;

/**
 * Whether the `settled`th file to settle (1-based) of `total` is announced.
 */
export function announcesSettle(
  settled: number,
  total: number,
  failed: boolean,
): boolean {
  if (settled < 1 || settled > total) return false;
  if (total <= ANNOUNCE_EVERY_FILE_UP_TO) return true;
  return failed || settled % ANNOUNCE_STRIDE === 0;
}
