import type { PDFDocument, PDFObject } from "pdf-lib";
import { namedDestinations } from "./document-structure";
import { loadPdf, PdfEngineError, stamp } from "./engine";
import { assemblePages } from "./page-copy";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { buildSplitParts, rangeToIndices } from "./ranges";
import type { NamedBytes, PageRange } from "./types";

/**
 * Split PDF's modes beyond "one file per part": ranges merged into one file,
 * parts packed under a file size, and cuts at the top-level bookmarks.
 *
 * Kept out of `engine.ts` on purpose: the engine module is preloaded by every
 * tool page, and these are only ever called by the split runner, whose chunk
 * loads them. In the engine they cost every tool page ~0.8 KB gz, measured
 * 2026-10-24 with `pnpm weigh:pages` (ocr-pdf 255.8 -> 256.7).
 *
 * Every part is assembled through `assemblePages` in its "subset" state, so
 * it carries what `splitPdf` carries; `page-copy.test.ts` holds both to that,
 * and finds them by scanning `src/lib/pdf` for subset assemblers, not by name.
 */

/**
 * Split PDF's "merge selected ranges into one file": the pages of every
 * range, in the order the ranges were typed, as ONE document. A page named by
 * two ranges appears twice, as typed.
 */
export async function combineRanges(
  bytes: Uint8Array,
  ranges: readonly PageRange[],
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  const src = await loadPdf(bytes);
  const count = src.getPageCount();
  const indices = ranges
    .flatMap((range) => rangeToIndices(range))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < count);
  if (indices.length === 0) {
    throw new PdfEngineError("No valid pages were selected to split.");
  }
  const { out } = await assemblePages(lib, [{ doc: src, indices }], {
    documentState: "subset",
  });
  stamp(out);
  return out.save();
}

/** The outcome of a split by file size. */
export interface SizeSplitResult {
  /** Each part, as saved: these are the bytes that were measured. */
  files: (NamedBytes & { indices: number[] })[];
  /**
   * 0-based pages that are bigger than the target ON THEIR OWN. Each is
   * still written, as a one-page part over the target, and the caller must
   * say so: no split can make one page smaller.
   */
  oversized: number[];
}

/**
 * Split a PDF into consecutive parts of at most `maxBytes` each, packing as
 * many pages into each part as fit. A part's size is not estimated: every
 * candidate part is assembled and SAVED, and the bytes returned are the
 * bytes that were measured, so "each part is at most the target" holds by
 * construction (except for an oversized single page, reported). Fonts and
 * images shared between pages are copied into each part that uses them,
 * which is why a page-count estimate would be wrong.
 *
 * The search grows a part by doubling and then bisects, so a part costs
 * O(log pages) saves, not one per page. Bisection assumes a part does not
 * shrink when a page is added; where it does, a part may hold fewer pages
 * than would fit, never more bytes than the target.
 */
export async function splitPdfBySize(
  bytes: Uint8Array,
  maxBytes: number,
  base: string,
): Promise<SizeSplitResult> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new PdfEngineError(
      "Enter a maximum size per file greater than zero.",
    );
  }
  const lib = await loadPdfLib();
  const src = await loadPdf(bytes);
  const count = src.getPageCount();
  const save = async (start: number, end: number) => {
    const { out } = await assemblePages(
      lib,
      [{ doc: src, indices: rangeToIndices({ start, end }) }],
      { documentState: "subset" },
    );
    stamp(out);
    return out.save();
  };
  const packed: { range: PageRange; bytes: Uint8Array }[] = [];
  const oversized: number[] = [];
  let start = 0;
  while (start < count) {
    let okEnd = start;
    let okBytes = await save(start, start);
    if (okBytes.byteLength > maxBytes) {
      oversized.push(start);
      packed.push({ range: { start, end: start }, bytes: okBytes });
      start += 1;
      continue;
    }
    let badEnd: number | undefined;
    let gap = 1;
    while (badEnd === undefined && okEnd < count - 1) {
      const probe = Math.min(count - 1, okEnd + gap);
      const candidate = await save(start, probe);
      if (candidate.byteLength <= maxBytes) {
        okEnd = probe;
        okBytes = candidate;
        gap *= 2;
      } else badEnd = probe;
    }
    while (badEnd !== undefined && badEnd - okEnd > 1) {
      const mid = Math.floor((okEnd + badEnd) / 2);
      const candidate = await save(start, mid);
      if (candidate.byteLength <= maxBytes) {
        okEnd = mid;
        okBytes = candidate;
      } else badEnd = mid;
    }
    packed.push({ range: { start, end: okEnd }, bytes: okBytes });
    start = okEnd + 1;
  }
  const names = buildSplitParts(
    base,
    packed.map((p) => p.range),
  );
  return {
    files: packed.map((p, i) => ({
      name: names[i]!.name,
      indices: names[i]!.indices,
      bytes: p.bytes,
    })),
    oversized,
  };
}

/** A top-level bookmark of a document, and the 0-based page it opens. */
export interface TopLevelBookmark {
  title: string;
  pageIndex: number;
}

/** A guard on a hostile outline whose `/Next` chain never ends. */
const MAX_TOP_LEVEL = 100_000;

/**
 * The document's top-level bookmarks that open one of its pages, in outline
 * order (not page order: the caller decides what an out-of-order outline
 * means). A top-level bookmark to a URL, a viewer action or nowhere is
 * skipped, since it names no page to cut at. Destinations are resolved the
 * way the page assembler resolves them (`namedDestinations`), so a bookmark
 * through a named destination cuts where it opens.
 */
export function topLevelBookmarks(
  lib: PdfLibModule,
  src: PDFDocument,
): TopLevelBookmark[] {
  const { PDFDict, PDFName, PDFNumber, PDFRef, PDFString, PDFHexString } = lib;
  const root = src.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!root) return [];
  const context = src.context;
  const resolve = namedDestinations(lib, src);
  const pages = src.getPages().map((page) => page.ref);
  const pageIndex = new Map(pages.map((ref, i) => [ref, i]));
  const result: TopLevelBookmark[] = [];
  const seen = new Set<PDFObject>();
  const follow = (value: PDFObject | undefined) =>
    value === undefined ? undefined : context.lookup(value);
  let current = follow(root.get(PDFName.of("First")));
  let budget = MAX_TOP_LEVEL;
  while (current instanceof PDFDict && !seen.has(current) && budget-- > 0) {
    seen.add(current);
    const action = current.lookupMaybe(PDFName.of("A"), PDFDict);
    let target: PDFObject | undefined;
    if (current.has(PDFName.of("Dest"))) {
      target = current.get(PDFName.of("Dest"));
    } else if (action?.get(PDFName.of("S")) === PDFName.of("GoTo")) {
      target = action.get(PDFName.of("D"));
    }
    const dest = target === undefined ? undefined : resolve(target);
    const head = dest && dest.size() > 0 ? dest.get(0) : undefined;
    let index: number | undefined;
    if (head instanceof PDFRef) index = pageIndex.get(head);
    else {
      // pdfjs, and so many viewers, also take a 0-based page NUMBER here.
      const n = follow(head);
      if (n instanceof PDFNumber && pages[n.asNumber()]) index = n.asNumber();
    }
    if (index !== undefined) {
      const title = follow(current.get(PDFName.of("Title")));
      result.push({
        title:
          title instanceof PDFString || title instanceof PDFHexString
            ? title.decodeText()
            : "",
        pageIndex: index,
      });
    }
    current = follow(current.get(PDFName.of("Next")));
  }
  return result;
}

/**
 * The top-level bookmarks of a PDF that open one of its pages, in outline
 * order — Split PDF's "By bookmarks" mode cuts at their pages.
 */
export async function readTopLevelBookmarks(
  bytes: Uint8Array,
): Promise<TopLevelBookmark[]> {
  const lib = await loadPdfLib();
  return topLevelBookmarks(lib, await loadPdf(bytes));
}
