/**
 * Which image pixels each PAGE paints, for the pdf.js preflight's per-page
 * image budget (`RASTER_MAX_PAGE_IMAGE_PIXELS` in ./pdfjs-guard), and where a
 * page paints the images a preview skips (Auto-crop's placements).
 *
 * WHY A PAGE, AND WHY WHAT IT PAINTS. The raster budget is per image, so ten
 * images of 49 MP on one page each passed it and the editor drew the page for
 * 106 s (hostile review, PR #306). Summing over the FILE would refuse every
 * long scan (300 pages of one 9 MP image each is 2.7 GP and normal). Summing
 * over a page's RESOURCES over-counts: many writers share one /Resources
 * dictionary listing every image of every page, while each page draws one.
 * So a page's figure is what its content actually paints: every `Do` of an
 * image XObject (through Form XObjects, recursively, with a bound) and every
 * inline image, resolved through the page's inherited /Resources, its
 * /Contents (one stream, or an array pdf.js reads joined), objects held in
 * object streams, and content shared between pages.
 *
 * Everything here is an UPPER bound on what pdf.js decodes for one page:
 *
 *  - an object defined more than once (incremental updates; a cross-reference
 *    may point at any of the definitions) is read in EVERY definition, and a
 *    page counts the largest result;
 *  - an image painted twice on one page counts once: pdf.js keeps each image
 *    it decoded for the page by its reference (`_regionalImageCache`) and
 *    paints it again from there (measured: see pdfjs-guard's budget);
 *    an inline image counts every time its content is read;
 *  - images a page MAY paint without a `Do` in its content — tiling patterns,
 *    Type3 glyphs, soft-mask groups, annotation appearances — count whether
 *    or not the page uses them (their placement is then not known);
 *  - a content stream that cannot be read (a filter the scan does not decode,
 *    alternatives past {@link MAX_CONTENT_ALTERNATIVES}, forms nested past
 *    {@link MAX_FORM_DEPTH}) counts EVERY image its resources can reach.
 *
 * When the mapping itself cannot be completed (a work bound passed, an
 * object stream the scan cannot decode), it says so (`incomplete`) and the
 * caller treats every page as over budget: fail safe, never open.
 *
 * pdf.js internals this mirrors (pdfjs-dist 6.2.108): a page's /Resources are
 * inherited through /Parent (`getInheritableProperty`), a page is any /Kids
 * entry with /Type /Page or no /Kids (`Catalog.getPageDict`), a form without
 * /Resources paints with its caller's, and a form already on the painting
 * path is not painted again.
 *
 * Its own module, reached only through ./pdfjs-guard (loaded with `import()`):
 * nothing here may reach a first-load bundle. The scanner's own pieces (its
 * stream decoder, its pdf.js-faithful content lexer, its image sizing) are
 * handed in as {@link PageScanTools}, so this module imports none of the
 * guard and the guard's chunk stays one chunk.
 */
import {
  ascii,
  indexOfWord,
  isDelimiter,
  isWhite,
  matchesAt,
} from "./pdf-scan-bytes";
import { findObjectHeaders, skipForward } from "./pdf-scan-objects";

/* ------------------------------------------------------------------ *
 *  Values
 * ------------------------------------------------------------------ */

class PdfName {
  constructor(readonly name: string) {}
}
class PdfRef {
  constructor(readonly num: number) {}
}
class PdfDict {
  readonly map = new Map<string, PdfValue>();
  /** Where `<<` starts and `>>` ends (exclusive), in its source. */
  constructor(
    readonly start: number,
    public end: number,
  ) {}
  get(key: string): PdfValue | undefined {
    return this.map.get(key);
  }
}
const OTHER = Symbol("other");
type PdfValue =
  | number
  | PdfName
  | PdfRef
  | PdfDict
  | PdfValue[]
  | typeof OTHER;

/** Thrown when a work bound passes: the mapping is incomplete. */
class Incomplete extends Error {}

/** Containers nested deeper than this end the mapping (pdf.js nests far less). */
const MAX_VALUE_DEPTH = 64;

const STREAM = ascii("stream");
const ENDSTREAM = ascii("endstream");
const latin1 = new TextDecoder("latin1");

const decodeName = (raw: string): string =>
  raw.includes("#")
    ? raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) =>
        String.fromCharCode(parseInt(h, 16)),
      )
    : raw;

/** Work charged by the parser, in bytes read; past `max`, Incomplete. */
interface Budget {
  used: number;
  max: number;
}

type Token =
  | { t: "num"; v: number; int: boolean }
  | { t: "name"; v: string }
  | { t: "kw"; v: string }
  | { t: "open"; v: "<<" | "[" }
  | { t: "close"; v: ">>" | "]" }
  | { t: "other" }
  | { t: "eof" };

/** A pdf.js-shaped object parser over one source (the file, or a decoded object stream). */
class Parser {
  pos: number;
  constructor(
    private readonly src: Uint8Array,
    at: number,
    private readonly budget: Budget,
  ) {
    this.pos = at;
  }

  private charge(from: number): void {
    this.budget.used += this.pos - from;
    if (this.budget.used > this.budget.max) throw new Incomplete("parse work");
  }

  next(): Token {
    const { src } = this;
    const from = this.pos;
    let i = skipForward(src, this.pos);
    if (i >= src.length) {
      this.pos = i;
      return { t: "eof" };
    }
    const b = src[i]!;
    let tok: Token;
    if (b === 0x3c && src[i + 1] === 0x3c) {
      i += 2;
      tok = { t: "open", v: "<<" };
    } else if (b === 0x3e && src[i + 1] === 0x3e) {
      i += 2;
      tok = { t: "close", v: ">>" };
    } else if (b === 0x5b) {
      i += 1;
      tok = { t: "open", v: "[" };
    } else if (b === 0x5d) {
      i += 1;
      tok = { t: "close", v: "]" };
    } else if (b === 0x28) {
      // A literal string: nested parentheses, backslash escapes.
      let depth = 0;
      for (; i < src.length; i += 1) {
        const c = src[i]!;
        if (c === 0x5c) i += 1;
        else if (c === 0x28) depth += 1;
        else if (c === 0x29 && --depth === 0) {
          i += 1;
          break;
        }
      }
      tok = { t: "other" };
    } else if (b === 0x3c) {
      const close = src.indexOf(0x3e, i + 1);
      i = close === -1 ? src.length : close + 1;
      tok = { t: "other" };
    } else if (b === 0x2f) {
      let j = i + 1;
      while (j < src.length && !isWhite(src[j]!) && !isDelimiter(src[j]!)) {
        j += 1;
      }
      tok = { t: "name", v: decodeName(latin1.decode(src.subarray(i + 1, j))) };
      i = j;
    } else if (isDelimiter(b)) {
      // `)`, `>`, `{`, `}`: pdf.js skips or errors; one byte, no value.
      i += 1;
      tok = { t: "other" };
    } else {
      let j = i;
      while (j < src.length && !isWhite(src[j]!) && !isDelimiter(src[j]!)) {
        j += 1;
      }
      const word = latin1.decode(src.subarray(i, j));
      i = j;
      tok = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)
        ? { t: "num", v: Number(word), int: /^\d+$/.test(word) }
        : { t: "kw", v: word };
    }
    this.pos = i;
    this.charge(from);
    return tok;
  }

  /** The value whose first token is `tok`. */
  value(tok: Token, depth: number): PdfValue {
    if (depth > MAX_VALUE_DEPTH) throw new Incomplete("nesting");
    if (tok.t === "num") {
      if (tok.int) {
        // `num gen R`: a reference.
        const save = this.pos;
        const g = this.next();
        if (g.t === "num" && g.int) {
          const r = this.next();
          if (r.t === "kw" && r.v === "R") return new PdfRef(tok.v);
        }
        this.pos = save;
      }
      return tok.v;
    }
    if (tok.t === "name") return new PdfName(tok.v);
    if (tok.t === "open" && tok.v === "[") {
      const out: PdfValue[] = [];
      for (;;) {
        const t = this.next();
        if (t.t === "eof" || (t.t === "close" && t.v === "]")) return out;
        if (t.t === "close") continue; // a stray `>>` inside an array
        if (t.t === "kw" && (t.v === "endobj" || t.v === "stream")) {
          return out;
        }
        out.push(this.value(t, depth + 1));
      }
    }
    if (tok.t === "open") {
      const dict = new PdfDict(this.pos - 2, this.pos);
      for (;;) {
        const k = this.next();
        if (k.t === "eof" || (k.t === "close" && k.v === ">>")) break;
        if (k.t === "kw" && (k.v === "endobj" || k.v === "stream")) {
          this.pos -= k.v.length;
          break;
        }
        // pdf.js skips a key that is not a name.
        if (k.t !== "name") continue;
        const v = this.next();
        if (v.t === "eof") break;
        if (v.t === "close" && v.v === ">>") break;
        // pdf.js keeps a repeated key's LAST value (Dict.set overwrites).
        dict.map.set(k.v, this.value(v, depth + 1));
      }
      dict.end = this.pos;
      return dict;
    }
    return OTHER;
  }
}

/* ------------------------------------------------------------------ *
 *  The object index: every definition of every object
 * ------------------------------------------------------------------ */

/** One definition of an object: in the file's text, or in an object stream. */
interface Def {
  readonly id: number;
  readonly num: number;
  readonly src: Uint8Array;
  readonly at: number;
  /** In the file's text: a stream may follow its dictionary. */
  readonly plain: boolean;
}

interface Parsed {
  value: PdfValue;
  /** [start, end) of the stream data in the file, when one follows. */
  stream: [number, number] | null;
}

/** What the scanner hands in: its decoder, its lexer, its image sizing. */
export interface PageScanTools {
  /**
   * The decoded data of a stream whose dictionary text is `dict`, or null
   * when a filter is one the scan does not decode, or it passes `limit`.
   */
  decode(dict: string, data: Uint8Array, limit: number): Promise<Uint8Array | null>;
  /** A pdf.js-faithful content lexer reporting each operator (see `ContentOps`). */
  ops(hook: OpHook): { feed(chunk: Uint8Array): void; end(): void };
  /**
   * An image's own pixels (its /Width x /Height, what pdf.js's
   * `maxImageSize` compares), its cost (the most pixels pdf.js decodes to
   * paint it, its masks included) and whether pdf.js paints it through its
   * 1-bit path; null where a size cannot be read.
   */
  image(
    dict: string,
    numberOf: (num: number) => number | undefined,
    maskDict: (num: number) => string | null,
  ): ImageSize;
  /**
   * What an image costs one page, in colour pixels; 0 when pdf.js skips it
   * (its own size past `skipAbove`) or paints nothing (a zero side).
   */
  weigh(size: ImageSize, skipAbove: number): number;
  /** Most bytes the mapping may decode, all content streams together. */
  decodeBudget: number;
}

export interface ImageSize {
  own: number | null;
  cost: number | null;
  bilevel: boolean;
}

/**
 * One operator from the content lexer: `q`, `Q`, `cm` (with its six
 * operands, or null when they are not six numbers), `Do` (with the name
 * operand, or null), an inline image the exact reading sized (or could not:
 * `unknown`), or a `BI` only the loose reading saw. `exact` is false once the
 * lexer has turned loose (after a first inline image's data, see ContentOps).
 */
export type ContentOp =
  | { op: "q" | "Q"; exact: boolean }
  | { op: "cm"; m: number[] | null; exact: boolean }
  | { op: "Do"; name: string | null; exact: boolean }
  | { op: "inline"; pixels: number; bilevel: boolean; unknown: boolean }
  | { op: "looseInline"; w: number; h: number };
export type OpHook = (op: ContentOp) => void;

/** Defs parsed more than this many bytes over the sources' sizes: incomplete. */
const PARSE_WORK_FACTOR = 8;

/**
 * Every definition of every object number, from the file's `num gen obj`
 * headers and the tables of the object streams the scan can decode.
 */
class ObjectIndex {
  readonly defs = new Map<number, Def[]>();
  private readonly cache = new Map<number, Parsed>();
  /** Object streams whose data the scan cannot decode. */
  opaqueObjectStreams = 0;
  private nextId = 0;

  private constructor(
    readonly bytes: Uint8Array,
    readonly budget: Budget,
  ) {}

  static async build(
    bytes: Uint8Array,
    tools: PageScanTools,
  ): Promise<ObjectIndex> {
    const index = new ObjectIndex(bytes, {
      used: 0,
      max: PARSE_WORK_FACTOR * bytes.length + 65_536,
    });
    for (const h of findObjectHeaders(bytes)) {
      if (Number.isInteger(h.num)) index.add(h.num, bytes, h.objAt + 3, true);
    }
    // Object streams: decode each, and index its table (pdf.js reads /N
    // pairs of `num offset` before /First).
    const plain = [...index.defs.values()].flat();
    let decoded = 0;
    for (const def of plain) {
      const p = index.parse(def);
      if (!(p.value instanceof PdfDict) || p.stream === null) continue;
      const d = p.value;
      const isObjStm =
        index.nameOf(d.get("Type")) === "ObjStm" ||
        (d.get("First") !== undefined && d.get("N") !== undefined);
      if (!isObjStm) continue;
      const data = await tools.decode(
        latin1.decode(bytes.subarray(d.start, d.end)),
        bytes.subarray(p.stream[0], p.stream[1]),
        tools.decodeBudget - decoded,
      );
      if (data === null) {
        index.opaqueObjectStreams += 1;
        continue;
      }
      decoded += data.length;
      index.budget.max += PARSE_WORK_FACTOR * data.length;
      const first = index.numberIn(d.get("First"));
      const n = index.numberIn(d.get("N"));
      if (first === null || n === null || first < 0 || first > data.length) {
        continue;
      }
      const table = latin1
        .decode(data.subarray(0, first))
        .trim()
        .split(/\s+/)
        .map(Number);
      for (let k = 0; k < n && 2 * k + 1 < table.length; k += 1) {
        const num = table[2 * k]!;
        const off = table[2 * k + 1]!;
        if (!Number.isInteger(num) || !Number.isInteger(off) || off < 0) {
          continue;
        }
        if (first + off < data.length) index.add(num, data, first + off, false);
      }
    }
    return index;
  }

  /** Every `endstream` before `scannedTo`, each found once (linear overall). */
  private readonly endstreams: number[] = [];
  private scannedTo = 0;
  private endstreamFrom(from: number): number {
    const { endstreams, bytes } = this;
    let lo = 0;
    let hi = endstreams.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (endstreams[mid]! < from) lo = mid + 1;
      else hi = mid;
    }
    if (lo < endstreams.length) return endstreams[lo]!;
    while (this.scannedTo < bytes.length) {
      const p = indexOfWord(bytes, ENDSTREAM, this.scannedTo);
      if (p === -1) {
        this.scannedTo = bytes.length;
        break;
      }
      endstreams.push(p);
      this.scannedTo = p + 1;
      if (p >= from) return p;
    }
    return -1;
  }

  private add(num: number, src: Uint8Array, at: number, plain: boolean): void {
    const def: Def = { id: this.nextId++, num, src, at, plain };
    const list = this.defs.get(num);
    if (list) list.push(def);
    else this.defs.set(num, [def]);
  }

  parse(def: Def): Parsed {
    const kept = this.cache.get(def.id);
    if (kept) return kept;
    const p = new Parser(def.src, def.at, this.budget);
    const value = p.value(p.next(), 0);
    let stream: [number, number] | null = null;
    if (def.plain && value instanceof PdfDict) {
      const k = skipForward(def.src, value.end);
      if (
        matchesAt(def.src, k, STREAM) &&
        !(def.src[k + 6]! > 0x20 && !isDelimiter(def.src[k + 6]!))
      ) {
        let start = k + STREAM.length;
        if (def.src[start] === 0x0d) start += 1;
        if (def.src[start] === 0x0a) start += 1;
        const length = this.numberIn(value.get("Length"));
        let end =
          length !== null &&
          Number.isInteger(length) &&
          length >= 0 &&
          start + length <= def.src.length
            ? start + length
            : -1;
        if (end !== -1) {
          const after = skipForward(def.src, end);
          if (!matchesAt(def.src, after, ENDSTREAM)) end = -1;
        }
        if (end === -1) {
          const e = this.endstreamFrom(start);
          end = e === -1 ? def.src.length : e;
        }
        stream = [start, end];
      }
    }
    const parsed: Parsed = { value, stream };
    this.cache.set(def.id, parsed);
    return parsed;
  }

  /** Every value `v` may be: a reference read in each of its definitions. */
  all(v: PdfValue | undefined, depth = 0): PdfValue[] {
    if (v === undefined) return [];
    if (!(v instanceof PdfRef)) return [v];
    if (depth > 8) throw new Incomplete("reference chain");
    const defs = this.defs.get(v.num);
    if (!defs) {
      // Possibly held in an object stream the scan cannot decode.
      if (this.opaqueObjectStreams > 0) throw new Incomplete("opaque object");
      return [];
    }
    return defs.flatMap((d) => this.all(this.parse(d).value, depth + 1));
  }

  dicts(v: PdfValue | undefined): PdfDict[] {
    return this.all(v).filter((x): x is PdfDict => x instanceof PdfDict);
  }

  /** A number, a reference to one (its largest definition), or null. */
  numberIn(v: PdfValue | undefined): number | null {
    let best: number | null = null;
    for (const x of this.all(v)) {
      if (typeof x === "number") best = best === null ? x : Math.max(best, x);
    }
    return best;
  }

  nameOf(v: PdfValue | undefined): string | null {
    for (const x of this.all(v)) if (x instanceof PdfName) return x.name;
    return null;
  }

  /** The streams `v` names: each definition that is a dictionary with data. */
  streams(v: PdfValue | undefined): { def: Def; dict: PdfDict; data: [number, number] }[] {
    if (!(v instanceof PdfRef)) return [];
    const out: { def: Def; dict: PdfDict; data: [number, number] }[] = [];
    const defs = this.defs.get(v.num);
    if (!defs) {
      if (this.opaqueObjectStreams > 0) throw new Incomplete("opaque object");
      return out;
    }
    for (const def of defs) {
      const p = this.parse(def);
      if (p.value instanceof PdfDict && p.stream !== null) {
        out.push({ def, dict: p.value, data: p.stream });
      }
    }
    return out;
  }

  dictText(dict: PdfDict, src: Uint8Array): string {
    return latin1.decode(src.subarray(dict.start, dict.end));
  }
}

/* ------------------------------------------------------------------ *
 *  Painting
 * ------------------------------------------------------------------ */

/** A 2D affine matrix [a b c d e f], PDF order. */
type Matrix = readonly number[];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0]! * n[0]! + m[1]! * n[2]!,
  m[0]! * n[1]! + m[1]! * n[3]!,
  m[2]! * n[0]! + m[3]! * n[2]!,
  m[2]! * n[1]! + m[3]! * n[3]!,
  m[4]! * n[0]! + m[5]! * n[2]! + n[4]!,
  m[4]! * n[1]! + m[5]! * n[3]! + n[5]!,
];

/** A rectangle in default user space: [x0, y0, x1, y1], x0 <= x1, y0 <= y1. */
export type Box = [number, number, number, number];

/** The unit square through `m`, bounded. */
function unitBox(m: Matrix): Box | null {
  const xs = [m[4]!, m[0]! + m[4]!, m[2]! + m[4]!, m[0]! + m[2]! + m[4]!];
  const ys = [m[5]!, m[1]! + m[5]!, m[3]! + m[5]!, m[1]! + m[3]! + m[5]!];
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Forms nested past this are not followed: what lies below counts whole. */
export const MAX_FORM_DEPTH = 32;
/** Combinations of a page's content-stream definitions read; past it, whole. */
export const MAX_CONTENT_ALTERNATIVES = 8;
/** `Do` and resource resolutions, all pages together; past it, incomplete. */
export const MAX_PAINT_STEPS = 2_000_000;
/** Content operators kept, all streams together; past it, incomplete. */
const MAX_KEPT_OPS = 4_000_000;

/** A stream an object resolves to: its definition, dictionary and data. */
interface StreamDef {
  def: Def;
  dict: PdfDict;
  data: [number, number];
}

/** What painting some content costs and, when asked, where. */
interface Paint {
  /** Distinct image definitions painted, with their weight. */
  images: Map<number, number>;
  /** Inline images' weight, every time read. */
  inline: number;
  /** An image pdf.js skips (own size past the preview's bound) is painted. */
  skipped: boolean;
  /** Boxes (user space) of the skipped images, when placements are asked. */
  boxes: Box[];
  /** A skipped image is (or may be) painted where no box is known. */
  uncertain: boolean;
}

const emptyPaint = (): Paint => ({
  images: new Map(),
  inline: 0,
  skipped: false,
  boxes: [],
  uncertain: false,
});

function absorb(into: Paint, p: Paint): void {
  for (const [k, w] of p.images) into.images.set(k, w);
  into.inline += p.inline;
  for (const b of p.boxes) into.boxes.push(b);
  if (p.skipped) into.skipped = true;
  if (p.uncertain) into.uncertain = true;
}

/** `p` painted where its placements are not known. */
function unplaced(p: Paint): Paint {
  return { ...p, boxes: [], uncertain: p.uncertain || p.skipped };
}

const weightOf = (p: Paint): number => {
  let w = p.inline;
  for (const v of p.images.values()) w += v;
  return w;
};

/** The pages and what each paints. */
export interface PageImageMap {
  /** Each page object number, with the most image pixels one of its definitions paints. */
  pages: Map<number, number>;
  /** Why the mapping could not be completed, or null. */
  incomplete: string | null;
}

/** Where a page paints the images a preview skips. */
export interface Placements {
  /** Boxes in the page's default user space. */
  boxes: Box[];
  /**
   * False when a skipped image is (or may be) painted somewhere this cannot
   * place: a pattern, a Type3 glyph, a soft mask, an annotation, content it
   * cannot read, or after the lexer turned loose.
   */
  certain: boolean;
  /** What the page weighs at the same bound (see {@link PageImages.map}). */
  weight: number;
}

/** Reads pages' painted images from one file. Build once with {@link PageImages.open}. */
export class PageImages {
  private steps = 0;
  private keptOps = 0;
  private decoded = 0;
  private pages: Map<number, PdfDict[]> | null = null;
  private readonly opsCache = new Map<string, ContentOp[] | null>();
  private readonly imageCache = new Map<number, ImageSize>();
  /** Unplaced paints, by stream definition and resources (see `resKey`). */
  private readonly paintCache = new Map<string, Paint>();
  private readonly indirectCache = new Map<string, Paint>();
  private readonly dictIds = new WeakMap<PdfDict, number>();
  private nextDictId = 0;

  private constructor(
    private readonly index: ObjectIndex,
    private readonly tools: PageScanTools,
  ) {}

  static async open(
    bytes: Uint8Array,
    tools: PageScanTools,
  ): Promise<PageImages | { incomplete: string }> {
    try {
      const index = await ObjectIndex.build(bytes, tools);
      if (index.opaqueObjectStreams > 0) {
        return { incomplete: "an object stream the scan cannot decode" };
      }
      return new PageImages(index, tools);
    } catch (err) {
      if (err instanceof Incomplete) return { incomplete: err.message };
      throw err;
    }
  }

  private step(): void {
    if (++this.steps > MAX_PAINT_STEPS) throw new Incomplete("paint steps");
  }

  private resKey(resources: readonly PdfDict[]): string {
    return resources
      .map((r) => {
        let id = this.dictIds.get(r);
        if (id === undefined) {
          id = this.nextDictId++;
          this.dictIds.set(r, id);
        }
        return id;
      })
      .join(".");
  }

  /** Every page object: each definition pdf.js may take as a page. */
  private pageDefs(): Map<number, PdfDict[]> {
    if (this.pages) return this.pages;
    const { index } = this;
    const kidRefs = new Set<number>();
    const typed = new Map<number, PdfDict[]>();
    const bare = new Map<number, PdfDict[]>();
    for (const [num, defs] of index.defs) {
      for (const def of defs) {
        const v = index.parse(def).value;
        if (!(v instanceof PdfDict)) continue;
        const kids = v.get("Kids");
        if (kids !== undefined) {
          for (const k of index.all(kids)) {
            if (!Array.isArray(k)) continue;
            for (const r of k) if (r instanceof PdfRef) kidRefs.add(r.num);
          }
        }
        const target =
          index.nameOf(v.get("Type")) === "Page"
            ? typed
            : kids === undefined
              ? bare
              : null;
        if (target === null) continue;
        const list = target.get(num);
        if (list) list.push(v);
        else target.set(num, [v]);
      }
    }
    const pages = new Map(typed);
    for (const [num, dicts] of bare) {
      if (!kidRefs.has(num)) continue;
      pages.set(num, [...(pages.get(num) ?? []), ...dicts]);
    }
    this.pages = pages;
    return pages;
  }

  /** What pdf.js finds for `key` on `dict`: its own, else its /Parent chain's. */
  private inherited(dict: PdfDict, key: string, depth = 0): PdfValue[] {
    const own = dict.get(key);
    if (own !== undefined) return this.index.all(own);
    if (depth >= 100) throw new Incomplete("parent chain");
    const parent = dict.get("Parent");
    if (parent === undefined) return [];
    return this.index
      .dicts(parent)
      .flatMap((p) => this.inherited(p, key, depth + 1));
  }

  /**
   * The weight of every page: each page object number, the most image
   * pixels any of its definitions paints (images skipped past `skipAbove`
   * own pixels weigh nothing: pdf.js decodes none of them).
   */
  async map(skipAbove: number): Promise<PageImageMap> {
    const pages = new Map<number, number>();
    try {
      for (const [num, dicts] of this.pageDefs()) {
        let most = 0;
        for (const dict of dicts) {
          const paint = await this.paintPage(dict, skipAbove, false);
          most = Math.max(most, weightOf(paint));
        }
        pages.set(num, most);
      }
      return { pages, incomplete: null };
    } catch (err) {
      if (err instanceof Incomplete) return { pages, incomplete: err.message };
      throw err;
    }
  }

  /**
   * Where page `num` paints the images pdf.js skips past `skipAbove` own
   * pixels, and its weight at that bound. Null when the mapping cannot say
   * (`num` is no page it found, or a bound passed).
   */
  async placements(num: number, skipAbove: number): Promise<Placements | null> {
    try {
      const dicts = this.pageDefs().get(num);
      if (!dicts) return null;
      const boxes: Box[] = [];
      let certain = true;
      let weight = 0;
      for (const dict of dicts) {
        const paint = await this.paintPage(dict, skipAbove, true);
        boxes.push(...paint.boxes);
        if (paint.uncertain) certain = false;
        weight = Math.max(weight, weightOf(paint));
      }
      return { boxes, certain, weight };
    } catch (err) {
      if (err instanceof Incomplete) return null;
      throw err;
    }
  }

  private async paintPage(
    dict: PdfDict,
    skipAbove: number,
    place: boolean,
  ): Promise<Paint> {
    const { index } = this;
    const resources = this.inherited(dict, "Resources").filter(
      (r): r is PdfDict => r instanceof PdfDict,
    );
    const out = emptyPaint();
    // The /Contents: one stream, or an array (direct or not) pdf.js reads
    // joined; each position may have several definitions.
    const contents = dict.get("Contents");
    const positions: StreamDef[][] = [];
    if (contents instanceof PdfRef) {
      const alts = index.streams(contents);
      if (alts.length > 0) positions.push(alts);
    }
    for (const c of index.all(contents)) {
      if (!Array.isArray(c)) continue;
      for (const r of c) {
        const alts = index.streams(r);
        if (alts.length > 0) positions.push(alts);
      }
    }
    let combos = 1;
    for (const p of positions) combos *= p.length;
    if (combos > MAX_CONTENT_ALTERNATIVES) {
      absorb(out, unplaced(await this.reachAll(resources, skipAbove)));
    } else if (positions.length > 0) {
      let all: StreamDef[][] = [[]];
      for (const alts of positions) {
        all = all.flatMap((chosen) => alts.map((a) => [...chosen, a]));
      }
      for (const chosen of all) {
        absorb(
          out,
          await this.paintContent(
            chosen,
            resources,
            IDENTITY,
            0,
            new Set(),
            skipAbove,
            place,
          ),
        );
      }
    }
    // Annotation appearances: pdf.js draws them with the page, each from
    // its own stream and resources; where it places them is not followed.
    for (const annots of index.all(dict.get("Annots"))) {
      if (!Array.isArray(annots)) continue;
      for (const a of annots) {
        for (const annot of index.dicts(a)) {
          for (const ap of index.dicts(annot.get("AP"))) {
            for (const key of ["N", "R", "D"]) {
              const v = ap.get(key);
              if (v === undefined) continue;
              this.step();
              const forms: PdfValue[] = v instanceof PdfRef ? [v] : [];
              for (const states of index.dicts(v)) {
                for (const s of states.map.values()) forms.push(s);
              }
              for (const f of forms) {
                for (const s of index.streams(f)) {
                  const res = index.dicts(s.dict.get("Resources"));
                  absorb(
                    out,
                    unplaced(await this.paintUnplaced(s, res, skipAbove)),
                  );
                }
              }
            }
          }
        }
      }
    }
    // What the page's resources may paint with no `Do`.
    for (const r of resources) {
      absorb(out, await this.indirectPaint(r, skipAbove));
    }
    return out;
  }

  /** The content operators of a joined stream sequence, read once. */
  private async contentOps(
    streams: readonly StreamDef[],
  ): Promise<ContentOp[] | null> {
    const key = streams.map((s) => s.def.id).join(",");
    if (this.opsCache.has(key)) return this.opsCache.get(key)!;
    const ops: ContentOp[] = [];
    let overflow = false;
    const lexer = this.tools.ops((op) => {
      if (++this.keptOps > MAX_KEPT_OPS) overflow = true;
      else ops.push(op);
    });
    let readable = true;
    for (const s of streams) {
      const data = await this.tools.decode(
        this.index.dictText(s.dict, s.def.src),
        s.def.src.subarray(s.data[0], s.data[1]),
        this.tools.decodeBudget - this.decoded,
      );
      if (data === null) {
        readable = false;
        break;
      }
      this.decoded += data.length;
      lexer.feed(data);
    }
    lexer.end();
    if (overflow) throw new Incomplete("content operators");
    const result = readable ? ops : null;
    this.opsCache.set(key, result);
    return result;
  }

  private size(s: StreamDef): ImageSize {
    const kept = this.imageCache.get(s.def.id);
    if (kept) return kept;
    const { index } = this;
    const size = this.tools.image(
      index.dictText(s.dict, s.def.src),
      (num) => index.numberIn(new PdfRef(num)) ?? undefined,
      (num) => {
        const m = index.streams(new PdfRef(num))[0];
        return m ? index.dictText(m.dict, m.def.src) : null;
      },
    );
    this.imageCache.set(s.def.id, size);
    return size;
  }

  /** The XObject streams `name` resolves to through `resources`. */
  private xobjects(resources: readonly PdfDict[], name: string): StreamDef[] {
    const out: StreamDef[] = [];
    for (const r of resources) {
      for (const xo of this.index.dicts(r.get("XObject"))) {
        this.step();
        out.push(...this.index.streams(xo.get(name)));
      }
    }
    return out;
  }

  /** An image painted: its weight, and its box when it is skipped and placed. */
  private paintImage(
    out: Paint,
    key: number | null,
    size: ImageSize,
    skipAbove: number,
    box: Box | null,
    place: boolean,
  ): void {
    const w = this.tools.weigh(size, skipAbove);
    if (key === null) out.inline += w;
    else out.images.set(key, w);
    if (size.own === null || size.own > skipAbove) {
      out.skipped = true;
      if (place) {
        if (box) out.boxes.push(box);
        else out.uncertain = true;
      }
    }
  }

  /** A form, pattern, glyph or appearance, painted where its placement is not followed. */
  private async paintUnplaced(
    s: StreamDef,
    resources: readonly PdfDict[],
    skipAbove: number,
    depth = 0,
    path: ReadonlySet<number> = new Set(),
  ): Promise<Paint> {
    const key = `${s.def.id}|${this.resKey(resources)}|${skipAbove}|${depth}`;
    const kept = this.paintCache.get(key);
    if (kept) return kept;
    const p = await this.paintContent(
      [s],
      resources,
      IDENTITY,
      depth,
      new Set([...path, s.def.num]),
      skipAbove,
      false,
    );
    this.paintCache.set(key, p);
    return p;
  }

  private async paintContent(
    streams: readonly StreamDef[],
    resources: readonly PdfDict[],
    base: Matrix,
    depth: number,
    path: ReadonlySet<number>,
    skipAbove: number,
    place: boolean,
  ): Promise<Paint> {
    const out = emptyPaint();
    const ops = await this.contentOps(streams);
    if (ops === null) {
      // Content the scan cannot read may paint anything its resources hold.
      absorb(out, unplaced(await this.reachAll(resources, skipAbove)));
      return out;
    }
    let ctm = base;
    let trusted = true;
    const stack: Matrix[] = [];
    for (const op of ops) {
      switch (op.op) {
        case "q":
          stack.push(ctm);
          break;
        case "Q":
          if (stack.length > 0) ctm = stack.pop()!;
          break;
        case "cm":
          if (op.m === null || !op.exact) trusted = false;
          else ctm = mul(op.m, ctm);
          break;
        case "inline": {
          const size: ImageSize = op.unknown
            ? { own: null, cost: null, bilevel: false }
            : { own: op.pixels, cost: op.pixels, bilevel: op.bilevel };
          const box = trusted ? unitBox(ctm) : null;
          this.paintImage(out, null, size, skipAbove, box, place);
          break;
        }
        case "looseInline": {
          // Only a bound on this image's size is known (see ContentOps):
          // decoded, it costs at most the bound and at most `skipAbove`.
          const bound = Math.min(op.w * op.h, Number.MAX_SAFE_INTEGER);
          if (!(bound > 0)) break;
          const most = Math.min(bound, skipAbove);
          out.inline += this.tools.weigh(
            { own: most, cost: most, bilevel: false },
            skipAbove,
          );
          if (bound > skipAbove) {
            out.skipped = true;
            if (place) out.uncertain = true;
          }
          break;
        }
        case "Do": {
          if (op.name === null) {
            // A `Do` whose operand the lexer could not keep: any XObject.
            absorb(out, unplaced(await this.reachAll(resources, skipAbove)));
            break;
          }
          if (!op.exact) trusted = false;
          for (const x of this.xobjects(resources, op.name)) {
            const sub = this.index.nameOf(x.dict.get("Subtype"));
            if (sub === "Image") {
              const box = trusted ? unitBox(ctm) : null;
              this.paintImage(out, x.def.id, this.size(x), skipAbove, box, place);
            } else if (sub === "Form") {
              if (path.has(x.def.num)) continue; // pdf.js refuses a circular form
              const own = this.index.dicts(x.dict.get("Resources"));
              const res = own.length > 0 ? own : resources;
              if (depth + 1 > MAX_FORM_DEPTH) {
                absorb(out, unplaced(await this.reachAll(res, skipAbove)));
                continue;
              }
              const m = this.matrixOf(x.dict.get("Matrix"));
              if (place && trusted && m !== null) {
                const inner = await this.paintContent(
                  [x],
                  res,
                  mul(m, ctm),
                  depth + 1,
                  new Set([...path, x.def.num]),
                  skipAbove,
                  true,
                );
                absorb(out, inner);
              } else {
                const inner = await this.paintUnplaced(
                  x,
                  res,
                  skipAbove,
                  depth + 1,
                  path,
                );
                absorb(out, place ? unplaced(inner) : inner);
              }
            }
          }
          break;
        }
      }
    }
    // What a form's own resources may paint with no `Do`.
    if (depth > 0) {
      for (const r of resources) {
        absorb(out, await this.indirectPaint(r, skipAbove));
      }
    }
    return out;
  }

  private matrixOf(v: PdfValue | undefined): Matrix | null {
    if (v === undefined) return IDENTITY;
    for (const a of this.index.all(v)) {
      if (
        Array.isArray(a) &&
        a.length >= 6 &&
        a.slice(0, 6).every((n) => typeof n === "number")
      ) {
        return a.slice(0, 6) as number[];
      }
    }
    return null;
  }

  /**
   * Everything `resources` can paint, whatever the content says: every image
   * XObject, every form's own reach (each form once), and what each
   * resource dictionary may paint with no `Do`. Placements: none known.
   */
  private async reachAll(
    resources: readonly PdfDict[],
    skipAbove: number,
  ): Promise<Paint> {
    const out = emptyPaint();
    const seen = new Set<number>();
    const visit = async (res: readonly PdfDict[], depth: number) => {
      for (const r of res) {
        for (const xo of this.index.dicts(r.get("XObject"))) {
          for (const v of xo.map.values()) {
            this.step();
            for (const x of this.index.streams(v)) {
              if (seen.has(x.def.id)) continue;
              seen.add(x.def.id);
              const sub = this.index.nameOf(x.dict.get("Subtype"));
              if (sub === "Image") {
                this.paintImage(out, x.def.id, this.size(x), skipAbove, null, false);
              } else if (sub === "Form") {
                if (depth >= MAX_FORM_DEPTH) throw new Incomplete("form depth");
                const own = this.index.dicts(x.dict.get("Resources"));
                await visit(own.length > 0 ? own : res, depth + 1);
              }
            }
          }
        }
        absorb(out, await this.indirectPaint(r, skipAbove));
      }
    };
    await visit(resources, 0);
    return unplaced(out);
  }

  /**
   * What a resource dictionary may paint without a `Do`: its tiling
   * patterns' content, its Type3 fonts' glyph procedures, and its graphics
   * states' soft-mask groups, each read as content with its own resources.
   * pdf.js may paint any of them anywhere: they are counted whether or not
   * the page uses them, and never placed.
   */
  private async indirectPaint(r: PdfDict, skipAbove: number): Promise<Paint> {
    const key = `${this.resKey([r])}|${skipAbove}`;
    const kept = this.indirectCache.get(key);
    if (kept) return kept;
    const out = emptyPaint();
    // Kept BEFORE the walk: a resource dictionary reachable from itself
    // (a pattern whose resources are its page's) reads as found so far.
    this.indirectCache.set(key, out);
    const { index } = this;
    const content = async (s: StreamDef, res: readonly PdfDict[]) => {
      const p = await this.paintUnplaced(s, res, skipAbove, MAX_FORM_DEPTH - 4);
      absorb(out, unplaced(p));
    };
    for (const pats of index.dicts(r.get("Pattern"))) {
      for (const v of pats.map.values()) {
        this.step();
        for (const s of index.streams(v)) {
          await content(s, index.dicts(s.dict.get("Resources")));
        }
      }
    }
    for (const fonts of index.dicts(r.get("Font"))) {
      for (const v of fonts.map.values()) {
        this.step();
        for (const font of index.dicts(v)) {
          if (index.nameOf(font.get("Subtype")) !== "Type3") continue;
          const own = index.dicts(font.get("Resources"));
          for (const procs of index.dicts(font.get("CharProcs"))) {
            for (const p of procs.map.values()) {
              this.step();
              for (const s of index.streams(p)) {
                await content(s, own.length > 0 ? own : [r]);
              }
            }
          }
        }
      }
    }
    for (const states of index.dicts(r.get("ExtGState"))) {
      for (const v of states.map.values()) {
        this.step();
        for (const gs of index.dicts(v)) {
          for (const mask of index.dicts(gs.get("SMask"))) {
            for (const g of index.streams(mask.get("G"))) {
              await content(g, index.dicts(g.dict.get("Resources")));
            }
          }
        }
      }
    }
    return out;
  }
}
