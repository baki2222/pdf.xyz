import { loadPdf, PdfEngineError, stamp } from "./engine";
import { interleavePages } from "./merge-order";
import { assemblePages } from "./page-copy";
import { loadPdfLib } from "./pdf-lib";

/**
 * Merge PDF's "Alternate pages": one page from each file in turn — A1, B1,
 * A2, B2, … — with what is left of a longer file appended in its own order,
 * and a per-file Reverse for a double-sided scan (a fronts file, and a backs
 * file the scanner fed last sheet first).
 *
 * Kept out of `engine.ts` on purpose, like `split-modes.ts`: the engine
 * module is preloaded by every tool page, and this is only ever called by
 * the merge runner, whose chunk loads it.
 *
 * The pages are assembled ONCE, file by file, through `assemblePages` in its
 * "merge" state — so forms, bookmarks and links are carried exactly as a
 * plain merge carries them — and only then moved into the alternating order.
 * Moving a page moves its page object, not a copy, so every bookmark and
 * link that pointed at it still does (`merge-alternate.test.ts` reads one
 * back after the pages move). `page-copy.test.ts` finds this function by
 * scanning for merge-state assemblers.
 */

export interface AlternateMergeOptions {
  /**
   * Per file, the 0-based pages to take, as in a plain merge; `undefined`
   * takes every page. A selection picks pages in the file's own order.
   */
  pages?: readonly (readonly number[] | undefined)[];
  /** Per file: take its (selected) pages last first, before alternating. */
  reverse?: readonly boolean[];
}

export async function mergeAlternating(
  files: Uint8Array[],
  options: AlternateMergeOptions = {},
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  if (files.length === 0) {
    throw new PdfEngineError("Add at least one PDF to merge.");
  }
  const sources = [];
  for (const [i, bytes] of files.entries()) {
    const doc = await loadPdf(bytes);
    const count = doc.getPageCount();
    const chosen = options.pages?.[i];
    const indices = chosen
      ? [...new Set(chosen)]
          .filter((p) => Number.isInteger(p) && p >= 0 && p < count)
          .sort((a, b) => a - b)
      : doc.getPageIndices();
    if (indices.length === 0) {
      throw new PdfEngineError(
        `File ${i + 1} has no pages selected — choose at least one page or remove it.`,
      );
    }
    if (options.reverse?.[i]) indices.reverse();
    sources.push({ doc, indices });
  }

  const { out, pages } = await assemblePages(lib, sources, {
    documentState: "merge",
  });

  // `pages` is file after file; cut it back into one run per file, then
  // alternate the runs.
  const runs: (typeof pages)[] = [];
  let at = 0;
  for (const { indices } of sources) {
    runs.push(pages.slice(at, at + indices.length));
    at += indices.length;
  }
  const order = interleavePages(runs);
  for (let i = out.getPageCount() - 1; i >= 0; i -= 1) out.removePage(i);
  for (const page of order) out.addPage(page);

  stamp(out);
  return out.save();
}
