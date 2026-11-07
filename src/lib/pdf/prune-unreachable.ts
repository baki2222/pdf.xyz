import type { PDFDocument, PDFObject, PDFRef } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Drop every object nothing reachable from the trailer refers to, and return
 * how many were dropped. pdf-lib's `save()` writes EVERY object it parsed, so
 * without this an object a change disconnected — a page's old content
 * stream, a replaced image, an earlier Info dictionary an incremental save
 * left behind — is still in the saved file, readable by anyone who looks.
 *
 * `cut` names objects that go even if something still refers to them — a
 * deleted page (`editor/deleted-pages.ts`), which a structure element's
 * `/Pg` or an article bead may still name. A reference left to one is to
 * an undefined object, which the spec (7.3.10) reads as null. Nothing is
 * reached THROUGH a cut object either, so its content goes with it.
 */
export function pruneUnreachable(
  lib: PdfLibModule,
  doc: PDFDocument,
  cut: ReadonlySet<PDFRef> = new Set(),
): number {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = lib;
  const ctx = doc.context;
  const seen = new Set<string>();
  for (const ref of cut) seen.add(ref.toString());
  const queue: PDFObject[] = [];
  const t = ctx.trailerInfo;
  for (const o of [t.Root, t.Info, t.Encrypt, t.ID]) if (o) queue.push(o);
  while (queue.length) {
    const o = queue.pop()!;
    if (o instanceof PDFRef) {
      const k = o.toString();
      if (seen.has(k)) continue;
      seen.add(k);
      const v = ctx.lookup(o);
      if (v) queue.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) queue.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) queue.push(v);
    } else if (o instanceof PDFStream) {
      queue.push(o.dict);
    }
  }
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString()) || cut.has(ref)) {
      ctx.delete(ref);
      dropped++;
    }
  }
  return dropped;
}
