/**
 * The page the in-browser "to PDF" engines lay content out on, as a LEAF (no
 * imports), so the engines that draw the page and the copy that describes it
 * read one value.
 *
 * Image to PDF, Text to PDF and Markdown to PDF each declared a private
 * `PAGE_WIDTH = 612` / `PAGE_HEIGHT = 792` / `MARGIN`, and the JPG to PDF
 * catalogue entry and guide promised "control over orientation, margins, and
 * page size" — over an engine with none. A page that states its geometry has
 * to state THIS one, or the statement is a third independent number.
 */

/** PDF user space: 72 points to the inch. */
export const PT_PER_INCH = 72;

/** US Letter, portrait, in points. Every in-browser "to PDF" engine uses it. */
export const US_LETTER_PT = { width: 612, height: 792 } as const;

/** White space around each image on an Image to PDF page. */
export const IMAGE_PAGE_MARGIN_PT = 36;

/** White space around the text block on a Text or Markdown to PDF page. */
export const TEXT_PAGE_MARGIN_PT = 54;

/** Points as inches, printed without a trailing ".0" (8.5, 11, 0.75). */
export function inches(points: number): string {
  return String(Math.round((points / PT_PER_INCH) * 100) / 100);
}

/** "US Letter (8.5 × 11 in)" — the page size, as a reader would name it. */
export const US_LETTER_LABEL = `US Letter (${inches(US_LETTER_PT.width)} × ${inches(US_LETTER_PT.height)} in)`;
