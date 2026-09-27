import type {
  PDFDict as PDFDictType,
  PDFDocument,
  PDFObject,
  PDFPage,
} from "pdf-lib";
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

const PRODUCER = "pdf.xyz";

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
    if (/encrypt/i.test(message)) {
      throw new PdfEngineError(
        "This PDF is password-protected. Unlock it first, then try again.",
      );
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

/**
 * Copy the chosen pages of `src` into `out` WITHOUT the pages the reader left
 * behind riding along inside the file — and with links between kept pages
 * pointing at the pages the reader can actually see.
 *
 * pdf-lib's `copyPages` deep-copies everything a page references, and a link
 * that jumps to another page references THAT PAGE. Two defects followed, both
 * invisible in the page tree, which is why nothing saw them:
 *
 *  - a kept page linking to a LEFT-OUT page copied the left-out page's object,
 *    text and images included, into the output — transitively, through that
 *    page's own links. Measured 2026-09-27 by the content writers on
 *    `extractPages`: pages 1–2 of a five-page file whose page 1 linked to 3
 *    and 3 linked to 5 gave a file holding page objects 1, 2, 3 and 5. For
 *    Delete Pages that is the tool failing at the one thing it is for.
 *  - a link to a KEPT page did not reach it either: the copier copies each
 *    page as a fresh node, so the link's reference produced a SECOND, orphan
 *    copy of the kept page and the link opened that. Same for an
 *    annotation's `/P`, which every form widget carries.
 *
 * So for the duration of the copy, every reference to a page is detached from
 * the annotations (`/Dest`, an `/A` action, each `/AA` trigger that names a
 * page, and `/P` on every annotation in the file — a field's `/Parent` can
 * reach widgets on any page), and article beads (`/B`, whose threads live in
 * the catalogue and are never copied) are dropped. The source is restored
 * afterwards, so `splitPdf` can reuse it for its next part. Then, matching
 * annotations by their position in each page's `/Annots`, every link to a kept
 * page is re-aimed at that page's new copy and every `/P` at its own page. A
 * link to a left-out page stays inert — there is nothing left for it to open.
 * Named destinations resolve through the catalogue's name tree, which is not
 * copied, so they carry nothing across.
 *
 * `engine.test.ts` counts the PAGE OBJECTS in each output, not the tree.
 */
async function copyChosenPages(
  out: PDFDocument,
  src: PDFDocument,
  indices: number[],
): Promise<PDFPage[]> {
  const { PDFArray, PDFDict, PDFName, PDFRef } = await loadPdfLib();
  type Dict = PDFDictType;
  type Obj = PDFObject;
  interface Dest {
    index: number;
    view: Obj[];
  }
  const srcPages = src.getPages();
  const indexOfRef = new Map(
    srcPages.map((page, i) => [page.ref.toString(), i] as const),
  );
  const lookup = (value: unknown): unknown =>
    value instanceof PDFRef ? src.context.lookup(value) : value;
  const annotsOf = (node: Dict): unknown[] => {
    const annots = lookup(node.get(PDFName.of("Annots")));
    return annots instanceof PDFArray ? annots.asArray().map(lookup) : [];
  };
  /** A local destination `[pageRef, ...view]`, as a page index and its view. */
  const localDest = (dest: unknown): Dest | undefined => {
    const array = lookup(dest);
    if (!(array instanceof PDFArray) || array.size() === 0) return undefined;
    const first = array.get(0);
    const index =
      first instanceof PDFRef ? indexOfRef.get(first.toString()) : undefined;
    if (index === undefined) return undefined;
    const view = array.asArray().slice(1);
    // A view holding a reference is not one that can be re-homed safely.
    if (view.some((item) => item instanceof PDFRef)) return undefined;
    return { index, view };
  };
  const mentionsPage = (value: unknown, seen = new Set<string>()): boolean => {
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (indexOfRef.has(key)) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return mentionsPage(src.context.lookup(value), seen);
    }
    if (value instanceof PDFArray)
      return value.asArray().some((item) => mentionsPage(item, seen));
    if (value instanceof PDFDict)
      return value.values().some((item) => mentionsPage(item, seen));
    return false;
  };

  const undo: (() => void)[] = [];
  const detach = (dict: Dict, key: string): boolean => {
    const name = PDFName.of(key);
    const original = dict.get(name);
    if (original === undefined) return false;
    dict.delete(name);
    undo.push(() => dict.set(name, original));
    return true;
  };

  interface Fix {
    ownPage: boolean;
    dest?: Dest;
    goto?: Dest;
  }
  const hadPage = new Set<Dict>();
  for (const page of srcPages) {
    for (const annot of annotsOf(page.node)) {
      if (annot instanceof PDFDict && detach(annot, "P")) hadPage.add(annot);
    }
  }
  const GOTO = PDFName.of("GoTo");
  const plans = new Map<number, Fix[]>();
  for (const index of new Set(indices)) {
    const page = srcPages[index];
    if (!page) continue;
    detach(page.node, "B");
    const fixes: Fix[] = [];
    for (const annot of annotsOf(page.node)) {
      const fix: Fix = { ownPage: false };
      fixes.push(fix);
      if (!(annot instanceof PDFDict)) continue;
      fix.ownPage = hadPage.has(annot);
      const destValue = annot.get(PDFName.of("Dest"));
      const dest = localDest(destValue);
      if (dest || mentionsPage(destValue)) detach(annot, "Dest");
      if (dest) fix.dest = dest;
      const action = lookup(annot.get(PDFName.of("A")));
      if (action instanceof PDFDict && mentionsPage(action)) {
        const simple =
          action.get(PDFName.of("S")) === GOTO &&
          action.get(PDFName.of("Next")) === undefined
            ? localDest(action.get(PDFName.of("D")))
            : undefined;
        detach(annot, "A");
        if (simple) fix.goto = simple;
      }
      const triggers = lookup(annot.get(PDFName.of("AA")));
      if (triggers instanceof PDFDict) {
        for (const [key, trigger] of triggers.entries()) {
          if (mentionsPage(trigger)) detach(triggers, key.decodeText());
        }
      }
    }
    plans.set(index, fixes);
  }

  let copied: PDFPage[];
  try {
    copied = await out.copyPages(src, indices);
  } finally {
    for (const restore of undo.reverse()) restore();
  }

  const newRef = new Map<number, PDFPage["ref"]>();
  indices.forEach((index, k) => {
    if (!newRef.has(index)) newRef.set(index, copied[k]!.ref);
  });
  const retarget = (d: Dest | undefined) => {
    const ref = d && newRef.get(d.index);
    return d && ref ? out.context.obj([ref, ...d.view]) : undefined;
  };
  copied.forEach((page, k) => {
    const fixes = plans.get(indices[k]!) ?? [];
    const annots = out.context.lookup(page.node.get(PDFName.of("Annots")));
    if (!(annots instanceof PDFArray)) return;
    annots.asArray().forEach((entry, j) => {
      const annot = out.context.lookup(entry);
      const fix = fixes[j];
      if (!(annot instanceof PDFDict) || !fix) return;
      if (fix.ownPage) annot.set(PDFName.of("P"), page.ref);
      const dest = retarget(fix.dest);
      if (dest) annot.set(PDFName.of("Dest"), dest);
      const goto = retarget(fix.goto);
      if (goto)
        annot.set(
          PDFName.of("A"),
          out.context.obj({ S: PDFName.of("GoTo"), D: goto }),
        );
    });
  });
  return copied;
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
  const { PDFDocument } = await loadPdfLib();
  if (files.length === 0) {
    throw new PdfEngineError("Add at least one PDF to merge.");
  }
  const out = await PDFDocument.create();
  for (const bytes of files) {
    const src = await load(bytes);
    const pages = await copyChosenPages(out, src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  stamp(out);
  return out.save();
}

/** Produce a new PDF containing only the given pages, in ascending order. */
export async function extractPages(
  bytes: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await loadPdfLib();
  const src = await load(bytes);
  const clean = sanitizeIndices(indices, src.getPageCount());
  if (clean.length === 0) {
    throw new PdfEngineError("Select at least one page to extract.");
  }
  const out = await PDFDocument.create();
  const pages = await copyChosenPages(out, src, clean);
  for (const page of pages) out.addPage(page);
  stamp(out);
  return out.save();
}

/** Remove the given pages, keeping the rest in order. */
export async function deletePages(
  bytes: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await loadPdfLib();
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
  const out = await PDFDocument.create();
  const pages = await copyChosenPages(out, src, keep);
  for (const page of pages) out.addPage(page);
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
  const { PDFDocument } = await loadPdfLib();
  if (parts.length === 0) {
    throw new PdfEngineError("Nothing to split — add at least one range.");
  }
  const src = await load(bytes);
  const count = src.getPageCount();
  const results: NamedBytes[] = [];
  for (const part of parts) {
    const clean = sanitizeIndices(part.indices, count);
    if (clean.length === 0) continue;
    const out = await PDFDocument.create();
    const pages = await copyChosenPages(out, src, clean);
    for (const page of pages) out.addPage(page);
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
 */
export async function organizePages(
  bytes: Uint8Array,
  plan: OrganizePlanItem[],
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await loadPdfLib();
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
  const out = await PDFDocument.create();
  const pages = await copyChosenPages(
    out,
    src,
    valid.map((item) => item.sourceIndex),
  );
  pages.forEach((page, i) => {
    page.setRotation(degrees(normalizeAngle(valid[i]!.rotation)));
    out.addPage(page);
  });
  stamp(out);
  return out.save();
}
