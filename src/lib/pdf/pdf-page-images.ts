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
 * Everything here is an UPPER bound on what pdf.js paints for one page:
 *
 *  - an object defined more than once (incremental updates; a cross-reference
 *    may point at any of the definitions) is read in EVERY definition, and a
 *    page counts the largest result;
 *  - every paint counts: pdf.js decodes an image once a page, but each `Do`
 *    paints it again at its own size (see `Paint`), and an inline image
 *    counts every time its content is read;
 *  - images a page MAY paint without a `Do` in its content — tiling patterns,
 *    Type3 glyphs, soft-mask groups, annotation appearances — count whether
 *    or not the page uses them (their placement is then not known), but
 *    ONCE: pdf.js paints a pattern's, glyph's or mask's content at every
 *    fill, glyph or use, which this does not count (an open bound, review
 *    r3, 2026-11-14);
 *  - a content stream that cannot be read (a filter the scan does not decode,
 *    alternatives past {@link MAX_CONTENT_ALTERNATIVES}, forms nested past
 *    {@link MAX_FORM_DEPTH}) may paint EVERY image its resources can reach,
 *    any number of times: when any weighs at all, the page's bound has no
 *    limit, and it is noted MAY, never IS.
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
class PdfString {
  constructor(readonly bytes: Uint8Array) {}
}
class PdfDict {
  readonly map = new Map<string, PdfValue>();
  /** Where `<<` starts and `>>` ends (exclusive), in its source. */
  constructor(
    readonly src: Uint8Array,
    readonly start: number,
    public end: number,
  ) {}
  get(key: string): PdfValue | undefined {
    return this.map.get(key);
  }
}
const OTHER = Symbol("other");
type PdfValue =
  number | PdfName | PdfRef | PdfDict | PdfString | PdfValue[] | typeof OTHER;

/** Thrown when a work bound passes: the mapping is incomplete. */
class Incomplete extends Error {}

/** Containers nested deeper than this end the mapping (pdf.js nests far less). */
const MAX_VALUE_DEPTH = 64;

const STREAM = ascii("stream");
const ENDSTREAM = ascii("endstream");
const latin1 = new TextDecoder("latin1");

const hexDigit = (c: string | undefined): number => {
  if (c === undefined) return -1;
  const n = c.charCodeAt(0);
  if (n >= 0x30 && n <= 0x39) return n - 0x30;
  if (n >= 0x41 && n <= 0x46) return n - 0x37;
  if (n >= 0x61 && n <= 0x66) return n - 0x57;
  return -1;
};

/**
 * A name's characters after `/`, decoded exactly as pdf.js's
 * `Lexer.getName` decodes them: `#` and two hex digits is one character; a
 * `#` before a non-hex character is kept with it; `#` and ONE hex digit
 * keeps both and the character after them, unread (so `#4#30` is
 * `#4#30`, where a regex would read `#40`). Used for dictionary keys and
 * for the operand of `Do`, so both sides of a resource lookup read alike.
 */
export function decodeName(raw: string): string {
  if (!raw.includes("#")) return raw;
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]!;
    if (c !== "#") {
      out += c;
      continue;
    }
    if (i + 1 >= raw.length) {
      out += "#";
      break;
    }
    const x = hexDigit(raw[i + 1]);
    if (x === -1) {
      out += `#${raw[i + 1]}`;
      i += 1;
      continue;
    }
    if (i + 2 >= raw.length) {
      out += `#${raw[i + 1]}`;
      break;
    }
    const x2 = hexDigit(raw[i + 2]);
    if (x2 === -1) {
      out += `#${raw[i + 1]}${raw[i + 2]}`;
      i += 2;
      continue;
    }
    out += String.fromCharCode((x << 4) | x2);
    i += 2;
  }
  return out;
}

/** Strings longer than this (in source bytes) are not kept as values. */
const MAX_KEPT_STRING = 1024;

/** A literal string's bytes (between its parentheses), escapes read as pdf.js reads them. */
function literalBytes(raw: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]!;
    if (c !== 0x5c) {
      out.push(c);
      continue;
    }
    i += 1;
    const e = raw[i];
    if (e === undefined) break;
    if (e >= 0x30 && e <= 0x37) {
      let v = e - 0x30;
      for (
        let k = 0;
        k < 2 && raw[i + 1]! >= 0x30 && raw[i + 1]! <= 0x37;
        k++
      ) {
        i += 1;
        v = (v << 3) + (raw[i]! - 0x30);
      }
      out.push(v & 0xff);
    } else if (e === 0x0d) {
      if (raw[i + 1] === 0x0a) i += 1; // a line continuation
    } else if (e !== 0x0a) {
      const map: Record<number, number> = {
        0x6e: 0x0a,
        0x72: 0x0d,
        0x74: 0x09,
        0x62: 0x08,
        0x66: 0x0c,
      };
      out.push(map[e] ?? e);
    }
  }
  return Uint8Array.from(out);
}

/** A hex string's bytes (between `<` and `>`): whitespace skipped, an odd last digit padded. */
function hexBytes(raw: Uint8Array): Uint8Array {
  const out: number[] = [];
  let first = -1;
  for (const b of raw) {
    const d = hexDigit(String.fromCharCode(b));
    if (d === -1) continue;
    if (first === -1) first = d;
    else {
      out.push((first << 4) | d);
      first = -1;
    }
  }
  if (first !== -1) out.push(first << 4);
  return Uint8Array.from(out);
}

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
  | { t: "str"; v: Uint8Array }
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
      // A literal string: nested parentheses, backslash escapes. Its bytes
      // are kept only while short (the /Encrypt dictionary's /O, /U, /ID).
      const from = i;
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
      tok =
        i - from <= MAX_KEPT_STRING
          ? { t: "str", v: literalBytes(src.subarray(from + 1, i - 1)) }
          : { t: "other" };
    } else if (b === 0x3c) {
      const close = src.indexOf(0x3e, i + 1);
      const end = close === -1 ? src.length : close;
      tok =
        end - i <= MAX_KEPT_STRING
          ? { t: "str", v: hexBytes(src.subarray(i + 1, end)) }
          : { t: "other" };
      i = close === -1 ? src.length : close + 1;
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
    if (tok.t === "str") return new PdfString(tok.v);
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
      const dict = new PdfDict(this.src, this.pos - 2, this.pos);
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
  /** Its generation (0 inside an object stream): an encrypted file's key needs it. */
  readonly gen: number;
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
  decode(
    dict: string,
    data: Uint8Array,
    limit: number,
  ): Promise<Uint8Array | null>;
  /**
   * A pdf.js-faithful content lexer reporting each operator (see
   * `ContentOps`); `q`, `Q` and `cm` only when `geometry` (placements).
   */
  ops(
    hook: OpHook,
    geometry?: boolean,
  ): { feed(chunk: Uint8Array): void; end(): void };
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
    num: number,
    codestream?: number | null,
  ): ImageSize;
  /**
   * A JPEG 2000 codestream's own size (its SIZ marker, as pdf.js reads it),
   * or null; for an encrypted file's images, whose codestreams only the
   * map can read (decrypted), and hands to `image` as `codestream`.
   */
  jpx(data: Uint8Array): number | null;
  /**
   * What an image costs one page, in colour pixels; 0 when pdf.js skips it
   * (its own size past `skipAbove`) or paints nothing (a zero side).
   */
  weigh(size: ImageSize, skipAbove: number): number;
  /** Most bytes the mapping may decode, all content streams together. */
  decodeBudget: number;
  /**
   * The file names /Encrypt: its streams are decrypted before `decode`
   * (see `ObjectIndex.openEncryption`), or not read at all.
   */
  encrypted: boolean;
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
      if (Number.isInteger(h.num)) {
        index.add(h.num, genBefore(bytes, h.objAt), bytes, h.objAt + 3, true);
      }
    }
    if (tools.encrypted) await index.openEncryption();
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
      const data = await index.decode(
        { def, dict: d, data: p.stream },
        tools,
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
        if (first + off < data.length) {
          index.add(num, 0, data, first + off, false);
        }
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

  private add(
    num: number,
    gen: number,
    src: Uint8Array,
    at: number,
    plain: boolean,
  ): void {
    const def: Def = { id: this.nextId++, num, gen, src, at, plain };
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
  streams(
    v: PdfValue | undefined,
  ): { def: Def; dict: PdfDict; data: [number, number] }[] {
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

  /** The file has an /Encrypt: its streams are ciphertext until decrypted. */
  private encrypted = false;
  /** Decrypts one stream of object `num gen`; null when the file needs a password. */
  private decryptor:
    | ((num: number, gen: number, data: Uint8Array) => Promise<Uint8Array>)
    | null = null;
  /**
   * Decrypts one stream of object `num gen` with the crypt filter a /Crypt
   * stage names (pdf.js's `CipherTransform.createStream(.., name)`); null
   * when that filter is one this cannot read. Set with {@link decryptor}.
   */
  private cryptDecryptor:
    | ((
        name: string,
        num: number,
        gen: number,
        data: Uint8Array,
      ) => Promise<Uint8Array | null>)
    | null = null;
  private encryptMetadata = true;

  /**
   * Open the file's Standard security handler with the empty user password,
   * as pdf.js opens a PDF that has no open password (its author restricted
   * printing or copying, say): its streams, object streams among them, are
   * then read decrypted. When the handler cannot be opened that way (a
   * password is needed, a handler this cannot read), streams stay unread
   * and every page counts what its resources hold (or the map is
   * incomplete): fail safe.
   */
  async openEncryption(): Promise<void> {
    this.encrypted = true;
    // Every trailer (classic `trailer << >>`, or a cross-reference stream's
    // dictionary) that names /Encrypt; the last in the file is the newest.
    let trailer: PdfDict | null = null;
    let at = -1;
    const TRAILER = ascii("trailer");
    for (let t = indexOfWord(this.bytes, TRAILER, 0); t !== -1;) {
      const p = new Parser(this.bytes, t + TRAILER.length, this.budget);
      const v = p.value(p.next(), 0);
      if (v instanceof PdfDict && v.get("Encrypt") !== undefined && t > at) {
        trailer = v;
        at = t;
      }
      t = indexOfWord(this.bytes, TRAILER, t + TRAILER.length);
    }
    for (const defs of this.defs.values()) {
      for (const def of defs) {
        if (!def.plain) continue;
        const v = this.parse(def).value;
        if (
          v instanceof PdfDict &&
          this.nameOf(v.get("Type")) === "XRef" &&
          v.get("Encrypt") !== undefined &&
          def.at > at
        ) {
          trailer = v;
          at = def.at;
        }
      }
    }
    if (trailer === null) return;
    const encrypt = this.dicts(trailer.get("Encrypt"))[0];
    if (!encrypt) return;
    const get = (d: PdfDict, k: string) => this.all(d.get(k))[0];
    const bytesOf = (v: PdfValue | undefined) =>
      v instanceof PdfString ? v.bytes : undefined;
    const numOf = (v: PdfValue | undefined) =>
      typeof v === "number" ? v : undefined;
    if (this.nameOf(encrypt.get("Filter")) !== "Standard") return;
    const v = numOf(get(encrypt, "V")) ?? 0;
    const method = (filter: PdfValue | undefined) => {
      if (v < 4) return "rc4" as const;
      const name = filter instanceof PdfName ? filter.name : "Identity";
      if (name === "Identity") return "identity" as const;
      const cf = this.dicts(encrypt.get("CF"))[0];
      const f = cf ? this.dicts(cf.get(name))[0] : undefined;
      if (!f) return null;
      const cfm = this.nameOf(f.get("CFM")) ?? "None";
      return cfm === "V2"
        ? ("rc4" as const)
        : cfm === "AESV2"
          ? ("aesv2" as const)
          : cfm === "AESV3"
            ? ("aesv3" as const)
            : cfm === "None"
              ? ("identity" as const)
              : null;
    };
    const stream = method(get(encrypt, "StmF"));
    const string = method(get(encrypt, "StrF"));
    if (stream === null || string === null) return;
    const ids = this.all(trailer.get("ID"))[0];
    const em = get(encrypt, "EncryptMetadata");
    // pdf.js reads `false` as a keyword; this parser keeps it as OTHER.
    this.encryptMetadata = !(
      em === OTHER &&
      /\/EncryptMetadata\s+false/.test(this.dictText(encrypt, this.bytes))
    );
    const params = {
      v,
      r: numOf(get(encrypt, "R")) ?? 0,
      lengthBits: numOf(get(encrypt, "Length")) ?? (v === 1 ? 40 : 128),
      o: bytesOf(get(encrypt, "O")) ?? new Uint8Array(0),
      u: bytesOf(get(encrypt, "U")) ?? new Uint8Array(0),
      oe: bytesOf(get(encrypt, "OE")),
      ue: bytesOf(get(encrypt, "UE")),
      perms: bytesOf(get(encrypt, "Perms")),
      p: (numOf(get(encrypt, "P")) ?? 0) | 0,
      encryptMetadata: this.encryptMetadata,
      stream,
      string,
      id0:
        (Array.isArray(ids) ? bytesOf(ids[0]) : undefined) ?? new Uint8Array(0),
    };
    try {
      const { StandardSecurityHandler } =
        await import("./security/standard-handler");
      const handler = await StandardSecurityHandler.open(params, "");
      if (handler) {
        this.decryptor = (num, gen, data) =>
          handler.decrypt("stream", num, gen, data);
        // A /Crypt stage's filter, resolved as pdf.js's `resolveCipher`
        // resolves it: below V4 every filter is RC4; from V4 the /CF entry
        // it names (none, or /CFM /None, reads the data as it is), and V5
        // decrypts with AES-256 whatever /CFM says.
        const cryptOf = (name: string) => {
          if (v < 4) return "rc4" as const;
          const cf = this.dicts(encrypt.get("CF"))[0];
          const f = cf ? this.dicts(cf.get(name))[0] : undefined;
          const cfm = f ? this.nameOf(f.get("CFM")) : null;
          if (cfm === null || cfm === "None") return "identity" as const;
          if (v === 5 || cfm === "AESV3") return "aesv3" as const;
          return cfm === "V2"
            ? ("rc4" as const)
            : cfm === "AESV2"
              ? ("aesv2" as const)
              : null;
        };
        const opened = new Map<
          string,
          ReturnType<typeof StandardSecurityHandler.open>
        >();
        this.cryptDecryptor = async (name, num, gen, data) => {
          const m = cryptOf(name);
          if (m === null) return null;
          if (m === "identity") return data;
          let h = opened.get(m);
          if (!h) {
            h = StandardSecurityHandler.open(
              { ...params, stream: m },
              "",
            ).catch(() => null);
            opened.set(m, h);
          }
          const with_ = await h;
          return with_ ? with_.decrypt("stream", num, gen, data) : null;
        };
      }
    } catch {
      // A handler this cannot read: streams stay unread (fail safe).
    }
  }

  /** A stream's filter names and their /DecodeParms, position by position. */
  filtersOf(s: StreamDef): { filters: string[]; parms: (PdfDict | null)[] } {
    const filterValue = s.dict.get("F") ?? s.dict.get("Filter");
    const filters: string[] = [];
    for (const f of this.all(filterValue)) {
      if (f instanceof PdfName) filters.push(f.name);
      else if (Array.isArray(f)) {
        for (const x of f) filters.push(this.nameOf(x) ?? "?");
      }
    }
    const parmsValue = s.dict.get("DP") ?? s.dict.get("DecodeParms");
    const parms: (PdfDict | null)[] = [];
    for (const p of this.all(parmsValue)) {
      if (p instanceof PdfDict) parms.push(p);
      else if (Array.isArray(p)) {
        for (const x of p) parms.push(this.dicts(x)[0] ?? null);
      }
    }
    return { filters, parms };
  }

  /**
   * A stream's data before its filters, as pdf.js's `Parser.makeStream`
   * hands it to them: in an encrypted file, decrypted with the file's
   * stream filter, unless the stream has a /Crypt filter ANYWHERE in its
   * list (`#hasCryptFilter`), when the /Crypt stage decrypts instead, with
   * the crypt filter its /DecodeParms /Name names (/Identity when none).
   * Null when it cannot be read here: a password is needed, a crypt filter
   * this cannot read, or a /Crypt stage after another filter, or a second
   * one (pdf.js decrypts mid-chain; this reads such data whole only).
   *
   * History (hostile review r3, 2026-11-14): a stream whose first filter was
   * /Crypt was taken as plain text, its ciphertext lexed as content, no
   * `Do` found, and a page painting 64 MP weighed 0 and was drawn.
   */
  async decrypted(
    s: StreamDef,
    filters: readonly string[],
    parms: readonly (PdfDict | null)[],
  ): Promise<Uint8Array | null> {
    const data = s.def.src.subarray(s.data[0], s.data[1]);
    if (!this.encrypted) return data;
    const crypts = filters.filter((f) => f === "Crypt").length;
    if (crypts > 0) {
      if (filters[0] !== "Crypt" || crypts > 1) return null;
      if (this.cryptDecryptor === null) return null;
      // pdf.js reads the /Name of the stage's own parameters: the dictionary
      // itself after a lone filter name, the first entry after an array.
      const single = this.all(s.dict.get("F") ?? s.dict.get("Filter"))[0];
      const p =
        single instanceof PdfName
          ? this.dicts(s.dict.get("DP") ?? s.dict.get("DecodeParms"))[0]
          : (parms[0] ?? undefined);
      const name = p ? this.all(p.get("Name"))[0] : undefined;
      return this.cryptDecryptor(
        name instanceof PdfName ? name.name : "Identity",
        s.def.num,
        s.def.gen,
        data,
      );
    }
    const type = this.nameOf(s.dict.get("Type"));
    if (type === "XRef" || (type === "Metadata" && !this.encryptMetadata)) {
      return data;
    }
    if (this.decryptor === null) return null;
    return this.decryptor(s.def.num, s.def.gen, data);
  }

  /**
   * A stream's data as pdf.js reads it: decrypted (an encrypted file),
   * through its filters (`tools.decode`), and through a Flate stage's PNG
   * or TIFF predictor. Null when any step cannot be done here.
   */
  async decode(
    s: StreamDef,
    tools: PageScanTools,
    limit: number,
  ): Promise<Uint8Array | null> {
    const { filters, parms } = this.filtersOf(s);
    const data = await this.decrypted(s, filters, parms);
    if (data === null) return null;
    const text = this.dictText(s.dict, s.def.src);
    // pdf.js applies /DecodeParms /Predictor after a Flate (or LZW) stage.
    const single = parms.length === 1 && filters.length === 1;
    let predicted = -1;
    for (let i = 0; i < filters.length; i += 1) {
      const p = single ? parms[0] : parms[i];
      if (!p || !PREDICTED.has(filters[i]!)) continue;
      if ((this.numberIn(p.get("Predictor")) ?? 1) > 1) predicted = i;
      if (predicted !== -1 && predicted !== filters.length - 1) return null;
    }
    const decoded = await tools.decode(text, data, limit);
    if (decoded === null || predicted === -1) return decoded;
    const p = (single ? parms[0] : parms[predicted])!;
    return unpredict(decoded, {
      predictor: this.numberIn(p.get("Predictor")) ?? 1,
      colors: this.numberIn(p.get("Colors")) ?? 1,
      bpc: this.numberIn(p.get("BitsPerComponent")) ?? 8,
      columns: this.numberIn(p.get("Columns")) ?? 1,
    });
  }
}

/** The filters pdf.js applies a /Predictor after. */
const PREDICTED = new Set(["FlateDecode", "Fl", "LZWDecode", "LZW"]);

/**
 * Data through pdf.js's `PredictorStream`: PNG predictors (10-15, a filter
 * byte per row) and TIFF predictor 2 at 8 bits per component. Null for any
 * other predictor, or a row filter pdf.js refuses.
 */
export function unpredict(
  data: Uint8Array,
  p: { predictor: number; colors: number; bpc: number; columns: number },
): Uint8Array | null {
  const { predictor, colors, bpc, columns } = p;
  if (predictor <= 1) return data;
  if (![1, 2, 4, 8, 16].includes(bpc) || !(colors >= 1) || !(columns >= 1)) {
    return null;
  }
  const rowBytes = Math.ceil((colors * bpc * columns) / 8);
  const bpp = Math.ceil((colors * bpc) / 8);
  // A row longer than the data is one short row: nothing past the data is
  // ever read, so no buffer needs to be longer than it. (Hostile review r3:
  // /Columns 1e12 allocated a terabyte here and threw an untyped
  // RangeError out of the preflight.)
  if (!Number.isSafeInteger(rowBytes) || !Number.isSafeInteger(bpp)) {
    return null;
  }
  const kept = Math.min(rowBytes, data.length);
  if (predictor === 2) {
    if (bpc !== 8) return null;
    const out = data.slice();
    for (let r = 0; r < out.length; r += rowBytes) {
      const end = Math.min(out.length, r + rowBytes);
      for (let i = r + colors; i < end; i += 1) {
        out[i] = (out[i]! + out[i - colors]!) & 0xff;
      }
    }
    return out;
  }
  if (predictor < 10) return null;
  const out = new Uint8Array(
    Math.floor(data.length / (rowBytes + 1)) * rowBytes +
      Math.max(0, (data.length % (rowBytes + 1)) - 1),
  );
  let prior = new Uint8Array(kept);
  let at = 0;
  for (let r = 0; r < data.length; r += rowBytes + 1) {
    const type = data[r]!;
    const row = data.subarray(r + 1, Math.min(data.length, r + 1 + rowBytes));
    const cur = new Uint8Array(kept);
    for (let i = 0; i < row.length; i += 1) {
      const left = i >= bpp ? cur[i - bpp]! : 0;
      const up = prior[i]!;
      const upLeft = i >= bpp ? prior[i - bpp]! : 0;
      let v: number;
      if (type === 0) v = row[i]!;
      else if (type === 1) v = row[i]! + left;
      else if (type === 2) v = row[i]! + up;
      else if (type === 3) v = row[i]! + ((left + up) >> 1);
      else if (type === 4) {
        const base = left + up - upLeft;
        const pa = Math.abs(base - left);
        const pb = Math.abs(base - up);
        const pc = Math.abs(base - upLeft);
        v = row[i]! + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else return null;
      cur[i] = v & 0xff;
    }
    out.set(cur.subarray(0, row.length), at);
    at += row.length;
    prior = cur;
  }
  return out.subarray(0, at);
}

/** The generation number written before `obj` (`num gen obj`); 0 when unreadable. */
function genBefore(bytes: Uint8Array, objAt: number): number {
  let i = objAt - 1;
  while (i >= 0 && isWhite(bytes[i]!)) i -= 1;
  const end = i + 1;
  while (i >= 0 && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) i -= 1;
  if (end === i + 1) return 0;
  const gen = Number(latin1.decode(bytes.subarray(i + 1, end)));
  return Number.isInteger(gen) ? gen : 0;
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
/**
 * Content operators HELD: one joined sequence past it is content this does
 * not read (that page alone counts as such); the cache of every sequence
 * read is let go past it and read again when asked (see `contentOps`).
 */
const MAX_KEPT_OPS = 4_000_000;
/**
 * Content operators WALKED, all pages, forms and alternatives together;
 * past it, incomplete (every page then fails safe). A shared stream is
 * walked once per distinct resources (see `resKey`); without a bound, one
 * stream of 3.9 million operators named by 2,000 pages walked for 87 s on
 * the main thread before any guard could refuse (hostile review r1).
 * Measured cost: 8-24 ns an operator, so this is about half a second.
 */
export const MAX_OP_VISITS = 20_000_000;

/** A stream an object resolves to: its definition, dictionary and data. */
interface StreamDef {
  def: Def;
  dict: PdfDict;
  data: [number, number];
}

/**
 * What painting some content costs and, when asked, where. Every paint is
 * charged: pdf.js decodes an image once per page, but each `Do` of it runs
 * `paintImageXObject`, which copies the decoded pixels into a canvas of the
 * image's own size and halves it down to the drawn size, O(its pixels) on
 * the main thread every time (hostile review r1, 2026-11-14: one 16 MP
 * image painted 60 times drew for 180 s in the editor).
 */
interface Paint {
  /** Weight of paints the content is known to make. */
  exact: number;
  /**
   * Weight counted though it is not known to be painted, or not at that
   * size: everything content that cannot be read could reach, images of
   * unknown size, loose inline images' bound, what patterns, Type3 glyphs,
   * soft masks and annotation appearances may paint.
   */
  bound: number;
  /** An image pdf.js skips (own size past the preview's bound) is painted. */
  skipped: boolean;
  /** Boxes (user space) of the skipped images, when placements are asked. */
  boxes: Box[];
  /** A skipped image is (or may be) painted where no box is known. */
  uncertain: boolean;
}

const emptyPaint = (): Paint => ({
  exact: 0,
  bound: 0,
  skipped: false,
  boxes: [],
  uncertain: false,
});

function absorb(into: Paint, p: Paint): void {
  into.exact += p.exact;
  into.bound += p.bound;
  for (const b of p.boxes) into.boxes.push(b);
  if (p.skipped) into.skipped = true;
  if (p.uncertain) into.uncertain = true;
}

/** `p` painted where its placements are not known. */
function unplaced(p: Paint): Paint {
  return { ...p, boxes: [], uncertain: p.uncertain || p.skipped };
}

/** `p` counted as a bound: nothing in it is known to be painted. */
function bounded(p: Paint): Paint {
  return { ...unplaced(p), exact: 0, bound: p.exact + p.bound };
}

const weightOf = (p: Paint): number => p.exact + p.bound;

/**
 * Alternatives pdf.js picks ONE of (an object's definitions, a /Contents
 * position's): the most any may weigh, and only what every one is known to
 * paint as known.
 */
function eitherOf(ps: readonly Paint[]): Paint {
  if (ps.length === 0) return emptyPaint();
  const out = emptyPaint();
  let most = 0;
  let known = Infinity;
  for (const p of ps) {
    most = Math.max(most, weightOf(p));
    known = Math.min(known, p.exact);
    for (const b of p.boxes) out.boxes.push(b);
    if (p.skipped) out.skipped = true;
    if (p.uncertain) out.uncertain = true;
  }
  out.exact = known;
  out.bound = most - known;
  return out;
}

/** The pages and what each paints. */
export interface PageImageMap {
  /** Each page object number, with the most image pixels one of its definitions paints. */
  pages: Map<number, number>;
  /**
   * Each page object number, with the image pixels it is KNOWN to paint
   * (no bound in it: see {@link Paint.bound}). A page past the budget on
   * this figure is past it in fact; one past it only on `pages` may be.
   */
  exact: Map<number, number>;
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
  private visits = 0;
  private keptOps = 0;
  private decoded = 0;
  private pages: Map<number, PdfDict[]> | null = null;
  private readonly opsCache = new Map<string, ContentOp[] | null>();
  /** {@link contentChoices}, by the /Contents object pages name. */
  private readonly choicesCache = new Map<
    number,
    { chosen: StreamDef[]; ids: string }[] | null
  >();
  private readonly imageCache = new Map<number, ImageSize>();
  /** Unplaced paints, by stream definition and resources (see `resKey`). */
  private readonly paintCache = new Map<string, Paint>();
  private readonly indirectCache = new Map<string, Paint>();
  /** Pages' unplaced paints, by content streams and resources (see `resKey`). */
  private readonly pageCache = new Map<string, Paint>();
  private readonly dictIds = new WeakMap<PdfDict, number>();
  private readonly textIds = new Map<string, number>();

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

  /**
   * Resources as a key, by their TEXT: a dictionary means what its text
   * says (references are file-wide), so pages that each write the same
   * /Resources share one key, and a content stream they share is walked
   * once (hostile review r1: 2,000 pages sharing one stream took 87 s).
   */
  private resKey(resources: readonly PdfDict[]): string {
    return resources
      .map((r) => {
        let id = this.dictIds.get(r);
        if (id === undefined) {
          const text = latin1.decode(r.src.subarray(r.start, r.end));
          id = this.textIds.get(text);
          if (id === undefined) {
            id = this.textIds.size;
            this.textIds.set(text, id);
          }
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
    const exact = new Map<number, number>();
    try {
      for (const [num, dicts] of this.pageDefs()) {
        const paints: Paint[] = [];
        for (const dict of dicts) {
          paints.push(await this.paintPage(dict, skipAbove, false));
        }
        const p = eitherOf(paints);
        pages.set(num, weightOf(p));
        exact.set(num, p.exact);
      }
      return { pages, exact, incomplete: null };
    } catch (err) {
      if (err instanceof Incomplete) {
        return { pages, exact, incomplete: err.message };
      }
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
      const paints: Paint[] = [];
      for (const dict of dicts) {
        paints.push(await this.paintPage(dict, skipAbove, true));
      }
      const p = eitherOf(paints);
      return { boxes: p.boxes, certain: !p.uncertain, weight: weightOf(p) };
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
    const all = this.contentChoices(dict.get("Contents"));
    if (all === null) {
      absorb(out, await this.reachAll(resources, skipAbove));
    } else if (all.length > 0) {
      const read: Paint[] = [];
      for (const { chosen, ids } of all) {
        const key = `${ids}|${this.resKey(resources)}|${skipAbove}`;
        let p = place ? undefined : this.pageCache.get(key);
        if (!p) {
          p = await this.paintContent(
            chosen,
            resources,
            IDENTITY,
            0,
            new Set(),
            skipAbove,
            place,
          );
          if (!place) this.pageCache.set(key, p);
        }
        read.push(p);
      }
      absorb(out, eitherOf(read));
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
                    bounded(await this.paintUnplaced(s, res, skipAbove)),
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
      absorb(out, bounded(await this.indirectPaint(r, skipAbove)));
    }
    return out;
  }

  /**
   * The joined stream sequences a page's /Contents may be (one stream, or
   * an array, direct or not, pdf.js reads joined; each position may have
   * several definitions), each with its key; [] for none, null for more
   * than {@link MAX_CONTENT_ALTERNATIVES}. Built in time linear in the
   * positions, and once per /Contents object however many pages name it.
   *
   * History (hostile review r3, 2026-11-14): each position copied every
   * sequence built so far, quadratic in the positions, for every page: one
   * array of 20,000 references shared by 40 pages (a 127 KB file) held the
   * main thread for 33 s before pdf.js saw the file.
   */
  private contentChoices(
    contents: PdfValue | undefined,
  ): { chosen: StreamDef[]; ids: string }[] | null {
    const shared = contents instanceof PdfRef ? contents.num : null;
    if (shared !== null && this.choicesCache.has(shared)) {
      return this.choicesCache.get(shared)!;
    }
    const { index } = this;
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
    for (const p of positions) {
      combos *= p.length;
      if (combos > MAX_CONTENT_ALTERNATIVES) break;
    }
    let result: { chosen: StreamDef[]; ids: string }[] | null = null;
    if (combos <= MAX_CONTENT_ALTERNATIVES) {
      result = [];
      if (positions.length > 0) {
        // Combination k picks, at each position, digit k of a mixed radix.
        for (let k = 0; k < combos; k += 1) {
          const chosen: StreamDef[] = new Array<StreamDef>(positions.length);
          let rest = k;
          for (let i = positions.length - 1; i >= 0; i -= 1) {
            const alts = positions[i]!;
            chosen[i] = alts[rest % alts.length]!;
            rest = Math.floor(rest / alts.length);
          }
          result.push({ chosen, ids: chosen.map((c) => c.def.id).join(",") });
        }
      }
    }
    if (shared !== null) this.choicesCache.set(shared, result);
    return result;
  }

  /** The content operators of a joined stream sequence, read once. */
  private async contentOps(
    streams: readonly StreamDef[],
    geometry: boolean,
  ): Promise<ContentOp[] | null> {
    const key = `${geometry ? "g" : "w"}|${streams.map((s) => s.def.id).join(",")}`;
    if (this.opsCache.has(key)) return this.opsCache.get(key)!;
    const ops: ContentOp[] = [];
    let overflow = false;
    const lexer = this.tools.ops((op) => {
      if (ops.length >= MAX_KEPT_OPS) overflow = true;
      else ops.push(op);
    }, geometry);
    let readable = true;
    // A stream named at many positions of one /Contents is decoded once.
    const decoded = new Map<number, Uint8Array | null>();
    for (const s of streams) {
      let data = decoded.get(s.def.id);
      if (data === undefined) {
        data = await this.index.decode(
          s,
          this.tools,
          this.tools.decodeBudget - this.decoded,
        );
        decoded.set(s.def.id, data);
      }
      // Every position's bytes are lexed, so every position is charged.
      if (
        data === null ||
        overflow ||
        this.decoded + data.length > this.tools.decodeBudget
      ) {
        readable = false;
        break;
      }
      this.decoded += data.length;
      lexer.feed(data);
    }
    lexer.end();
    // One sequence past the bound is not held: it is content this cannot
    // read, and counts as such (`paintContent`), for its page alone.
    const result = readable && !overflow ? ops : null;
    // The bound on what is HELD across sequences is a cache's: past it,
    // what was held is let go and read again if asked. It ends nothing.
    // History (hostile review r3, 2026-11-14): it counted every sequence of
    // the document together and, past 4 million, ended the whole map, so
    // 150 pages of drawings with one 9 MP photo each were every one noted
    // "could not be fully read", and the output paths refused the file.
    if (result !== null) {
      if (this.keptOps + result.length > MAX_KEPT_OPS) {
        this.opsCache.clear();
        this.keptOps = 0;
      }
      this.keptOps += result.length;
    }
    this.opsCache.set(key, result);
    return result;
  }

  private async size(s: StreamDef): Promise<ImageSize> {
    const kept = this.imageCache.get(s.def.id);
    if (kept) return kept;
    const { index } = this;
    // pdf.js sizes a JPEG 2000 image (JPX its first filter) by its
    // codestream, which in an encrypted file only decryption shows: the scan
    // reads ciphertext. Unreadable here, its cost is not known.
    // History (hostile review r3, 2026-11-14): read by the dictionary alone,
    // four JPX images declared 100 x 100 with 6000 x 6000 codestreams
    // weighed 40,000 pixels in an RC4 or AES file, and the page was drawn.
    let codestream: number | null = null;
    let unread = false;
    const { filters, parms } = index.filtersOf(s);
    if (
      this.tools.encrypted &&
      (filters[0] === "JPXDecode" || filters[0] === "JPX")
    ) {
      const data = await index.decrypted(s, filters, parms);
      if (
        data === null ||
        this.decoded + data.length > this.tools.decodeBudget
      ) {
        unread = true;
      } else {
        this.decoded += data.length;
        codestream = this.tools.jpx(data);
      }
    }
    const size = this.tools.image(
      index.dictText(s.dict, s.def.src),
      (num) => index.numberIn(new PdfRef(num)) ?? undefined,
      (num) => {
        const m = index.streams(new PdfRef(num))[0];
        return m ? index.dictText(m.dict, m.def.src) : null;
      },
      s.def.num,
      codestream,
    );
    const out = unread ? { ...size, cost: null } : size;
    this.imageCache.set(s.def.id, out);
    return out;
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
    size: ImageSize,
    skipAbove: number,
    box: Box | null,
    place: boolean,
  ): void {
    const w = this.tools.weigh(size, skipAbove);
    // An image whose size cannot be read weighs a bound, not a measurement.
    if (size.own === null || size.cost === null) out.bound += w;
    else out.exact += w;
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
    // The forms already on the painting path are part of the key: what a
    // form paints depends on them (pdf.js refuses only a form that is its
    // own ancestor), so a result read under one path is not another's.
    // History (hostile review r3, 2026-11-14): without it, a cycle through a
    // shared form was cached with an ancestor cut out and reused where that
    // form was no ancestor: a page painting 64 MP weighed 32 MP or 96 MP by
    // the order of its `Do`s.
    const ancestors = [...path].sort((a, b) => a - b).join(",");
    const key = `${s.def.id}|${this.resKey(resources)}|${skipAbove}|${depth}|${ancestors}`;
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
    // Where images sit is read only when asked (`place`): a weight needs
    // no `q`, `Q` or `cm`.
    const ops = await this.contentOps(streams, place);
    if (ops === null) {
      // Content the scan cannot read may paint anything its resources hold.
      absorb(out, await this.reachAll(resources, skipAbove));
      return out;
    }
    // Every operator walked is charged: a stream read once is walked once
    // per page, form paint and alternative that reads it.
    this.visits += ops.length;
    if (this.visits > MAX_OP_VISITS) throw new Incomplete("content work");
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
          this.paintImage(out, size, skipAbove, box, place);
          break;
        }
        case "looseInline": {
          // Only a bound on this image's size is known (see ContentOps):
          // decoded, it costs at most the bound and at most `skipAbove`.
          const bound = Math.min(op.w * op.h, Number.MAX_SAFE_INTEGER);
          if (!(bound > 0)) break;
          const most = Math.min(bound, skipAbove);
          out.bound += this.tools.weigh(
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
            absorb(out, await this.reachAll(resources, skipAbove));
            break;
          }
          if (!op.exact) trusted = false;
          // The lexer keeps a name as written; pdf.js looks up its decoded
          // form, as the resource keys were decoded (`/I#30` is `/I0`).
          const name = decodeName(op.name);
          for (const x of this.xobjects(resources, name)) {
            const sub = this.index.nameOf(x.dict.get("Subtype"));
            if (sub === "Image") {
              const box = trusted ? unitBox(ctm) : null;
              this.paintImage(out, await this.size(x), skipAbove, box, place);
            } else if (sub === "Form") {
              if (path.has(x.def.num)) continue; // pdf.js refuses a circular form
              const own = this.index.dicts(x.dict.get("Resources"));
              const res = own.length > 0 ? own : resources;
              if (depth + 1 > MAX_FORM_DEPTH) {
                absorb(out, await this.reachAll(res, skipAbove));
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
        absorb(out, bounded(await this.indirectPaint(r, skipAbove)));
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
                this.paintImage(
                  out,
                  await this.size(x),
                  skipAbove,
                  null,
                  false,
                );
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
    // How many times content nobody read paints what it can reach is not
    // known, and every paint costs (see `Paint`): anything it can reach
    // that weighs at all may weigh without limit.
    // History (found in review r3, 2026-11-14): this counted each image
    // once, the rule from before every paint was charged; RunLength content
    // painting one 16 MP image four times weighed 16 MP and was drawn.
    const b = bounded(out);
    if (weightOf(b) > 0) b.bound = Number.POSITIVE_INFINITY;
    return b;
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
      absorb(out, bounded(p));
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
