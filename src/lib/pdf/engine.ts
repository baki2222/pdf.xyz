import type { PDFDocument } from "pdf-lib";
import {
  encryptedPdfMessage,
  probePdfEncryption,
  type EncryptionVerdict,
} from "./encryption";
import { assemblePages } from "./page-copy";
import { loadPdfLib } from "./pdf-lib";
import type {
  NamedBytes,
  OrganizePlanItem,
  Rotation,
  SplitPart,
} from "./types";

/**
 * The core client-side PDF engine. Every function takes and returns plain byte
 * arrays so it can run in the browser, in Node, and under Vitest without any
 * DOM. All heavy lifting is delegated to pdf-lib (pure JavaScript, no native
 * bindings), which keeps these operations fully in-browser and privacy-safe.
 */

/**
 * Why the loader refused a file, for callers that must tell the reasons apart.
 * `encrypted` means the file has an /Encrypt dictionary — which is NOT the same
 * as "needs a password": most encrypted PDFs open with no password at all and
 * only restrict editing. A caller that needs to know which asks a reader
 * (`classifyPdfAccess` in `./encryption`); the message alone cannot say.
 */
export type PdfEngineErrorKind = "encrypted" | "unreadable";

/**
 * What a {@link PdfEngineError} may carry beside its message: the standard
 * `cause` (so a wrapped failure keeps its diagnostic) and the refusal `kind`.
 */
export interface PdfEngineErrorOptions extends ErrorOptions {
  readonly kind?: PdfEngineErrorKind;
}

/** Thrown for problems reading or writing PDF bytes, with user-facing copy. */
export class PdfEngineError extends Error {
  readonly kind: PdfEngineErrorKind | undefined;
  constructor(message: string, options?: PdfEngineErrorOptions) {
    super(message, options);
    this.name = "PdfEngineError";
    this.kind = options?.kind;
  }
}

/**
 * pdf-lib refused the file because it is encrypted. `verdict` says whether it
 * needs a password to OPEN (`needs-password`), only carries its author's
 * editing restrictions (`opens-without-password`), or could not be told
 * (`null`) — and the message is the one true of that verdict. See
 * `./encryption` for why the difference is the whole point.
 */
export class PdfEncryptedError extends PdfEngineError {
  readonly verdict: EncryptionVerdict | null;
  constructor(verdict: EncryptionVerdict | null, message?: string) {
    super(message ?? encryptedPdfMessage(verdict), { kind: "encrypted" });
    this.name = "PdfEncryptedError";
    this.verdict = verdict;
  }
}

/**
 * The loader's copy for bytes that are not a readable PDF. Exported so a caller
 * that finds the damage AFTER a successful load (a trailer with no catalog loads
 * fine and throws on the first page walk) reports it in the same words.
 */
export const UNREADABLE_PDF_MESSAGE =
  "This file couldn't be read as a PDF — it may be corrupted or not a PDF.";

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

/** pdf.js's names for "this is not a readable PDF". */
const PDFJS_UNREADABLE = new Set([
  "InvalidPDFException",
  "MissingPDFException",
  "FormatError",
]);

/**
 * The same translation for a pdf.js load failure (text extraction, layout).
 * pdf.js already knows whether a password is needed, so no probe runs. A
 * failure that is NOT about the file — a worker that failed to start, a chunk
 * that did not load — is returned unchanged: calling it "not a PDF" would send
 * the user to fix a file that is fine.
 */
export function pdfjsLoadError(err: unknown): unknown {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "PasswordException")
    return new PdfEncryptedError("needs-password");
  if (typeof name === "string" && PDFJS_UNREADABLE.has(name)) {
    return new PdfEngineError(UNREADABLE_PDF_MESSAGE, { kind: "unreadable" });
  }
  return err;
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
function stamp(doc: PDFDocument): void {
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

/** Snap any angle to the nearest valid PDF rotation (0 | 90 | 180 | 270). */
export function normalizeAngle(angle: number): Rotation {
  const snapped = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return snapped as Rotation;
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

/** Concatenate several PDFs into one, in the order given. */
export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  if (files.length === 0) {
    throw new PdfEngineError("Add at least one PDF to merge.");
  }
  const sources = [];
  for (const bytes of files) {
    const doc = await load(bytes);
    sources.push({ doc, indices: doc.getPageIndices() });
  }
  const { out } = await assemblePages(lib, sources, {
    documentState: "merge",
  });
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
 * Rebuild a PDF from an ordered plan. Supports reordering, deleting (omit an
 * item), duplicating (repeat a sourceIndex), and per-page absolute rotation.
 * A plan that keeps every page once, in order, is applied in place; any other
 * goes through the page assembler, which carries a subset's document state
 * (`document-structure.ts`) but not attachments, XMP or the tag tree.
 */
export async function organizePages(
  bytes: Uint8Array,
  plan: OrganizePlanItem[],
): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  const src = await load(bytes);
  const count = src.getPageCount();
  const valid = plan.filter(
    (item) =>
      Number.isInteger(item.sourceIndex) &&
      item.sourceIndex >= 0 &&
      item.sourceIndex < count,
  );
  if (valid.length === 0) {
    throw new PdfEngineError("Keep at least one page.");
  }
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
