/**
 * Flatten PDF's "comments and markup" option (audit flatten-pdf#3), in the
 * words the single-file editor and the batch both use. Its own module so the
 * lazy batch does not import the editor to say the same thing.
 */
export const FLATTEN_MARKUP_LABEL = "Also flatten comments and markup";

export const FLATTEN_MARKUP_HINT =
  "Highlights, stamps, ink, typed comments and sticky notes become part of the page, so they can no longer be moved or deleted. A sticky note keeps its icon, not its text. Links stay clickable.";

/** "1 comment or markup annotation", "3 comments or markup annotations". */
export function markupCount(n: number): string {
  return n === 1
    ? "1 comment or markup annotation"
    : `${n} comments or markup annotations`;
}
