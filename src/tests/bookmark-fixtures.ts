import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFObject,
  type PDFRef,
} from "pdf-lib";

/**
 * Outlines built object by object, for Edit PDF Bookmarks' tests: every
 * item is a dictionary written here with exactly the keys a spec gives, so a
 * test can build what a real writer would never emit (a cycle, a lying
 * /Count, a /First naming an ancestor, a title that is not a string).
 */

export interface OutlineSpec {
  /** A string is written as UTF-16BE hex; any other object as given. */
  title: string | PDFObject;
  /** /Dest, as given (an array, a name, a string). */
  dest?: PDFObject;
  /** /A, as given. */
  action?: PDFObject;
  /** /Count is written as given when set; otherwise from `open`. */
  count?: number;
  open?: boolean;
  /** Extra keys, as given. */
  extra?: Record<string, PDFObject>;
  kids?: OutlineSpec[];
}

export interface BuiltOutline {
  root: PDFRef;
  /** Each item's ref, by its title when the title was a string. */
  refs: Map<string, PDFRef>;
  /** Every item's ref, in walk order. */
  order: PDFRef[];
}

/** A title as most writers write a non-ASCII one: UTF-16BE hex. */
export const utf16 = (text: string) => PDFHexString.fromText(text);

/** Write `specs` as `doc`'s outline, with a correct structure. */
export function addOutline(
  doc: PDFDocument,
  specs: OutlineSpec[],
): BuiltOutline {
  const ctx = doc.context;
  const refs = new Map<string, PDFRef>();
  const order: PDFRef[] = [];
  const visible = (items: OutlineSpec[]): number =>
    items.reduce(
      (n, item) => n + 1 + (item.open ? visible(item.kids ?? []) : 0),
      0,
    );
  const write = (items: OutlineSpec[], parent: PDFRef): PDFRef[] => {
    const own = items.map(() => ctx.nextRef());
    items.forEach((item, i) => {
      const ref = own[i]!;
      order.push(ref);
      if (typeof item.title === "string") refs.set(item.title, ref);
      const dict = ctx.obj({}) as PDFDict;
      dict.set(
        PDFName.of("Title"),
        typeof item.title === "string" ? utf16(item.title) : item.title,
      );
      dict.set(PDFName.of("Parent"), parent);
      if (i > 0) dict.set(PDFName.of("Prev"), own[i - 1]!);
      if (i < items.length - 1) dict.set(PDFName.of("Next"), own[i + 1]!);
      if (item.dest) dict.set(PDFName.of("Dest"), item.dest);
      if (item.action) dict.set(PDFName.of("A"), item.action);
      for (const [k, v] of Object.entries(item.extra ?? {})) {
        dict.set(PDFName.of(k), v);
      }
      const kids = item.kids ?? [];
      if (kids.length > 0) {
        const kidRefs = write(kids, ref);
        dict.set(PDFName.of("First"), kidRefs[0]!);
        dict.set(PDFName.of("Last"), kidRefs.at(-1)!);
        const shown = visible(kids);
        dict.set(
          PDFName.of("Count"),
          PDFNumber.of(item.count ?? (item.open ? shown : -shown)),
        );
      } else if (item.count !== undefined) {
        dict.set(PDFName.of("Count"), PDFNumber.of(item.count));
      }
      ctx.assign(ref, dict);
    });
    return own;
  };
  const root = ctx.nextRef();
  const top = write(specs, root);
  ctx.assign(
    root,
    ctx.obj({
      Type: "Outlines",
      ...(top.length ? { First: top[0]!, Last: top.at(-1)! } : {}),
      Count: visible(specs),
    }),
  );
  doc.catalog.set(PDFName.of("Outlines"), root);
  return { root, refs, order };
}

/** A document of `n` blank pages, each a different size so pages differ. */
export async function blankPages(n: number): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([300 + i, 400]);
  return doc;
}

/** `[page /Fit]` for 0-based page `i` of `doc`. */
export const fitDest = (doc: PDFDocument, i: number) =>
  doc.context.obj([doc.getPage(i).ref, PDFName.of("Fit")]);

/** `[page /XYZ left top zoom]` for 0-based page `i` of `doc`. */
export const xyzDest = (
  doc: PDFDocument,
  i: number,
  left: number,
  top: number,
  zoom: number,
) =>
  doc.context.obj([
    doc.getPage(i).ref,
    PDFName.of("XYZ"),
    PDFNumber.of(left),
    PDFNumber.of(top),
    PDFNumber.of(zoom),
  ]);

/** An action dictionary. */
export const action = (doc: PDFDocument, entries: Record<string, PDFObject>) =>
  doc.context.obj(entries);

/** A literal string, as given. */
export const lit = (text: string) => PDFString.of(text);

/**
 * The e2e proof's input, and the unit tests' plainest one: four pages, one
 * bookmark "Chapter One" on page 1, open with the bookmarks panel showing.
 */
export const PROOF_BOOKMARK = "Chapter One";
export async function oneBookmarkPdf(): Promise<Uint8Array> {
  const doc = await blankPages(4);
  addOutline(doc, [{ title: PROOF_BOOKMARK, dest: fitDest(doc, 0) }]);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  return doc.save({ useObjectStreams: false });
}
