/**
 * Every page LABEL a reader meets in a translation: the PDF's body headings
 * (`./typeset`), the ZIP's interrupted-gap notice (`./assembly`) and its
 * withheld-pages marker (`./chunking`). One author, derived from the pages
 * the person CHOSE (competitor audit #29, slice 6, D8).
 *
 * WHY. The three writers used to compress a page list to `first–last`. That
 * was honest only because a chunk or a gap held consecutive TEXT pages of the
 * whole document, so a page inside `first..last` that was not listed was a
 * blank page. Under a selection that stops being true: chosen pages 2 and 4
 * form one chunk, and "Pages 2–4" would claim page 3, which the person did not
 * choose and which may hold text. So a label is now the chosen spans clipped
 * to the part's first and last page: "Pages 2, 4".
 *
 * BYTE-IDENTICAL FOR A WHOLE-DOCUMENT JOB, by construction: with no selection
 * the clip is `[[first, last]]`, and `formatSpans` writes `first–last` with the
 * same en dash the three old writers wrote. `page-labels.test.ts` holds a
 * frozen copy of each old writer against this for page lists without a
 * selection, and the ZIP's characterisation SHAs are the end-to-end check.
 *
 * The heading style ("Page 4", "Pages 2, 4") deliberately differs from
 * `pagesPhrase`'s sentence style ("pages 2 and 4"): a heading is a list, a
 * sentence has an "and". This module is the one author of the heading style,
 * which is why `src/lib/pdf/page-spans.guard.test.ts` exempts it by name.
 *
 * Imports only the page-spans leaf.
 */
import { formatSpans, pagesIn, type PageSpan } from "@/lib/pdf/page-spans";

/**
 * The spans a label names: the chosen spans clipped to `[pages[0],
 * pages.at(-1)]`, or `[[first, last]]` when nothing was chosen (a
 * whole-document job). Empty for an empty page list.
 *
 * A chosen page inside the clip that is not in `pages` is a chosen page with
 * no text (a blank page the person chose), exactly today's whole-document
 * reasoning for a blank page inside a range.
 */
export function labelSpans(
  pages: readonly number[],
  chosen: readonly PageSpan[] | null,
): PageSpan[] {
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) return [];
  if (chosen === null) return [[first, last]];
  const clip: PageSpan[] = [];
  for (const [a, b] of chosen) {
    const from = Math.max(a, first);
    const to = Math.min(b, last);
    if (from <= to) clip.push([from, to]);
  }
  return clip;
}

/** "Page 5", "Pages 4–9" or "Pages 2, 4": a part's label, from its own pages. */
export function pagesLabel(
  pages: readonly number[],
  chosen: readonly PageSpan[] | null,
): string {
  const clip = labelSpans(pages, chosen);
  const one = pagesIn(clip) === 1;
  return one ? `Page ${clip[0]![0]}` : `Pages ${formatSpans(clip)}`;
}
