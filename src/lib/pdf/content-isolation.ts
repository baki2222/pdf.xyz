import type { PDFObject, PDFPage, PDFRawStream } from "pdf-lib";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Isolate a page's ORIGINAL content from whatever an engine draws after it
 * (hostile matrix STAMP-09 / EDIT-09, 2026-11-08).
 *
 * WHY. Every stamping and editing engine draws through pdf-lib, which wraps
 * the page's existing streams ONCE, as `[q, …original, Q]`, and appends its
 * own stream after them. One pair of brackets is only enough when the
 * original is balanced. A page whose content pops past the wrapper's `q`
 * (a surplus `Q`), or leaves two or more `q` open, ends with a transformed
 * CTM still in force when the appended drawing runs, so a page number came
 * out 0.1x size in the corner and an edited box landed at (1,1) instead of
 * (10,10), with the tool reporting success.
 *
 * WHAT. Scan the decoded streams once, counting graphics-state depth the way
 * a viewer executes it: a `Q` with nothing saved is IGNORED (pdf.js, Acrobat).
 * - Every such surplus `Q` is blanked to a space in a rewritten copy of the
 *   page's content. A viewer already ignored it on the page alone, so the
 *   page itself renders as it did before any tool touched it; only now it
 *   cannot pop the wrapper's `q`.
 * - One `Q` per `q` left open is appended after the original, in its own
 *   small stream, so everything it left open is closed.
 * The appended drawing then starts from the page's default state.
 *
 * Why blank rather than prepend one `q` per surplus `Q` (the first design):
 * pdf.js is quadratic in save depth. Measured on this repo's pdf.js, a page
 * with 20,000 nested saves took 4.7 s to read and 100,000 did not finish in
 * 300 s, so prepending would turn a page that renders instantly into one the
 * reader's viewer never finishes. Blanking adds no depth.
 *
 * A balanced page is left byte-identical: nothing is inserted or rewritten.
 * A page with only unclosed `q` keeps its original streams; only the closing
 * stream is added. Only a page with a surplus `Q` gets a rewritten copy (the
 * original stream objects are left alone, in case another page shares them).
 *
 * The scan skips what is not an operator: literal strings (escapes and
 * nested parentheses), hex strings, names, comments, and inline image data
 * between `ID` and `EI` — a `Q` byte inside any of those is not a `Q`.
 * It cuts operators where pdf.js does (`qq` is two saves), and the test
 * suite checks its q/Q balance against pdf.js's own operator list.
 *
 * CERTAIN BEFORE REWRITING. Blanking is the one step that changes how the
 * page's own content draws, so it runs only when the scan is certain. An
 * inline image's end is a guess: pdf.js searches for an `EI` followed by
 * operators, other readers count the bytes /L or /W /H /BPC imply, and image
 * data can contain ` EI ` and ` Q ` (review of l06: a page that rendered
 * correctly lost its real `Q` that way). The end is certain only when both
 * readings name the same `EI`. A page with surplus `Q` and any uncertain
 * image is left exactly as before (outcome `skipped`, `ambiguous`).
 * Closing open `q` after the original cannot change how the original draws,
 * so that is still done. A stream with a /Predictor, which pdf-lib does not
 * undo, is never read (`unreadable`).
 *
 * BOUNDED. Decoding stops at {@link ISOLATION_DECODE_BUDGET} decoded bytes
 * per page, read in chunks, so a decompression bomb is not inflated here. A
 * page over the budget, or whose streams pdf-lib cannot decode, is left
 * exactly as before (outcome `skipped`): no worse than before this module,
 * and never a refusal of a real file.
 *
 * ORDER. Call it before drawing on the page. It also works after pdf-lib has
 * already wrapped the page: it finds the wrapper's shared `q`/`Q` streams and
 * works inside them. Results are memoized per page.
 */

/**
 * Decoded content bytes scanned per page before giving up (left as before).
 * 32 MiB: every page of the 14-file legit corpus decodes to under 64 KB
 * (measured, and pinned in content-isolation.test.ts), so the headroom is
 * over 500x. Scanning 32 MiB of ordinary operators took 0.26 s (measured
 * 2026-11-08); the suite bounds it at 5 s.
 */
export const ISOLATION_DECODE_BUDGET = 32 * 1024 * 1024;

/** Graphics-state balance of a page's content, as a viewer executes it. */
export interface ContentBalance {
  /** Byte offsets of each `Q` that pops an empty stack (a viewer ignores it). */
  surplus: number[];
  /** `q` still open at the end. */
  open: number;
  /**
   * The scan may disagree with a viewer about which bytes are operators: an
   * inline image whose end two readings do not agree on (or that cannot be
   * read twice), or bytes pdf.js itself refuses to lex. The page's own bytes
   * must not be rewritten from such a scan.
   */
  uncertain: boolean;
}

export type IsolationOutcome =
  | { kind: "balanced" }
  | { kind: "isolated"; blanked: number; closed: number }
  | { kind: "skipped"; reason: "budget" | "unreadable" | "ambiguous" };

// PDF whitespace: NUL, TAB, LF, FF, CR, SPACE.
const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
// Delimiters: ( ) < > [ ] { } / %
const DELIM = new Uint8Array(256);
for (const c of [40, 41, 60, 62, 91, 93, 123, 125, 47, 37]) DELIM[c] = 1;

const regular = (c: number | undefined): boolean =>
  c !== undefined && WS[c] === 0 && DELIM[c] === 0;

/**
 * pdf.js's content operator table (pdf.worker EvaluatorPreprocessor.opMap):
 * operator → operand count, negative when the count is a maximum.
 */
const OPS = new Map<string, number>(
  Object.entries({
    w: 1,
    J: 1,
    j: 1,
    M: 1,
    d: 2,
    ri: 1,
    i: 1,
    gs: 1,
    q: 0,
    Q: 0,
    cm: 6,
    m: 2,
    l: 2,
    c: 6,
    v: 4,
    y: 4,
    h: 0,
    re: 4,
    S: 0,
    s: 0,
    f: 0,
    F: 0,
    "f*": 0,
    B: 0,
    "B*": 0,
    b: 0,
    "b*": 0,
    n: 0,
    W: 0,
    "W*": 0,
    BT: 0,
    ET: 0,
    Tc: 1,
    Tw: 1,
    Tz: 1,
    TL: 1,
    Tf: 2,
    Tr: 1,
    Ts: 1,
    Td: 2,
    TD: 2,
    Tm: 6,
    "T*": 0,
    Tj: 1,
    TJ: 1,
    "'": 1,
    '"': 3,
    d0: 2,
    d1: 6,
    CS: 1,
    cs: 1,
    SC: -4,
    SCN: -33,
    sc: -4,
    scn: -33,
    G: 1,
    g: 1,
    RG: 3,
    rg: 3,
    K: 4,
    k: 4,
    sh: 1,
    BI: 0,
    ID: 0,
    EI: 1,
    Do: 1,
    MP: 1,
    DP: 2,
    BMC: 1,
    BDC: 2,
    EMC: 0,
    BX: 0,
    EX: 0,
  }),
);
/** Every key of that table, including the ones pdf.js maps to null. */
const KNOWN = new Set<string>([
  ...OPS.keys(),
  ...["BM", "BD", "true", "fa", "fal", "fals", "false", "nu", "nul", "null"],
]);

type TokKind = "eof" | "num" | "str" | "name" | "cmd";

/**
 * A content-stream lexer that cuts bytes into tokens where pdf.js's Lexer
 * does. The rules that decide where an operator starts and ends are copied,
 * because q/Q counting depends on exactly them:
 * - a run of letters is cut greedily, stopping where the next letter would
 *   leave the operator table (`QQ` is Q, Q; `qq` is q, q; `Tfq` is Tf, q);
 * - a number ends at the first byte that is not a digit, `.` or `-`
 *   (`1Q` is 1, Q);
 * - a byte outside 0x20..0x7F followed by one inside is a token of its own.
 * Strings (escapes, nesting), hex strings, names and comments are skipped
 * whole, so a `Q` inside them is never an operator.
 */
class Lexer {
  pos: number;
  kind: TokKind = "eof";
  start = 0;
  cmd = "";
  /** pdf.js would throw here (a stray `)`, an over-long command). */
  bad = false;

  constructor(
    private readonly b: Uint8Array,
    from: number,
    private readonly end: number,
  ) {
    this.pos = from;
  }

  next(): TokKind {
    const { b, end } = this;
    let i = this.pos;
    for (;;) {
      if (i >= end) {
        this.pos = end;
        return (this.kind = "eof");
      }
      const c = b[i]!;
      if (WS[c] === 1) i += 1;
      else if (c === 37) while (i < end && b[i] !== 10 && b[i] !== 13) i += 1;
      else break;
    }
    const c = b[i]!;
    this.start = i;
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      i += 1;
      while (i < end) {
        const d = b[i]!;
        if ((d >= 48 && d <= 57) || d === 46 || d === 45) i += 1;
        else break;
      }
      this.pos = i;
      return (this.kind = "num");
    }
    if (c === 40) {
      let p = 1;
      i += 1;
      while (i < end) {
        const ch = b[i]!;
        i += 1;
        if (ch === 92) i += 1;
        else if (ch === 40) p += 1;
        else if (ch === 41 && --p === 0) break;
      }
      this.pos = Math.min(i, end);
      return (this.kind = "str");
    }
    if (c === 47) {
      i += 1;
      while (i < end && regular(b[i])) i += 1;
      this.pos = i;
      return (this.kind = "name");
    }
    if (c === 60 || c === 62) {
      if (i + 1 < end && b[i + 1] === c) {
        this.pos = i + 2;
        this.cmd = c === 60 ? "<<" : ">>";
        return (this.kind = "cmd");
      }
      if (c === 62) {
        this.pos = i + 1;
        this.cmd = ">";
        return (this.kind = "cmd");
      }
      i += 1;
      while (i < end && b[i] !== 62) i += 1;
      this.pos = Math.min(i + 1, end);
      return (this.kind = "str");
    }
    if (DELIM[c] === 1) {
      // [ ] { } and a stray ), which pdf.js refuses to lex.
      if (c === 41) this.bad = true;
      this.pos = i + 1;
      this.cmd = String.fromCharCode(c);
      return (this.kind = "cmd");
    }
    let str = String.fromCharCode(c);
    i += 1;
    if ((c < 0x20 || c > 0x7f) && i < end && b[i]! >= 0x20 && b[i]! <= 0x7f) {
      this.pos = i;
      this.cmd = str;
      return (this.kind = "cmd");
    }
    let known = KNOWN.has(str);
    while (i < end && regular(b[i])) {
      if (str.length >= 128) {
        // pdf.js throws "Command token too long"; skip the rest of the run.
        this.bad = true;
        while (i < end && regular(b[i])) i += 1;
        break;
      }
      const longer = str + String.fromCharCode(b[i]!);
      if (known && !KNOWN.has(longer)) break;
      str = longer;
      known = KNOWN.has(str);
      i += 1;
    }
    this.pos = i;
    this.cmd = str;
    return (this.kind = "cmd");
  }
}

type InlineValue = number | string | boolean | InlineValue[] | null;

const latin1 = (b: Uint8Array, from: number, to: number, max: number) =>
  String.fromCharCode(...b.subarray(from, Math.min(to, from + max)));

/** Read one object of an inline image dictionary; names come back "/X". */
function readValue(lx: Lexer, b: Uint8Array, depth = 0): InlineValue {
  const kind = lx.next();
  if (kind === "num") {
    const v = Number(latin1(b, lx.start, lx.pos, 32));
    return Number.isFinite(v) ? v : null;
  }
  if (kind === "name") return latin1(b, lx.start, lx.pos, 64);
  if (kind !== "cmd") return null;
  if (lx.cmd === "true" || lx.cmd === "false") return lx.cmd === "true";
  if (depth < 8 && (lx.cmd === "[" || lx.cmd === "<<")) {
    const close = lx.cmd === "[" ? "]" : ">>";
    const items: InlineValue[] = [];
    for (;;) {
      const at = lx.pos;
      const k = lx.next();
      if (k === "eof" || (k === "cmd" && (lx.cmd as string) === close)) break;
      lx.pos = at;
      items.push(readValue(lx, b, depth + 1));
    }
    return items;
  }
  return null;
}

const PRINTABLE_LOOKAHEAD = 15;

/**
 * Where pdf.js ends inline image data starting at `from` when the filter has
 * no dedicated finder (pdf.worker Parser.findDefaultInlineStreamEnd): the
 * first `EI` followed by SPACE, LF or CR, after which the next 15 bytes are
 * printable and the next 75 lex into a known operator with the right number
 * of operands. Returns the index of that `E`, or -1 when none qualifies
 * (pdf.js then guesses).
 */
function pdfjsInlineEnd(b: Uint8Array, from: number, n: number): number {
  for (let i = from; i + 1 < n; i += 1) {
    if (b[i] !== 69 || b[i + 1] !== 73) continue;
    if (i + 2 === n) return i; // EI ends the content
    const ws = b[i + 2];
    if (ws !== 32 && ws !== 10 && ws !== 13) continue;
    const after = i + 3;
    if (after >= n) return i;
    let printable = true;
    const stop = Math.min(n, after + PRINTABLE_LOOKAHEAD);
    for (let k = after; k < stop; k += 1) {
      const ch = b[k]!;
      if (ch === 0 && b[k + 1] !== 0) continue;
      if (ch !== 10 && ch !== 13 && (ch < 0x20 || ch > 0x7f)) {
        printable = false;
        break;
      }
    }
    if (!printable) continue;
    const lx = new Lexer(
      b,
      after,
      Math.min(n, after + 5 * PRINTABLE_LOOKAHEAD),
    );
    let args = 0;
    let ok = false;
    for (;;) {
      const kind = lx.next();
      if (kind === "eof") break;
      if (
        kind !== "cmd" ||
        lx.cmd === "true" ||
        lx.cmd === "false" ||
        lx.cmd === "null"
      ) {
        args += 1;
        continue;
      }
      const want = OPS.get(lx.cmd);
      if (want === undefined) break;
      if (want < 0 ? args <= -want : args === want) {
        ok = true;
        break;
      }
      args = 0;
    }
    if (ok) return i;
  }
  return -1;
}

/** Filters pdf.js ends with a dedicated finder this module does not copy. */
const OWN_FINDER = new Set([
  "/DCT",
  "/DCTDecode",
  "/A85",
  "/ASCII85Decode",
  "/AHx",
  "/ASCIIHexDecode",
]);

function colorComponents(cs: InlineValue): number | undefined {
  if (Array.isArray(cs))
    return cs[0] === "/I" || cs[0] === "/Indexed" ? 1 : undefined;
  switch (cs) {
    case "/G":
    case "/DeviceGray":
      return 1;
    case "/RGB":
    case "/DeviceRGB":
      return 3;
    case "/CMYK":
    case "/DeviceCMYK":
      return 4;
    default:
      return undefined; // a named resource: not knowable from these bytes
  }
}

/**
 * The data length an inline image dictionary states or implies: `/L`
 * (`/Length`) when present; else, for an unfiltered image, rows x bytes per
 * row from /W /H /BPC and the colour space. Undefined when not knowable.
 */
function statedLength(dict: Map<string, InlineValue>): number | undefined {
  const get = (a: string, b: string) => dict.get(a) ?? dict.get(b);
  const isCount = (v: InlineValue | undefined): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0;
  const length = get("/L", "/Length");
  if (isCount(length)) return length;
  const filter = get("/F", "/Filter");
  if (filter !== undefined && !(Array.isArray(filter) && filter.length === 0))
    return undefined;
  const w = get("/W", "/Width");
  const h = get("/H", "/Height");
  const mask = get("/IM", "/ImageMask") === true;
  const bpc = mask ? 1 : get("/BPC", "/BitsPerComponent");
  const comps = mask ? 1 : colorComponents(get("/CS", "/ColorSpace") ?? null);
  if (!isCount(w) || !isCount(h) || !isCount(bpc) || comps === undefined)
    return undefined;
  return Math.ceil((w * comps * bpc) / 8) * h;
}

/**
 * An inline image whose `ID` ends at `idEnd`: where scanning resumes, and
 * whether its end is CERTAIN. Certain means two independent readings name
 * the same `EI`: pdf.js's search, and the length the dictionary states or
 * implies. Where they differ, viewers differ too (pdf.js searches; others
 * count bytes), so no single reading of the rest of the page can be trusted.
 */
function skipInlineImage(
  b: Uint8Array,
  idEnd: number,
  dict: Map<string, InlineValue>,
): { resume: number; certain: boolean } {
  const n = b.length;
  const data = Math.min(n, idEnd + 1); // one whitespace byte after ID
  const searched = pdfjsInlineEnd(b, data, n);
  const filter = dict.get("/F") ?? dict.get("/Filter");
  const first = Array.isArray(filter) ? filter[0] : filter;
  const length = statedLength(dict);
  let certain = false;
  if (
    searched >= 0 &&
    length !== undefined &&
    !(typeof first === "string" && OWN_FINDER.has(first))
  ) {
    let e = data + length;
    while (e < n && WS[b[e]!] === 1) e += 1;
    certain = e === searched;
  }
  if (searched >= 0) return { resume: Math.min(n, searched + 3), certain };
  // No EI pdf.js accepts (it guesses): resume after the stated length if
  // there is one, else stop reading the stream.
  return {
    resume: length !== undefined ? Math.min(n, data + length) : n,
    certain: false,
  };
}

/**
 * Find the surplus `Q`s and count the `q` left open, in decoded content
 * bytes. Pure, never throws. A page's streams are scanned as one, joined by
 * a newline (a stream boundary is a token boundary).
 */
export function scanContentBalance(b: Uint8Array): ContentBalance {
  let depth = 0;
  const surplus: number[] = [];
  let uncertain = false;
  const lx = new Lexer(b, 0, b.length);
  for (;;) {
    const kind = lx.next();
    if (kind === "eof") break;
    if (kind !== "cmd") continue;
    const op = lx.cmd;
    if (op === "q") depth += 1;
    else if (op === "Q") {
      if (depth === 0) surplus.push(lx.start);
      else depth -= 1;
    } else if (op === "BI") {
      // pdf.js reads name/value pairs up to ID.
      const dict = new Map<string, InlineValue>();
      let idEnd = -1;
      for (;;) {
        const k = lx.next();
        if (k === "eof") break;
        if (k === "cmd" && lx.cmd === "ID") {
          idEnd = lx.pos;
          break;
        }
        if (k !== "name") {
          uncertain = true; // pdf.js: "Dictionary key must be a name object"
          continue;
        }
        dict.set(latin1(b, lx.start, lx.pos, 32), readValue(lx, b));
      }
      if (idEnd < 0) break;
      const { resume, certain } = skipInlineImage(b, idEnd, dict);
      if (!certain) uncertain = true;
      lx.pos = resume;
    }
  }
  return { surplus, open: depth, uncertain: uncertain || lx.bad };
}

const memo = new WeakMap<object, IsolationOutcome>();

const DECODE_CHUNK = 64 * 1024;

/** A /DecodeParms (or any entry of an array of them) with /Predictor > 1. */
function hasPredictor(lib: PdfLibModule, obj: PDFRawStream): boolean {
  const { PDFArray, PDFDict, PDFName, PDFNumber } = lib;
  const parms = obj.dict.lookup(PDFName.of("DecodeParms"));
  const all = parms instanceof PDFArray ? parms.asArray() : [parms];
  return all.some((p) => {
    const dict = p === undefined ? undefined : obj.dict.context.lookup(p);
    if (!(dict instanceof PDFDict)) return false;
    const predictor = dict.lookup(PDFName.of("Predictor"));
    return predictor instanceof PDFNumber && predictor.asNumber() > 1;
  });
}

/** Decode one content stream within `remaining` bytes; null = unreadable. */
function decodeStream(
  lib: PdfLibModule,
  obj: PDFObject | undefined,
  remaining: number,
): Uint8Array | "budget" | null {
  if (obj instanceof lib.PDFRawStream) {
    // pdf-lib's decoder ignores /DecodeParms predictors, so it would hand
    // back shifted bytes that a rewrite would then make permanent.
    if (hasPredictor(lib, obj)) return null;
    try {
      // In chunks: pdf-lib's decoder preallocates whatever one getBytes
      // asks for, so a single budget-sized read would allocate the budget.
      const stream = lib.decodePDFRawStream(obj);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const chunk = stream.getBytes(DECODE_CHUNK);
        if (chunk.length === 0) break;
        total += chunk.length;
        if (total > remaining) return "budget";
        chunks.push(new Uint8Array(chunk));
      }
      return join(chunks, total, false);
    } catch {
      return null;
    }
  }
  const unencoded = obj as unknown as {
    getUnencodedContents?: () => Uint8Array;
  };
  if (typeof unencoded?.getUnencodedContents === "function") {
    try {
      const bytes = unencoded.getUnencodedContents();
      return bytes.length > remaining ? "budget" : bytes;
    } catch {
      return null;
    }
  }
  // Not a stream (a null, a dangling ref): viewers skip it; so do we.
  return new Uint8Array(0);
}

/** Concatenate, optionally with a newline after each part. */
function join(parts: Uint8Array[], size: number, newline: boolean): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
    if (newline) out[at++] = 10;
  }
  return out;
}

/**
 * Make sure what is drawn on `page` after this call starts at the page's
 * default graphics state, whatever q/Q imbalance its original content has.
 */
export async function isolatePageContent(
  page: PDFPage,
  /** The caller's pdf-lib module (see `assertPageTree` in ./page-tree). */
  lib: PdfLibModule,
  budget: number = ISOLATION_DECODE_BUDGET,
): Promise<IsolationOutcome> {
  const known = memo.get(page.node);
  if (known) return known;
  const outcome = isolate(lib, page, budget);
  memo.set(page.node, outcome);
  return outcome;
}

function isolate(
  lib: PdfLibModule,
  page: PDFPage,
  budget: number,
): IsolationOutcome {
  const { PDFArray, PDFName, PDFStream } = lib;
  const ctx = page.doc.context;
  const key = PDFName.of("Contents");
  const raw = page.node.get(key);
  if (raw === undefined) return { kind: "balanced" };
  const contents = ctx.lookup(raw);

  let entries: PDFObject[];
  let lo = 0;
  let hi: number;
  if (contents instanceof PDFArray) {
    entries = contents.asArray();
    hi = entries.length;
    // Already wrapped by pdf-lib (`[q, …, Q, drawn…]`): work inside its
    // shared q/Q streams.
    const shared = ctx as unknown as {
      pushGraphicsStateContentStreamRef?: PDFObject;
      popGraphicsStateContentStreamRef?: PDFObject;
    };
    const push = shared.pushGraphicsStateContentStreamRef;
    const pop = shared.popGraphicsStateContentStreamRef;
    if (push && entries[0] === push) {
      const end = entries.lastIndexOf(pop as PDFObject);
      if (end > 0) {
        lo = 1;
        hi = end;
      }
    }
  } else if (contents instanceof PDFStream) {
    entries = [raw];
    hi = 1;
  } else {
    return { kind: "balanced" };
  }

  const parts: Uint8Array[] = [];
  let used = 0;
  for (let k = lo; k < hi; k += 1) {
    const data = decodeStream(lib, ctx.lookup(entries[k]!), budget - used);
    if (data === null) return { kind: "skipped", reason: "unreadable" };
    if (data === "budget") return { kind: "skipped", reason: "budget" };
    parts.push(data);
    used += data.length + 1;
    if (used > budget) return { kind: "skipped", reason: "budget" };
  }
  const joined = join(parts, used, true);
  const { surplus, open, uncertain } = scanContentBalance(joined);
  if (surplus.length === 0 && open === 0) return { kind: "balanced" };
  // Blanking rewrites the page's OWN content, so it is done only from a scan
  // a viewer agrees with. (Appending Q after the original cannot change how
  // the original draws, so an uncertain count of open q is still closed.)
  if (surplus.length > 0 && uncertain)
    return { kind: "skipped", reason: "ambiguous" };

  // The original streams, or one rewritten copy with each surplus Q blanked.
  let body: PDFObject[] = entries.slice(lo, hi);
  if (surplus.length > 0) {
    for (const at of surplus) joined[at] = 32;
    body = [ctx.register(ctx.flateStream(joined))];
  }
  if (open > 0) {
    // Deflated: a hostile page can leave thousands open.
    body.push(ctx.register(ctx.flateStream("Q\n".repeat(open))));
  }
  if (contents instanceof PDFArray) {
    for (let k = hi - 1; k >= lo; k -= 1) contents.remove(k);
    body.forEach((ref, k) => contents.insert(lo + k, ref));
  } else {
    page.node.set(key, ctx.obj(body));
  }
  return { kind: "isolated", blanked: surplus.length, closed: open };
}
