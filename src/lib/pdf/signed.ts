import type { PDFDict, PDFDocument, PDFObject } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * How many digital signatures a PDF carries.
 *
 * A digital signature covers exact byte ranges of the file (`/ByteRange`). Any
 * rewrite — including a "lossless" repack that changes nothing a reader can
 * see — moves those bytes, and every signature then reports "the document has
 * been altered". Compress promised "no quality lost" for exactly such a rewrite
 * and never looked; this is the look.
 *
 * Two independent routes, unioned, because each misses something the other
 * sees:
 *
 *  1. Every signature DICTIONARY in the file: a dict with `/ByteRange` and
 *     `/Contents`, or `/Type /Sig` / `/DocTimeStamp` with `/Contents`. This
 *     finds a signature whose field is missing from `/AcroForm /Fields`, which
 *     real signers (and incremental updates) do produce.
 *  2. Every signature FIELD reachable from `/AcroForm /Fields` through `/Kids`
 *     — `/FT /Sig`, inherited from the parent as the spec allows — that has a
 *     `/V` value. This finds a signature whose value is a direct object, which
 *     route 1 cannot enumerate.
 *
 * Raw dictionary walks, never `doc.getForm()`: that CREATES an empty
 * `/AcroForm` on a document without one, which would change the very file the
 * caller is about to save — and it throws on forms it cannot model.
 *
 * `/SigFlags` alone is deliberately NOT counted: bit 1 means a signature FIELD
 * exists, and an empty field waiting to be signed has nothing to invalidate.
 *
 * Takes the pdf-lib module rather than importing it, so this stays behind the
 * one dynamic boundary in `./pdf-lib`.
 */
export function countSignatures(lib: PdfLibModule, doc: PDFDocument): number {
  const { PDFArray, PDFDict, PDFName, PDFNull, PDFRef } = lib;
  const ctx = doc.context;
  const name = (n: string) => PDFName.of(n);
  const resolve = (v: PDFObject | undefined): PDFObject | undefined =>
    v instanceof PDFRef ? ctx.lookup(v) : v;

  const isSignatureDict = (d: PDFDict): boolean => {
    if (!d.has(name("Contents"))) return false;
    if (resolve(d.get(name("ByteRange"))) instanceof PDFArray) return true;
    const type = resolve(d.get(name("Type")));
    return type === name("Sig") || type === name("DocTimeStamp");
  };

  const signatures = new Set<PDFObject>();

  // Route 1: signature dictionaries anywhere in the object table.
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && isSignatureDict(obj)) signatures.add(obj);
  }

  // Route 2: signed signature fields in the form tree.
  const acroForm = resolve(doc.catalog.get(name("AcroForm")));
  if (acroForm instanceof PDFDict) {
    const visited = new Set<PDFObject>();
    const walk = (node: PDFObject | undefined, inheritedFT?: PDFObject) => {
      const field = resolve(node);
      if (!(field instanceof PDFDict) || visited.has(field)) return;
      visited.add(field);
      const ft = resolve(field.get(name("FT"))) ?? inheritedFT;
      const value = resolve(field.get(name("V")));
      if (ft === name("Sig") && value !== undefined && value !== PDFNull) {
        signatures.add(value);
      }
      const kids = resolve(field.get(name("Kids")));
      if (kids instanceof PDFArray) {
        for (let i = 0; i < kids.size(); i++) walk(kids.get(i), ft);
      }
    };
    const fields = resolve(acroForm.get(name("Fields")));
    if (fields instanceof PDFArray) {
      for (let i = 0; i < fields.size(); i++) walk(fields.get(i));
    }
  }

  return signatures.size;
}
