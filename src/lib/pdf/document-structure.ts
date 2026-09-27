import type {
  PDFArray as PDFArrayT,
  PDFContext,
  PDFDict as PDFDictT,
  PDFDocument,
  PDFObject,
  PDFRef as PDFRefT,
} from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * The document-level structure a subset of pages still needs, rebuilt in the
 * output from its parts: bookmarks, page labels, the document's metadata and
 * language, and links that go through a NAMED destination.
 *
 * `assemblePages` builds a fresh document and treats the source catalog and
 * everything it names as foreign (a copy of the catalog carries every page's
 * field values, the embedded files and the XMP stream). So none of this came
 * across: measured at 74b8c4a, Remove Pages on a bookmarked, page-labelled
 * handbook returned no bookmarks, no page labels, no author, subject,
 * keywords or language, and its table-of-contents links — hyperref and
 * Chrome's "Save as PDF" write them through named destinations — pointed at
 * names the output no longer defined. Nothing here COPIES a source object:
 * every piece is read from the source and written fresh, so the leak rules of
 * `page-copy.ts` are untouched. A bookmark whose page was dropped is not
 * written at all, so its title cannot ship (the tests read the file for it).
 *
 * Deliberately NOT carried: custom `/Info` keys, the XMP `/Metadata` stream
 * (it describes the whole source and would need rewriting, not copying), the
 * structure tree of a tagged PDF, embedded files, and document JavaScript.
 */

/** Source page ref -> output page ref, for the pages the output kept. */
export type PageMap = Map<PDFRefT, PDFRefT>;

const MAX_DEPTH = 64;
const MAX_NODES = 100_000;

/** Decoded text of a string or name, or `undefined` for anything else. */
function textOf(lib: PdfLibModule, value: PDFObject | undefined) {
  const { PDFString, PDFHexString, PDFName } = lib;
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  if (value instanceof PDFName) return value.decodeText();
  return undefined;
}

/**
 * The source's named destinations: the catalog `/Dests` dictionary (keyed by
 * NAME, PDF 1.1) and the `/Names` `/Dests` name tree (keyed by STRING). Built
 * on first use; a destination value may be an array or a dictionary whose
 * `/D` is one.
 */
export function namedDestinations(lib: PdfLibModule, src: PDFDocument) {
  // One per source: split asks once per part, and the source never changes.
  const cached = resolvers.get(src);
  if (cached) return cached;
  const resolver = buildResolver(lib, src);
  resolvers.set(src, resolver);
  return resolver;
}

const resolvers = new WeakMap<
  PDFDocument,
  (dest: PDFObject | undefined) => PDFArrayT | undefined
>();

function buildResolver(lib: PdfLibModule, src: PDFDocument) {
  const { PDFDict, PDFArray, PDFName, PDFString, PDFHexString } = lib;
  let byName: Map<string, PDFObject> | undefined;
  let byString: Map<string, PDFObject> | undefined;
  const build = () => {
    byName = new Map();
    byString = new Map();
    const context = src.context;
    const dests = src.catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
    for (const [key, value] of dests?.entries() ?? []) {
      byName.set(key.decodeText(), value);
    }
    const names = src.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    const root = names?.lookupMaybe(PDFName.of("Dests"), PDFDict);
    const seen = new Set<PDFObject>();
    const walk = (node: PDFObject | undefined, depth: number) => {
      const dict = node === undefined ? undefined : context.lookup(node);
      if (!(dict instanceof PDFDict) || depth > MAX_DEPTH || seen.has(dict)) {
        return;
      }
      seen.add(dict);
      const pairs = dict.lookupMaybe(PDFName.of("Names"), PDFArray);
      for (let i = 0; pairs && i + 1 < pairs.size(); i += 2) {
        const key = context.lookup(pairs.get(i));
        if (key instanceof PDFString || key instanceof PDFHexString) {
          byString!.set(key.decodeText(), pairs.get(i + 1));
        }
        if (byString!.size > MAX_NODES) return;
      }
      const kids = dict.lookupMaybe(PDFName.of("Kids"), PDFArray);
      kids?.asArray().forEach((kid) => walk(kid, depth + 1));
    };
    walk(root, 0);
  };
  /** The explicit destination array `dest` means, in the source. */
  return (dest: PDFObject | undefined): PDFArrayT | undefined => {
    const context = src.context;
    let value = dest === undefined ? undefined : context.lookup(dest);
    if (!(value instanceof PDFArray)) {
      const key = textOf(lib, value);
      if (key === undefined) return undefined;
      if (!byName) build();
      // A name is looked up in /Dests and a string in the name tree, as the
      // spec says; each falls back to the other, as viewers do.
      const [first, second] =
        value instanceof PDFName ? [byName!, byString!] : [byString!, byName!];
      value = context.lookup(first.get(key) ?? second.get(key));
    }
    if (value instanceof PDFDict) {
      value = context.lookup(value.get(PDFName.of("D")));
    }
    return value instanceof PDFArray ? value : undefined;
  };
}

export type DestinationResolver = ReturnType<typeof namedDestinations>;

/** Where an explicit source destination goes in the output. */
export type MappedDestination =
  | { kind: "kept"; array: PDFArrayT }
  | { kind: "dropped" }
  | { kind: "unknown" };

/**
 * Map explicit source destinations into the output: `kept` with the output's
 * own array (its page is the kept page's copy), `dropped` when the page it
 * names was not kept, `unknown` when it names no page of this source at all.
 * Nothing is copied: the page becomes the output's ref, and the view
 * parameters are re-made as plain numbers and names.
 */
export function destinationMapper(
  lib: PdfLibModule,
  src: PDFDocument,
  out: PDFDocument,
  pageMap: PageMap,
) {
  const { PDFRef, PDFNumber, PDFName, PDFNull } = lib;
  const pages = src.getPages().map((page) => page.ref);
  const isPage = new Set(pages);
  return (dest: PDFArrayT | undefined): MappedDestination => {
    if (!dest || dest.size() === 0) return { kind: "unknown" };
    let target = src.context.lookup(dest.get(0));
    // pdfjs, and so many viewers, also take a 0-based page NUMBER here.
    if (target instanceof PDFNumber) {
      const page = pages[target.asNumber()];
      if (!page) return { kind: "unknown" };
      target = page;
    } else target = dest.get(0);
    if (!(target instanceof PDFRef)) return { kind: "unknown" };
    const mapped = pageMap.get(target);
    if (!mapped) {
      return isPage.has(target) ? { kind: "dropped" } : { kind: "unknown" };
    }
    const view = dest
      .asArray()
      .slice(1)
      .map((value) => {
        const resolved = src.context.lookup(value);
        if (resolved instanceof PDFNumber) {
          return PDFNumber.of(resolved.asNumber());
        }
        return resolved instanceof PDFName ? resolved : PDFNull;
      });
    return { kind: "kept", array: out.context.obj([mapped, ...view]) };
  };
}

export type DestinationMapper = ReturnType<typeof destinationMapper>;

/**
 * Rewrite links on the pages copied from `src` that go through a NAMED
 * destination into explicit ones. The output has no name tree, so a named
 * link is dead in it: pointed at the kept page's copy when its page was kept,
 * and at `sentinel` when it was not, so the assembler's repair removes it.
 */
export function resolveNamedLinks(
  lib: PdfLibModule,
  out: PDFDocument,
  resolve: DestinationResolver,
  map: DestinationMapper,
  sentinel: PDFRefT,
  outPageRefs: PDFRefT[],
): void {
  const { PDFName, PDFArray, PDFDict } = lib;
  const context = out.context;
  /** The replacement for a named `dest`, or `undefined` to leave it be. */
  const rewrite = (dest: PDFObject | undefined): PDFObject | undefined => {
    const value = dest === undefined ? undefined : context.lookup(dest);
    if (value === undefined || value instanceof PDFArray) return undefined;
    if (textOf(lib, value) === undefined) return undefined;
    const mapped = map(resolve(value));
    if (mapped.kind === "kept") return mapped.array;
    if (mapped.kind === "dropped") return context.obj([sentinel]);
    return undefined;
  };
  const fixAction = (action: PDFObject | undefined, depth = 0) => {
    const dict = action === undefined ? undefined : context.lookup(action);
    if (dict instanceof PDFArray) {
      dict.asArray().forEach((a) => fixAction(a, depth + 1));
      return;
    }
    if (!(dict instanceof PDFDict) || depth > 32) return;
    if (dict.get(PDFName.of("S")) === PDFName.of("GoTo")) {
      const next = rewrite(dict.get(PDFName.of("D")));
      if (next) dict.set(PDFName.of("D"), next);
    }
    fixAction(dict.get(PDFName.of("Next")), depth + 1);
  };
  for (const pageRef of outPageRefs) {
    const page = context.lookup(pageRef, PDFDict);
    const annots = page.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (const entry of annots?.asArray() ?? []) {
      const annot = context.lookup(entry);
      if (!(annot instanceof PDFDict)) continue;
      const next = rewrite(annot.get(PDFName.of("Dest")));
      if (next) annot.set(PDFName.of("Dest"), next);
      fixAction(annot.get(PDFName.of("A")));
    }
  }
}

/** The `/Info` entries a reader shows, carried as the source wrote them. */
const INFO_KEYS = ["Title", "Author", "Subject", "Keywords"];

/**
 * Carry the document's title, author, subject and keywords, its `/Lang`, its
 * bookmarks (pruned to the kept pages) and its page labels (each kept page
 * keeps its own).
 */
export function carryDocumentStructure(
  lib: PdfLibModule,
  src: PDFDocument,
  out: PDFDocument,
  keptIndices: number[],
  resolve: DestinationResolver,
  map: DestinationMapper,
): void {
  const { PDFDict, PDFName, PDFString, PDFHexString } = lib;
  const text = (value: PDFObject | undefined) => {
    const resolved =
      value === undefined ? undefined : src.context.lookup(value);
    return resolved instanceof PDFString || resolved instanceof PDFHexString
      ? resolved.clone()
      : undefined;
  };
  // Read, never created: pdf-lib's getInfoDict() adds one to a source that
  // has none.
  const info = src.context.lookup(src.context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    let outInfo = out.context.lookup(out.context.trailerInfo.Info);
    if (!(outInfo instanceof PDFDict)) {
      outInfo = out.context.obj({});
      out.context.trailerInfo.Info = out.context.register(outInfo);
    }
    for (const key of INFO_KEYS) {
      const value = text(info.get(PDFName.of(key)));
      if (value) (outInfo as PDFDictT).set(PDFName.of(key), value);
    }
  }
  const lang = text(src.catalog.get(PDFName.of("Lang")));
  if (lang) out.catalog.set(PDFName.of("Lang"), lang);

  const wroteOutline = carryOutline(lib, src, out, resolve, map);
  const mode = src.catalog.get(PDFName.of("PageMode"));
  if (wroteOutline && mode === PDFName.of("UseOutlines")) {
    out.catalog.set(PDFName.of("PageMode"), mode);
  }
  carryPageLabels(lib, src, out, keptIndices);
}

// --------------------------------------------------------------------------
// Bookmarks
// --------------------------------------------------------------------------

interface Bookmark {
  title: PDFObject;
  dest?: PDFArrayT;
  action?: PDFDictT;
  color?: PDFArrayT;
  flags?: PDFObject;
  open: boolean;
  children: Bookmark[];
}

/**
 * Rebuild the outline with only the bookmarks that still go somewhere: to a
 * kept page, to a URL, or to a named viewer action (next page, print) — or
 * that hold such a bookmark below them. A bookmark whose own page was dropped
 * but whose children survive opens its first surviving child's page. Anything
 * else — a bookmark to a dropped page, JavaScript, a launch — is not written,
 * so its title does not ship. Returns whether an outline was written.
 */
function carryOutline(
  lib: PdfLibModule,
  src: PDFDocument,
  out: PDFDocument,
  resolve: DestinationResolver,
  map: DestinationMapper,
): boolean {
  const { PDFDict, PDFName, PDFArray, PDFNumber, PDFString, PDFHexString } =
    lib;
  const context = src.context;
  const root = src.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!root) return false;
  const seen = new Set<PDFObject>();
  let budget = MAX_NODES;

  const readOne = (item: PDFDictT, depth: number): Bookmark | undefined => {
    const children =
      depth < MAX_DEPTH
        ? readSiblings(item.get(PDFName.of("First")), depth + 1)
        : [];
    const action = item.lookupMaybe(PDFName.of("A"), PDFDict);
    const kind = action?.get(PDFName.of("S"));
    let target: PDFObject | undefined;
    if (item.has(PDFName.of("Dest"))) target = item.get(PDFName.of("Dest"));
    else if (kind === PDFName.of("GoTo")) target = action!.get(PDFName.of("D"));
    let dest: PDFArrayT | undefined;
    let ownPageDropped = false;
    if (target !== undefined) {
      const mapped = map(resolve(target));
      if (mapped.kind === "kept") dest = mapped.array;
      ownPageDropped = mapped.kind === "dropped";
    }
    let carried: PDFDictT | undefined;
    if (!dest && action && kind === PDFName.of("URI")) {
      const uri = context.lookup(action.get(PDFName.of("URI")));
      if (uri instanceof PDFString || uri instanceof PDFHexString) {
        carried = out.context.obj({ S: "URI", URI: uri.clone() });
      }
    } else if (!dest && action && kind === PDFName.of("Named")) {
      const name = action.get(PDFName.of("N"));
      if (name instanceof PDFName) {
        carried = out.context.obj({ S: "Named", N: name });
      }
    }
    if (!dest && !carried && children.length === 0) return undefined;
    if (!dest && ownPageDropped) dest = firstDestination(children);

    const title = context.lookup(item.get(PDFName.of("Title")));
    const flags = context.lookup(item.get(PDFName.of("F")));
    const count = context.lookup(item.get(PDFName.of("Count")));
    return {
      title:
        title instanceof PDFString || title instanceof PDFHexString
          ? title.clone()
          : PDFString.of(""),
      dest,
      action: carried,
      color: colorOf(item.lookupMaybe(PDFName.of("C"), PDFArray)),
      flags:
        flags instanceof PDFNumber ? PDFNumber.of(flags.asNumber()) : undefined,
      open: count instanceof PDFNumber && count.asNumber() > 0,
      children,
    };
  };

  const readSiblings = (first: PDFObject | undefined, depth: number) => {
    const items: Bookmark[] = [];
    let current = first === undefined ? undefined : context.lookup(first);
    while (current instanceof PDFDict && !seen.has(current) && budget-- > 0) {
      seen.add(current);
      const item = readOne(current, depth);
      if (item) items.push(item);
      const next = current.get(PDFName.of("Next"));
      current = next === undefined ? undefined : context.lookup(next);
    }
    return items;
  };

  /** An RGB colour, re-made as three plain numbers. */
  const colorOf = (color: PDFArrayT | undefined) => {
    const parts = color?.asArray().map((c) => context.lookup(c));
    if (!parts || parts.length !== 3) return undefined;
    const rgb = parts.map((c) => (c instanceof PDFNumber ? c.asNumber() : NaN));
    return rgb.every(Number.isFinite) ? out.context.obj(rgb) : undefined;
  };

  const top = readSiblings(root.get(PDFName.of("First")), 0);
  if (top.length === 0) return false;

  const ctx = out.context;
  /** Items shown when `items`' parent is open (spec: `/Count`). */
  const visible = (items: Bookmark[]): number =>
    items.reduce(
      (n, item) => n + 1 + (item.open ? visible(item.children) : 0),
      0,
    );
  const write = (items: Bookmark[], parent: PDFRefT): PDFRefT[] => {
    const refs = items.map(() => ctx.nextRef());
    items.forEach((item, i) => {
      const dict = ctx.obj({}) as PDFDictT;
      dict.set(PDFName.of("Title"), item.title);
      dict.set(PDFName.of("Parent"), parent);
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]!);
      if (i < items.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]!);
      if (item.children.length > 0) {
        const kids = write(item.children, refs[i]!);
        dict.set(PDFName.of("First"), kids[0]!);
        dict.set(PDFName.of("Last"), kids[kids.length - 1]!);
        const shown = visible(item.children);
        dict.set(PDFName.of("Count"), ctx.obj(item.open ? shown : -shown));
      }
      if (item.dest) dict.set(PDFName.of("Dest"), item.dest);
      else if (item.action) dict.set(PDFName.of("A"), item.action);
      if (item.color) dict.set(PDFName.of("C"), item.color);
      if (item.flags) dict.set(PDFName.of("F"), item.flags);
      ctx.assign(refs[i]!, dict);
    });
    return refs;
  };
  const rootRef = ctx.nextRef();
  const refs = write(top, rootRef);
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: refs[0]!,
      Last: refs[refs.length - 1]!,
      Count: visible(top),
    }),
  );
  out.catalog.set(PDFName.of("Outlines"), rootRef);
  return true;
}

function firstDestination(items: Bookmark[]): PDFArrayT | undefined {
  for (const item of items) {
    const dest = item.dest ?? firstDestination(item.children);
    if (dest) return dest;
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Page labels
// --------------------------------------------------------------------------

/** One page's label, as its parts: style, prefix, and number. */
interface PageLabel {
  style?: PDFObject;
  prefix?: PDFObject;
  prefixText?: string;
  value: number;
}

const LABEL_STYLES = ["D", "R", "r", "A", "a"];

/**
 * Give every kept page the label it had in the source — "iii" stays "iii",
 * not the label of whatever page now sits at that position — and write the
 * fewest ranges that say so: a new range wherever the style or prefix changes
 * or the numbers stop running on.
 */
function carryPageLabels(
  lib: PdfLibModule,
  src: PDFDocument,
  out: PDFDocument,
  keptIndices: number[],
): void {
  const { PDFDict, PDFArray, PDFName, PDFNumber, PDFString, PDFHexString } =
    lib;
  const context: PDFContext = src.context;
  const tree = src.catalog.lookupMaybe(PDFName.of("PageLabels"), PDFDict);
  if (!tree) return;
  const ranges: { start: number; dict: PDFDictT }[] = [];
  const seen = new Set<PDFObject>();
  const walk = (node: PDFObject | undefined, depth: number) => {
    const dict = node === undefined ? undefined : context.lookup(node);
    if (!(dict instanceof PDFDict) || depth > MAX_DEPTH || seen.has(dict)) {
      return;
    }
    seen.add(dict);
    const nums = dict.lookupMaybe(PDFName.of("Nums"), PDFArray);
    for (let i = 0; nums && i + 1 < nums.size(); i += 2) {
      const key = context.lookup(nums.get(i));
      const value = context.lookup(nums.get(i + 1));
      if (
        key instanceof PDFNumber &&
        Number.isInteger(key.asNumber()) &&
        key.asNumber() >= 0 &&
        value instanceof PDFDict
      ) {
        ranges.push({ start: key.asNumber(), dict: value });
      }
    }
    const kids = dict.lookupMaybe(PDFName.of("Kids"), PDFArray);
    kids?.asArray().forEach((kid) => walk(kid, depth + 1));
  };
  walk(tree, 0);
  if (ranges.length === 0) return;
  ranges.sort((a, b) => a.start - b.start);

  const labelOf = (index: number): PageLabel => {
    let range: (typeof ranges)[number] | undefined;
    for (const candidate of ranges) {
      if (candidate.start > index) break;
      range = candidate;
    }
    // Before the first range (the spec says it starts at 0; not every writer
    // does), a viewer shows no label: pdfjs gives "".
    if (!range) return { value: index + 1 };
    const style = range.dict.get(PDFName.of("S"));
    const prefix = context.lookup(range.dict.get(PDFName.of("P")));
    const start = context.lookup(range.dict.get(PDFName.of("St")));
    const first =
      start instanceof PDFNumber &&
      Number.isInteger(start.asNumber()) &&
      start.asNumber() >= 1
        ? start.asNumber()
        : 1;
    const hasPrefix =
      prefix instanceof PDFString || prefix instanceof PDFHexString;
    return {
      style:
        style instanceof PDFName && LABEL_STYLES.includes(style.decodeText())
          ? style
          : undefined,
      prefix: hasPrefix ? prefix.clone() : undefined,
      prefixText: hasPrefix ? prefix.decodeText() : undefined,
      value: first + (index - range.start),
    };
  };

  const nums: PDFObject[] = [];
  let previous: PageLabel | undefined;
  keptIndices.forEach((sourceIndex, outIndex) => {
    const label = labelOf(sourceIndex);
    const runsOn =
      previous !== undefined &&
      previous.style === label.style &&
      previous.prefixText === label.prefixText &&
      (label.style === undefined || label.value === previous.value + 1);
    if (!runsOn) {
      const dict = out.context.obj({}) as PDFDictT;
      if (label.style) dict.set(PDFName.of("S"), label.style);
      if (label.prefix) dict.set(PDFName.of("P"), label.prefix);
      if (label.style && label.value !== 1) {
        dict.set(PDFName.of("St"), PDFNumber.of(label.value));
      }
      nums.push(PDFNumber.of(outIndex), dict);
    }
    previous = label;
  });
  out.catalog.set(
    PDFName.of("PageLabels"),
    out.context.obj({ Nums: out.context.obj(nums) }),
  );
}
