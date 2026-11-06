import type {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFObject,
  PDFRef,
} from "pdf-lib";
import {
  carryOutlines,
  destinationMapper,
  namedDestinations,
  type PageMap,
} from "../document-structure";
import type { PdfLibModule } from "../pdf-lib";

/**
 * What the editor does to the rest of the file when it deletes a page.
 *
 * Taking a page out of the page tree is not deleting it: a bookmark, a link,
 * a named destination, the document's open action or a form field still
 * names the page object, so `pruneUnreachable` kept it — node, content
 * stream, and the field with its value — in the saved file, while the page
 * count said it was gone (audit #2, 2026-11-06; a field `ssn` survived the
 * deletion of the page it sat on). So, for each deleted page:
 *
 * - bookmarks are rebuilt the way Remove Pages rebuilds them
 *   (`carryOutlines`): one to a deleted page goes, unless a bookmark below
 *   it lands on a kept page, which it then opens;
 * - a link on a kept page, and a named destination, that go to it are
 *   removed, and so is an open action that does;
 * - its widgets leave `/AcroForm /Fields` (and `/CO`); a field left with no
 *   widget goes with its value, and its name is returned, so a fill for it
 *   is not asked of a field that is no longer there.
 *
 * And the page itself is returned as `cut`, for `pruneUnreachable` to drop
 * whatever still names it — a structure element's `/Pg`, an article bead —
 * so the property holds for referrers this list does not name.
 */
export interface DeletedPages {
  /** The deleted pages' objects: dropped even if something names them. */
  cut: ReadonlySet<PDFRef>;
  /** Fully qualified names of the fields that went with them. */
  removedFields: ReadonlySet<string>;
}

const MAX_DEPTH = 64;

/**
 * Read the file's destinations while every page is still in the page tree,
 * and return the step that clears the deleted pages out once they are not.
 * `kept` holds the 0-based source indices of the pages that stay.
 */
export function prepareDeletedPages(
  lib: PdfLibModule,
  doc: PDFDocument,
  kept: ReadonlySet<number>,
): () => DeletedPages {
  const refs = doc.getPages().map((page) => page.ref);
  const cut = new Set(refs.filter((_, i) => !kept.has(i)));
  const pageMap: PageMap = new Map(
    refs.filter((_, i) => kept.has(i)).map((ref) => [ref, ref]),
  );
  // Both read the page tree now, before it changes: the mapper numbers the
  // pages (a destination may name a page by index) and knows which were.
  const resolve = namedDestinations(lib, doc);
  const map = destinationMapper(lib, doc, doc, pageMap);
  return () => {
    const removedFields = new Set<string>();
    if (cut.size === 0) return { cut, removedFields };
    const { PDFName, PDFDict, PDFArray } = lib;
    const ctx = doc.context;
    const name = (n: string) => PDFName.of(n);
    /** Does this destination (explicit or named) go to a deleted page? */
    const dead = (dest: PDFObject | undefined) =>
      dest !== undefined && map(resolve(dest)).kind === "dropped";
    /** Does this link, bookmark or action go to a deleted page? */
    const goesToDeleted = (dict: PDFDict) => {
      if (dict.has(name("Dest"))) return dead(dict.get(name("Dest")));
      const action = dict.lookupMaybe(name("A"), PDFDict);
      return (
        action?.get(name("S")) === name("GoTo") && dead(action.get(name("D")))
      );
    };

    // Bookmarks: rebuilt; an outline with nothing left is removed.
    const outlines = doc.catalog.get(name("Outlines"));
    if (outlines !== undefined) {
      carryOutlines(lib, doc, [{ src: doc, resolve, map }]);
      if (doc.catalog.get(name("Outlines")) === outlines) {
        doc.catalog.delete(name("Outlines"));
      }
    }

    // Links on the kept pages that go to a deleted one.
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      for (let i = (annots?.size() ?? 0) - 1; annots && i >= 0; i -= 1) {
        const annot = ctx.lookup(annots.get(i));
        if (
          annot instanceof PDFDict &&
          annot.get(name("Subtype")) === name("Link") &&
          goesToDeleted(annot)
        ) {
          annots.remove(i);
        }
      }
    }

    // The open action, when it opens a deleted page.
    const open = ctx.lookup(doc.catalog.get(name("OpenAction")));
    if (
      (open instanceof PDFArray && dead(open)) ||
      (open instanceof PDFDict &&
        open.get(name("S")) === name("GoTo") &&
        dead(open.get(name("D"))))
    ) {
      doc.catalog.delete(name("OpenAction"));
    }

    // Named destinations to a deleted page: the catalog's /Dests, and the
    // leaves of the /Names /Dests tree.
    const dests = doc.catalog.lookupMaybe(name("Dests"), PDFDict);
    for (const [key, value] of dests?.entries() ?? []) {
      if (dead(value)) dests!.delete(key);
    }
    const seen = new Set<PDFObject>();
    const walkNames = (node: PDFObject | undefined, depth: number) => {
      const dict = node === undefined ? undefined : ctx.lookup(node);
      if (!(dict instanceof PDFDict) || depth > MAX_DEPTH || seen.has(dict)) {
        return;
      }
      seen.add(dict);
      const pairs = dict.lookupMaybe(name("Names"), PDFArray);
      for (let i = (pairs?.size() ?? 0) - 2; pairs && i >= 0; i -= 2) {
        if (dead(pairs.get(i + 1))) {
          pairs.remove(i + 1);
          pairs.remove(i);
        }
      }
      const kids = dict.lookupMaybe(name("Kids"), PDFArray);
      kids?.asArray().forEach((kid) => walkNames(kid, depth + 1));
    };
    walkNames(
      doc.catalog
        .lookupMaybe(name("Names"), PDFDict)
        ?.lookupMaybe(name("Dests"), PDFDict),
      0,
    );

    // Form fields: a widget on a deleted page is one in its /Annots, or one
    // whose /P names it.
    const onDeleted = new Set<PDFObject>();
    for (const ref of cut) {
      const page = ctx.lookup(ref);
      if (!(page instanceof PDFDict)) continue;
      const annots = page.lookupMaybe(name("Annots"), PDFArray);
      for (const entry of annots?.asArray() ?? []) onDeleted.add(entry);
    }
    const isOnDeleted = (entry: PDFObject, dict: PDFDict) => {
      const owner = dict.get(name("P"));
      return (
        onDeleted.has(entry) ||
        onDeleted.has(dict) ||
        (owner instanceof lib.PDFRef && cut.has(owner))
      );
    };
    const removed = new Set<PDFObject>();
    const partial = (dict: PDFDict) => {
      const t = ctx.lookup(dict.get(name("T")));
      return t instanceof lib.PDFString || t instanceof lib.PDFHexString
        ? t.decodeText()
        : undefined;
    };
    /** Drop the deleted widgets from `entries`, and the fields left empty. */
    const prune = (entries: PDFArray, parent: string, depth: number) => {
      if (depth > MAX_DEPTH) return;
      for (let i = entries.size() - 1; i >= 0; i -= 1) {
        const entry = entries.get(i);
        const dict = ctx.lookup(entry);
        if (!(dict instanceof PDFDict) || seen.has(dict)) continue;
        seen.add(dict);
        const own = partial(dict);
        const full =
          own === undefined ? parent : parent ? `${parent}.${own}` : own;
        const kids = dict.lookupMaybe(name("Kids"), PDFArray);
        let goes: boolean;
        if (kids && kids.size() > 0) {
          prune(kids, full, depth + 1);
          goes = kids.size() === 0;
        } else goes = isOnDeleted(entry, dict);
        if (!goes) continue;
        entries.remove(i);
        removed.add(entry);
        if (own !== undefined) removedFields.add(full);
      }
    };
    const acroForm = doc.catalog.lookupMaybe(name("AcroForm"), PDFDict);
    const fields = acroForm?.lookupMaybe(name("Fields"), PDFArray);
    if (fields) prune(fields, "", 0);
    const order = acroForm?.lookupMaybe(name("CO"), PDFArray);
    for (let i = (order?.size() ?? 0) - 1; order && i >= 0; i -= 1) {
      if (removed.has(order.get(i))) order.remove(i);
    }
    return { cut, removedFields };
  };
}
