/**
 * What Compress PDF's lossless repack drops (audit compress-pdf#6,
 * 2026-11-08): only what no page can show.
 *
 *  - Embedded page thumbnails (`/Thumb` on a page). A viewer draws its page
 *    previews from the page itself; the embedded picture is a second copy.
 *  - Objects nothing in the file refers to. pdf-lib's save writes every
 *    indirect object it parsed, so a file edited by appending (old object
 *    versions), or one whose object streams were unpacked on the way in,
 *    kept carrying them. Reachability is walked from the trailer — the
 *    catalog, the document info and the ID — through every dictionary,
 *    array and stream dictionary; anything not reached is not part of the
 *    document a reader can open.
 *
 * Not dropped, on purpose: embedded attachments, bookmarks, form fields,
 * annotations and metadata. Those are content someone may want, and removing
 * them would need the person's say-so (see the lane report: attachments are
 * deferred until there is an opt-in control).
 *
 * pdf-lib's classes come from the caller's lazily loaded module (`lib`), so
 * this leaf adds no static import of the engine to whoever imports it.
 */
import type { PDFDocument, PDFObject } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

export interface RepackRemoved {
  /** Page `/Thumb` entries removed. */
  thumbnails: number;
  /** Indirect objects removed because nothing reached them. */
  unreferenced: number;
}

/** The page's sentence for the cleanup (the content test pins it there). */
export const REPACK_CLEANUP_SENTENCE =
  "The repack also drops objects nothing in the file refers to, and embedded page thumbnails, which a viewer can draw from the page itself; neither changes how a page looks.";

/** The panel's line for one run; `null` when nothing was removed. */
export function removedLine(removed: RepackRemoved): string | null {
  const parts: string[] = [];
  if (removed.unreferenced > 0) {
    parts.push(
      `${removed.unreferenced} unused object${removed.unreferenced === 1 ? "" : "s"}`,
    );
  }
  if (removed.thumbnails > 0) {
    parts.push(
      `${removed.thumbnails} page thumbnail${removed.thumbnails === 1 ? "" : "s"}`,
    );
  }
  return parts.length === 0
    ? null
    : `The repack also dropped ${parts.join(" and ")}.`;
}

/**
 * Remove page thumbnails, then every indirect object the trailer cannot
 * reach. Call after the last change to the document (the producer stamp),
 * right before `save`, so nothing written after it is mistaken for an orphan.
 */
export function dropUnseen(lib: PdfLibModule, doc: PDFDocument): RepackRemoved {
  const { PDFArray, PDFDict, PDFName, PDFRef, PDFStream } = lib;
  const THUMB = PDFName.of("Thumb");
  let thumbnails = 0;
  for (const page of doc.getPages()) {
    if (page.node.has(THUMB)) {
      page.node.delete(THUMB);
      thumbnails += 1;
    }
  }

  const ctx = doc.context;
  const reached = new Set<string>();
  const stack: PDFObject[] = [];
  const t = ctx.trailerInfo;
  for (const root of [t.Root, t.Info, t.Encrypt, t.ID]) {
    if (root) stack.push(root);
  }
  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (reached.has(key)) continue;
      reached.add(key);
      const target = ctx.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    }
  }

  let unreferenced = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) {
      ctx.delete(ref);
      unreferenced += 1;
    }
  }
  return { thumbnails, unreferenced };
}
