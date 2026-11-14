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
 *    Type3 glyphs, soft-mask groups, annotations' normal (/N) appearances
 *    (pdf.js draws no other) — count whether
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

/**
 * `src[a, b)` as Latin-1 text. A token is a few bytes, and a TextDecoder
 * call costs far more than that many `fromCharCode`s: every name and number
 * of every object the map parses went through one (review r3 profile).
 */
function text(src: Uint8Array, a: number, b: number): string {
  if (b - a > 64) return latin1.decode(src.subarray(a, b));
  let out = "";
  for (let i = a; i < b; i += 1) out += String.fromCharCode(src[i]!);
  return out;
}

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
      tok = { t: "name", v: decodeName(text(src, i + 1, j)) };
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
      const word = text(src, i, j);
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
  /** The data's end is its /Length, and `endstream` follows it there. */
  measured: boolean;
}

/** What the scanner hands in: its decoder, its lexer, its image sizing. */
export interface PageScanTools {
  /**
   * The decoded data of a stream through `filters` (its filter names, as
   * the map resolved them, references included), streamed:
   * each chunk handed to `sink` as it is made, nothing held. The bytes
   * made, or null when a filter is one the scan does not decode, the data
   * is not valid for it, or it passes `limit` (some chunks may then have
   * reached `sink` already). `earlyChange` is an LZW stage's /EarlyChange,
   * by its position in the filter list.
   *
   * History (hostile review r3, 2026-11-14): the map held each content
   * stream whole, up to 400 MB, where the scan streams it: a 190 MB content
   * stream cost 350 MB more peak memory than main.
   */
  /** `decodeTo` hands the data on as it is: no filter in `filters` changes it. */
  unchanged(filters: readonly string[]): boolean;
  decodeTo(
    filters: readonly string[],
    data: Uint8Array,
    limit: number,
    sink: (chunk: Uint8Array) => void,
    earlyChange: readonly (number | null)[],
  ): Promise<number | null>;
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
  /** The scan's own reading of each content stream (see {@link ContentCount}). */
  counts: ReadonlyMap<number, ContentCount | null>;
  /**
   * The file's trailer names /Encrypt: its streams are decrypted before
   * `decode` (see `ObjectIndex.openEncryption`), or not read at all. A
   * trailer is one outside every stream's data (see `encryptedTrailer` in
   * ./pdfjs-guard), never the word /Encrypt anywhere in the bytes.
   */
  encrypted: boolean;
}

/**
 * One content stream as the scan's own exact reading found it (the same
 * lexer as the map's, on the same bytes): every `Do` operand with its count
 * (null: one the lexer could not keep), its inline images, and whether it
 * ended where pdf.js would start the next stream of a /Contents array
 * fresh. `start`/`end` are the data it read, so a stream whose data the map
 * would bound otherwise is not taken for it.
 */
export interface ContentCount {
  start: number;
  end: number;
  /** The /Predictor it was read through (null: none), as the map must read it too. */
  predictor: {
    predictor: number;
    colors: number;
    bpc: number;
    columns: number;
  } | null;
  dos: ReadonlyMap<string | null, number>;
  inline: {
    sized: readonly { pixels: number; bilevel: boolean }[];
    unknown: number;
    loose: number;
    looseW: number;
    looseH: number;
  };
  cleanEnd: boolean;
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
    index.dropNested();
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

  /** The file's measured stream data (see {@link Parsed.measured}), merged and sorted. */
  private dataRanges: [number, number][] = [];

  /** `at` lies inside some stream's measured data. */
  private inData(at: number): boolean {
    const r = this.dataRanges;
    let lo = 0;
    let hi = r.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (r[mid]![0] <= at) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && at < r[lo - 1]![1];
  }

  /**
   * Forget every object header that lies inside another object's stream
   * data, where its /Length says the data runs and `endstream` follows: it
   * is data (an attached PDF stored unfiltered, a page's text), and pdf.js
   * reads an object by its cross-reference, never there. A stream whose end
   * is not measured hides nothing: a damaged /Length must not make the
   * objects after it vanish.
   *
   * History (hostile review r3, 2026-11-14): an unencrypted three-page scan
   * carrying an encrypted PDF as an attachment had the attachment's page
   * indexed as a fourth page, its trailer taken as the file's, and every
   * real page noted "could not be fully read".
   */
  private dropNested(): void {
    const ranges: [number, number][] = [];
    for (const defs of this.defs.values()) {
      for (const def of defs) {
        if (!def.plain) continue;
        const p = this.parse(def);
        if (p.stream !== null && p.measured) ranges.push(p.stream);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [a, b] of ranges) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    this.dataRanges = merged;
    if (merged.length === 0) return;
    for (const [num, defs] of [...this.defs]) {
      const kept = defs.filter((d) => !d.plain || !this.inData(d.at));
      if (kept.length === 0) this.defs.delete(num);
      else if (kept.length !== defs.length) this.defs.set(num, kept);
    }
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
    let measured = false;
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
        measured = end !== -1;
        if (end === -1) {
          const e = this.endstreamFrom(start);
          end = e === -1 ? def.src.length : e;
        }
        stream = [start, end];
      }
    }
    const parsed: Parsed = { value, stream, measured };
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
  /** {@link decryptor}, synchronous, for a short stream; undefined for a long one. */
  private decryptorNow:
    | ((num: number, gen: number, data: Uint8Array) => Uint8Array | undefined)
    | null = null;

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
      if (this.inData(t)) {
        t = indexOfWord(this.bytes, TRAILER, t + TRAILER.length);
        continue;
      }
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
      const [{ StandardSecurityHandler }, { aesCbcDecryptJs }, { rc4 }] =
        await Promise.all([
          import("./security/standard-handler"),
          import("./security/aes-js"),
          import("./security/rc4"),
        ]);
      type Handler = NonNullable<
        Awaited<ReturnType<typeof StandardSecurityHandler.open>>
      >;
      // A short stream is decrypted here, synchronously, exactly as the
      // handler would (`aes-js.test.ts`); a long one by the handler, whose
      // WebCrypto is faster per byte but costs a call each.
      // History (hostile review r3, 2026-11-14): one WebCrypto call per
      // stream, a 100,000-stream AES file held the preflight 4.3 s (main
      // 0.86 s), all of it WebCrypto's own per-call work.
      const shortDecrypt = (
        h: Handler,
        num: number,
        gen: number,
        data: Uint8Array,
      ): Uint8Array | undefined => {
        if (data.length > SHORT_CIPHER_TEXT) return undefined;
        const { method, key } = h.keyFor("stream", num, gen);
        if (method === "identity") return data;
        if (method === "rc4") return rc4(key, data);
        if (data.length < 32) return new Uint8Array(0);
        const body = data.subarray(
          16,
          16 + Math.floor((data.length - 16) / 16) * 16,
        );
        return aesCbcDecryptJs(key, data.subarray(0, 16), body);
      };
      const decryptWith = async (
        h: Handler,
        num: number,
        gen: number,
        data: Uint8Array,
      ): Promise<Uint8Array> =>
        shortDecrypt(h, num, gen, data) ?? h.decrypt("stream", num, gen, data);
      const handler = await StandardSecurityHandler.open(params, "");
      if (handler) {
        this.decryptor = (num, gen, data) =>
          decryptWith(handler, num, gen, data);
        this.decryptorNow = (num, gen, data) =>
          shortDecrypt(handler, num, gen, data);
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
          return with_ ? decryptWith(with_, num, gen, data) : null;
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
   * {@link decrypted} when it needs no await: the data, null where
   * `decrypted` gives null, undefined when only `decrypted` can say (a long
   * stream, a /Crypt stage).
   */
  decryptedNow(
    s: StreamDef,
    filters: readonly string[],
  ): Uint8Array | null | undefined {
    const data = s.def.src.subarray(s.data[0], s.data[1]);
    if (!this.encrypted) return data;
    if (filters.includes("Crypt")) return undefined;
    const type = this.nameOf(s.dict.get("Type"));
    if (type === "XRef" || (type === "Metadata" && !this.encryptMetadata)) {
      return data;
    }
    if (this.decryptor === null) return null;
    return this.decryptorNow?.(s.def.num, s.def.gen, data);
  }

  /**
   * {@link decodeDecrypted} when it needs no await (no filter changes the
   * data, no predictor): the bytes handed to `sink`, null past `limit`,
   * undefined when only `decodeDecrypted` can say.
   */
  decodeNow(
    filters: readonly string[],
    parms: readonly (PdfDict | null)[],
    data: Uint8Array,
    tools: PageScanTools,
    limit: number,
    sink: (chunk: Uint8Array) => void,
  ): number | null | undefined {
    if (!tools.unchanged(filters)) return undefined;
    if (this.predictorOf(filters, parms) !== null) return undefined;
    if (data.length > limit) return null;
    sink(data);
    return data.length;
  }

  /**
   * The /Predictor pdf.js reads a stream's data through (it applies one
   * after a Flate or LZW stage): null for none, undefined when it follows a
   * stage that is not the last (which this does not read).
   */
  predictorOf(
    filters: readonly string[],
    parms: readonly (PdfDict | null)[],
  ):
    | { predictor: number; colors: number; bpc: number; columns: number }
    | null
    | undefined {
    const single = parms.length === 1 && filters.length === 1;
    let predicted = -1;
    for (let i = 0; i < filters.length; i += 1) {
      const p = single ? parms[0] : parms[i];
      if (!p || !PREDICTED.has(filters[i]!)) continue;
      if ((this.numberIn(p.get("Predictor")) ?? 1) > 1) predicted = i;
      if (predicted !== -1 && predicted !== filters.length - 1) {
        return undefined;
      }
    }
    if (predicted === -1) return null;
    const p = (single ? parms[0] : parms[predicted])!;
    return {
      predictor: this.numberIn(p.get("Predictor")) ?? 1,
      colors: this.numberIn(p.get("Colors")) ?? 1,
      bpc: this.numberIn(p.get("BitsPerComponent")) ?? 8,
      columns: this.numberIn(p.get("Columns")) ?? 1,
    };
  }

  /**
   * A stream's data as pdf.js reads it: decrypted (an encrypted file),
   * through its filters (`tools.decodeTo`), and through a Flate stage's PNG
   * or TIFF predictor. Null when any step cannot be done here.
   */
  async decode(
    s: StreamDef,
    tools: PageScanTools,
    limit: number,
  ): Promise<Uint8Array | null> {
    const chunks: Uint8Array[] = [];
    const total = await this.decodeTo(s, tools, limit, (c) =>
      chunks.push(c.slice()),
    );
    if (total === null) return null;
    if (chunks.length === 1) return chunks[0]!;
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  /**
   * {@link decode}, streamed into `sink` (content is lexed as it decodes,
   * never held whole): the bytes made, or null when the stream cannot be
   * read here (chunks may have reached `sink` by then; the caller then
   * discards what it read).
   */
  async decodeTo(
    s: StreamDef,
    tools: PageScanTools,
    limit: number,
    sink: (chunk: Uint8Array) => void,
  ): Promise<number | null> {
    const { filters, parms } = this.filtersOf(s);
    const data = await this.decrypted(s, filters, parms);
    if (data === null) return null;
    return this.decodeDecrypted(s, filters, parms, data, tools, limit, sink);
  }

  /** {@link decodeTo} past decryption: `data` is what the filters read. */
  async decodeDecrypted(
    s: StreamDef,
    filters: readonly string[],
    parms: readonly (PdfDict | null)[],
    data: Uint8Array,
    tools: PageScanTools,
    limit: number,
    sink: (chunk: Uint8Array) => void,
  ): Promise<number | null> {
    const single = parms.length === 1 && filters.length === 1;
    const earlyChange = filters.map((_, i) => {
      const p = (single ? parms[0] : parms[i]) ?? null;
      return p ? this.numberIn(p.get("EarlyChange")) : null;
    });
    const predictor = this.predictorOf(filters, parms);
    if (predictor === undefined) return null;
    if (predictor === null) {
      return tools.decodeTo(filters, data, limit, sink, earlyChange);
    }
    const un = Unpredictor.of(predictor, sink);
    if (un === null) return null;
    const made = await tools.decodeTo(
      filters,
      data,
      limit,
      (c) => un.feed(c),
      earlyChange,
    );
    return made === null || !un.end() ? null : un.made;
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
  if (p.predictor <= 1) return data;
  const out = new Uint8Array(data.length);
  let at = 0;
  const un = Unpredictor.of(p, (c) => {
    out.set(c, at);
    at += c.length;
  });
  if (un === null) return null;
  un.feed(data);
  return un.end() ? out.subarray(0, at) : null;
}

/**
 * {@link unpredict}, streamed: rows are undone as their bytes arrive and
 * handed on, the previous row the only one held. One output buffer per
 * chunk fed, none per row.
 *
 * History (hostile review r3, 2026-11-14): two typed arrays were allocated
 * for EVERY row, so /Columns 1 (one byte a row) cost about 115 ns a byte:
 * 64 MB of content held the main thread for 8 s, 300 MB for 38 s, on pages
 * main draws in under a second.
 */
export class Unpredictor {
  /** Bytes handed on so far. */
  made = 0;
  private failed = false;
  /** Column in the current row; -1 while a PNG row's filter byte is due. */
  private col: number;
  private type = 0;
  private hasPrev = false;
  private row: Uint8Array;
  private prev: Uint8Array;

  private constructor(
    private readonly png: boolean,
    private readonly rowBytes: number,
    private readonly bpp: number,
    private readonly sink: (chunk: Uint8Array) => void,
  ) {
    this.col = png ? -1 : 0;
    // A row longer than the data is one short row: the buffers grow with
    // what arrives, so no row is ever allocated longer than the data.
    // (Hostile review r3: /Columns 1e12 allocated a terabyte here and threw
    // an untyped RangeError out of the preflight.)
    const first = Math.min(rowBytes, 1 << 16);
    this.row = new Uint8Array(first);
    this.prev = new Uint8Array(png ? first : 0);
  }

  /** Null for parameters pdf.js refuses or this does not undo. */
  static of(
    p: { predictor: number; colors: number; bpc: number; columns: number },
    sink: (chunk: Uint8Array) => void,
  ): Unpredictor | null {
    const { predictor, colors, bpc, columns } = p;
    if (![1, 2, 4, 8, 16].includes(bpc) || !(colors >= 1) || !(columns >= 1)) {
      return null;
    }
    const rowBytes = Math.ceil((colors * bpc * columns) / 8);
    const bpp = Math.ceil((colors * bpc) / 8);
    if (!Number.isSafeInteger(rowBytes) || !Number.isSafeInteger(bpp)) {
      return null;
    }
    if (predictor === 2) {
      // TIFF: each byte plus the one `colors` before it, within its row.
      return bpc === 8 ? new Unpredictor(false, rowBytes, colors, sink) : null;
    }
    if (predictor < 10) return null;
    return new Unpredictor(true, rowBytes, bpp, sink);
  }

  private grow(): void {
    const size = Math.min(this.rowBytes, this.row.length * 2);
    const row = new Uint8Array(size);
    row.set(this.row);
    this.row = row;
    if (this.png && this.prev.length < size) {
      const prev = new Uint8Array(size);
      prev.set(this.prev);
      this.prev = prev;
    }
  }

  feed(chunk: Uint8Array): void {
    if (this.failed || chunk.length === 0) return;
    const out = new Uint8Array(chunk.length);
    let n = 0;
    const { rowBytes, bpp, png } = this;
    let { col, type, hasPrev, row, prev } = this;
    const len = chunk.length;
    let k = 0;
    if (png && rowBytes === 1) {
      // One byte a row (/Columns 1 of 8-bit gray, the costliest shape per
      // byte): each row is its filter byte and one value, whose left and
      // upper-left are 0, so every filter but Average adds the byte above.
      let up = hasPrev ? prev[0]! : 0;
      while (k < len) {
        if (col === -1) {
          type = chunk[k++]!;
          col = 0;
          continue;
        }
        const b = chunk[k++]!;
        let v: number;
        if (type === 0 || type === 1) v = b;
        else if (type === 2 || type === 4) v = (b + up) & 0xff;
        else if (type === 3) v = (b + (up >> 1)) & 0xff;
        else {
          this.failed = true;
          return;
        }
        out[n++] = v;
        up = v;
        col = -1;
        hasPrev = true;
      }
      prev[0] = up;
      this.col = col;
      this.type = type;
      this.hasPrev = hasPrev;
      if (n > 0) {
        this.made += n;
        this.sink(out.subarray(0, n));
      }
      return;
    }
    // Row by row: a run of one row's bytes at a time, one loop per filter
    // type, so a row costs its bytes and a little, never a branch a byte.
    while (k < len) {
      if (col === -1) {
        type = chunk[k++]!;
        col = 0;
        continue;
      }
      const run = Math.min(rowBytes - col, len - k);
      if (col + run > row.length) {
        this.row = row;
        this.prev = prev;
        while (col + run > this.row.length) this.grow();
        row = this.row;
        prev = this.prev;
      }
      const end = col + run;
      if (!png) {
        for (let c = col; c < end; c += 1) {
          const b = chunk[k++]!;
          const v = c >= bpp ? (b + row[c - bpp]!) & 0xff : b;
          row[c] = v;
          out[n++] = v;
        }
      } else if (type === 0) {
        for (let c = col; c < end; c += 1) {
          const v = chunk[k++]!;
          row[c] = v;
          out[n++] = v;
        }
      } else if (type === 1) {
        for (let c = col; c < end; c += 1) {
          const v = (chunk[k++]! + (c >= bpp ? row[c - bpp]! : 0)) & 0xff;
          row[c] = v;
          out[n++] = v;
        }
      } else if (type === 2) {
        for (let c = col; c < end; c += 1) {
          const v = (chunk[k++]! + (hasPrev ? prev[c]! : 0)) & 0xff;
          row[c] = v;
          out[n++] = v;
        }
      } else if (type === 3) {
        for (let c = col; c < end; c += 1) {
          const left = c >= bpp ? row[c - bpp]! : 0;
          const up = hasPrev ? prev[c]! : 0;
          const v = (chunk[k++]! + ((left + up) >> 1)) & 0xff;
          row[c] = v;
          out[n++] = v;
        }
      } else if (type === 4) {
        for (let c = col; c < end; c += 1) {
          const left = c >= bpp ? row[c - bpp]! : 0;
          const up = hasPrev ? prev[c]! : 0;
          const upLeft = hasPrev && c >= bpp ? prev[c - bpp]! : 0;
          const base = left + up - upLeft;
          const pa = Math.abs(base - left);
          const pb = Math.abs(base - up);
          const pc = Math.abs(base - upLeft);
          const v =
            (chunk[k++]! +
              (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) &
            0xff;
          row[c] = v;
          out[n++] = v;
        }
      } else {
        // A row filter pdf.js refuses, on a row with data.
        this.failed = true;
        return;
      }
      col = end;
      if (col === rowBytes) {
        if (png) {
          const t = prev;
          prev = row;
          row = t.length >= prev.length ? t : new Uint8Array(prev.length);
          hasPrev = true;
          col = -1;
        } else col = 0;
      }
    }
    this.col = col;
    this.type = type;
    this.hasPrev = hasPrev;
    this.row = row;
    this.prev = prev;
    if (n > 0) {
      this.made += n;
      this.sink(out.subarray(0, n));
    }
  }

  /** The data was undone whole (no refused row filter). */
  end(): boolean {
    return !this.failed;
  }
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

/** The painting path above a page's own content: no form. */
const NO_PATH: ReadonlySet<number> = new Set();

/** Forms nested past this are not followed: what lies below counts whole. */
export const MAX_FORM_DEPTH = 32;
/** Combinations of a page's content-stream definitions read; past it, whole. */
export const MAX_CONTENT_ALTERNATIVES = 8;
/**
 * Resource lookups (one per distinct `Do` name a walk reads, however often
 * it runs) and resource entries walked, all pages together; past it,
 * incomplete.
 */
export const MAX_PAINT_STEPS = 2_000_000;
/**
 * Content operators HELD: one joined sequence past it is content this does
 * not read (that page alone counts as such); the cache of every sequence
 * read is let go past it and read again when asked (see `contentOps`).
 */
const MAX_KEPT_OPS = 4_000_000;
/** A stream ciphertext at most this long is decrypted in JavaScript, not by a WebCrypto call. */
const SHORT_CIPHER_TEXT = 16_384;
/** A stream at most this long (stored, or decoded) is held for its repeats. */
const KEEP_DECODED = 1 << 20;
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

/** `p` painted `n` times, added to `into`. */
function absorbTimes(into: Paint, p: Paint, n: number): void {
  into.exact += p.exact * n;
  into.bound += p.bound * n;
  for (const b of p.boxes) into.boxes.push(b);
  if (p.skipped) into.skipped = true;
  if (p.uncertain) into.uncertain = true;
}

/**
 * What a paint read under one painting path depended on, gathered as it is
 * read: `cuts`, the forms on the path above it that its walk refused as
 * circular (`f<num>`), and the resource dictionaries whose indirect paint
 * was being summed when it met them (`i<key>`, see `indirectPaint`);
 * `flagged` when its walk met any refusal or the depth bound at all, so its
 * figure may hold a form that some other path refuses.
 */
interface Deps {
  cuts: Set<string>;
  flagged: boolean;
}

/**
 * A remembered paint. It holds for any path containing every form in its
 * `cuts` (whose indirect `i` cuts are all being summed): exactly when it is
 * not `flagged` or was read under the very same path (`pathKey`); else as a
 * bound only, since a path holding a form its walk painted refuses that
 * form, and paints less.
 *
 * History (hostile review r3, 2026-11-14): the key held every form on the
 * path. A diamond lattice of forms (each painting both of the next level's)
 * reaches its k-th level by 2^(k-1) paths, none ever matched, and a 13 KB
 * text-only page held the main thread 5.2 s and 690 MB before the map gave
 * up and noted it. Without the path at all (review r2), a cycle through a
 * shared form was remembered with an ancestor cut out and reused where it
 * was none: 32 MP for a page painting 64 MP.
 */
interface Memo {
  paint: Paint;
  cuts: readonly string[];
  flagged: boolean;
  pathKey: string;
}

/** Paths remembered per form, resources and depth before every other path takes the bound read with none. */
const MAX_MEMO_PATHS = 4;

/**
 * What a weight needs of some content: every `Do` operand with how many
 * times it is run, every inline image by size with its count. A weight is
 * a sum, so order and placement do not matter, and a name run 6,000 times
 * is looked up once. Placements read the operators in order instead
 * (`contentOps`).
 *
 * History (hostile review r3, 2026-11-14): every `Do` was a step of the
 * map's document-wide bound, so 400 pages of 6,000 icon paints each (2.4
 * million `Do`) ended the map at page 333 and every page was noted; so did
 * a 20-page map of 120,000 symbol forms a page.
 */
interface ContentSummary {
  /** Each `Do` operand as written (null: one the lexer could not keep), with its count. */
  dos: Map<string | null, number>;
  /** Inline images the exact reading sized (or could not), by size, with counts. */
  inline: Map<string, { size: ImageSize; n: number }>;
  /** Inline images only the loose reading saw, by bound, with counts. */
  loose: Map<string, { w: number; h: number; n: number }>;
  /** Distinct entries held. */
  entries: number;
}

function addInline(sum: ContentSummary, key: string, size: ImageSize): void {
  const e = sum.inline.get(key);
  if (e) e.n += 1;
  else {
    sum.entries += 1;
    sum.inline.set(key, { size, n: 1 });
  }
}

function addLoose(sum: ContentSummary, w: number, h: number): void {
  const key = `${w}x${h}`;
  const e = sum.loose.get(key);
  if (e) e.n += 1;
  else {
    sum.entries += 1;
    sum.loose.set(key, { w, h, n: 1 });
  }
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
  /** {@link contentSummary}, by the stream definitions read. */
  private readonly summaryCache = new Map<string, ContentSummary | null>();
  private readonly imageCache = new Map<number, ImageSize>();
  /**
   * Unplaced paints, by stream definition, resources (see `resKey`), bound
   * and depth: each with what it depended on (see {@link Memo}).
   */
  private readonly paintCache = new Map<string, Memo[]>();
  /** A paint read with no forms on its path: a bound for every path. */
  private readonly universal = new Map<string, Memo>();
  private readonly indirectCache = new Map<string, Memo[]>();
  /** Resource dictionaries whose {@link indirectPaint} is being summed. */
  private readonly summing = new Set<string>();
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
    this.steps = 0;
    this.visits = 0;
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
    // Each call is its own bounded work: one page's placements are not
    // refused for the steps a whole document's weights took before them.
    this.steps = 0;
    this.visits = 0;
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
    // Annotation appearances: pdf.js draws them with the page, each from
    // its own stream and resources; where it places them is not followed.
    // Only the normal appearance (/N) is ever drawn (`setAppearance`: the
    // /AS state of it; a check box reads its on and off states): every
    // state of /N counts, summed, and /R and /D, which pdf.js never draws,
    // do not. (Review r3: a pressed-state /D lattice weighed 134 MP on a
    // text-only page pdf.js paints no image on.)
    for (const annots of index.all(dict.get("Annots"))) {
      if (!Array.isArray(annots)) continue;
      for (const a of annots) {
        for (const annot of index.dicts(a)) {
          for (const ap of index.dicts(annot.get("AP"))) {
            const v = ap.get("N");
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
    // What the page's resources may paint with no `Do`.
    for (const r of resources) {
      absorb(out, bounded(await this.indirectPaint(r, skipAbove)));
    }
    const all = this.contentChoices(dict.get("Contents"));
    if (all === null) {
      absorb(out, await this.reachAll(resources, skipAbove));
      return out;
    }
    if (all.length === 0) return out;
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
          NO_PATH,
          skipAbove,
          place,
          { cuts: new Set(), flagged: false },
        );
        if (!place) this.pageCache.set(key, p);
      }
      read.push(p);
    }
    absorb(out, eitherOf(read));
    return out;
  }

  /**
   * The scan's reading of each stream of a joined sequence, or null when
   * it is not what pdf.js reads of the sequence: a stream it did not read
   * whole (or read at other bounds), or one that does not end where pdf.js
   * starts the next stream fresh (or was read loose).
   */
  private countsOf(chosen: readonly StreamDef[]): ContentCount[] | null {
    const out: ContentCount[] = [];
    for (let i = 0; i < chosen.length; i += 1) {
      const s = chosen[i]!;
      const c = this.tools.counts.get(s.def.num);
      if (!c || !s.def.plain || c.start !== s.data[0] || c.end !== s.data[1]) {
        return null;
      }
      if (i < chosen.length - 1 && !c.cleanEnd) return null;
      // The predictor the scan read it through must be the one this would.
      const { filters, parms } = this.index.filtersOf(s);
      const p = this.index.predictorOf(filters, parms);
      const q = c.predictor;
      if (
        p === undefined ||
        (p === null) !== (q === null) ||
        (p !== null &&
          q !== null &&
          (p.predictor !== q.predictor ||
            p.colors !== q.colors ||
            p.bpc !== q.bpc ||
            p.columns !== q.columns))
      ) {
        return null;
      }
      out.push(c);
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

  /**
   * Decode a joined stream sequence into `feed`, in order, streamed: false
   * when some stream cannot be read here, or the decode budget passes (what
   * reached `feed` is then to be discarded), or `stop` says so.
   *
   * A stream named at many positions is decoded once while small, and
   * every position is charged (every position's bytes are lexed). A short
   * stream that needs no filter is read with no `await` at all (an
   * encrypted one decrypted in JavaScript, see `ObjectIndex.decryptedNow`):
   * one await per stream was most of a 100,000-stream file's cost.
   */
  private async readContent(
    streams: readonly StreamDef[],
    feed: (chunk: Uint8Array) => void,
    stop: () => boolean,
  ): Promise<boolean> {
    const { index, tools } = this;
    const kept = new Map<number, Uint8Array>();
    // Positions still to come per stream: a stream with more is held.
    const remaining = new Map<number, number>();
    for (const s of streams) {
      remaining.set(s.def.id, (remaining.get(s.def.id) ?? 0) + 1);
    }
    for (const s of streams) {
      if (stop()) return false;
      const left = remaining.get(s.def.id)! - 1;
      remaining.set(s.def.id, left);
      const again = kept.get(s.def.id);
      if (again !== undefined) {
        if (this.decoded + again.length > tools.decodeBudget) return false;
        this.decoded += again.length;
        feed(again);
        continue;
      }
      const { filters, parms } = index.filtersOf(s);
      let data = index.decryptedNow(s, filters);
      // A cipher call that throws reads as a stream not read here.
      if (data === undefined) {
        data = await index.decrypted(s, filters, parms).catch(() => null);
      }
      if (data === null) return false;
      const chunks: Uint8Array[] | null = left > 0 ? [] : null;
      let held = 0;
      const sink = (c: Uint8Array) => {
        feed(c);
        if (chunks !== null && held <= KEEP_DECODED) {
          held += c.length;
          chunks.push(c.slice());
        }
      };
      const limit = tools.decodeBudget - this.decoded;
      let made = index.decodeNow(filters, parms, data, tools, limit, sink);
      if (made === undefined) {
        made = await index.decodeDecrypted(
          s,
          filters,
          parms,
          data,
          tools,
          limit,
          sink,
        );
      }
      if (made === null || this.decoded + made > tools.decodeBudget) {
        return false;
      }
      this.decoded += made;
      if (chunks !== null && held <= KEEP_DECODED) {
        const whole = new Uint8Array(held);
        let at = 0;
        for (const c of chunks) {
          whole.set(c, at);
          at += c.length;
        }
        kept.set(s.def.id, whole);
      }
    }
    return !stop();
  }

  /** The content operators of a joined stream sequence, read once (placements). */
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
    const readable = await this.readContent(
      streams,
      (c) => lexer.feed(c),
      () => overflow,
    );
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
        this.summaryCache.clear();
        this.keptOps = 0;
      }
      this.keptOps += result.length;
    }
    this.opsCache.set(key, result);
    return result;
  }

  /** What a weight needs of a joined stream sequence (see {@link ContentSummary}), read once. */
  private async contentSummary(
    streams: readonly StreamDef[],
  ): Promise<ContentSummary | null> {
    const key = streams.map((s) => s.def.id).join(",");
    if (this.summaryCache.has(key)) return this.summaryCache.get(key)!;
    const sum: ContentSummary = {
      dos: new Map(),
      inline: new Map(),
      loose: new Map(),
      entries: 0,
    };
    // Content the scan read whole is summed from the scan's own reading:
    // exactly what reading it again here would report (the same lexer on
    // the same bytes), so it is never decoded or lexed twice.
    // History (legit-corpus review r3, 2026-11-14): every content stream of
    // a document the map ran on was decoded and lexed again after the scan
    // had, about 3x main's preflight time on vector-heavy files (ten CAD
    // sheets of 500,000 segments and a 6 MP photo each: 3.3 s, main 1.1 s).
    const counted = this.countsOf(streams);
    if (counted !== null) {
      for (const c of counted) {
        for (const [name, n] of c.dos) {
          const was = sum.dos.get(name);
          if (was === undefined) sum.entries += 1;
          sum.dos.set(name, (was ?? 0) + n);
        }
        for (const x of c.inline.sized) {
          addInline(sum, `${x.pixels}|${x.bilevel}|false`, {
            own: x.pixels,
            cost: x.pixels,
            bilevel: x.bilevel,
          });
        }
        for (let k = 0; k < c.inline.unknown; k += 1) {
          addInline(sum, "0|false|true", {
            own: null,
            cost: null,
            bilevel: false,
          });
        }
        for (let k = 0; k < c.inline.loose; k += 1) {
          addLoose(sum, c.inline.looseW, c.inline.looseH);
        }
      }
      this.summaryCache.set(key, sum);
      return sum;
    }
    const lexer = this.tools.ops((op) => {
      if (op.op === "Do") {
        const n = sum.dos.get(op.name);
        if (n === undefined) sum.entries += 1;
        sum.dos.set(op.name, (n ?? 0) + 1);
      } else if (op.op === "inline") {
        addInline(
          sum,
          `${op.pixels}|${op.bilevel}|${op.unknown}`,
          op.unknown
            ? { own: null, cost: null, bilevel: false }
            : { own: op.pixels, cost: op.pixels, bilevel: op.bilevel },
        );
      } else if (op.op === "looseInline") {
        addLoose(sum, op.w, op.h);
      }
    }, false);
    const readable = await this.readContent(
      streams,
      (c) => lexer.feed(c),
      () => sum.entries > MAX_KEPT_OPS,
    );
    lexer.end();
    const result = readable && sum.entries <= MAX_KEPT_OPS ? sum : null;
    if (result !== null) {
      if (this.keptOps + result.entries > MAX_KEPT_OPS) {
        this.opsCache.clear();
        this.summaryCache.clear();
        this.keptOps = 0;
      }
      this.keptOps += result.entries;
    }
    this.summaryCache.set(key, result);
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

  /** An image painted `times` times: its weight, and its box when it is skipped and placed. */
  private paintImage(
    out: Paint,
    size: ImageSize,
    skipAbove: number,
    box: Box | null,
    place: boolean,
    times = 1,
  ): void {
    const w = this.tools.weigh(size, skipAbove) * times;
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

  /** An inline image only the loose reading saw, `times` times (see ContentOps). */
  private paintLoose(
    out: Paint,
    w: number,
    h: number,
    skipAbove: number,
    place: boolean,
    times = 1,
  ): void {
    // Only a bound on this image's size is known: decoded, it costs at
    // most the bound and at most `skipAbove`.
    const bound = Math.min(w * h, Number.MAX_SAFE_INTEGER);
    if (!(bound > 0)) return;
    const most = Math.min(bound, skipAbove);
    out.bound +=
      this.tools.weigh({ own: most, cost: most, bilevel: false }, skipAbove) *
      times;
    if (bound > skipAbove) {
      out.skipped = true;
      if (place) out.uncertain = true;
    }
  }

  /** Every cut in `cuts` holds on `path` (see {@link Memo}). */
  private holds(cuts: readonly string[], path: ReadonlySet<number>): boolean {
    for (const c of cuts) {
      const ok =
        c[0] === "f"
          ? path.has(Number(c.slice(1)))
          : this.summing.has(c.slice(1));
      if (!ok) return false;
    }
    return true;
  }

  /** A remembered paint, its dependencies handed on to `deps`; a bound only when `demote`. */
  private recall(m: Memo, deps: Deps | null, demote: boolean): Paint {
    if (deps) {
      for (const c of m.cuts) deps.cuts.add(c);
      if (m.flagged) deps.flagged = true;
    }
    return demote ? bounded(m.paint) : m.paint;
  }

  /** Read `s` as a form under `path`, with what the paint depended on. */
  private async readForm(
    s: StreamDef,
    resources: readonly PdfDict[],
    skipAbove: number,
    depth: number,
    path: ReadonlySet<number>,
    pathKey: string,
  ): Promise<Memo> {
    const local: Deps = { cuts: new Set(), flagged: false };
    const inner = new Set(path);
    inner.add(s.def.num);
    const paint = await this.paintContent(
      [s],
      resources,
      IDENTITY,
      depth,
      inner,
      skipAbove,
      false,
      local,
    );
    // A refusal of `s` itself is inside its own walk: no path above holds it.
    local.cuts.delete(`f${s.def.num}`);
    return { paint, cuts: [...local.cuts], flagged: local.flagged, pathKey };
  }

  /**
   * A form, pattern, glyph or appearance, painted where its placement is not
   * followed. Remembered by stream, resources, bound and depth, with what
   * the paint depended on (see {@link Memo}): a walk that refused no form
   * holds on every path, so an acyclic graph of forms, however many paths
   * reach a form, is walked once a form.
   */
  private async paintUnplaced(
    s: StreamDef,
    resources: readonly PdfDict[],
    skipAbove: number,
    depth = 0,
    path: ReadonlySet<number> = NO_PATH,
    deps: Deps | null = null,
  ): Promise<Paint> {
    const base = `${s.def.id}|${this.resKey(resources)}|${skipAbove}|${depth}`;
    let pathKey: string | null = null;
    const keyOfPath = () =>
      (pathKey ??= [...path].sort((a, b) => a - b).join(","));
    const memos = this.paintCache.get(base);
    if (memos) {
      for (const m of memos) {
        if (!this.holds(m.cuts, path)) continue;
        if (m.flagged && m.pathKey !== keyOfPath()) continue;
        return this.recall(m, deps, false);
      }
      if (memos.length >= MAX_MEMO_PATHS) {
        // Paths past the few remembered take the paint read with no form
        // above: no path refuses less, so it bounds every one.
        let u = this.universal.get(base);
        if (!u || !this.holds(u.cuts, NO_PATH)) {
          u = await this.readForm(s, resources, skipAbove, depth, NO_PATH, "");
          this.universal.set(base, u);
        }
        return this.recall(u, deps, u.flagged);
      }
    }
    const m = await this.readForm(
      s,
      resources,
      skipAbove,
      depth,
      path,
      keyOfPath(),
    );
    const now = this.paintCache.get(base);
    if (now) now.push(m);
    else this.paintCache.set(base, [m]);
    return this.recall(m, deps, false);
  }

  /**
   * The paint of form `x`, called by content painted with `resources` at
   * `depth`; null when pdf.js refuses it (a form already on the path).
   */
  private async formPaint(
    x: StreamDef,
    resources: readonly PdfDict[],
    depth: number,
    path: ReadonlySet<number>,
    skipAbove: number,
    deps: Deps,
  ): Promise<Paint | null> {
    if (path.has(x.def.num)) {
      // pdf.js refuses a circular form.
      deps.cuts.add(`f${x.def.num}`);
      deps.flagged = true;
      return null;
    }
    const own = this.index.dicts(x.dict.get("Resources"));
    const res = own.length > 0 ? own : resources;
    if (depth + 1 > MAX_FORM_DEPTH) {
      deps.flagged = true;
      return this.reachAll(res, skipAbove, deps);
    }
    return this.paintUnplaced(x, res, skipAbove, depth + 1, path, deps);
  }

  /** What some content paints, as a weight (see {@link ContentSummary}). */
  private async weighContent(
    streams: readonly StreamDef[],
    resources: readonly PdfDict[],
    depth: number,
    path: ReadonlySet<number>,
    skipAbove: number,
    deps: Deps,
  ): Promise<Paint> {
    const out = emptyPaint();
    const sum = await this.contentSummary(streams);
    if (sum === null) {
      // Content the scan cannot read may paint anything its resources hold.
      absorb(out, await this.reachAll(resources, skipAbove, deps));
      return out;
    }
    // Every entry walked is charged: a sequence read once is walked once
    // per page, form paint and alternative that reads it.
    this.visits += sum.entries;
    if (this.visits > MAX_OP_VISITS) throw new Incomplete("content work");
    for (const { size, n } of sum.inline.values()) {
      this.paintImage(out, size, skipAbove, null, false, n);
    }
    for (const { w, h, n } of sum.loose.values()) {
      this.paintLoose(out, w, h, skipAbove, false, n);
    }
    for (const [raw, n] of sum.dos) {
      if (raw === null) {
        // A `Do` whose operand the lexer could not keep: any XObject.
        absorb(out, await this.reachAll(resources, skipAbove, deps));
        continue;
      }
      // The lexer keeps a name as written; pdf.js looks up its decoded
      // form, as the resource keys were decoded (`/I#30` is `/I0`).
      for (const x of this.xobjects(resources, decodeName(raw))) {
        const sub = this.index.nameOf(x.dict.get("Subtype"));
        if (sub === "Image") {
          this.paintImage(out, await this.size(x), skipAbove, null, false, n);
        } else if (sub === "Form") {
          const inner = await this.formPaint(
            x,
            resources,
            depth,
            path,
            skipAbove,
            deps,
          );
          if (inner) absorbTimes(out, inner, n);
        }
      }
    }
    // What a form's own resources may paint with no `Do`.
    if (depth > 0) {
      for (const r of resources) {
        absorb(out, bounded(await this.indirectPaint(r, skipAbove, deps)));
      }
    }
    return out;
  }

  private async paintContent(
    streams: readonly StreamDef[],
    resources: readonly PdfDict[],
    base: Matrix,
    depth: number,
    path: ReadonlySet<number>,
    skipAbove: number,
    place: boolean,
    deps: Deps,
  ): Promise<Paint> {
    // A weight needs no order, no `q`, `Q` or `cm`: only placements walk
    // the operators one by one.
    if (!place) {
      return this.weighContent(
        streams,
        resources,
        depth,
        path,
        skipAbove,
        deps,
      );
    }
    const out = emptyPaint();
    const ops = await this.contentOps(streams, true);
    if (ops === null) {
      // Content the scan cannot read may paint anything its resources hold.
      absorb(out, await this.reachAll(resources, skipAbove, deps));
      return out;
    }
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
          this.paintImage(out, size, skipAbove, box, true);
          break;
        }
        case "looseInline":
          this.paintLoose(out, op.w, op.h, skipAbove, true);
          break;
        case "Do": {
          if (op.name === null) {
            // A `Do` whose operand the lexer could not keep: any XObject.
            absorb(out, await this.reachAll(resources, skipAbove, deps));
            break;
          }
          if (!op.exact) trusted = false;
          const name = decodeName(op.name);
          for (const x of this.xobjects(resources, name)) {
            const sub = this.index.nameOf(x.dict.get("Subtype"));
            if (sub === "Image") {
              const box = trusted ? unitBox(ctm) : null;
              this.paintImage(out, await this.size(x), skipAbove, box, true);
            } else if (sub === "Form") {
              const m = this.matrixOf(x.dict.get("Matrix"));
              if (
                trusted &&
                m !== null &&
                !path.has(x.def.num) &&
                depth + 1 <= MAX_FORM_DEPTH
              ) {
                const own = this.index.dicts(x.dict.get("Resources"));
                const inner = new Set(path);
                inner.add(x.def.num);
                absorb(
                  out,
                  await this.paintContent(
                    [x],
                    own.length > 0 ? own : resources,
                    mul(m, ctm),
                    depth + 1,
                    inner,
                    skipAbove,
                    true,
                    deps,
                  ),
                );
              } else {
                const inner = await this.formPaint(
                  x,
                  resources,
                  depth,
                  path,
                  skipAbove,
                  deps,
                );
                if (inner) absorb(out, unplaced(inner));
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
        absorb(out, bounded(await this.indirectPaint(r, skipAbove, deps)));
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
    deps: Deps | null = null,
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
        absorb(out, await this.indirectPaint(r, skipAbove, deps));
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
   *
   * A dictionary reachable from itself (a glyph procedure with no
   * /Resources paints with its font's caller's; a pattern may name its
   * page's own) is counted ONCE: met again while it is being summed, it
   * adds nothing there (it is being counted already) and the paints read
   * meanwhile remember that (an `i` cut, see {@link Memo}).
   *
   * History (legit-corpus review r3, 2026-11-14): the dictionary's entry was
   * remembered BEFORE its walk, so meeting it again returned the sum so far
   * into itself, and the page doubled with every glyph: 24 glyphs of a
   * Type3 bitmap font with no /Resources weighed 1,735 MP, a dvips paper
   * 2.0e80 MP, and every page of a file main draws was noted and refused.
   */
  private async indirectPaint(
    r: PdfDict,
    skipAbove: number,
    deps: Deps | null = null,
  ): Promise<Paint> {
    const key = `${this.resKey([r])}|${skipAbove}`;
    if (this.summing.has(key)) {
      deps?.cuts.add(`i${key}`);
      return emptyPaint();
    }
    const memos = this.indirectCache.get(key) ?? [];
    for (const m of memos) {
      if (this.holds(m.cuts, NO_PATH)) return this.recall(m, deps, false);
    }
    const { index } = this;
    const out = emptyPaint();
    const local: Deps = { cuts: new Set(), flagged: false };
    const content = async (s: StreamDef, res: readonly PdfDict[]) => {
      const p = await this.paintUnplaced(
        s,
        res,
        skipAbove,
        MAX_FORM_DEPTH - 4,
        NO_PATH,
        local,
      );
      absorb(out, bounded(p));
    };
    this.summing.add(key);
    try {
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
    } finally {
      this.summing.delete(key);
    }
    local.cuts.delete(`i${key}`);
    // What it paints does not depend on any path (it is read with none).
    const memo: Memo = {
      paint: out,
      cuts: [...local.cuts],
      flagged: false,
      pathKey: "",
    };
    if (memos.length < MAX_MEMO_PATHS) {
      memos.push(memo);
      this.indirectCache.set(key, memos);
    }
    return this.recall(memo, deps, false);
  }
}
