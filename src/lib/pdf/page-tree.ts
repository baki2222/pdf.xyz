import type {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObject,
  PDFRef,
} from "pdf-lib";
import { PdfEngineError, UNREADABLE_PDF_MESSAGE } from "./engine-errors";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";

/**
 * The page tree, checked and settled ONCE, right after pdf-lib parses a file
 * and before anything walks it.
 *
 * pdf-lib "loads" a great deal it cannot use. A header with no catalog loads;
 * so does a page tree that contains itself, a 50,000-deep chain of /Pages
 * nodes, a page whose /Parent is itself, a page dictionary whose number it
 * could not parse (it becomes a `PDFInvalidObject` and the page silently
 * vanishes), and a /CropBox whose value is a reference to itself. Every one of
 * those then failed on the first page walk with a raw TypeError or RangeError
 * the user read verbatim, or — worse — went on with ZERO pages and wrote a
 * "success" that stamped nothing (hostile matrix PS-03…PS-12, STAMP-01…11,
 * CO-01/09/10, EDIT-01…05).
 *
 * The walk here is ITERATIVE (an explicit stack, so no input depth can
 * overflow it), visits each node once (so no cycle can loop it), and decides
 * for each defect whether a viewer would have recovered:
 *
 *  - REPAIRED, because pdf.js and real viewers read these files and the repair
 *    writes what the file plainly meant: a wrong /Count (common in real files,
 *    and pdf.js then reads OUR output as 0 pages — STAMP-11, PS-12); a /Parent
 *    that is not the node holding the page (pdf-lib's inherited-attribute walk
 *    recursed forever — STAMP-03); a missing /Type on the catalog or a tree
 *    node; a /Kids entry or attribute behind a chain of references; a page
 *    attribute of the wrong type, dropped as if absent (PS-07, STAMP-04/05);
 *    a page with no /MediaBox anywhere, given pdf.js's US Letter default; and
 *    a tree deeper than {@link PAGE_TREE_FLATTEN_DEPTH}, flattened to one
 *    level with each page's inherited attributes copied onto it, because
 *    pdf-lib's own traversal is recursive and overflows the stack (PS-05).
 *  - REFUSED, because recovery would write a wrong document: no catalog or no
 *    page tree (UNREADABLE_PDF_MESSAGE, as `engine-errors.ts` always said this
 *    case should read); a /Kids cycle (pdf.js refuses those too: "Pages tree
 *    contains circular reference"); and a page pdf-lib could not parse, which
 *    {@link damagedPageMessage} names — processing on would drop that page
 *    from the output without a word.
 *
 * A file this does not touch is left exactly as parsed: every repair checks
 * first and writes only on a difference, and `page-tree.test.ts` holds the
 * real-producer corpus to ZERO repairs.
 */

/**
 * Trees deeper than this are flattened. pdf-lib walks the tree recursively
 * (page enumeration, inherited attributes, /Count updates on insert), and in
 * Node 24 with the default stack it overflowed between 6,000 and 8,000 levels
 * (measured on `deepPageTreeObjects`); a browser worker may have less. Real
 * producers write flat or balanced trees: every file in the real-producer
 * corpus is ONE level deep (measured), and a million pages at fan-out 2 is
 * only 20. 256 is ~25x below the measured overflow and >10x above anything
 * balanced; `page-tree.test.ts` holds both bounds (pdf-lib alone walks 4x the
 * threshold; the corpus's deepest x10 stays under it).
 */
export const PAGE_TREE_FLATTEN_DEPTH = 256;

/** pdf.js's page size for a page with no /MediaBox anywhere (US Letter). */
export const DEFAULT_MEDIA_BOX = [0, 0, 612, 792] as const;

/** A reference that points at a reference is followed this many times. */
const MAX_REF_HOPS = 32;

/** The keys a page inherits from its ancestors (ISO 32000-1, Table 30). */
const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"] as const;
type Inheritable = (typeof INHERITABLE)[number];
/** Boxes only a page itself may carry. */
const LEAF_BOXES = ["BleedBox", "TrimBox", "ArtBox"] as const;
/** Resource categories pdf-lib reads as dictionaries when it draws. */
const RESOURCE_DICTS = [
  "Font",
  "XObject",
  "ExtGState",
  "ColorSpace",
  "Pattern",
  "Shading",
  "Properties",
] as const;

/** What the walk found: the page count, or why the tree cannot be used. */
export type PageTreeVerdict =
  | {
      readonly ok: true;
      readonly pages: number;
      /** What was repaired, by key; empty when the file was left untouched. */
      readonly repaired: readonly string[];
      /** Deepest /Pages nesting seen (the root alone is 1). */
      readonly depth: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        "no-catalog" | "no-page-tree" | "cycle" | "damaged-page" | "internal";
      /** 1-based: the page pdf-lib could not read (`damaged-page` only). */
      readonly page?: number;
    };

/**
 * The refusal for a page the parser could not read. It names the page, says
 * what processing on would cost, and blames the file rather than the user's
 * settings (the sentences it replaces said "Choose a page that exists" for a
 * page a viewer shows — STAMP-07).
 */
export function damagedPageMessage(page: number): string {
  return `Page ${page} of this PDF is damaged and couldn't be read, so this file can't be processed without losing that page.`;
}

interface Frame {
  readonly node: PDFDict;
  readonly ref: PDFRef | undefined;
  readonly kids: PDFArray;
  next: number;
  leaves: number;
  readonly inherited: Partial<Record<Inheritable, PDFObject>>;
  readonly depth: number;
}

interface Leaf {
  readonly node: PDFDict;
  /** What /Kids holds for it: its reference, or the dictionary inlined. */
  readonly handle: PDFObject;
  readonly inherited: Partial<Record<Inheritable, PDFObject>>;
}

class Walk {
  readonly repaired = new Set<string>();
  private readonly settledResources = new Set<PDFDict>();
  constructor(
    private readonly lib: PdfLibModule,
    private readonly ctx: PDFContext,
  ) {}

  /** Follow a chain of references; `cyclic` when it never ends. */
  resolve(value: PDFObject | undefined): {
    obj: PDFObject | undefined;
    ref: PDFRef | undefined;
  } {
    let ref: PDFRef | undefined;
    let v = value;
    for (let hops = 0; v instanceof this.lib.PDFRef; hops += 1) {
      if (hops >= MAX_REF_HOPS) return { obj: undefined, ref };
      ref = v;
      v = this.ctx.lookup(v);
    }
    return { obj: v, ref };
  }

  /**
   * Keep `dict[key]` only if it resolves to something `valid`; a value
   * behind a chain of references is re-pointed at the last reference, which
   * is all pdf-lib's one-level lookup can follow.
   */
  keepIf(dict: PDFDict, key: string, valid: (obj: PDFObject) => boolean) {
    const name = this.lib.PDFName.of(key);
    const raw = dict.get(name);
    if (raw === undefined) return;
    const { obj, ref } = this.resolve(raw);
    if (obj === undefined || !valid(obj)) {
      dict.delete(name);
      this.repaired.add(key);
    } else if (ref !== undefined && ref !== raw) {
      dict.set(name, ref);
      this.repaired.add(key);
    }
  }

  isDict = (obj: PDFObject) =>
    obj instanceof this.lib.PDFDict && !(obj instanceof this.lib.PDFStream);

  isBox = (obj: PDFObject) => {
    if (!(obj instanceof this.lib.PDFArray) || obj.size() !== 4) return false;
    for (let i = 0; i < 4; i += 1) {
      const n = this.ctx.lookup(obj.get(i));
      if (!(n instanceof this.lib.PDFNumber) || !Number.isFinite(n.asNumber()))
        return false;
    }
    return true;
  };

  /** Drop each page attribute pdf-lib would trip over, as if absent. */
  settleAttributes(node: PDFDict, leaf: boolean) {
    const { lib } = this;
    this.keepIf(node, "MediaBox", this.isBox);
    this.keepIf(node, "CropBox", this.isBox);
    this.keepIf(node, "Rotate", (o) => o instanceof lib.PDFNumber);
    this.keepIf(node, "Resources", this.isDict);
    const resources = this.resolve(node.get(lib.PDFName.of("Resources"))).obj;
    if (resources instanceof lib.PDFDict && this.isDict(resources)) {
      if (!this.settledResources.has(resources)) {
        this.settledResources.add(resources);
        for (const key of RESOURCE_DICTS)
          this.keepIf(resources, key, this.isDict);
      }
    }
    if (!leaf) return;
    for (const key of LEAF_BOXES) this.keepIf(node, key, this.isBox);
    this.keepIf(
      node,
      "Contents",
      (o) => o instanceof lib.PDFStream || o instanceof lib.PDFArray,
    );
  }

  /** Re-type `dict` as `Cls` where it is stored; returns the new object. */
  retype<T extends PDFDict>(
    dict: PDFDict,
    make: (map: Map<PDFName, PDFObject>, ctx: PDFContext) => T,
    store: (obj: T) => void,
    what: string,
  ): T {
    const typed = make(new Map(dict.entries()), this.ctx);
    store(typed);
    this.repaired.add(what);
    return typed;
  }

  /** The value of `inherited` safe to give one more page. */
  copyable(v: PDFObject): PDFObject {
    const { lib } = this;
    return v instanceof lib.PDFDict || v instanceof lib.PDFArray
      ? v.clone(this.ctx)
      : v;
  }
}

/**
 * Check and settle `doc`'s page tree in place. Never throws: an unexpected
 * failure inside the walk is reported as `internal`, which callers refuse in
 * the unreadable-file words.
 */
export function settlePageTree(
  lib: PdfLibModule,
  doc: PDFDocument,
): PageTreeVerdict {
  try {
    return walkPageTree(lib, doc);
  } catch {
    return { ok: false, reason: "internal" };
  }
}

function walkPageTree(lib: PdfLibModule, doc: PDFDocument): PageTreeVerdict {
  const { PDFName, PDFNumber, PDFPageTree, PDFPageLeaf, PDFCatalog } = lib;
  const ctx = doc.context;
  const walk = new Walk(lib, ctx);
  const name = (key: string) => PDFName.of(key);

  // The catalog. A dictionary without /Type /Catalog is still one (pdf.js
  // reads it); anything else is no catalog at all.
  const root = walk.resolve(ctx.trailerInfo.Root);
  if (!(root.obj instanceof lib.PDFDict) || !walk.isDict(root.obj)) {
    return { ok: false, reason: "no-catalog" };
  }
  let catalog = root.obj;
  if (!(catalog instanceof PDFCatalog)) {
    catalog = walk.retype(
      catalog,
      (m, c) => PDFCatalog.fromMapWithContext(m, c),
      (typed) => {
        if (root.ref) ctx.assign(root.ref, typed);
        (doc as unknown as { catalog: PDFDict }).catalog = typed;
      },
      "Catalog",
    );
  }

  // The root of the page tree.
  const pagesRaw = catalog.get(name("Pages"));
  const top = walk.resolve(pagesRaw);
  if (!(top.obj instanceof lib.PDFDict) || !walk.isDict(top.obj)) {
    return { ok: false, reason: "no-page-tree" };
  }
  if (top.ref !== undefined && top.ref !== pagesRaw) {
    catalog.set(name("Pages"), top.ref);
    walk.repaired.add("Pages");
  }
  const kidsOf = (node: PDFDict): PDFArray | undefined => {
    const raw = node.get(name("Kids"));
    const { obj, ref } = walk.resolve(raw);
    if (!(obj instanceof lib.PDFArray)) return undefined;
    if (ref !== undefined && ref !== raw) {
      node.set(name("Kids"), ref);
      walk.repaired.add("Kids");
    }
    return obj;
  };
  let rootNode = top.obj;
  const rootKids = kidsOf(rootNode);
  if (!rootKids || rootNode instanceof PDFPageLeaf) {
    return { ok: false, reason: "no-page-tree" };
  }
  if (!(rootNode instanceof PDFPageTree)) {
    rootNode = walk.retype(
      rootNode,
      (m, c) => PDFPageTree.fromMapWithContext(m, c),
      (typed) =>
        top.ref
          ? ctx.assign(top.ref, typed)
          : catalog.set(name("Pages"), typed),
      "Type",
    );
  }
  if (rootNode.get(name("Parent")) !== undefined) {
    rootNode.delete(name("Parent"));
    walk.repaired.add("Parent");
  }

  const inheritedAt = (
    node: PDFDict,
    from: Frame["inherited"],
  ): Frame["inherited"] => {
    const out = { ...from };
    for (const key of INHERITABLE) {
      const v = node.get(name(key));
      if (v !== undefined) out[key] = v;
    }
    return out;
  };

  walk.settleAttributes(rootNode, false);
  const seenTrees = new Set<PDFDict>([rootNode]);
  const seenLeaves = new Set<PDFDict>();
  const leaves: Leaf[] = [];
  let maxDepth = 1;
  const stack: Frame[] = [
    {
      node: rootNode,
      ref: top.ref,
      kids: rootKids,
      next: 0,
      leaves: 0,
      inherited: inheritedAt(rootNode, {}),
      depth: 1,
    },
  ];
  /** Point `node`'s /Parent at the frame holding it, if it says otherwise. */
  const adopt = (node: PDFDict, parent: Frame) => {
    if (parent.ref === undefined) return;
    if (node.get(name("Parent")) !== parent.ref) {
      node.set(name("Parent"), parent.ref);
      walk.repaired.add("Parent");
    }
  };

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.next >= frame.kids.size()) {
      // Every kid counted: settle this node's /Count, hand the total up.
      stack.pop();
      const count = ctx.lookup(frame.node.get(name("Count")));
      if (!(count instanceof PDFNumber) || count.asNumber() !== frame.leaves) {
        frame.node.set(name("Count"), PDFNumber.of(frame.leaves));
        walk.repaired.add("Count");
      }
      const parent = stack[stack.length - 1];
      if (parent) parent.leaves += frame.leaves;
      continue;
    }
    const index = frame.next;
    frame.next += 1;
    const raw = frame.kids.get(index);
    const { obj, ref } = walk.resolve(raw);
    if (ref !== undefined && ref !== raw) {
      frame.kids.set(index, ref);
      walk.repaired.add("Kids");
    }
    const handle = ref ?? obj;
    const pageNumber = leaves.length + 1;
    if (
      handle === undefined ||
      !(obj instanceof lib.PDFDict) ||
      !walk.isDict(obj)
    ) {
      // A PDFInvalidObject (a page pdf-lib could not parse), a missing
      // object, or something that is not a dictionary: a page is gone.
      return { ok: false, reason: "damaged-page", page: pageNumber };
    }
    const store = (typed: PDFDict) =>
      ref ? ctx.assign(ref, typed) : frame.kids.set(index, typed);
    let node: PDFDict = obj;
    const kids = node instanceof PDFPageLeaf ? undefined : kidsOf(node);
    if (
      node instanceof PDFPageTree ||
      (kids && !(node instanceof PDFPageLeaf))
    ) {
      if (!kids) return { ok: false, reason: "no-page-tree" };
      if (seenTrees.has(node)) return { ok: false, reason: "cycle" };
      if (!(node instanceof PDFPageTree)) {
        node = walk.retype(
          node,
          (m, c) => PDFPageTree.fromMapWithContext(m, c),
          store,
          "Type",
        );
      }
      seenTrees.add(node);
      adopt(node, frame);
      walk.settleAttributes(node, false);
      stack.push({
        node,
        ref,
        kids,
        next: 0,
        leaves: 0,
        inherited: inheritedAt(node, frame.inherited),
        depth: frame.depth + 1,
      });
      maxDepth = Math.max(maxDepth, frame.depth + 1);
      continue;
    }
    if (!(node instanceof PDFPageLeaf)) {
      // pdf.js reads a dictionary with no /Type and no /Kids as a page;
      // anything typed as something else is not one.
      if (node.get(name("Type")) !== undefined) {
        return { ok: false, reason: "damaged-page", page: pageNumber };
      }
      node = walk.retype(
        node,
        (m, c) => PDFPageLeaf.fromMapWithContext(m, c),
        store,
        "Type",
      );
    }
    if (!seenLeaves.has(node)) {
      seenLeaves.add(node);
      adopt(node, frame);
      walk.settleAttributes(node, true);
      if (
        node.get(name("MediaBox")) === undefined &&
        frame.inherited.MediaBox === undefined
      ) {
        node.set(name("MediaBox"), ctx.obj([...DEFAULT_MEDIA_BOX]));
        walk.repaired.add("MediaBox");
      }
    }
    leaves.push({ node, handle: ref ?? node, inherited: frame.inherited });
    frame.leaves += 1;
  }

  if (maxDepth > PAGE_TREE_FLATTEN_DEPTH) {
    // One level: every page a kid of the root, carrying what it inherited.
    const kids = ctx.obj([]) as PDFArray;
    for (const leaf of leaves) {
      for (const key of INHERITABLE) {
        const v = leaf.inherited[key];
        if (leaf.node.get(name(key)) === undefined && v !== undefined) {
          leaf.node.set(name(key), walk.copyable(v));
        }
      }
      if (top.ref) leaf.node.set(name("Parent"), top.ref);
      kids.push(leaf.handle);
    }
    rootNode.set(name("Kids"), kids);
    rootNode.set(name("Count"), PDFNumber.of(leaves.length));
    walk.repaired.add("depth");
  }

  return {
    ok: true,
    pages: leaves.length,
    repaired: [...walk.repaired].sort(),
    depth: maxDepth,
  };
}

/** The typed refusal for a verdict that is not `ok`, in the user's words. */
export function pageTreeError(
  verdict: Extract<PageTreeVerdict, { ok: false }>,
): PdfEngineError {
  const cause = new Error(`page tree: ${verdict.reason}`);
  return verdict.reason === "damaged-page" && verdict.page !== undefined
    ? new PdfEngineError(damagedPageMessage(verdict.page), {
        kind: "unreadable",
        cause,
      })
    : new PdfEngineError(UNREADABLE_PDF_MESSAGE, { kind: "unreadable", cause });
}

/**
 * Settle `doc`'s page tree, or throw the typed refusal. Every pdf-lib loader
 * that hands a document to an engine calls this right after the parse.
 */
export async function assertPageTree(doc: PDFDocument): Promise<void> {
  const verdict = settlePageTree(await loadPdfLib(), doc);
  if (!verdict.ok) throw pageTreeError(verdict);
}
