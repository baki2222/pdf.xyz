import type { PDFDict, PDFDocument, PDFObject } from "pdf-lib";
import { PdfEngineError, UNREADABLE_PDF_MESSAGE } from "./engine-errors";
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
 *  1. Every signature DICTIONARY in the file: a dict with `/Contents` and a
 *     SIGNED `/ByteRange` (below). This finds a signature whose field is
 *     missing from `/AcroForm /Fields`, which real signers (and incremental
 *     updates) do produce.
 *  2. Every signature FIELD reachable from `/AcroForm /Fields` through `/Kids`
 *     — `/FT /Sig`, inherited from the parent as the spec allows — that has a
 *     `/V` value. This finds a signature whose value is a direct object, which
 *     route 1 cannot enumerate. A `/V` that is a dictionary must pass the same
 *     test as route 1; any other non-null `/V` still counts (toward caution).
 *
 * A SIGNED `/ByteRange` is the shape `./digital-signatures` counts: an array
 * of two or more pairs of non-negative integers. Until hostile matrix SIB-12
 * this counter took any array, and `/Type /Sig` with no `/ByteRange` at all,
 * so a signer's unfilled placeholder (`[0 /********** ...]`) was "1 signature"
 * here and 0 in every other tool. Nothing in such a dictionary was ever
 * hashed, so a rewrite invalidates nothing; the two counters now agree.
 *
 * A document with no catalog (pdf-lib loads a bare `%PDF-1.7` header without
 * complaint) is not a readable PDF: it gets the loader's unreadable copy as a
 * typed error, never a TypeError from the form walk (SIB-14).
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
  const { PDFArray, PDFDict, PDFName, PDFNull, PDFNumber, PDFRef } = lib;
  const ctx = doc.context;
  const name = (n: string) => PDFName.of(n);
  const resolve = (v: PDFObject | undefined): PDFObject | undefined =>
    v instanceof PDFRef ? ctx.lookup(v) : v;

  const isSignedByteRange = (v: PDFObject | undefined): boolean => {
    const range = resolve(v);
    if (!(range instanceof PDFArray)) return false;
    const n = range.size();
    if (n < 4 || n % 2 !== 0) return false;
    for (let i = 0; i < n; i++) {
      const x = resolve(range.get(i));
      if (!(x instanceof PDFNumber)) return false;
      const value = x.asNumber();
      if (!Number.isInteger(value) || value < 0) return false;
    }
    return true;
  };

  const isSignatureDict = (d: PDFDict): boolean =>
    d.has(name("Contents")) && isSignedByteRange(d.get(name("ByteRange")));

  if (!(doc.catalog instanceof PDFDict)) {
    throw new PdfEngineError(UNREADABLE_PDF_MESSAGE, { kind: "unreadable" });
  }

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
      if (
        ft === name("Sig") &&
        value !== undefined &&
        value !== PDFNull &&
        (!(value instanceof PDFDict) || isSignatureDict(value))
      ) {
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
