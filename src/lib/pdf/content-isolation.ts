import type { PDFObject, PDFPage, PDFRawStream } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";

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
 * per page, read in chunks, so a decompression bomb is not inflated here, and
 * the scan spends what is left of that budget as metered WORK (an inline image
 * or an `EI` candidate costs more than a byte). A page over the budget, or whose streams pdf-lib cannot decode, is left
 * exactly as before (outcome `skipped`): no worse than before this module,
 * and never a refusal of a real file.
 *
 * ORDER. Call it before drawing on the page. It also works after pdf-lib has
 * already wrapped the page: it finds the wrapper's shared `q`/`Q` streams and
 * works inside them. Results are memoized per page, and per DOCUMENT by the
 * list of content streams: pages that share streams share one scan and one
 * rewritten copy, and a document-wide budget bounds the total decoded.
 */

/**
 * WORK per page before giving up (left as before), in units of one decoded
 * byte read once: decoded bytes, plus {@link IMAGE_WORK} per inline image
 * and {@link CANDIDATE_WORK} per `EI` candidate tested.
 * 32 MiB: every page of the 14-file legit corpus costs under 64 KB
 * (measured, and pinned in content-isolation.test.ts), so the headroom is
 * over 500x. Scanning 32 MiB of ordinary operators took 0.26 s (measured
 * 2026-11-08; the suite bounds it at 5 s).
 *
 * It counted BYTES until review of l06, round 3: the costliest shapes cost
 * far more per byte than operators do, so a full byte budget of inline
 * image data full of `EI ` candidates took 8.4 s (18.7 s under load) and
 * eight such pages froze addPageNumbers for 104 s. Metering the work makes
 * every shape cost about what ordinary content of the same budget costs.
 * The scan is also linear in every shape: each inline-image search covers
 * bytes no other search covers (see pdfjsInlineEnd).
 */
export const ISOLATION_DECODE_BUDGET = 32 * 1024 * 1024;

/** Work left to spend; see {@link ISOLATION_DECODE_BUDGET} for the unit. */
interface Meter {
  left: number;
}

/**
 * The work units one `EI` candidate costs: pdf.js's printable test (15
 * bytes) and a lex of up to 75 bytes, plus a lexer. Measured 2026-11-09 at
 * ~0.75 us per candidate (11.2 M candidates in 8.4 s) against ~7.7 ns per
 * ordinary byte (32 MiB in 0.26 s): ~97 bytes' worth, charged as 128.
 */
const CANDIDATE_WORK = 128;

/**
 * The work units one inline image costs beyond its bytes: its dictionary
 * map and its EI search. Measured 2026-11-09 at ~0.9 us per `BI /L 1 ID x`
 * (2.58 M images in 2.3 s), ~115 bytes' worth less its 13 bytes, charged
 * as 128. A page of 10,000 inline images costs 1/26 of the budget (the
 * positive control in the suite).
 */
const IMAGE_WORK = 128;

/** pdfjsInlineEnd's result when the meter runs out. */
const OUT_OF_WORK = -2;

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
 * first `EI` its E/I state machine reaches that is followed by SPACE, LF or
 * CR, after which the next 15 bytes are printable and the next 75 lex into a
 * known operator with the right number of operands. Returns the index of
 * that `E`, or -1 when none qualifies (pdf.js then guesses).
 *
 * The state machine, copied exactly: after `E`, any byte but `I` resets to
 * the start WITHOUT re-testing that byte for `E`, so in `EEI` (or `EIEI`)
 * pdf.js sees no `EI` at all.
 *
 * `knownNone`: a search from an earlier start already ran to the end of the
 * stream and found nothing. Two runs of this machine over the same bytes are
 * in the same state after any byte that is neither `E` nor `I` (it leaves
 * state 0 whatever came before), and whether a candidate qualifies depends
 * only on the bytes after it; so past the first such byte this search would
 * repeat that one exactly, and it stops there. Without that, every image of
 * a stream that no `EI` ends re-searched the rest of the stream: quadratic
 * (review of l06, round 2: a 2.7 KB PDF took 49 s).
 *
 * Returns {@link OUT_OF_WORK} when `meter` runs out first.
 */
function pdfjsInlineEnd(
  b: Uint8Array,
  from: number,
  n: number,
  knownNone: boolean,
  meter: Meter,
): number {
  let state = 0;
  for (let p = from; p < n; p += 1) {
    const ch = b[p]!;
    if (state === 0) state = ch === 69 ? 1 : 0;
    else if (state === 1) state = ch === 73 ? 2 : 0;
    else {
      state = 0;
      if (ch === 32 || ch === 10 || ch === 13) {
        if ((meter.left -= CANDIDATE_WORK) < 0) return OUT_OF_WORK;
        if (endsImage(b, p + 1, n)) return p - 2;
      }
    }
    if (knownNone && ch !== 69 && ch !== 73) return -1;
  }
  return state === 2 ? n - 2 : -1; // EI ends the content
}

/** pdf.js's test of what follows a candidate `EI` and its whitespace. */
function endsImage(b: Uint8Array, after: number, n: number): boolean {
  if (after >= n) return true;
  const stop = Math.min(n, after + PRINTABLE_LOOKAHEAD);
  for (let k = after; k < stop; k += 1) {
    const ch = b[k]!;
    if (ch === 0 && b[k + 1] !== 0) continue;
    if (ch !== 10 && ch !== 13 && (ch < 0x20 || ch > 0x7f)) return false;
  }
  const lx = new Lexer(b, after, Math.min(n, after + 5 * PRINTABLE_LOOKAHEAD));
  let args = 0;
  for (;;) {
    const kind = lx.next();
    if (kind === "eof") return false;
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
    if (want === undefined) return false;
    if (want < 0 ? args <= -want : args === want) return true;
    args = 0;
  }
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
 * Undefined when `meter` runs out.
 */
function skipInlineImage(
  b: Uint8Array,
  idEnd: number,
  dict: Map<string, InlineValue>,
  search: { noEiFrom: number },
  meter: Meter,
): { resume: number; certain: boolean } | undefined {
  const n = b.length;
  const data = Math.min(n, idEnd + 1); // one whitespace byte after ID
  const searched = pdfjsInlineEnd(b, data, n, data >= search.noEiFrom, meter);
  if (searched === OUT_OF_WORK) return undefined;
  if (searched < 0) search.noEiFrom = Math.min(search.noEiFrom, data);
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
  return meteredScan(b, { left: Infinity }) as ContentBalance;
}

/**
 * {@link scanContentBalance}, charging `meter` for the work beyond reading
 * each byte once; "budget" as soon as it runs out (nothing is decided from
 * a partial scan).
 */
function meteredScan(b: Uint8Array, meter: Meter): ContentBalance | "budget" {
  let depth = 0;
  const surplus: number[] = [];
  let uncertain = false;
  // Where a search for EI already ran to the end and found none.
  const search = { noEiFrom: Infinity };
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
      if ((meter.left -= IMAGE_WORK) < 0) return "budget";
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
      const image = skipInlineImage(b, idEnd, dict, search, meter);
      if (!image) return "budget";
      const { resume, certain } = image;
      if (!certain) uncertain = true;
      lx.pos = resume;
    }
  }
  return { surplus, open: depth, uncertain: uncertain || lx.bad };
}

const memo = new WeakMap<object, IsolationOutcome>();

/**
 * Work (decoded bytes plus scan work, in the unit of
 * {@link ISOLATION_DECODE_BUDGET}) per DOCUMENT before further pages are left
 * as they were. The per-page budget alone let N pages cost N x 32 MiB (review
 * of l06, round 2: a 60 KB file of 50 pages, each 30 MB decoded, took 20 s).
 * 256 MiB = eight full page budgets. The legit corpus is pinned in the suite
 * to need under 4 MiB per document (64x headroom), and the worst case it
 * allows is measured there in a child process (ordinary content, and the
 * costliest scan shapes, which since round 3 are metered as work).
 */
const ISOLATION_DOCUMENT_BUDGET = 256 * 1024 * 1024;

/**
 * Per document: decoded bytes spent, and the result for each list of
 * content streams already scanned, so a stream shared by many pages is
 * decoded, scanned and rewritten ONCE and every page gets the same copy.
 */
interface DocumentWork {
  used: number;
  done: Map<string, Scanned>;
}
interface Scanned {
  outcome: IsolationOutcome;
  /** What replaces the scanned streams; absent when nothing does. */
  body?: PDFObject[];
}
const work = new WeakMap<object, DocumentWork>();

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
  budget: number = ISOLATION_DECODE_BUDGET,
  documentBudget: number = ISOLATION_DOCUMENT_BUDGET,
): Promise<IsolationOutcome> {
  const known = memo.get(page.node);
  if (known) return known;
  const lib = await loadPdfLib();
  const ctx = page.doc.context;
  let doc = work.get(ctx);
  if (!doc) work.set(ctx, (doc = { used: 0, done: new Map() }));
  const outcome = isolate(lib, page, budget, documentBudget, doc);
  memo.set(page.node, outcome);
  return outcome;
}

/** A list of indirect streams as one key; undefined if any is direct. */
function keyOf(lib: PdfLibModule, refs: PDFObject[]): string | undefined {
  if (!refs.every((r) => r instanceof lib.PDFRef)) return undefined;
  return refs.join(",");
}

function isolate(
  lib: PdfLibModule,
  page: PDFPage,
  budget: number,
  documentBudget: number,
  doc: DocumentWork,
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

  const original = entries.slice(lo, hi);
  const id = keyOf(lib, original);
  let result = id === undefined ? undefined : doc.done.get(id);
  if (!result) {
    result = scanAndRewrite(lib, page, original, budget, documentBudget, doc);
    if (id !== undefined) doc.done.set(id, result);
    // A page that later names the rewritten list is already isolated.
    const out = result.body && keyOf(lib, result.body);
    if (out) doc.done.set(out, { outcome: { kind: "balanced" } });
  }
  const { outcome, body } = result;
  if (body) {
    if (contents instanceof PDFArray) {
      for (let k = hi - 1; k >= lo; k -= 1) contents.remove(k);
      body.forEach((ref, k) => contents.insert(lo + k, ref));
    } else {
      page.node.set(key, ctx.obj(body));
    }
  }
  return outcome;
}

/**
 * Decode and scan one list of content streams; when it is unbalanced,
 * register what replaces it (`body`). Registers nothing otherwise.
 */
function scanAndRewrite(
  lib: PdfLibModule,
  page: PDFPage,
  original: PDFObject[],
  budget: number,
  documentBudget: number,
  doc: DocumentWork,
): Scanned {
  const ctx = page.doc.context;
  const limit = Math.min(budget, Math.max(0, documentBudget - doc.used));
  const parts: Uint8Array[] = [];
  let used = 0;
  const skip = (reason: "budget" | "unreadable"): Scanned => {
    // What was decoded before giving up is spent all the same.
    doc.used += reason === "budget" ? limit : used;
    return { outcome: { kind: "skipped", reason } };
  };
  for (const entry of original) {
    const data = decodeStream(lib, ctx.lookup(entry), limit - used);
    if (data === null) return skip("unreadable");
    if (data === "budget") return skip("budget");
    parts.push(data);
    used += data.length + 1;
    if (used > limit) return skip("budget");
  }
  const joined = join(parts, used, true);
  // The scan spends what decoding left of the same limit.
  const meter: Meter = { left: limit - used };
  const scan = meteredScan(joined, meter);
  if (scan === "budget") return skip("budget");
  doc.used += limit - meter.left;
  const { surplus, open, uncertain } = scan;
  if (surplus.length === 0 && open === 0)
    return { outcome: { kind: "balanced" } };
  // Blanking rewrites the page's OWN content, so it is done only from a scan
  // a viewer agrees with. (Appending Q after the original cannot change how
  // the original draws, so an uncertain count of open q is still closed.)
  if (surplus.length > 0 && uncertain)
    return { outcome: { kind: "skipped", reason: "ambiguous" } };

  // The original streams, or one rewritten copy with each surplus Q blanked.
  let body: PDFObject[] = original.slice();
  if (surplus.length > 0) {
    for (const at of surplus) joined[at] = 32;
    body = [ctx.register(ctx.flateStream(joined))];
  }
  if (open > 0) {
    // Deflated: a hostile page can leave thousands open.
    body.push(ctx.register(ctx.flateStream("Q\n".repeat(open))));
  }
  return {
    outcome: { kind: "isolated", blanked: surplus.length, closed: open },
    body,
  };
}
