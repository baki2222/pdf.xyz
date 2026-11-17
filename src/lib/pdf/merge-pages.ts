import type { PDFDocument, PDFPage } from "pdf-lib";
import { PdfEngineError } from "./engine-errors";
import type { PdfLibModule } from "./pdf-lib";
import { normalizeAngle } from "./rotation";

/**
 * Merge PDF's "Arrange pages" (audit backlog #9, 2026-11-17): the merged
 * pages in any order, mixing files, each with an optional rotation.
 *
 * Kept out of `engine.ts` on purpose, like `merge-alternate.ts`: the engine
 * module rides the first load of every tool page, and `mergePdfs` imports
 * this only when it is given an `order`.
 *
 * `mergePdfs` assembles the pages ONCE, file by file, through `assemblePages`
 * in its "merge" state (so forms, bookmarks and links are carried exactly as
 * a plain merge carries them), with each file's pages in the order they
 * appear in `order`. When the files stay grouped that IS the final order, so
 * the blank pads, the contents page and the bookmark for each file need no
 * change. When they interleave, {@link applyPageOrder} moves the page
 * OBJECTS into place (the merge-alternate.ts pattern), so every bookmark and
 * link that pointed at a page still does; the options that need one first
 * page per file are refused instead.
 */

/** One merged page: its file (0-based, into `files`), its page, its turn. */
export interface MergePageRef {
  readonly file: number;
  /** 0-based page in its file. */
  readonly page: number;
  /**
   * The ABSOLUTE rotation the page shows in the merged file, in degrees (a
   * multiple of 90). Omitted, the page keeps the rotation it has.
   */
  readonly rotation?: number;
}

/** What an order resolves to, before any page is copied. */
export interface PageOrderPlan {
  /** Per file, its pages in the order they appear in the merged file. */
  readonly indices: number[][];
  /** True when some file's pages are not one unbroken run. */
  readonly interleaved: boolean;
}

/** The MergeOptions an order is checked against (engine.ts owns the type). */
export interface PageOrderChecks {
  readonly pages?: unknown;
  readonly fileBookmarks?: unknown;
  readonly contentsPage?: unknown;
  readonly blankAfterOdd?: boolean;
}

/**
 * Check `order` against the files' page counts and the other options, and
 * split it into each file's pages. Every file must give at least one page,
 * no page may be given twice, and files must be listed in the order their
 * first pages appear (so bookmark, contents and download-name order, which
 * follow `files`, follow the merged pages too).
 */
export function planPageOrder(
  order: readonly MergePageRef[],
  counts: readonly number[],
  checks: PageOrderChecks = {},
): PageOrderPlan {
  if (checks.pages !== undefined) {
    throw new Error("give either pages or order, not both");
  }
  const indices: number[][] = counts.map(() => []);
  const firsts: number[] = [];
  const left = new Set<number>();
  let previous = -1;
  let interleaved = false;
  for (const { file, page } of order) {
    const count = counts[file];
    if (!Number.isInteger(file) || count === undefined || file < 0) {
      throw new Error(`order names file ${file}, which is not given`);
    }
    if (!Number.isInteger(page) || page < 0 || page >= count) {
      throw new Error(`order names page ${page} of file ${file}, out of range`);
    }
    const taken = indices[file]!;
    if (taken.includes(page)) {
      throw new Error(`order gives page ${page} of file ${file} twice`);
    }
    if (taken.length === 0) firsts.push(file);
    if (file !== previous) {
      if (left.has(file)) interleaved = true;
      if (previous >= 0) left.add(previous);
      previous = file;
    }
    taken.push(page);
  }
  indices.forEach((taken, i) => {
    if (taken.length === 0) {
      throw new PdfEngineError(
        `File ${i + 1} has no pages selected — choose at least one page or remove it.`,
      );
    }
  });
  if (firsts.some((file, i) => file !== i)) {
    throw new Error(
      "files must be given in the order their first pages appear in order",
    );
  }
  if (
    interleaved &&
    (checks.fileBookmarks !== undefined ||
      checks.contentsPage !== undefined ||
      checks.blankAfterOdd === true)
  ) {
    throw new Error(
      "a bookmark for each file, a contents page and blank pages after odd files need each file's pages to be together",
    );
  }
  return { indices, interleaved };
}

/**
 * Turn and place the assembled pages. `pages` is what `assemblePages`
 * returned for `plan.indices`: file after file, each in its plan order.
 * Rotations are set FIRST, before anything reads them (the file-name stamp
 * reads each page's rotation, and must run after this).
 */
export function applyPageOrder(
  lib: PdfLibModule,
  out: PDFDocument,
  pages: readonly PDFPage[],
  plan: PageOrderPlan,
  order: readonly MergePageRef[],
): void {
  const at = new Map<string, PDFPage>();
  let next = 0;
  plan.indices.forEach((taken, file) => {
    for (const page of taken) at.set(`${file}:${page}`, pages[next++]!);
  });
  const placed = order.map((ref) => {
    const page = at.get(`${ref.file}:${ref.page}`);
    if (!page) throw new Error(`page ${ref.page} of file ${ref.file} missing`);
    if (ref.rotation !== undefined) {
      page.setRotation(lib.degrees(normalizeAngle(ref.rotation)));
    }
    return page;
  });
  if (!plan.interleaved) return;
  for (let i = out.getPageCount() - 1; i >= 0; i -= 1) out.removePage(i);
  for (const page of placed) out.addPage(page);
}
