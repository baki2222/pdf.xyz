/**
 * Summarize PDF's outline reader, in a module of its own reached only
 * through `import()` from `./summary-sections` (itself lazy).
 */

import { awaitPdfjsDocument, loadPdfjs } from "./pdfjs";
import type { PdfTextReader } from "./text";
import { PDFJS_DOCUMENT_DEFAULTS } from "./wasm-assets";

/** A top-level outline item that opens a page: its title and 0-based page. */
export interface OutlineStart {
  title: string;
  pageIndex: number;
}

/** A guard on a hostile outline: pdf.js walks it, this bounds what we keep. */
const MAX_OUTLINE_ITEMS = 100_000;

/**
 * The page count and the TOP-LEVEL outline items that open a page, in
 * outline order, read with pdf.js as a viewer resolves a click
 * (`getDestination` for a name, `getPageIndex` for a page reference, or a
 * 0-based page number as the head). A URL or action item, or one whose
 * target resolves nowhere, is skipped. For Summarize PDF's "Part to
 * summarize" sections (`./summary-sections`).
 *
 * ON PDF.JS, NOT PDF-LIB: a lazy module importing the first-load pdf-lib
 * engine (Split's `readTopLevelBookmarks`) made webpack re-split every
 * runner's chunks, +278 B gz on each of ~40 pdf-engine tool pages; placed
 * in `./text` instead it cost the four pages that import `./text`
 * statically +272 B each (both measured 2026-11-16 on the merged build).
 * In a module of its own, reached only through `import()`, it costs no
 * page's first load.
 *
 * Lookups run one at a time: two concurrent `getPageIndex` calls for the
 * same page reference were seen never to settle under pdf.js.
 */
export async function readPdfOutline(
  bytes: Uint8Array,
  loadReader: PdfTextReader = loadPdfjs,
): Promise<{ pageCount: number; starts: OutlineStart[] }> {
  const guard = await import("./pdfjs-guard");
  await guard.preflightPdfjsOpen(bytes);
  const pdfjs = await loadReader();
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
  });
  const doc = await awaitPdfjsDocument(loadingTask);
  try {
    const pageCount = guard.pdfjsPageCount(doc.numPages);
    const items = ((await doc.getOutline()) ?? []) as {
      title?: unknown;
      dest?: unknown;
    }[];
    const starts: OutlineStart[] = [];
    for (const item of items.slice(0, MAX_OUTLINE_ITEMS)) {
      const pageIndex = await outlinePageIndex(doc, item.dest, pageCount);
      if (pageIndex === null) continue;
      starts.push({
        title: typeof item.title === "string" ? item.title : "",
        pageIndex,
      });
    }
    return { pageCount, starts };
  } finally {
    try {
      doc.cleanup();
    } catch {
      // best effort
    }
    await loadingTask.destroy().catch(() => {});
  }
}

/** Where an outline item's destination opens, 0-based, or null. */
async function outlinePageIndex(
  doc: {
    getDestination(name: string): Promise<unknown>;
    getPageIndex(ref: never): Promise<number>;
  },
  dest: unknown,
  pageCount: number,
): Promise<number | null> {
  try {
    const explicit =
      typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const head: unknown = explicit[0];
    const index =
      typeof head === "number"
        ? head
        : head && typeof head === "object"
          ? await doc.getPageIndex(head as never)
          : null;
    return index !== null &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < pageCount
      ? index
      : null;
  } catch {
    return null;
  }
}
