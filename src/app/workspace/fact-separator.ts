/**
 * Between two facts about a file — "2.1 MB · 12 pages · no text layer" — in
 * the staged-file list and in the suggestion rows alike.
 *
 * A no-break space BEFORE the dot and an ordinary one after it: a line that
 * wraps ends on the dot, and the next line never starts with one. Written as
 * an escape because the character is invisible in an editor and in a diff.
 */
export const FACT_SEP = "\u00a0\u00b7 ";
