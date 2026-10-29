import type { PDFDocument } from "pdf-lib";
import { probePdfEncryption, type EncryptionVerdict } from "./encryption";
import {
  PdfEncryptedError,
  PdfEngineError,
  UNREADABLE_PDF_MESSAGE,
} from "./engine-errors";
import type { assemblePages as AssemblePages } from "./page-copy";
import { normalizeAngle } from "./rotation";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import type {
  NamedBytes,
  OrganizePlanItem,
  Rotation,
  SplitPart,
} from "./types";

export * from "./engine-errors";
export { normalizeAngle } from "./rotation";

/**
 * Page copying (`./page-copy`, with the structure walk it carries) is ~10 KB
 * gz that only runs once a file is processed, while this module rides the
 * first load of every tool page whose runner imports an engine function. It
 * is imported at call time, like pdf-lib itself; every caller is already
 * async.
 */
const assemblePages: typeof AssemblePages = async (...args) =>
  (await import("./page-copy")).assemblePages(...args);

/**
 * The core client-side PDF engine. Every function takes and returns plain byte
 * arrays so it can run in the browser, in Node, and under Vitest without any
 * DOM. All heavy lifting is delegated to pdf-lib (pure JavaScript, no native
 * bindings), which keeps these operations fully in-browser and privacy-safe.
 */

const PRODUCER = "pdf.xyz";

/**
 * Translate a pdf-lib load failure into the typed, user-facing error. Every
 * pdf-lib loader in `src/lib/pdf` routes its failure through here, so an
 * encrypted file is classified ONCE, by the same probe, wherever it is opened.
 */
export async function pdfLoadError(
  err: unknown,
  bytes: Uint8Array,
  probe: (bytes: Uint8Array) => Promise<EncryptionVerdict | null> = (b) =>
    probePdfEncryption(b),
): Promise<PdfEngineError> {
  const message = err instanceof Error ? err.message : "";
  // pdf-lib's EncryptedPDFError is an ES5-compiled subclass of Error: its
  // `name` is "Error" and `instanceof` does not hold, so its message is the
  // only thing that identifies it.
  if (/encrypt/i.test(message)) {
    return new PdfEncryptedError(await probe(bytes));
  }
  return new PdfEngineError(UNREADABLE_PDF_MESSAGE, { kind: "unreadable" });
}

/**
 * Load PDF bytes into a pdf-lib document, translating pdf-lib's raw failures
 * into typed, user-facing errors. Exported so text-stamping helpers (page
 * numbers, watermark, header/footer) share one loader and one set of messages.
 */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  const { PDFDocument } = await loadPdfLib();
  try {
    return await PDFDocument.load(bytes);
  } catch (err) {
    throw await pdfLoadError(err, bytes);
  }
}

/** Internal alias kept so existing call sites read the same as before. */
async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return loadPdf(bytes);
}

/** Stamp our producer/creator so exported files identify their origin. */
export function stamp(doc: PDFDocument): void {
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
}

function toIndexList(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/** De-duplicate, drop out-of-range values, and sort ascending. */
function sanitizeIndices(indices: number[], count: number): number[] {
  const set = new Set<number>();
  for (const i of indices) {
    if (Number.isInteger(i) && i >= 0 && i < count) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

/** Read the total number of pages in a PDF. */
export async function getPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await load(bytes);
  return doc.getPageCount();
}

/** Read each page's current rotation, in document order. */
export async function getPageRotations(bytes: Uint8Array): Promise<Rotation[]> {
  const doc = await load(bytes);
  const { toDegrees } = await loadPdfLib();
  return doc
    .getPages()
    .map((page) => normalizeAngle(toDegrees(page.getRotation())));
}

/** What a merge does besides concatenating every page of every file. */
export interface MergeOptions {
  /**
   * Per file, the 0-based pages to take; `undefined` (or a missing entry)
   * takes every page. Pages always come out in the file's own order, once
   * each: a selection picks pages, it does not reorder them.
   */
  pages?: readonly (readonly number[] | undefined)[];
  /**
   * Per file, the title of a bookmark written for it, opening its first page
   * in the merged file with the file's own bookmarks beneath it. Omitted, no
   * bookmark is invented and each file's own bookmarks follow one another.
   */
  fileBookmarks?: readonly string[];
  /**
   * Per file, the name a contents page lists it under. Given, pages listing
   * every file with the page it starts on — each line a link to that page —
   * are put in front of the merged pages (`merge-contents.ts`).
   */
  contentsPage?: readonly string[];
  /**
   * Told how many contents pages were put in front, so the receipt's page
   * re-count expects them (they depend on the first page's height).
   */
  onContentsPages?: (pages: number) => void;
}

/** Concatenate several PDFs into one, in the order given. */
export async function mergePdfs(
  files: Uint8Array[],
  options: MergeOptions = {},
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  if (files.length === 0) {
    throw new PdfEngineError("Add at least one PDF to merge.");
  }
  if (options.fileBookmarks && options.fileBookmarks.length !== files.length) {
    throw new Error("one bookmark title per file");
  }
  const sources = [];
  for (const [i, bytes] of files.entries()) {
    const doc = await load(bytes);
    const chosen = options.pages?.[i];
    const indices = chosen
      ? sanitizeIndices([...chosen], doc.getPageCount())
      : doc.getPageIndices();
    if (indices.length === 0) {
      throw new PdfEngineError(
        `File ${i + 1} has no pages selected — choose at least one page or remove it.`,
      );
    }
    sources.push({ doc, indices });
  }
  if (options.contentsPage && options.contentsPage.length !== files.length) {
    throw new Error("one contents title per file");
  }
  const { out, pages } = await assemblePages(lib, sources, {
    documentState: "merge",
    ...(options.fileBookmarks ? { fileBookmarks: options.fileBookmarks } : {}),
  });
  if (options.contentsPage) {
    const titles = options.contentsPage;
    const { addContentsPages } = await import("./merge-contents");
    let at = 0;
    const entries = sources.map(({ indices }, i) => {
      const entry = { title: titles[i]!, page: pages[at]! };
      at += indices.length;
      return entry;
    });
    // Added before it is reported: `f?.(x)` does not evaluate `x` when `f`
    // is absent, which once skipped the contents page for every caller that
    // did not ask for the count.
    const added = await addContentsPages(lib, out, entries);
    options.onContentsPages?.(added);
  }
  stamp(out);
  return out.save();
}

/** Produce a new PDF containing only the given pages, in ascending order. */
export async function extractPages(
  bytes: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  const src = await load(bytes);
  const clean = sanitizeIndices(indices, src.getPageCount());
  if (clean.length === 0) {
    throw new PdfEngineError("Select at least one page to extract.");
  }
  const { out } = await assemblePages(lib, [{ doc: src, indices: clean }], {
    documentState: "subset",
  });
  stamp(out);
  return out.save();
}

/** Remove the given pages, keeping the rest in order. */
export async function deletePages(
  bytes: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  const src = await load(bytes);
  const count = src.getPageCount();
  const remove = new Set(sanitizeIndices(indices, count));
  if (remove.size === 0) {
    throw new PdfEngineError("Select at least one page to delete.");
  }
  const keep = toIndexList(count).filter((i) => !remove.has(i));
  if (keep.length === 0) {
    throw new PdfEngineError(
      "You can't delete every page — keep at least one.",
    );
  }
  const { out } = await assemblePages(lib, [{ doc: src, indices: keep }], {
    documentState: "subset",
  });
  stamp(out);
  return out.save();
}

/**
 * Rotate the given pages by a signed quarter-turn delta (e.g. 90 or -90),
 * relative to each page's current rotation.
 */
export async function rotatePages(
  bytes: Uint8Array,
  indices: number[],
  turn: number,
): Promise<Uint8Array> {
  const { degrees, toDegrees } = await loadPdfLib();
  const src = await load(bytes);
  const count = src.getPageCount();
  const target = new Set(sanitizeIndices(indices, count));
  if (target.size === 0) {
    throw new PdfEngineError("Select at least one page to rotate.");
  }
  const pages = src.getPages();
  for (const i of target) {
    const page = pages[i];
    if (!page) continue;
    const current = toDegrees(page.getRotation());
    page.setRotation(degrees(normalizeAngle(current + turn)));
  }
  stamp(src);
  return src.save();
}

/**
 * Set every page's ABSOLUTE rotation, in place — one angle per page, in
 * document order. This is the rotate tool's engine.
 *
 * In place is the whole point. The tool used to route through
 * {@link organizePages}, which builds a new document and copies page objects
 * into it, and a page object is all that survives: bookmarks, the AcroForm,
 * Title/Author, page labels, `/Lang` and the tag tree were deleted from every
 * file rotated, while the download looked right. Rotation touches one key per
 * page dictionary; nothing else in the file has any reason to change.
 * `rotate-runner.test.tsx` holds that property against the downloaded bytes.
 */
export async function setPageRotations(
  bytes: Uint8Array,
  rotations: readonly Rotation[],
): Promise<Uint8Array> {
  const { degrees } = await loadPdfLib();
  const doc = await load(bytes);
  const pages = doc.getPages();
  if (rotations.length !== pages.length) {
    throw new PdfEngineError(
      "The rotation plan doesn't match this PDF's pages — reload the file and try again.",
    );
  }
  pages.forEach((page, i) => {
    page.setRotation(degrees(normalizeAngle(rotations[i]!)));
  });
  stamp(doc);
  return doc.save();
}

/** Split a PDF into several documents, one per part. */
export async function splitPdf(
  bytes: Uint8Array,
  parts: SplitPart[],
): Promise<NamedBytes[]> {
  const lib = await loadPdfLib();
  if (parts.length === 0) {
    throw new PdfEngineError("Nothing to split — add at least one range.");
  }
  const src = await load(bytes);
  const count = src.getPageCount();
  const results: NamedBytes[] = [];
  for (const part of parts) {
    const clean = sanitizeIndices(part.indices, count);
    if (clean.length === 0) continue;
    // Each part is assembled from the same parsed source: the assembler never
    // mutates it, so part 2 cannot inherit part 1's pruning.
    const { out } = await assemblePages(lib, [{ doc: src, indices: clean }], {
      documentState: "subset",
    });
    stamp(out);
    results.push({ name: part.name, bytes: await out.save() });
  }
  if (results.length === 0) {
    throw new PdfEngineError("No valid pages were selected to split.");
  }
  return results;
}

/**
 * Give the source's pages from `start` on (the appended blanks) a page-label
 * range with no style and no prefix — an empty label — so the label carrier
 * starts a fresh range after each blank instead of numbering it into the run
 * before. A source without page labels is left without them.
 */
function unlabelFrom(lib: PdfLibModule, src: PDFDocument, start: number) {
  const { PDFArray, PDFDict, PDFName, PDFNumber } = lib;
  const tree = src.catalog.lookupMaybe(PDFName.of("PageLabels"), PDFDict);
  if (!tree) return;
  let nums = tree.lookupMaybe(PDFName.of("Nums"), PDFArray);
  if (!nums) {
    nums = src.context.obj([]);
    tree.set(PDFName.of("Nums"), nums);
  }
  nums.push(PDFNumber.of(start));
  nums.push(src.context.obj({}));
}

/**
 * Rebuild a PDF from an ordered plan. Supports reordering, deleting (omit an
 * item), duplicating (repeat a sourceIndex), and per-page absolute rotation.
 * A plan that keeps every page once, in order, is applied in place; any other
 * goes through the page assembler, which carries a subset's document state
 * (`document-structure.ts`) but not attachments, XMP or the tag tree.
 *
 * A `blank` item becomes a new empty page. It is appended to the parsed
 * SOURCE (never the caller's bytes) and then planned like any other page, so
 * the assembler places it with no path of its own; it is given an unlabelled
 * page-label range there, so the pages after it keep the labels they had
 * (organize-blank.test.ts reads them back through pdf.js).
 */
export async function organizePages(
  bytes: Uint8Array,
  plan: OrganizePlanItem[],
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  const src = await load(bytes);
  const count = src.getPageCount();
  const fromSource = plan.filter(
    (item) =>
      !item.blank &&
      Number.isInteger(item.sourceIndex) &&
      item.sourceIndex >= 0 &&
      item.sourceIndex < count,
  );
  if (fromSource.length === 0) {
    throw new PdfEngineError("Keep at least one page.");
  }
  const valid = plan.flatMap((item): OrganizePlanItem[] => {
    if (!item.blank) return fromSource.includes(item) ? [item] : [];
    const width = Math.max(1, Math.min(14400, item.blank.width || 0));
    const height = Math.max(1, Math.min(14400, item.blank.height || 0));
    src.addPage([width, height]);
    return [{ sourceIndex: src.getPageCount() - 1, rotation: item.rotation }];
  });
  if (valid.length > fromSource.length) unlabelFrom(lib, src, count);
  // Every page, once, in its own order — what Rotate PDF always sends, and
  // Organize when only rotations changed. Nothing leaves the document, so
  // nothing can leak from it, and it is rotated in place: the assembler below
  // rebuilds only what a SUBSET needs, and dropped the attachments, XMP
  // stream, tag tree and custom /Info keys of a file the user only rotated
  // (measured at 8e270e8; page-copy.test.ts "removes no page").
  const removesNothing =
    valid.length === count && valid.every((item, i) => item.sourceIndex === i);
  if (removesNothing) {
    src.getPages().forEach((page, i) => {
      page.setRotation(lib.degrees(normalizeAngle(valid[i]!.rotation)));
    });
    stamp(src);
    return src.save();
  }
  const { out, pages } = await assemblePages(
    lib,
    [{ doc: src, indices: valid.map((item) => item.sourceIndex) }],
    { documentState: "subset" },
  );
  pages.forEach((page, i) => {
    page.setRotation(lib.degrees(normalizeAngle(valid[i]!.rotation)));
  });
  stamp(out);
  return out.save();
}
