import type {
  PDFArray as PDFArrayT,
  PDFContext,
  PDFDict as PDFDictT,
  PDFDocument,
  PDFName as PDFNameT,
  PDFObject,
  PDFPage,
  PDFPageLeaf as PDFPageLeafT,
  PDFRef as PDFRefT,
  PDFStream as PDFStreamT,
} from "pdf-lib";
import {
  carryDocumentStructure,
  carryOutlines,
  destinationMapper,
  namedDestinations,
  resolveNamedLinks,
  type OutlineSource,
  type PageMap,
} from "./document-structure";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Build a new document from some pages of others — the ONE way the page tools
 * copy pages (`page-copy.test.ts` fails on any direct `copyPages` call in src).
 *
 * WHY NOT `out.copyPages(src, keep)`: pdf-lib deep-copies every object a kept
 * page references, and a page references OTHER pages through its annotations —
 * a table-of-contents Link's `/Dest`, a GoTo action's `/D`, a form widget's
 * `/Parent` whose `/Kids` hold every other page's widgets (each with a `/P`),
 * an article bead's `/P`. Each of those arrived as an orphan page object
 * outside the page tree: invisible in any viewer, and written to disk anyway,
 * because pdf-lib's writer saves every object in the context whether or not
 * anything reaches it. So a 1-page extract of a filled 3-page form carried the
 * other two pages' body text and field values, Remove Pages shipped the page
 * the user deleted, and a per-page split of a LiveCycle-shaped form produced N
 * copies of the whole document. Measured at 67e8d0f; pinned by the tests.
 *
 * It had a second, quieter cost even when nothing was dropped: pdf-lib copies
 * the top-level page by VALUE and a link's target by REFERENCE, so a link to a
 * kept page pointed at a duplicate, orphan copy of it — dead in the output, and
 * a second copy of the page's content in the file (merge, rotate, organize).
 *
 * Three layers, each covering what the one before cannot see:
 *
 *  1. The copier is told which source objects belong to dropped pages — the
 *     page dicts, the page-tree nodes, and every annotation listed only on a
 *     dropped page — and which belong to the source DOCUMENT: its catalog, its
 *     `/Info`, and every object the catalog names directly. It copies a
 *     reference to any of them as a SENTINEL instead of following it. A
 *     dropped page is never copied at all, not even on its way to the garbage
 *     collector, which is what keeps a per-page split of a big form linear
 *     (the page-registration probe in the tests counts every page object ever
 *     assigned into an output). The document-level objects matter because a
 *     kept page can reach them without a page in between: an Acrobat FieldMDP
 *     signature's `/Data` names the catalog, and a copied catalog brought the
 *     outline titles, embedded files and XMP stream along — measured at
 *     59811fd, where layer 3 already cut the field values it also brought.
 *     A kept page is copied BY REFERENCE, so a link to it lands on the copy
 *     that is in the tree rather than on a duplicate.
 *  2. Semantic repair on the output: a Link or GoTo whose target was dropped is
 *     removed (it would point into nothing); a widget's field tree is pruned to
 *     the widgets on kept pages and published as the output's `/AcroForm`, so
 *     the form stays fillable; a SubmitForm / ResetForm action's `/Fields` and
 *     a Hide action's `/T` lose the fields that are not in that pruned tree,
 *     and an action whose whole target list went is removed (an emptied
 *     "submit these" list would read as "submit everything"); `/B` (article
 *     beads) is dropped, since the thread list lives in a catalog we do not
 *     copy.
 *  3. A backstop keyed on three KINDS of object that belong to pages — page
 *     leaves, page-tree nodes and form-field nodes — rather than on the edges
 *     that reach them: every edge still pointing at the sentinel, at a page
 *     object outside the tree, at a page-tree node that is not ours, or at a
 *     field node outside the kept field trees is cut, and then every indirect
 *     object the trailer cannot reach is DELETED from the context, because the
 *     writer would otherwise ship it. The cut is what sees an edge no layer-2
 *     rule knows (a Rendition action's `/AN`, a vendor key): left alone it
 *     ships as a reference to the never-assigned sentinel, and the tests'
 *     oracle fails any output holding a reference to nothing.
 *
 * What this does NOT promise: that nothing else a kept page references came
 * from elsewhere in the source. Field data needed its own kind in layer 3
 * because a field's dictionary is not an annotation, so layer 1 cannot mark it,
 * and an action on a kept widget that names it BY REFERENCE (Acrobat's "submit
 * / reset selected fields") carried its `/V` across — measured at 7394803, a
 * 1-page extract shipped the other pages' filled values. A new kind of
 * page-scoped object needs a new kind here; `page-copy.test.ts` FIXTURES is
 * where each one found so far is pinned.
 *
 * The document-level structure the output DOES need — bookmarks, page labels,
 * title/author/subject/keywords, `/Lang`, and links through named
 * destinations — is rebuilt fresh from its parts by `document-structure.ts`,
 * never copied, so none of the above is weakened by it. The form is
 * published the same way (`publishForm`): the output's `/AcroForm` is a new
 * dictionary listing the kept field trees, with only the source form's
 * appearance defaults (`/DA`, `/DR`, `/NeedAppearances`, `/Q`) copied in.
 *
 * Nor does it prune what kept and dropped pages SHARE. When pages share one
 * `/Resources` dictionary, as some writers emit, every XObject and font in it
 * ships, including an image only a dropped page draws. Pruning a shared
 * resource dictionary per page would mean parsing each page's content
 * streams, and it is not done.
 */

/** One source document and the 0-based pages to take from it, in order. */
export interface PageSource {
  doc: PDFDocument;
  indices: number[];
}

export interface AssembleOptions {
  /**
   * The document-level state the output carries besides its pages.
   *
   * - `"subset"`: some pages of ONE source (extract, remove, split,
   *   organize). The kept pages' form fields are published as the output's
   *   `/AcroForm`, and the source's bookmarks, page labels, metadata and
   *   language are carried (`document-structure.ts`).
   * - `"merge"`: every page of each source, in order. EVERY source's form is
   *   published in one `/AcroForm` — a root field whose name an earlier file
   *   already uses is renamed (`name_2`), so two copies of one form stay two
   *   sets of answers, and a form-resource font whose name an earlier file
   *   gives a different font is renamed with the `/DA` strings that use it —
   *   and every source's bookmarks are written one source after another.
   *   Page labels, title and language are one source's claim about the whole
   *   file, and are not carried. Measured at d4b37dd, a merge carried no form
   *   and no bookmarks at all: the widgets stayed on the page with no
   *   `/AcroForm` behind them, so the fields looked filled and could not be
   *   filled.
   */
  documentState: "subset" | "merge";
}

const MAX_FIELD_DEPTH = 64;

/**
 * Copy `sources`' selected pages, in order, into a fresh document and return
 * it with no page, page-tree node, form field or source document-level object
 * in the file that is not part of the output, and nothing the trailer cannot
 * reach. (Resources the kept pages share with dropped ones still ship; see
 * the module doc.)
 */
export async function assemblePages(
  lib: PdfLibModule,
  sources: PageSource[],
  options: AssembleOptions,
): Promise<{ out: PDFDocument; pages: PDFPage[] }> {
  const { PDFDocument, PDFName, PDFDict, PDFPage } = lib;
  if (options.documentState === "subset" && sources.length !== 1) {
    throw new Error(
      `a subset is taken from one source, not ${sources.length}: merge them`,
    );
  }
  const out = await PDFDocument.create();
  const sentinel = out.context.nextRef();
  const pages: PDFPage[] = [];
  const forms: FormSource[] = [];
  const outlines: OutlineSource[] = [];
  let structure: (() => void) | undefined;

  for (const { doc: src, indices } of sources) {
    const srcPages = src.getPages();
    const keep = new Set(indices);
    const foreign = foreignObjects(lib, src, keep);
    const copier = new ForeignAwareCopier(
      lib,
      src.context,
      out.context,
      foreign,
      sentinel,
    );
    const copiedOnce = new Set<number>();
    /** Each kept source page's FIRST copy: where a link to it now lands. */
    const pageMap: PageMap = new Map();
    const copiedRefs: PDFRefT[] = [];
    const copiedIndices: number[] = [];
    for (const index of indices) {
      const srcPage = srcPages[index];
      if (!srcPage) continue;
      let ref: PDFRefT;
      if (copiedOnce.has(index)) {
        // A duplicate (organize): a second page object sharing resources,
        // with annotations of its own.
        ref = out.context.register(copier.copy(srcPage.node));
        ownAnnotations(lib, out.context, ref);
      } else {
        copiedOnce.add(index);
        ref = copier.copyRef(srcPage.ref);
        pageMap.set(srcPage.ref, ref);
      }
      copiedRefs.push(ref);
      copiedIndices.push(index);
      const node = out.context.lookup(ref);
      if (!(node instanceof lib.PDFPageLeaf)) {
        throw new Error("page copy did not produce a page");
      }
      const page = PDFPage.of(node, ref, out);
      out.addPage(page);
      pages.push(page);
    }
    // The output has no name tree, so a link through a named destination
    // would be dead in it: make it explicit (or the sentinel, for layer 2 to
    // remove when its page was dropped).
    const resolve = namedDestinations(lib, src);
    const map = destinationMapper(lib, src, out, pageMap);
    resolveNamedLinks(lib, out, resolve, map, sentinel, copiedRefs);
    forms.push({
      acroForm: src.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict),
      copier,
      pages: new Set(copiedRefs),
      roots: [],
    });
    if (options.documentState === "subset") {
      structure = () =>
        carryDocumentStructure(lib, src, out, copiedIndices, resolve, map);
    } else outlines.push({ src, resolve, map });
  }
  structure?.();
  if (options.documentState === "merge") {
    carryOutlines(lib, out, outlines);
  }

  const tree = pageTree(lib, out);
  const keptAnnots = repairAnnotations(lib, out, tree, sentinel);
  const { roots, live } = pruneFieldTrees(lib, out, keptAnnots);
  const deadField = (value: PDFObject) =>
    isDeadField(lib, out.context, live, sentinel, value);
  pruneFieldActions(lib, out.context, deadField);

  // Each root goes back to the source whose pages hold its widgets: that
  // source's form defaults are the ones its fields were drawn with.
  for (const { ref, page } of roots) {
    const form = forms.find((f) => f.pages.has(page));
    if (!form) throw new Error("a field root on a page no source produced");
    form.roots.push(ref);
  }
  publishForm(lib, out, forms);

  cutForeignEdges(lib, out, tree, sentinel, deadField);
  collectGarbage(lib, out.context, tree);
  return { out, pages };
}

// --------------------------------------------------------------------------
// Layer 1 — the copier
// --------------------------------------------------------------------------

/**
 * Source refs that must never be followed: pages not kept, every page-tree
 * node, annotations that appear only on pages not kept, and the document-level
 * objects (catalog, `/Info`, everything the catalog names directly).
 */
function foreignObjects(
  lib: PdfLibModule,
  src: PDFDocument,
  keep: Set<number>,
): Set<PDFRefT> {
  const { PDFName, PDFArray, PDFRef, PDFDict } = lib;
  const foreign = new Set<PDFRefT>();
  const keptAnnots = new Set<PDFRefT>();
  const droppedAnnots: PDFRefT[] = [];
  src.getPages().forEach((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    const refs = annots
      ? annots.asArray().filter((a): a is PDFRefT => a instanceof PDFRef)
      : [];
    if (keep.has(i)) refs.forEach((r) => keptAnnots.add(r));
    else {
      foreign.add(page.ref);
      droppedAnnots.push(...refs);
    }
  });
  for (const ref of droppedAnnots) if (!keptAnnots.has(ref)) foreign.add(ref);
  // Page-tree nodes: nothing in a copied page may reach back into the source
  // tree (pdf-lib already strips a copied page's own /Parent).
  for (const [ref, obj] of src.context.enumerateIndirectObjects()) {
    if (
      obj instanceof PDFDict &&
      obj.get(PDFName.of("Type")) === PDFName.of("Pages")
    ) {
      foreign.add(ref);
    }
  }
  // Document-level state: the source catalog, its /Info, and every object the
  // catalog names directly — derived from the catalog, not typed, so a key
  // added tomorrow is covered. A kept page can reach them without a page in
  // between (a FieldMDP signature's `/Data` names the catalog), and each one
  // brings the WHOLE document: every page's field values through `/AcroForm`,
  // bookmark titles, embedded files, the XMP stream. The output has its own
  // catalog; the form fields and title it carries are rebuilt from their parts
  // (`assemblePages` reads `/AcroForm` from the source, not through a copy).
  const { Root, Info } = src.context.trailerInfo;
  for (const docLevel of [Root, Info]) {
    if (docLevel instanceof PDFRef) foreign.add(docLevel);
  }
  for (const [, value] of src.catalog.entries()) {
    if (value instanceof PDFRef) foreign.add(value);
  }
  return foreign;
}

/**
 * pdf-lib's `PDFObjectCopier`, with two changes: a reference in `foreign` is
 * copied as `sentinel` instead of being followed, and `copyRef` is public so a
 * kept page can be copied by reference (see the module doc).
 */
class ForeignAwareCopier {
  private readonly refs = new Map<PDFRefT, PDFRefT>();
  private readonly direct = new Map<PDFObject, PDFObject>();

  constructor(
    private readonly lib: PdfLibModule,
    private readonly src: PDFContext,
    private readonly dest: PDFContext,
    private readonly foreign: Set<PDFRefT>,
    private readonly sentinel: PDFRefT,
  ) {}

  copy(object: PDFObject): PDFObject {
    const { PDFRef, PDFPageLeaf, PDFDict, PDFArray, PDFStream } = this.lib;
    if (object instanceof PDFRef) return this.copyRef(object);
    if (object instanceof PDFPageLeaf) return this.copyPage(object);
    if (object instanceof PDFDict) return this.copyDict(object);
    if (object instanceof PDFArray) return this.copyArray(object);
    if (object instanceof PDFStream) return this.copyStream(object);
    return object.clone();
  }

  copyRef(ref: PDFRefT): PDFRefT {
    if (this.foreign.has(ref)) return this.sentinel;
    const mapped = this.refs.get(ref);
    if (mapped) return mapped;
    const newRef = this.dest.nextRef();
    this.refs.set(ref, newRef);
    const value = this.src.lookup(ref);
    if (value) this.dest.assign(newRef, this.copy(value));
    return newRef;
  }

  private copyPage(original: PDFPageLeafT) {
    const { PDFName, PDFPageLeaf } = this.lib;
    const cloned = original.clone();
    for (const key of PDFPageLeaf.InheritableEntries) {
      const name = PDFName.of(key);
      const value = cloned.getInheritableAttribute(name);
      if (!cloned.get(name) && value) cloned.set(name, value);
    }
    cloned.delete(PDFName.of("Parent"));
    return this.copyDict(cloned);
  }

  private copyDict(original: PDFDictT): PDFDictT {
    const seen = this.direct.get(original);
    if (seen) return seen as PDFDictT;
    const cloned = original.clone(this.dest);
    this.direct.set(original, cloned);
    for (const [key, value] of original.entries()) {
      cloned.set(key, this.copy(value));
    }
    return cloned;
  }

  private copyArray(original: PDFArrayT): PDFArrayT {
    const seen = this.direct.get(original);
    if (seen) return seen as PDFArrayT;
    const cloned = original.clone(this.dest);
    this.direct.set(original, cloned);
    for (let i = 0; i < original.size(); i++) {
      cloned.set(i, this.copy(original.get(i)));
    }
    return cloned;
  }

  private copyStream(original: PDFStreamT) {
    const seen = this.direct.get(original);
    if (seen) return seen;
    const cloned = original.clone(this.dest);
    this.direct.set(original, cloned);
    for (const [key, value] of original.dict.entries()) {
      cloned.dict.set(key, this.copy(value));
    }
    return cloned;
  }
}

// --------------------------------------------------------------------------
// Duplicates (organize)
// --------------------------------------------------------------------------

/**
 * The keys a field dictionary holds AS A FIELD (ISO 32000-2 tables 226, 228,
 * 229, 231, 232, 234): what moves out of a widget that is merged with its
 * field when that field gains a second widget.
 */
const FIELD_KEYS = [
  "FT",
  "T",
  "TU",
  "TM",
  "Ff",
  "V",
  "DV",
  "DA",
  "Q",
  "DS",
  "RV",
  "Opt",
  "TI",
  "I",
  "MaxLen",
  "Lock",
  "SV",
];
/** The `/AA` triggers of a FIELD — keystroke, format, validate, calculate. */
const FIELD_TRIGGERS = ["K", "F", "V", "C"];

/**
 * Give a duplicated page annotations of its own. The copier maps each source
 * annotation to ONE output object, so a second copy of a page listed the very
 * objects the first copy lists — one annotation on two pages, which PDF 2.0
 * §12.5.2 forbids. A viewer then reported each field on the first copy only,
 * and Flatten PDF drew the value there, deleted the widget, and left the
 * duplicate with no value and a reference to nothing (measured at 8e270e8).
 *
 * Each annotation on the page is cloned, its `/P` pointed at this page, and
 * references between annotations of the page (`/Popup`, a popup's `/Parent`,
 * `/IRT`) pointed at the clones. A widget's clone joins the SAME field as one
 * more widget — a duplicated page shows the same answers, and an answer typed
 * on either copy shows on both, as two widgets of one field do. A widget that
 * is merged with its field cannot have a sibling, so it is first separated:
 * its field keys move to a new field dictionary that takes its place in the
 * tree, with it and the clone as kids. Clones share their appearance streams.
 *
 * What it does not do: an action that names the merged field BY REFERENCE
 * (a SubmitForm `/Fields`, a calculation order) still names the widget, now
 * no longer a field.
 */
function ownAnnotations(
  lib: PdfLibModule,
  context: PDFContext,
  pageRef: PDFRefT,
): void {
  const { PDFName, PDFArray, PDFDict, PDFRef } = lib;
  const page = context.lookup(pageRef, PDFDict);
  const annots = page.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return;
  const entries = annots.asArray();
  const clones = new Map<PDFObject, PDFRefT>();
  for (const entry of entries) {
    if (entry instanceof PDFRef && context.lookup(entry) instanceof PDFDict) {
      clones.set(entry, context.nextRef());
    }
  }
  const own = entries.map((entry) => {
    const cloneRef = clones.get(entry);
    if (!cloneRef) {
      // Not an indirect annotation (the sentinel, or a direct dictionary,
      // which the spec does not allow here): a direct one is copied.
      const value = context.lookup(entry);
      return value instanceof PDFDict
        ? cloneDirect(lib, context, value)
        : entry;
    }
    const original = context.lookup(entry, PDFDict);
    const isWidget =
      original.get(PDFName.of("Subtype")) === PDFName.of("Widget");
    if (
      isWidget &&
      (original.has(PDFName.of("FT")) || original.has(PDFName.of("T")))
    ) {
      separateField(lib, context, entry as PDFRefT, original);
    }
    const clone = cloneDirect(lib, context, original) as PDFDictT;
    for (const key of ["Popup", "IRT", "Parent"]) {
      const target = clone.get(PDFName.of(key));
      const mapped = target === undefined ? undefined : clones.get(target);
      if (mapped) clone.set(PDFName.of(key), mapped);
    }
    clone.set(PDFName.of("P"), pageRef);
    context.assign(cloneRef, clone);
    const parent = isWidget ? clone.get(PDFName.of("Parent")) : undefined;
    const field = parent === undefined ? undefined : context.lookup(parent);
    if (field instanceof PDFDict) {
      const kids = field.lookupMaybe(PDFName.of("Kids"), PDFArray);
      if (kids) kids.push(cloneRef);
      else field.set(PDFName.of("Kids"), context.obj([cloneRef]));
    }
    return cloneRef;
  });
  // A new array: the one there is the first copy's (the copier shares it).
  page.set(PDFName.of("Annots"), context.obj(own));
}

/**
 * Split a widget merged with its field into a field dictionary and a widget
 * kid of it, in place: the field takes the widget's place under its parent.
 */
function separateField(
  lib: PdfLibModule,
  context: PDFContext,
  widgetRef: PDFRefT,
  widget: PDFDictT,
): void {
  const { PDFName, PDFDict, PDFArray } = lib;
  const field = PDFDict.withContext(context);
  for (const key of FIELD_KEYS) {
    const name = PDFName.of(key);
    const value = widget.get(name);
    if (value === undefined) continue;
    field.set(name, value);
    widget.delete(name);
  }
  const triggers = widget.lookupMaybe(PDFName.of("AA"), PDFDict);
  if (triggers) {
    const fieldTriggers = PDFDict.withContext(context);
    for (const key of FIELD_TRIGGERS) {
      const name = PDFName.of(key);
      const action = triggers.get(name);
      if (action === undefined) continue;
      fieldTriggers.set(name, action);
      triggers.delete(name);
    }
    if (fieldTriggers.keys().length > 0) {
      field.set(PDFName.of("AA"), fieldTriggers);
    }
    if (triggers.keys().length === 0) widget.delete(PDFName.of("AA"));
  }
  const fieldRef = context.register(field);
  const parent = widget.get(PDFName.of("Parent"));
  if (parent !== undefined) {
    field.set(PDFName.of("Parent"), parent);
    const parentDict = context.lookup(parent);
    const kids =
      parentDict instanceof PDFDict
        ? parentDict.lookupMaybe(PDFName.of("Kids"), PDFArray)
        : undefined;
    const at = kids?.indexOf(widgetRef);
    if (kids && at !== undefined) kids.set(at, fieldRef);
  }
  field.set(PDFName.of("Kids"), context.obj([widgetRef]));
  widget.set(PDFName.of("Parent"), fieldRef);
}

/** A copy of `obj` in which no direct dictionary or array is shared. */
function cloneDirect(
  lib: PdfLibModule,
  context: PDFContext,
  obj: PDFObject,
): PDFObject {
  const { PDFDict, PDFArray } = lib;
  if (obj instanceof PDFDict) {
    const copy = PDFDict.withContext(context);
    for (const [key, value] of obj.entries()) {
      copy.set(key, cloneDirect(lib, context, value));
    }
    return copy;
  }
  if (obj instanceof PDFArray) {
    const copy = PDFArray.withContext(context);
    for (const value of obj.asArray()) {
      copy.push(cloneDirect(lib, context, value));
    }
    return copy;
  }
  return obj;
}

// --------------------------------------------------------------------------
// Layer 2 — semantic repair
// --------------------------------------------------------------------------

interface PageTree {
  /** Resolved page leaves in the output's tree. */
  leaves: Set<PDFObject>;
  leafRefs: PDFRefT[];
  /** Resolved `/Pages` nodes in the output's tree. */
  nodes: Set<PDFObject>;
}

function pageTree(lib: PdfLibModule, out: PDFDocument): PageTree {
  const { PDFName, PDFArray, PDFDict, PDFRef } = lib;
  const leaves = new Set<PDFObject>();
  const leafRefs: PDFRefT[] = [];
  const nodes = new Set<PDFObject>();
  const rootRef = out.catalog.get(PDFName.of("Pages"));
  const walk = (ref: PDFObject | undefined, depth: number) => {
    if (!(ref instanceof PDFRef) || depth > 64) return;
    const node = out.context.lookup(ref);
    if (!(node instanceof PDFDict)) return;
    if (node.get(PDFName.of("Type")) === PDFName.of("Pages")) {
      if (nodes.has(node)) return;
      nodes.add(node);
      const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
      kids?.asArray().forEach((kid) => walk(kid, depth + 1));
    } else {
      leaves.add(node);
      leafRefs.push(ref);
    }
  };
  walk(rootRef, 0);
  if (leafRefs.length !== out.getPageCount()) {
    throw new Error(
      `page tree walk found ${leafRefs.length} pages, the document has ${out.getPageCount()}`,
    );
  }
  return { leaves, leafRefs, nodes };
}

/** True when `value` points somewhere the output must not reach. */
function pointsOutside(
  lib: PdfLibModule,
  context: PDFContext,
  tree: PageTree,
  sentinel: PDFRefT,
  value: PDFObject | undefined,
): boolean {
  const { PDFRef, PDFDict, PDFName, PDFPageLeaf } = lib;
  if (value === undefined) return false;
  if (value === sentinel) return true;
  if (!(value instanceof PDFRef)) return false;
  const target = context.lookup(value);
  if (!(target instanceof PDFDict)) return false;
  const type = target.get(PDFName.of("Type"));
  if (target instanceof PDFPageLeaf || type === PDFName.of("Page")) {
    return !tree.leaves.has(target);
  }
  if (type === PDFName.of("Pages")) return !tree.nodes.has(target);
  return false;
}

/** The first element of an explicit destination array, if it is one. */
function destinationTarget(
  lib: PdfLibModule,
  context: PDFContext,
  dest: PDFObject | undefined,
): PDFObject | undefined {
  const { PDFArray } = lib;
  const resolved = dest === undefined ? undefined : context.lookup(dest);
  return resolved instanceof PDFArray && resolved.size() > 0
    ? resolved.get(0)
    : undefined;
}

/** True when an action (or any action chained through /Next) goes nowhere. */
function actionHitsOutside(
  lib: PdfLibModule,
  context: PDFContext,
  tree: PageTree,
  sentinel: PDFRefT,
  action: PDFObject | undefined,
  depth = 0,
): boolean {
  const { PDFDict, PDFName, PDFArray } = lib;
  if (action === undefined || depth > 32) return false;
  if (action === sentinel) return true;
  const dict = context.lookup(action);
  if (dict instanceof PDFArray) {
    return dict
      .asArray()
      .some((a) =>
        actionHitsOutside(lib, context, tree, sentinel, a, depth + 1),
      );
  }
  if (!(dict instanceof PDFDict)) return false;
  if (dict.get(PDFName.of("S")) === PDFName.of("GoTo")) {
    const target = destinationTarget(lib, context, dict.get(PDFName.of("D")));
    if (pointsOutside(lib, context, tree, sentinel, target)) return true;
  }
  return actionHitsOutside(
    lib,
    context,
    tree,
    sentinel,
    dict.get(PDFName.of("Next")),
    depth + 1,
  );
}

/**
 * Drop links into dropped pages, point every annotation's `/P` at the page it
 * is on, drop beads, and return the set of annotations that survive.
 */
function repairAnnotations(
  lib: PdfLibModule,
  out: PDFDocument,
  tree: PageTree,
  sentinel: PDFRefT,
): Set<PDFObject> {
  const { PDFName, PDFArray, PDFDict } = lib;
  const context = out.context;
  const kept = new Set<PDFObject>();
  const outside = (v: PDFObject | undefined) =>
    pointsOutside(lib, context, tree, sentinel, v);
  const deadAction = (v: PDFObject | undefined) =>
    actionHitsOutside(lib, context, tree, sentinel, v);
  /** Remove trigger actions (`/AA`) that jump to a dropped page. */
  const pruneTriggers = (owner: PDFDictT) => {
    const triggers = owner.lookupMaybe(PDFName.of("AA"), PDFDict);
    if (!triggers) return;
    for (const [key, action] of triggers.entries()) {
      if (deadAction(action)) triggers.delete(key);
    }
  };

  // Pass 1, over EVERY page before any cross-annotation check: which
  // annotations survive. A reply on page 1 to a note on page 5 needs page 5's
  // verdict first.
  const survivors = new Map<PDFRefT, PDFObject[]>();
  for (const pageRef of tree.leafRefs) {
    const page = context.lookup(pageRef, PDFDict);
    page.delete(PDFName.of("B"));
    pruneTriggers(page);
    const annots = page.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    const onPage: PDFObject[] = [];
    for (const entry of annots.asArray()) {
      if (entry === sentinel) continue;
      const annot = context.lookup(entry);
      if (!(annot instanceof PDFDict)) continue;
      const isLink = annot.get(PDFName.of("Subtype")) === PDFName.of("Link");
      const deadDest = outside(
        destinationTarget(lib, context, annot.get(PDFName.of("Dest"))),
      );
      const deadA = deadAction(annot.get(PDFName.of("A")));
      // A link whose only job was to go somewhere that is gone is removed,
      // not left as a hot-spot that does nothing.
      if (isLink && (deadDest || deadA)) continue;
      if (deadDest) annot.delete(PDFName.of("Dest"));
      if (deadA) annot.delete(PDFName.of("A"));
      pruneTriggers(annot);
      if (!annot.has(PDFName.of("P")) || outside(annot.get(PDFName.of("P")))) {
        annot.set(PDFName.of("P"), pageRef);
      }
      onPage.push(entry);
      kept.add(annot);
    }
    survivors.set(pageRef, onPage);
  }

  // Pass 2: references between annotations (a reply's /IRT, a markup's
  // /Popup, a popup's /Parent) that name one no longer on any kept page.
  const isDroppedAnnot = (value: PDFObject | undefined): boolean => {
    if (value === undefined) return false;
    if (value === sentinel) return true;
    const target = context.lookup(value);
    return (
      target instanceof PDFDict &&
      target.has(PDFName.of("Subtype")) &&
      target.has(PDFName.of("Rect")) &&
      !kept.has(target)
    );
  };
  const orphanPopups = new Set<PDFObject>();
  for (const entries of survivors.values()) {
    for (const entry of entries) {
      const annot = context.lookup(entry, PDFDict);
      for (const key of ["IRT", "Popup"]) {
        if (isDroppedAnnot(annot.get(PDFName.of(key)))) {
          annot.delete(PDFName.of(key));
        }
      }
      if (
        annot.get(PDFName.of("Subtype")) === PDFName.of("Popup") &&
        isDroppedAnnot(annot.get(PDFName.of("Parent")))
      ) {
        orphanPopups.add(annot);
      }
    }
  }
  for (const [pageRef, entries] of survivors) {
    const final = entries.filter(
      (entry) => !orphanPopups.has(context.lookup(entry) as PDFObject),
    );
    context
      .lookup(pageRef, PDFDict)
      .set(PDFName.of("Annots"), context.obj(final));
  }
  for (const popup of orphanPopups) kept.delete(popup);
  return kept;
}

/**
 * Prune every field tree to the widgets on kept pages and return the roots to
 * publish as `/AcroForm /Fields`, each with the page it was first found on. A
 * field keeps a kid only if that kid is a kept widget or has one below it; a
 * root with none is not published.
 */
function pruneFieldTrees(
  lib: PdfLibModule,
  out: PDFDocument,
  keptAnnots: Set<PDFObject>,
): { roots: { ref: PDFRefT; page: PDFRefT }[]; live: Set<PDFObject> } {
  const { PDFName, PDFArray, PDFDict, PDFRef } = lib;
  const context = out.context;
  const live = new Set<PDFObject>();
  const roots: { ref: PDFRefT; page: PDFRefT }[] = [];
  const rootSeen = new Set<PDFObject>();

  for (const pageRef of out.getPages().map((p) => p.ref)) {
    const page = context.lookup(pageRef, PDFDict);
    const annots = page.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (const entry of annots.asArray()) {
      const widget = context.lookup(entry);
      if (
        !(widget instanceof PDFDict) ||
        widget.get(PDFName.of("Subtype")) !== PDFName.of("Widget") ||
        !keptAnnots.has(widget)
      ) {
        continue;
      }
      let ref: PDFObject = entry;
      let node: PDFDictT = widget;
      for (let depth = 0; depth < MAX_FIELD_DEPTH; depth++) {
        live.add(node);
        const parent = node.get(PDFName.of("Parent"));
        const parentDict = parent ? context.lookup(parent) : undefined;
        if (!(parent instanceof PDFRef) || !(parentDict instanceof PDFDict)) {
          break;
        }
        ref = parent;
        node = parentDict;
      }
      if (!rootSeen.has(node)) {
        rootSeen.add(node);
        if (!(ref instanceof PDFRef)) {
          // A direct widget with no parent: give it an identity to list.
          const registered = context.register(node);
          annots.set(annots.indexOf(entry) ?? 0, registered);
          ref = registered;
        }
        // Only a field is a root; a bare widget with no field is decoration.
        if (["FT", "Kids", "T"].some((k) => node.has(PDFName.of(k)))) {
          roots.push({ ref: ref as PDFRefT, page: pageRef });
        }
      }
    }
  }

  for (const node of live) {
    if (!(node instanceof PDFDict)) continue;
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (!kids) continue;
    const keptKids = kids
      .asArray()
      .filter((kid) => live.has(context.lookup(kid) as PDFObject));
    node.set(PDFName.of("Kids"), context.obj(keptKids));
  }
  return { roots, live };
}

/** One source's form, and the field roots the output kept from it. */
interface FormSource {
  /** The source's `/AcroForm`, read in place: it is never copied whole. */
  acroForm: PDFDictT | undefined;
  copier: ForeignAwareCopier;
  /** The output pages copied from this source. */
  pages: Set<PDFRefT>;
  roots: PDFRefT[];
}

/** The keys of a standard-14 font dictionary that names no file. */
const STANDARD_FONT_KEYS = ["Type", "Subtype", "BaseFont", "Encoding"];

/** A resource name in a `/DA` string, followed by its size and `Tf`. */
const DA_FONT = /\/([^\s/[\]()<>{}%]+)(\s+[-+]?[\d.]+\s+Tf)/g;

/** `base_2`, `base_3`, ... — the first that `taken` does not claim. */
function freshName(base: string, taken: (name: string) => boolean): string {
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * Publish the kept field trees as the output's `/AcroForm`: a new dictionary
 * listing every root of every source that had a form, with that form's
 * appearance defaults (`/DA`, `/DR`, `/NeedAppearances`, `/Q`).
 *
 * One source (a subset tool) publishes its form's defaults as they were. More
 * than one (merge) need three things one form never does:
 *  - A root field whose name an EARLIER source already published is renamed
 *    `name_2` (then `_3`, ... past every name in use). Two roots with one
 *    fully qualified name are one field to a viewer: merging a form with
 *    itself would otherwise fill both copies with one answer. Renaming the
 *    root renames everything below it. Names a source repeats among its own
 *    roots stay repeated — that is the source's own form.
 *  - `/DR` is merged. A font resource name an earlier source gives a
 *    DIFFERENT font is renamed, and every `/DA` in that source's field trees,
 *    and its default `/DA`, is rewritten to match — otherwise its text would
 *    be regenerated in the other file's font. The same standard font under
 *    the same name stays one resource. Other resource kinds keep the first
 *    source's entry: `/DA` names only fonts.
 *  - A source whose default `/DA` or `/Q` differs from the published one
 *    gives it to each of its roots that has none, since a root inherits the
 *    published default otherwise. `/NeedAppearances` is true if any source
 *    asked for it.
 * What a rename cannot reach: a script or a submit list that names a renamed
 * field BY NAME still names the earlier file's field.
 */
function publishForm(
  lib: PdfLibModule,
  out: PDFDocument,
  forms: FormSource[],
): void {
  const { PDFName, PDFDict, PDFString, PDFHexString, PDFNumber, PDFBool } = lib;
  const ctx = out.context;
  const parts = forms.filter(
    (form): form is FormSource & { acroForm: PDFDictT } =>
      form.acroForm !== undefined && form.roots.length > 0,
  );
  if (parts.length === 0) return;
  /** A key of a source's form, copied into the output and resolved there. */
  const read = (part: (typeof parts)[number], key: string) => {
    const value = part.acroForm.get(PDFName.of(key));
    return value === undefined
      ? undefined
      : ctx.lookup(part.copier.copy(value));
  };
  const text = (value: PDFObject | undefined) =>
    value instanceof PDFString || value instanceof PDFHexString
      ? value.decodeText()
      : undefined;
  /** A literal string; `/DA` holds names and numbers, but escape anyway. */
  const literal = (value: string) =>
    PDFString.of(value.replace(/[\\()]/g, "\\$&"));
  const DA = PDFName.of("DA");
  const Q = PDFName.of("Q");

  // Resources, and each source's font renames.
  const resources = new Map<PDFNameT, Map<PDFNameT, PDFObject>>();
  const plain = new Map<PDFNameT, PDFObject>();
  const sameStandardFont = (a: PDFObject, b: PDFObject) => {
    const [x, y] = [ctx.lookup(a), ctx.lookup(b)];
    if (x === y) return true;
    if (!(x instanceof PDFDict) || !(y instanceof PDFDict)) return false;
    const standard = (font: PDFDictT) =>
      font.keys().every((k) => STANDARD_FONT_KEYS.includes(k.decodeText()));
    return (
      standard(x) &&
      standard(y) &&
      STANDARD_FONT_KEYS.every(
        (k) => x.get(PDFName.of(k)) === y.get(PDFName.of(k)),
      )
    );
  };
  const fontRenames = parts.map((part) => {
    const renames = new Map<PDFNameT, PDFNameT>();
    const dr = read(part, "DR");
    if (!(dr instanceof PDFDict)) return renames;
    for (const [category, value] of dr.entries()) {
      const entries = ctx.lookup(value);
      if (!(entries instanceof PDFDict)) {
        if (!plain.has(category)) plain.set(category, value);
        continue;
      }
      let merged = resources.get(category);
      if (!merged) resources.set(category, (merged = new Map()));
      const own = new Set(entries.keys());
      for (const [name, resource] of entries.entries()) {
        const existing = merged.get(name);
        if (existing === undefined) merged.set(name, resource);
        else if (
          category === PDFName.of("Font") &&
          !sameStandardFont(existing, resource)
        ) {
          const fresh = PDFName.of(
            freshName(name.decodeText(), (c) => {
              const candidate = PDFName.of(c);
              return merged.has(candidate) || own.has(candidate);
            }),
          );
          merged.set(fresh, resource);
          renames.set(name, fresh);
        }
      }
    }
    return renames;
  });
  const rewriteDA = (da: string, renames: Map<PDFNameT, PDFNameT>) =>
    renames.size === 0
      ? da
      : da.replace(DA_FONT, (match, raw: string, rest: string) => {
          const to = renames.get(PDFName.of(raw));
          return to ? `${to.asString()}${rest}` : match;
        });
  const defaults = parts.map((part, i) => {
    const raw = read(part, "DA");
    const da = text(raw);
    const q = read(part, "Q");
    const renames = fontRenames[i]!;
    return {
      da: da === undefined ? undefined : rewriteDA(da, renames),
      /** The string to write: the source's own, unless a rename changed it. */
      daObject:
        da === undefined
          ? undefined
          : renames.size === 0
            ? raw!
            : literal(rewriteDA(da, renames)),
      q: q instanceof PDFNumber ? q.asNumber() : undefined,
    };
  });
  const first = defaults.find((d) => d.da !== undefined);
  const published = {
    da: first?.da,
    q: defaults.find((d) => d.q !== undefined)?.q,
  };

  // Root names: the first source to publish a name keeps it.
  const rootDict = (ref: PDFRefT) => ctx.lookup(ref, PDFDict);
  const nameOf = (ref: PDFRefT) =>
    text(ctx.lookup(rootDict(ref).get(PDFName.of("T"))));
  const inUse = new Set(
    parts.flatMap((part) =>
      part.roots.map(nameOf).filter((n): n is string => n !== undefined),
    ),
  );
  const claimed = new Set<string>();
  parts.forEach((part, i) => {
    const renamed = new Map<string, string>();
    for (const root of part.roots) {
      const name = nameOf(root);
      if (name === undefined) continue;
      let next = renamed.get(name);
      if (next === undefined && claimed.has(name)) {
        next = freshName(name, (c) => inUse.has(c) || claimed.has(c));
        renamed.set(name, next);
        claimed.add(next);
      }
      if (next !== undefined) {
        rootDict(root).set(PDFName.of("T"), PDFHexString.fromText(next));
      }
    }
    for (const root of part.roots) {
      const name = nameOf(root);
      if (name !== undefined) claimed.add(name);
    }

    // Fonts: rewrite the trees' own /DA first, then hand down the default.
    const renames = fontRenames[i]!;
    const { da, q } = defaults[i]!;
    for (const root of part.roots) {
      const dict = rootDict(root);
      if (renames.size > 0) {
        const seen = new Set<PDFObject>();
        const walk = (node: PDFObject | undefined, depth: number) => {
          const field = node === undefined ? undefined : ctx.lookup(node);
          if (!(field instanceof PDFDict) || seen.has(field)) return;
          if (depth > MAX_FIELD_DEPTH) return;
          seen.add(field);
          const own = text(ctx.lookup(field.get(DA)));
          if (own !== undefined) {
            field.set(DA, literal(rewriteDA(own, renames)));
          }
          const kids = field.lookupMaybe(PDFName.of("Kids"), lib.PDFArray);
          kids?.asArray().forEach((kid) => walk(kid, depth + 1));
        };
        walk(root, 0);
      }
      if (da !== undefined && da !== published.da && !dict.has(DA)) {
        dict.set(DA, literal(da));
      }
      if ((q ?? 0) !== (published.q ?? 0) && !dict.has(Q)) {
        dict.set(Q, PDFNumber.of(q ?? 0));
      }
    }
  });

  const acroForm = ctx.obj({}) as PDFDictT;
  acroForm.set(
    PDFName.of("Fields"),
    ctx.obj(parts.flatMap((part) => part.roots)),
  );
  if (first?.daObject) acroForm.set(DA, first.daObject);
  if (resources.size > 0 || plain.size > 0) {
    const dr = ctx.obj({}) as PDFDictT;
    for (const [category, value] of plain) dr.set(category, value);
    for (const [category, entries] of resources) {
      const dict = ctx.obj({}) as PDFDictT;
      for (const [name, value] of entries) dict.set(name, value);
      dr.set(category, dict);
    }
    acroForm.set(PDFName.of("DR"), dr);
  }
  const needs = parts
    .map((part) => read(part, "NeedAppearances"))
    .filter((v) => v instanceof PDFBool);
  if (needs.length > 0) {
    acroForm.set(
      PDFName.of("NeedAppearances"),
      needs.some((v) => v.asBoolean()) ? PDFBool.True : PDFBool.False,
    );
  }
  if (published.q !== undefined) acroForm.set(Q, PDFNumber.of(published.q));
  out.catalog.set(PDFName.of("AcroForm"), ctx.register(acroForm));
}

/**
 * A form-field dictionary, terminal or not: it has a field type, or — for a
 * non-terminal node, which need not — a text-string name. Three other kinds
 * of dictionary carry a `/T` and are NOT fields: a markup annotation (its
 * author; it has `/Subtype`), a Hide action or a structure element (both have
 * `/S`; a Hide's `/T` may be a field's NAME), and a bead (its `/T` is a ref).
 * A widget that is not merged with its field is an annotation, which layer 1
 * already handles; what carries a field's value is the field dictionary.
 */
function isFieldNode(lib: PdfLibModule, obj: PDFObject | undefined): boolean {
  const { PDFDict, PDFName, PDFPageLeaf, PDFString, PDFHexString } = lib;
  if (!(obj instanceof PDFDict) || obj instanceof PDFPageLeaf) return false;
  if (obj.has(PDFName.of("FT"))) return true;
  if (obj.has(PDFName.of("Subtype")) || obj.has(PDFName.of("S"))) return false;
  const title = obj.get(PDFName.of("T"));
  return title instanceof PDFString || title instanceof PDFHexString;
}

/** True when `value` names a field that did not survive `pruneFieldTrees`. */
function isDeadField(
  lib: PdfLibModule,
  context: PDFContext,
  live: Set<PDFObject>,
  sentinel: PDFRefT,
  value: PDFObject,
): boolean {
  if (value === sentinel) return true;
  const target = value instanceof lib.PDFRef ? context.lookup(value) : value;
  return isFieldNode(lib, target) && !live.has(target as PDFObject);
}

/** Every object the trailer reaches, each resolved once. */
function reachableObjects(lib: PdfLibModule, context: PDFContext): PDFObject[] {
  const { PDFDict, PDFArray, PDFStream, PDFRef } = lib;
  const visited = new Set<PDFObject>();
  const stack: PDFObject[] = trailerRoots(context);
  while (stack.length > 0) {
    const current = stack.pop()!;
    const obj = current instanceof PDFRef ? context.lookup(current) : current;
    if (!obj || visited.has(obj)) continue;
    visited.add(obj);
    const dict =
      obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict) for (const [, value] of dict.entries()) stack.push(value);
    else if (obj instanceof PDFArray) stack.push(...obj.asArray());
  }
  return [...visited];
}

/** Actions whose `/Fields` names fields to act on. */
const FIELD_LIST_ACTIONS = ["SubmitForm", "ResetForm"];
/** SubmitForm / ResetForm `/Flags` bit 1: the list names fields to EXCLUDE. */
const EXCLUDE_FLAG = 1;

/**
 * Take the fields that did not survive out of every action that names fields
 * by reference, wherever the action hangs (`/A`, `/AA`, a `/Next` chain, a
 * field's own `/AA`). An action whose list is emptied is removed rather than
 * left with an empty list: "submit these fields" with none left means nothing
 * to do, while an empty or absent `/Fields` means EVERY field to a viewer.
 * An exclude-list that empties just loses `/Fields` — "all but none" is all.
 * A removed action hands its place to whatever its `/Next` still runs.
 */
function pruneFieldActions(
  lib: PdfLibModule,
  context: PDFContext,
  deadField: (value: PDFObject) => boolean,
): void {
  const { PDFDict, PDFArray, PDFName, PDFNumber, PDFRef } = lib;
  const dead = new Set<PDFObject>();
  /** Drop dead fields from `list`; true when that left it empty. */
  const emptied = (list: PDFArrayT): boolean => {
    let removed = false;
    for (let i = list.size() - 1; i >= 0; i--) {
      if (deadField(list.get(i))) {
        list.remove(i);
        removed = true;
      }
    }
    return removed && list.size() === 0;
  };
  for (const obj of reachableObjects(lib, context)) {
    if (!(obj instanceof PDFDict)) continue;
    const kind = obj.get(PDFName.of("S"));
    if (!(kind instanceof PDFName)) continue;
    if (FIELD_LIST_ACTIONS.includes(kind.decodeText())) {
      const list = obj.lookupMaybe(PDFName.of("Fields"), PDFArray);
      if (!list || !emptied(list)) continue;
      const flags = obj.lookupMaybe(PDFName.of("Flags"), PDFNumber);
      if ((flags?.asNumber() ?? 0) & EXCLUDE_FLAG) {
        obj.delete(PDFName.of("Fields"));
      } else dead.add(obj);
    } else if (kind === PDFName.of("Hide")) {
      const target = obj.get(PDFName.of("T"));
      if (target === undefined) continue;
      const list = context.lookup(target);
      if (list instanceof PDFArray ? emptied(list) : deadField(target)) {
        dead.add(obj);
      }
    }
  }
  if (dead.size === 0) return;

  const resolve = (v: PDFObject): PDFObject =>
    v instanceof PDFRef ? (context.lookup(v) ?? v) : v;
  /** The live actions a dead one hands on to through `/Next`, in order. */
  const handOn = (action: PDFObject, depth = 0): PDFObject[] => {
    const dict = resolve(action);
    if (!(dict instanceof PDFDict) || depth > 32) return [];
    const next = dict.get(PDFName.of("Next"));
    if (next === undefined) return [];
    const resolved = resolve(next);
    const steps = resolved instanceof PDFArray ? resolved.asArray() : [next];
    return steps.flatMap((step) =>
      dead.has(resolve(step)) ? handOn(step, depth + 1) : [step],
    );
  };
  for (const obj of reachableObjects(lib, context)) {
    if (obj instanceof PDFArray) {
      for (let i = obj.size() - 1; i >= 0; i--) {
        if (!dead.has(resolve(obj.get(i)))) continue;
        const steps = handOn(obj.get(i));
        obj.remove(i);
        steps.reverse().forEach((step) => obj.insert(i, step));
      }
    } else if (obj instanceof PDFDict) {
      for (const [key, value] of obj.entries()) {
        if (!dead.has(resolve(value))) continue;
        const [first, ...rest] = handOn(value);
        if (first === undefined) obj.delete(key);
        else if (rest.length === 0) obj.set(key, first);
        else if (key === PDFName.of("Next")) {
          obj.set(key, context.obj([first, ...rest]));
        } else {
          // A trigger slot holds ONE action; the rest ride on its /Next.
          const head = resolve(first);
          if (head instanceof PDFDict && !head.has(PDFName.of("Next"))) {
            head.set(PDFName.of("Next"), context.obj(rest));
          }
          obj.set(key, first);
        }
      }
    }
  }
}

// --------------------------------------------------------------------------
// Layer 3 — backstop
// --------------------------------------------------------------------------

/**
 * Walk everything the trailer reaches and cut any edge that still points at a
 * dropped page, a foreign page-tree node, a field outside the kept field
 * trees, or the sentinel.
 */
function cutForeignEdges(
  lib: PdfLibModule,
  out: PDFDocument,
  tree: PageTree,
  sentinel: PDFRefT,
  deadField: (value: PDFObject) => boolean,
): void {
  const { PDFDict, PDFArray, PDFStream, PDFRef } = lib;
  const context = out.context;
  const outside = (v: PDFObject) =>
    pointsOutside(lib, context, tree, sentinel, v) || deadField(v);
  const visited = new Set<PDFObject>();
  const stack: PDFObject[] = trailerRoots(context);
  while (stack.length > 0) {
    const current = stack.pop()!;
    const obj = current instanceof PDFRef ? context.lookup(current) : current;
    if (!obj || visited.has(obj)) continue;
    visited.add(obj);
    const dict =
      obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict) {
      for (const [key, value] of dict.entries()) {
        if (outside(value)) dict.delete(key);
        else stack.push(value);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = obj.size() - 1; i >= 0; i--) {
        const value = obj.get(i);
        if (outside(value)) obj.remove(i);
        else stack.push(value);
      }
    }
  }
}

function trailerRoots(context: PDFContext): PDFObject[] {
  const { Root, Info } = context.trailerInfo;
  return [Root, Info].filter((v): v is PDFObject => v !== undefined);
}

/**
 * Delete every indirect object the trailer cannot reach. pdf-lib's writer
 * saves the whole context, so an unreachable object is not garbage — it is a
 * payload.
 */
function collectGarbage(
  lib: PdfLibModule,
  context: PDFContext,
  tree: PageTree,
): void {
  const { PDFDict, PDFArray, PDFStream, PDFRef } = lib;
  const reachable = new Set<PDFRefT>();
  const visited = new Set<PDFObject>();
  const stack: PDFObject[] = trailerRoots(context);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current instanceof PDFRef) {
      if (reachable.has(current)) continue;
      reachable.add(current);
      const target = context.lookup(current);
      if (target) stack.push(target);
      continue;
    }
    if (visited.has(current)) continue;
    visited.add(current);
    const dict =
      current instanceof PDFStream
        ? current.dict
        : current instanceof PDFDict
          ? current
          : null;
    if (dict) for (const [, value] of dict.entries()) stack.push(value);
    else if (current instanceof PDFArray) stack.push(...current.asArray());
  }
  // Health check: a reachability bug that lost the page tree would otherwise
  // delete the document the user asked for and report success.
  for (const ref of tree.leafRefs) {
    if (!reachable.has(ref)) {
      throw new Error("garbage collection lost a kept page");
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) context.delete(ref);
  }
}
