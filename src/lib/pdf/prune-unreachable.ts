import type { PDFDocument, PDFObject } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Drop every object nothing reachable from the trailer refers to, and return
 * how many were dropped. pdf-lib's `save()` writes EVERY object it parsed, so
 * without this an object a change disconnected — a page's old content
 * stream, a replaced image, an earlier Info dictionary an incremental save
 * left behind — is still in the saved file, readable by anyone who looks.
 */
export function pruneUnreachable(lib: PdfLibModule, doc: PDFDocument): number {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = lib;
  const ctx = doc.context;
  const seen = new Set<string>();
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
    if (!seen.has(ref.toString())) {
      ctx.delete(ref);
      dropped++;
    }
  }
  return dropped;
}
