import type {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFRef,
  PDFString,
} from "pdf-lib";
import {
  BOOKMARK_DEPTH_MAX,
  BOOKMARK_EDIT_MAX,
  BOOKMARK_TITLE_MAX,
} from "./bookmark-labels";
import { countAll, depthOf, type BookmarkNode } from "./bookmark-tree";
import {
  destinationMapper,
  namedDestinations,
  writeOutline,
  type Bookmark,
} from "./document-structure";
import { loadPdf, PdfEngineError, stamp } from "./engine";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";
import { pruneUnreachable } from "./prune-unreachable";

/**
 * Edit PDF Bookmarks — read a PDF's outline into plain data
 * (`bookmark-tree.ts`), and save a copy with an edited one.
 *
 * READ, bounded. The walk keeps a seen-set and stops a sibling or child link
 * that leads back to an item already read (a /Next or /First cycle, a /First
 * naming an ancestor) or out of the outline: such a link is CUT and counted
 * (`cutLinks`). Out of the outline is a PROPERTY, not a type: an object is
 * an item when its /Parent is the node that lists it, or when nothing but the
 * old outline reaches it (`reachedOutside`). Anything else the file uses — a
 * page, its /Resources, the AcroForm, an annotation, the catalog — fails
 * both, so the link to it is cut, the object is not read as a bookmark, and
 * it is never cut at save. A /Type on an item does not stop the walk (pdf.js
 * lists such items too). Nesting deeper than
 * {@link BOOKMARK_DEPTH_MAX} is refused as damaged, and more than
 * {@link BOOKMARK_EDIT_MAX} items is refused with the count: never a
 * truncated list that would then be saved as if it were the whole one. The
 * count itself stops at {@link OUTLINE_WALK_MAX}. `/Count` is read only for
 * its sign (open or closed), never trusted as a size.
 *
 * Targets are classified: a page (an explicit /Dest, an /A GoTo, a named
 * destination resolved through the catalog's /Dests or the /Names tree, or
 * pdf.js's 0-based page-number form), a URL, a viewer action (/Named), or
 * none. A destination that names no page of this file is `none`, kept and
 * counted (`brokenTargets`). An action this tool does not write back —
 * JavaScript, Launch, GoToR, anything chained through /Next — is dropped and
 * counted (`droppedActions`); the ITEM stays, with its children, as a
 * bookmark with no target (a GoTo's own page is kept; only its chain goes).
 *
 * WRITE. Every item is written fresh through `writeOutline` (the writer Merge
 * and Split use): a page target as the source's own view re-made from plain
 * numbers and names (`destinationMapper`), or `[page /Fit]` for a new or
 * moved one; a named destination as a fresh copy of its key; a URL or viewer
 * action re-made from its parts. An unedited title is a copy of the very
 * string the file had (same bytes, any length); a typed one is PDFDocEncoding
 * text when plain ASCII and UTF-16BE otherwise. Nothing original is written
 * verbatim.
 *
 * DELETED MEANS GONE. pdf-lib's `save()` writes every object it parsed, so
 * the old outline items would still be in the file, titles and all, even
 * once nothing pointed at them. Every old item (and the old root) is CUT
 * (`pruneUnreachable`): dropped even when something else — a link, a name
 * tree, a vendor key — still names it. `bookmarks.test.ts` proves it with a
 * reader that parses objects and decodes every stream, object streams
 * included. What is NOT cut: a named destination a deleted item opened
 * through (/Dests, the /Names tree). Links may use it too, and its key is
 * often the heading's own words; the page says so, and `bookmarks.test.ts`
 * holds that sentence to this behaviour.
 *
 * The result is READ BACK from the saved bytes, never the request.
 */

/** The most outline items the walk counts before it stops counting. */
export const OUTLINE_WALK_MAX = 100_000;

export type BookmarksRefusalReason =
  "too-many-bookmarks" | "damaged-outline" | "bad-page" | "title-too-long";

/** A refusal made before anything in the document changed. */
export class BookmarksRefusal extends PdfEngineError {
  readonly reason: BookmarksRefusalReason;
  constructor(reason: BookmarksRefusalReason, message: string) {
    super(message);
    this.name = "BookmarksRefusal";
    this.reason = reason;
  }
}

/** Too many to edit: carries the count found and the limit. */
export class TooManyBookmarksError extends BookmarksRefusal {
  readonly count: number;
  readonly max: number;
  /** The count stopped at {@link OUTLINE_WALK_MAX}: there are at least this many. */
  readonly atLeast: boolean;
  constructor(count: number, atLeast: boolean) {
    super("too-many-bookmarks", tooManyMessage(count, atLeast));
    this.name = "TooManyBookmarksError";
    this.count = count;
    this.max = BOOKMARK_EDIT_MAX;
    this.atLeast = atLeast;
  }
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function tooManyMessage(count: number, atLeast = false): string {
  return `This PDF has ${atLeast ? "more than " : ""}${fmt(count)} bookmarks. This tool edits up to ${fmt(BOOKMARK_EDIT_MAX)}, and it does not save a shortened list.`;
}

export const DAMAGED_OUTLINE_MESSAGE = `This PDF's bookmarks are nested more than ${BOOKMARK_DEPTH_MAX} levels deep, which is damage rather than a real outline, so they can't be edited safely.`;

export function badPageMessage(page: number, pageCount: number): string {
  return `A bookmark points at page ${fmt(page)}, but this PDF has ${fmt(pageCount)} ${pageCount === 1 ? "page" : "pages"}. Choose a page from 1 to ${fmt(pageCount)}.`;
}

export const TITLE_TOO_LONG_MESSAGE = `A bookmark title you typed is longer than ${BOOKMARK_TITLE_MAX} characters. Shorten it and save again.`;

export type PageModeReading = "outlines" | "other" | "none";

export interface OutlineReading {
  items: BookmarkNode[];
  /** Bookmarks at every level. */
  total: number;
  /** Levels of nesting (0 with no bookmarks). */
  depth: number;
  pageCount: number;
  /** Actions not written back (JavaScript, Launch, GoToR, /Next chains). */
  droppedActions: number;
  /** Destinations that name no page of this file; the item is kept with none. */
  brokenTargets: number;
  /** Links that looped back into the outline or led out of it, cut. */
  cutLinks: number;
  /** The catalog's /PageMode, as far as bookmarks care. */
  pageMode: PageModeReading;
}

/** What the writer needs of one item read from the source. */
interface Original {
  title?: PDFString | PDFHexString;
  /** The title as the panel shows it. */
  text: string;
  /** 1-based, when the item opens a page of this file. */
  page?: number;
  /** The explicit destination array, resolved, for its view. */
  dest?: PDFArray;
  /** The destination's key when it went through a NAME. */
  namedKey?: PDFName | PDFString | PDFHexString;
  uri?: PDFString | PDFHexString;
  namedAction?: PDFName;
  color?: number[];
  flags?: number;
}

interface Walk {
  reading: OutlineReading;
  originals: Map<string, Original>;
  /** The old outline's own objects: cut at save, whatever names them. */
  cut: Set<PDFRef>;
}

/** Decoded text; never throws on a malformed string. */
function decode(lib: PdfLibModule, value: PDFObject | undefined): string {
  const { PDFString, PDFHexString } = lib;
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return "";
  let text: string;
  try {
    const bytes = value.asBytes();
    // PDF 2.0 allows UTF-8 text strings, marked by a BOM, and pdf.js reads
    // them; pdf-lib's decodeText knows only the UTF-16 marks.
    text =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
        ? new TextDecoder("utf-8").decode(bytes.subarray(3))
        : value.decodeText();
  } catch {
    try {
      text = String.fromCharCode(...value.asBytes());
    } catch {
      text = "";
    }
  }
  return displayable(text);
}

/**
 * The title as a text field can hold it: lone surrogates (an odd UTF-16
 * byte count, a cut pair) become U+FFFD, and control characters a space.
 */
function displayable(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i += 1;
      } else out += "�";
    } else if (c >= 0xdc00 && c <= 0xdfff) out += "�";
    else if (c < 0x20 || c === 0x7f) out += " ";
    else out += text[i]!;
  }
  return out;
}

function walkOutline(lib: PdfLibModule, doc: PDFDocument): Walk {
  const {
    PDFArray,
    PDFDict,
    PDFName,
    PDFNumber,
    PDFRef,
    PDFString,
    PDFHexString,
  } = lib;
  const ctx = doc.context;
  const name = (n: string) => PDFName.of(n);
  const pageRefs = doc.getPages().map((p) => p.ref);
  const pageIndex = new Map(pageRefs.map((ref, i) => [ref, i]));
  const resolve = namedDestinations(lib, doc);
  const lookup = (o: PDFObject | undefined) =>
    o === undefined ? undefined : ctx.lookup(o);
  const dictAt = (o: PDFObject | undefined) => {
    const v = lookup(o);
    return v instanceof PDFDict ? v : undefined;
  };

  const pageModeName = doc.catalog.get(name("PageMode"));
  const pageMode: PageModeReading =
    pageModeName === undefined
      ? "none"
      : pageModeName === name("UseOutlines")
        ? "outlines"
        : "other";

  const reading: OutlineReading = {
    items: [],
    total: 0,
    depth: 0,
    pageCount: pageRefs.length,
    droppedActions: 0,
    brokenTargets: 0,
    cutLinks: 0,
    pageMode,
  };
  const originals = new Map<string, Original>();
  const cut = new Set<PDFRef>();
  const rootLink = doc.catalog.get(name("Outlines"));
  const root = dictAt(rootLink);
  if (!root) return { reading, originals, cut };

  // Never cut what is not the outline's own: a hostile /First may name a
  // page, the catalog or the page tree.
  const protectedRefs = new Set<PDFRef>(pageRefs);
  const catalogRef = ctx.trailerInfo.Root;
  if (catalogRef instanceof PDFRef) protectedRefs.add(catalogRef);
  const pagesLink = doc.catalog.get(name("Pages"));
  if (pagesLink instanceof PDFRef) protectedRefs.add(pagesLink);
  const infoRef = ctx.trailerInfo.Info;
  if (infoRef instanceof PDFRef) protectedRefs.add(infoRef);

  /**
   * Every object the trailer reaches WITHOUT the catalog's /Outlines: what
   * the rest of the file uses. Built once, and only when a link's target is
   * not plainly an item (a well-formed outline never needs it).
   */
  let outside: Set<PDFRef> | undefined;
  const reachedOutside = (ref: PDFRef): boolean => {
    if (!outside) {
      outside = new Set<PDFRef>();
      const queue: PDFObject[] = [];
      const t = ctx.trailerInfo;
      for (const o of [t.Root, t.Info, t.Encrypt]) if (o) queue.push(o);
      while (queue.length) {
        const o = queue.pop()!;
        if (o instanceof PDFRef) {
          if (outside.has(o)) continue;
          outside.add(o);
          const v = ctx.lookup(o);
          if (v) queue.push(v);
        } else if (o instanceof PDFDict) {
          for (const [k, v] of o.entries()) {
            if (o === doc.catalog && k === name("Outlines")) continue;
            queue.push(v);
          }
        } else if (o instanceof PDFArray) {
          queue.push(...o.asArray());
        } else if (o instanceof lib.PDFStream) {
          queue.push(o.dict);
        }
      }
    }
    return outside.has(ref);
  };

  if (
    rootLink instanceof PDFRef &&
    !protectedRefs.has(rootLink) &&
    !reachedOutside(rootLink)
  ) {
    cut.add(rootLink);
  }

  const seen = new Set<PDFDict>([root, doc.catalog]);
  let counted = 0;
  let tooMany = false;

  /**
   * `dict`, reached through `link` from `parent`, is an outline item: its
   * /Parent says so, or nothing but the old outline reaches it, so cutting it
   * at save cannot take anything the rest of the file uses.
   */
  const isItem = (dict: PDFDict, link: PDFObject, parent: PDFDict) => {
    if (!(link instanceof PDFRef)) return true;
    if (protectedRefs.has(link)) return false;
    if (lookup(dict.get(name("Parent"))) === parent) return true;
    return !reachedOutside(link);
  };

  const pageOfArray = (dest: PDFArray | undefined): number | undefined => {
    if (!dest || dest.size() === 0) return undefined;
    const first = dest.get(0);
    if (first instanceof PDFRef) {
      const i = pageIndex.get(first);
      return i === undefined ? undefined : i + 1;
    }
    const n = lookup(first);
    if (n instanceof PDFNumber) {
      const i = n.asNumber();
      return Number.isInteger(i) && i >= 0 && i < pageRefs.length
        ? i + 1
        : undefined;
    }
    return undefined;
  };

  const classify = (
    item: PDFDict,
    original: Original,
  ): BookmarkNode["target"] => {
    let target: PDFObject | undefined;
    const action = lookup(item.get(name("A")));
    let kind: PDFObject | undefined;
    if (action !== undefined && !(action instanceof PDFDict)) {
      reading.droppedActions += 1;
    }
    if (action instanceof PDFDict) {
      kind = action.get(name("S"));
      if (action.has(name("Next"))) reading.droppedActions += 1;
    }
    if (item.has(name("Dest"))) {
      target = item.get(name("Dest"));
      // Only the /Dest is written back: an /A beside it (a script, a launch,
      // even a GoTo) is not, so it is counted with the rest.
      if (action instanceof PDFDict && !action.has(name("Next"))) {
        reading.droppedActions += 1;
      }
    } else if (action instanceof PDFDict && kind === name("GoTo")) {
      target = action.get(name("D"));
    }
    if (target !== undefined) {
      const key = lookup(target);
      const array = resolve(target);
      const page = pageOfArray(array);
      if (page === undefined) {
        reading.brokenTargets += 1;
        return { kind: "none" };
      }
      original.page = page;
      original.dest = array;
      if (
        key instanceof PDFName ||
        key instanceof PDFString ||
        key instanceof PDFHexString
      ) {
        original.namedKey = key;
      }
      return { kind: "page", page };
    }
    if (action instanceof PDFDict) {
      if (kind === name("URI")) {
        const uri = lookup(action.get(name("URI")));
        if (uri instanceof PDFString || uri instanceof PDFHexString) {
          original.uri = uri;
          return { kind: "uri", uri: decode(lib, uri) };
        }
      } else if (kind === name("Named")) {
        const n = action.get(name("N"));
        if (n instanceof PDFName) {
          original.namedAction = n;
          return { kind: "named", action: n.decodeText() };
        }
      }
      // JavaScript, Launch, GoToR, a broken URI or Named: not written back.
      reading.droppedActions += 1;
    }
    return { kind: "none" };
  };

  const readOne = (item: PDFDict, depth: number): BookmarkNode => {
    const id = `b${counted - 1}`;
    const rawTitle = lookup(item.get(name("Title")));
    const original: Original = { text: decode(lib, rawTitle) };
    if (rawTitle instanceof PDFString || rawTitle instanceof PDFHexString) {
      original.title = rawTitle;
    }
    const target = classify(item, original);
    const color = lookup(item.get(name("C")));
    if (color instanceof PDFArray && color.size() === 3) {
      const rgb = color
        .asArray()
        .map((c) => lookup(c))
        .map((c) => (c instanceof PDFNumber ? c.asNumber() : NaN));
      if (rgb.every(Number.isFinite)) original.color = rgb;
    }
    const flags = lookup(item.get(name("F")));
    if (flags instanceof PDFNumber) original.flags = flags.asNumber();
    if (!tooMany) originals.set(id, original);
    const count = lookup(item.get(name("Count")));
    const children = readSiblings(item.get(name("First")), depth + 1, item);
    return {
      id,
      title: original.text,
      target,
      open:
        children.length > 0 &&
        count instanceof PDFNumber &&
        count.asNumber() > 0,
      children,
    };
  };

  const readSiblings = (
    first: PDFObject | undefined,
    depth: number,
    parent: PDFDict,
  ): BookmarkNode[] => {
    const items: BookmarkNode[] = [];
    let link = first;
    while (link !== undefined) {
      const current = lookup(link);
      if (current === undefined || current === lib.PDFNull) break;
      if (
        !(current instanceof PDFDict) ||
        seen.has(current) ||
        !isItem(current, link, parent)
      ) {
        reading.cutLinks += 1;
        break;
      }
      if (depth > BOOKMARK_DEPTH_MAX) {
        throw new BookmarksRefusal("damaged-outline", DAMAGED_OUTLINE_MESSAGE);
      }
      if (counted >= OUTLINE_WALK_MAX) {
        throw new TooManyBookmarksError(counted, true);
      }
      seen.add(current);
      counted += 1;
      if (counted > BOOKMARK_EDIT_MAX) tooMany = true;
      if (link instanceof PDFRef) cut.add(link);
      const node = readOne(current, depth);
      if (!tooMany) items.push(node);
      link = current.get(name("Next"));
    }
    return items;
  };

  const items = readSiblings(root.get(name("First")), 1, root);
  if (tooMany) throw new TooManyBookmarksError(counted, false);
  reading.items = items;
  reading.total = countAll(items);
  reading.depth = depthOf(items);
  return { reading, originals, cut };
}

/** Read the outline of an open document. */
export function readOutlineDoc(
  lib: PdfLibModule,
  doc: PDFDocument,
): OutlineReading {
  return walkOutline(lib, doc).reading;
}

/** Read a PDF's outline. */
export async function readOutlineTree(
  bytes: Uint8Array,
): Promise<OutlineReading> {
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  return readOutlineDoc(lib, doc);
}

export interface BookmarkEdit {
  items: readonly BookmarkNode[];
  /** `/PageMode /UseOutlines` when there are bookmarks to show. */
  showPanel: boolean;
}

export interface BookmarksResult {
  bytes: Uint8Array;
  /** The saved copy's outline, read back from its bytes. */
  saved: OutlineReading;
  /** Actions in the source that the copy does not carry. */
  droppedActions: number;
}

/** A title typed in the panel, as a PDF string. */
function encodeTitle(lib: PdfLibModule, text: string) {
  const { PDFString, PDFHexString } = lib;
  // PDFString writes its value between parentheses as given, so only text
  // with nothing to escape goes that way; the rest is UTF-16BE hex.
  return /^[\x20-\x27\x2a-\x5b\x5d-\x7e]*$/.test(text)
    ? PDFString.of(text)
    : PDFHexString.fromText(text);
}

/** Every refusal the edit itself earns, before the document is touched. */
function checkEdit(
  items: readonly BookmarkNode[],
  originals: Map<string, Original>,
  pageCount: number,
): void {
  const total = countAll(items);
  if (total > BOOKMARK_EDIT_MAX) throw new TooManyBookmarksError(total, false);
  if (depthOf(items) > BOOKMARK_DEPTH_MAX) {
    throw new BookmarksRefusal("damaged-outline", DAMAGED_OUTLINE_MESSAGE);
  }
  const visit = (list: readonly BookmarkNode[]) => {
    for (const node of list) {
      const original = originals.get(node.id);
      if (
        (!original || original.text !== node.title) &&
        [...node.title].length > BOOKMARK_TITLE_MAX
      ) {
        throw new BookmarksRefusal("title-too-long", TITLE_TOO_LONG_MESSAGE);
      }
      if (node.target.kind === "page") {
        const { page } = node.target;
        if (!Number.isInteger(page) || page < 1 || page > pageCount) {
          throw new BookmarksRefusal(
            "bad-page",
            badPageMessage(page, pageCount),
          );
        }
      }
      visit(node.children);
    }
  };
  visit(items);
}

/**
 * Save a copy of `bytes` whose outline is `edit.items`. Every refusal is
 * thrown before the document is changed.
 */
export async function writePdfBookmarks(
  bytes: Uint8Array,
  edit: BookmarkEdit,
): Promise<BookmarksResult> {
  const lib = await loadPdfLib();
  const { PDFName, PDFNumber } = lib;
  const doc = await loadPdf(bytes);
  const ctx = doc.context;
  const { reading, originals, cut } = walkOutline(lib, doc);
  const pageRefs = doc.getPages().map((p) => p.ref);
  checkEdit(edit.items, originals, pageRefs.length);

  const identity = new Map(pageRefs.map((ref) => [ref, ref]));
  const remap = destinationMapper(lib, doc, doc, identity);

  const build = (node: BookmarkNode): Bookmark => {
    const original = originals.get(node.id);
    const title =
      original?.title && original.text === node.title
        ? original.title.clone()
        : encodeTitle(lib, node.title);
    const out: Bookmark = {
      title,
      open: node.open && node.children.length > 0,
      children: node.children.map(build),
    };
    const target = node.target;
    if (target.kind === "page") {
      const unmoved = original?.page === target.page;
      if (unmoved && original?.namedKey) {
        out.namedDest = original.namedKey.clone();
      } else {
        const mapped = unmoved ? remap(original!.dest) : undefined;
        out.dest =
          mapped?.kind === "kept"
            ? mapped.array
            : ctx.obj([pageRefs[target.page - 1]!, PDFName.of("Fit")]);
      }
    } else if (target.kind === "uri" && original?.uri) {
      out.action = ctx.obj({ S: "URI", URI: original.uri.clone() });
    } else if (target.kind === "named" && original?.namedAction) {
      out.action = ctx.obj({ S: "Named", N: original.namedAction });
    }
    if (original?.color) out.color = ctx.obj(original.color);
    if (original?.flags !== undefined) {
      out.flags = PDFNumber.of(original.flags);
    }
    return out;
  };

  const top = edit.items.map(build);
  doc.catalog.delete(PDFName.of("Outlines"));
  const written = writeOutline(lib, doc, top);
  const useOutlines = PDFName.of("UseOutlines");
  const mode = doc.catalog.get(PDFName.of("PageMode"));
  if (written && edit.showPanel) {
    doc.catalog.set(PDFName.of("PageMode"), useOutlines);
  } else if (mode === useOutlines) {
    doc.catalog.delete(PDFName.of("PageMode"));
  }

  pruneUnreachable(lib, doc, cut);
  stamp(doc);
  const out = await doc.save({ updateFieldAppearances: false });
  const saved = readOutlineDoc(lib, await loadPdf(out));
  return { bytes: out, saved, droppedActions: reading.droppedActions };
}
