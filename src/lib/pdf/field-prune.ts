import type { PDFArray, PDFDict, PDFDocument, PDFObject } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Take form fields out of the RAW `/AcroForm /Fields` tree — without
 * `doc.getForm()`, which deletes XFA and rewrites the tree as a side effect.
 * Shared by the page editor's page deletion (`editor/deleted-pages.ts`: the
 * widgets on a deleted page) and Remove Annotations (`./remove-annotations`:
 * every non-signature field).
 *
 * A terminal field (no `/Kids`, or empty `/Kids`) goes when `goes` says so;
 * a field with kids goes when every kid went. Each removed entry leaves the
 * array that listed it — `/Fields` or its parent's `/Kids` — and the
 * calculation order (`/CO`). A field whose own `/T` gave it a name is
 * reported by its fully qualified name.
 *
 * Bounded: a dict is visited once (a `/Kids` cycle, or one field listed
 * twice, is walked once), and the walk stops below {@link MAX_FIELD_DEPTH}.
 * With `keepSignatures`, a field whose type (`/FT`, inherited down the tree)
 * is `/Sig` never goes, whatever `goes` says.
 */
export const MAX_FIELD_DEPTH = 64;

export interface FieldPrune {
  /** The `/Fields` or `/Kids` entries removed (refs or direct dicts). */
  removed: Set<PDFObject>;
  /** Fully qualified names of the removed fields that had one. */
  removedFields: Set<string>;
  /** Signature fields left in place because of `keepSignatures`. */
  signaturesKept: number;
}

export function pruneFields(
  lib: PdfLibModule,
  doc: PDFDocument,
  goes: (entry: PDFObject, dict: PDFDict) => boolean,
  { keepSignatures = false }: { keepSignatures?: boolean } = {},
): FieldPrune {
  const { PDFName, PDFDict, PDFArray, PDFString, PDFHexString } = lib;
  const ctx = doc.context;
  const name = (n: string) => PDFName.of(n);
  const removed = new Set<PDFObject>();
  const removedFields = new Set<string>();
  let signaturesKept = 0;
  const seen = new Set<PDFDict>();
  const partial = (dict: PDFDict) => {
    const t = ctx.lookup(dict.get(name("T")));
    return t instanceof PDFString || t instanceof PDFHexString
      ? t.decodeText()
      : undefined;
  };
  const prune = (
    entries: PDFArray,
    parent: string,
    parentType: PDFObject | undefined,
    depth: number,
  ) => {
    if (depth > MAX_FIELD_DEPTH) return;
    for (let i = entries.size() - 1; i >= 0; i -= 1) {
      const entry = entries.get(i);
      const dict = ctx.lookup(entry);
      if (!(dict instanceof PDFDict) || seen.has(dict)) continue;
      seen.add(dict);
      const own = partial(dict);
      const full =
        own === undefined ? parent : parent ? `${parent}.${own}` : own;
      const type = dict.get(name("FT")) ?? parentType;
      if (keepSignatures && type === name("Sig")) {
        signaturesKept += 1;
        continue;
      }
      const kids = dict.lookupMaybe(name("Kids"), PDFArray);
      let gone: boolean;
      if (kids && kids.size() > 0) {
        prune(kids, full, type, depth + 1);
        gone = kids.size() === 0;
      } else gone = goes(entry, dict);
      if (!gone) continue;
      entries.remove(i);
      removed.add(entry);
      if (own !== undefined) removedFields.add(full);
    }
  };
  const acroForm = doc.catalog.lookupMaybe(name("AcroForm"), PDFDict);
  const fields = acroForm?.lookupMaybe(name("Fields"), PDFArray);
  if (fields) prune(fields, "", undefined, 0);
  const order = acroForm?.lookupMaybe(name("CO"), PDFArray);
  for (let i = (order?.size() ?? 0) - 1; order && i >= 0; i -= 1) {
    const entry = order.get(i);
    if (removed.has(entry) || removed.has(ctx.lookup(entry) as PDFObject)) {
      order.remove(i);
    }
  }
  return { removed, removedFields, signaturesKept };
}
