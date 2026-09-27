import type { PDFDocument } from "pdf-lib";
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

/** Thrown for problems reading or writing PDF bytes, with user-facing copy. */
export class PdfEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfEngineError";
  }
}

/** The file cannot be OPENED without a password. */
export class PdfPasswordRequiredError extends PdfEngineError {
  constructor() {
    super("This PDF is password-protected. Unlock it first, then try again.");
    this.name = "PdfPasswordRequiredError";
  }
}

/**
 * The file opens with no password but carries owner ("permissions")
 * encryption, which pdf-lib cannot remove — so a tool that rewrites the file
 * cannot take it. It is NOT "password-protected" to the person holding it: it
 * opened in their viewer without a prompt. Unlock PDF does remove it, but only
 * with the permissions password, which is why the copy says so rather than
 * sending everyone there.
 */
export class PdfRestrictedError extends PdfEngineError {
  constructor(
    message = "This PDF has editing restrictions set by its author. It opens without a password, but this tool can't change a restricted file. If you have its permissions password, remove the restrictions with Unlock PDF, then try again.",
  ) {
    super(message);
    this.name = "PdfRestrictedError";
  }
}

const PRODUCER = "pdf.xyz";

/**
 * Which encrypted file is this? pdf-lib refuses every /Encrypt the same way;
 * pdfjs can tell a file that opens without a password from one that cannot.
 * pdfjs is imported only here, on the refusal path, so no successful load pays
 * for it. A probe that cannot answer changes nothing: the password copy stays.
 */
async function encryptedPdfError(bytes: Uint8Array): Promise<PdfEngineError> {
  try {
    const { opensWithoutPassword } = await import("./pdfjs");
    if ((await opensWithoutPassword(bytes)) === true) {
      return new PdfRestrictedError();
    }
  } catch {
    // Fall through to the conservative answer.
  }
  return new PdfPasswordRequiredError();
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
    const message = err instanceof Error ? err.message : "";
    // By message: pdf-lib's EncryptedPDFError is compiled to ES5 and does not
    // survive `instanceof` (encryption.test.ts pins the message it throws).
    if (/encrypt/i.test(message)) {
      throw await encryptedPdfError(bytes);
    }
    throw new PdfEngineError(
      "This file couldn't be read as a PDF — it may be corrupted or not a PDF.",
    );
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
