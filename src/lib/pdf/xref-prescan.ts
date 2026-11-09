/**
 * What pdf.js will read as a cross-reference section, found in the bytes
 * before pdf.js is asked (lane l02 of the hostile-input matrix, SIB-03 and
 * SIB-09). Loaded by `./pdf-access-guard` and `./pdfjs-guard` (whose
 * `preflightPdfjsOpen` runs it before every pdf.js open), both lazy chunks.
 *
 * The questions are pdf.js's, so the answers are read the way pdf.js reads
 * them, not the way a well-formed file writes them:
 *  - numbers through pdf.js's lexer rules (`0.0`, `-0`, `+0`, `.0`, `--0`
 *    and a bare `-` are all 0), names with `#xx` escapes decoded (`/#57` is
 *    `/W`), and a repeated key resolved to its LAST value, as pdf.js's
 *    dictionary stores it;
 *  - the rows pdf.js may walk: those of EVERY stream in the file whose
 *    dictionary has a /W. pdf.js reaches a section by an offset (startxref,
 *    a linearized first page, /Prev, /XRefStm, a rebuild's scan, a /Prev
 *    from a section the rebuild found, a /Prev that is a reference to an
 *    integer object), and every offset it can follow lands on literal
 *    `N G obj << ... >> stream` bytes, so reading every such object answers
 *    for all of the routes without following any of them (review 2 found
 *    four routes a chain walk missed);
 *  - the trailer pdf.js takes /Encrypt from: the newest section's
 *    dictionary, read by following the chain from `startxref`.
 *
 * Nothing here decodes the whole file into a string, and every byte it
 * lexes or searches past is charged to one budget proportional to the
 * file ({@link scanBudget}): it runs on the caller's thread before any
 * deadline, so a file of dictionaries that never close must cost it no more
 * than a few passes over the file.
 */

/** A value as pdf.js's parser hands it to a dictionary. */
type Value =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "ref"; num: number }
  | { t: "arr"; v: Value[] }
  /** A kept array (/W, /Index): its numbers, NaN where pdf.js sees no number. */
  | { t: "nums"; v: number[] }
  | { t: "dict"; v: Map<string, Value> }
  | { t: "word"; v: string }
  | { t: "str" };

/** The dictionary did not close inside the bytes it may use. */
class Incomplete extends Error {}

/** Nested past 64 levels: pdf.js would read on, so nothing can be said. */
class TooDeep extends Error {}

/** The scan's budget ({@link scanBudget}) is spent: refuse, do not guess. */
class OutOfBudget extends Error {}

/** Something pdf.js would walk past every bound: refuse. */
class Refuse extends Error {}

/**
 * Zero-width rows pdf.js may walk: 65,536. A row zero bytes wide reads
 * nothing, so pdf.js's loop runs to the /Index (or /Size) count alone and
 * stores an entry each time. Measured under Node with the legacy build
 * (`xref-prescan.test.ts` keeps the fixture): 65,536 such rows add nothing
 * measurable to the 6-row baseline (476 vs 479 MB peak, 242 vs 233 ms);
 * 1,000,000 add about 180 MB; 8,388,607 (the ISO 32000-1 Annex C object
 * limit) add about 1.5 GB; 2^31 runs out of memory. No real producer writes
 * a zero-width /W at all, so the bound only decides how much of a
 * malformed file is still handed to pdf.js to recover.
 */
export const ZERO_WIDTH_ROW_LIMIT = 65_536;

/** How far one dictionary may run: 1 MiB (the corpus's largest is < 1 KiB). */
export const DICT_SPAN_LIMIT = 2 ** 20;

/** Cross-reference sections followed from `startxref` before giving up. */
const CHAIN_LIMIT = 4096;

/**
 * Entries pdf.js may store from xref STREAMS, for a small file: 2^19
 * (524,288). pdf.js keeps one entry object per row it walks
 * (`#entries[first + i]`), so this, not the bytes in the file, is what a
 * row walk costs. Rows that each read a byte are still unbounded once a
 * filter makes the bytes: 20,000,000 rows over deflated zeros are a
 * 19,887-byte file that peaked pdf.js at 3,312 MB (review 2). Measured
 * 2026-11-08 (Windows, Node 24, legacy build, 1 GB heap), rows one byte
 * wide over FlateDecode against six such rows, three runs each: 2^19 rows
 * add 62 to 69 MB, 2^20 add 154 to 199 MB, 2^22 add about 650 MB. A real
 * file reaches 2^19 entries only past 8 MiB, where the file-size term below
 * takes over. `security-bounds.test.ts` re-measures the floor.
 */
export const XREF_ENTRY_FLOOR = 2 ** 19;

/**
 * File bytes per entry above the floor: 16. Every entry a real file lists
 * is an object it holds, and an object costs more than 16 bytes even packed
 * in an object stream. Measured 2026-11-08 (`xref-prescan.test.ts` holds
 * both to four times this): the legit corpus's densest file spends 478
 * bytes an entry, and 5,000 one-word pdf-lib pages packed in object streams
 * 94. At the 100 MiB upload cap this
 * allows 6.5 million entries, about 900 MB in pdf.js, which a real document
 * of that many objects costs pdf.js anyway.
 */
export const FILE_BYTES_PER_ENTRY = 16;

/** The entries pdf.js may store for a file of `fileLength` bytes. */
export function xrefEntryLimit(fileLength: number): number {
  return Math.max(
    XREF_ENTRY_FLOOR,
    Math.floor(fileLength / FILE_BYTES_PER_ENTRY),
  );
}

/**
 * Row bytes pdf.js may decode, per entry allowed: 16. A row is the sum of
 * its /W widths (a zero-width row counts as one), and a real row is at most
 * 1 + 8 + 4 bytes (type, offset, generation); a section of rows 2^20 bytes
 * wide over a deflate bomb would otherwise make pdf.js inflate gigabytes
 * for one entry. Summed over every section, so revisions that each repeat a
 * full section still fit (they would need 16 full repeats to reach it).
 */
const ROW_BYTES_PER_ENTRY = 16;

/**
 * Bytes the scan may lex or search past, for a file of `fileLength` bytes:
 * eight passes over the file plus 8 MiB. A real file costs about one pass
 * (each object's dictionary once, each trailer once; the corpus's worst is
 * reported by `xref-prescan.test.ts`). Without it, a file of dictionaries
 * that never close cost the scan O(n^2): 16,000 such units, 256 KB, took
 * 33 s on the caller's thread (review 2).
 */
export function scanBudget(fileLength: number): number {
  return 8 * fileLength + 8 * 2 ** 20;
}

/** Bytes left to lex; {@link charge} throws {@link OutOfBudget} past zero. */
interface Budget {
  left: number;
}

function charge(budget: Budget, n: number): void {
  budget.left -= Math.max(0, n);
  if (budget.left < 0) throw new OutOfBudget();
}

const isWhite = (c: number) =>
  c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0;
const isDelimiter = (c: number) =>
  c === 0x28 || // (
  c === 0x29 || // )
  c === 0x3c || // <
  c === 0x3e || // >
  c === 0x5b || // [
  c === 0x5d || // ]
  c === 0x7b || // {
  c === 0x7d || // }
  c === 0x2f || // /
  c === 0x25; // %
const isSpecial = (c: number) => c < 0 || isWhite(c) || isDelimiter(c);
const hexDigit = (c: number) =>
  c >= 0x30 && c <= 0x39
    ? c - 0x30
    : c >= 0x41 && c <= 0x46
      ? c - 0x37
      : c >= 0x61 && c <= 0x66
        ? c - 0x57
        : -1;

type Token =
  | { k: "num"; v: number }
  | { k: "name"; v: string }
  | { k: "punct"; v: "[" | "]" | "<<" | ">>" | "{" | "}" }
  | { k: "word"; v: string }
  | { k: "str" }
  | { k: "bad" }
  | { k: "end" };

/** pdf.js's lexer, for the tokens a dictionary is made of. */
class Lexer {
  pos: number;
  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.pos = start;
  }

  private at(i: number): number {
    return i < this.end ? this.bytes[i]! : -1;
  }

  next(): Token {
    let c = this.at(this.pos);
    for (;;) {
      if (c < 0) return { k: "end" };
      if (isWhite(c)) c = this.at(++this.pos);
      else if (c === 0x25) {
        while (c >= 0 && c !== 0x0a && c !== 0x0d) c = this.at(++this.pos);
      } else break;
    }
    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e)
      return this.number();
    switch (c) {
      case 0x2f:
        return this.name();
      case 0x28:
        return this.string();
      case 0x5b:
        this.pos += 1;
        return { k: "punct", v: "[" };
      case 0x5d:
        this.pos += 1;
        return { k: "punct", v: "]" };
      case 0x7b:
        this.pos += 1;
        return { k: "punct", v: "{" };
      case 0x7d:
        this.pos += 1;
        return { k: "punct", v: "}" };
      case 0x3c:
        if (this.at(this.pos + 1) === 0x3c) {
          this.pos += 2;
          return { k: "punct", v: "<<" };
        }
        while (c >= 0 && c !== 0x3e) c = this.at(++this.pos);
        this.pos += 1;
        return { k: "str" };
      case 0x3e:
        if (this.at(this.pos + 1) === 0x3e) {
          this.pos += 2;
          return { k: "punct", v: ">>" };
        }
        this.pos += 1;
        return { k: "bad" };
      case 0x29:
        this.pos += 1;
        return { k: "bad" };
    }
    let word = "";
    while (!isSpecial(c) && word.length < 128) {
      word += String.fromCharCode(c);
      c = this.at(++this.pos);
    }
    return { k: "word", v: word };
  }

  /** pdf.js `Lexer.getNumber`, step for step. */
  private number(): Token {
    let c = this.at(this.pos);
    let sign = 1;
    let divideBy = 0;
    if (c === 0x2d) {
      sign = -1;
      c = this.at(++this.pos);
      if (c === 0x2d) c = this.at(++this.pos);
    } else if (c === 0x2b) c = this.at(++this.pos);
    while (c === 0x0a || c === 0x0d) c = this.at(++this.pos);
    if (c === 0x2e) {
      divideBy = 10;
      c = this.at(++this.pos);
    }
    if (c < 0x30 || c > 0x39) {
      if (isWhite(c) || c === 0x28 || c === 0x3c || c < 0)
        return { k: "num", v: 0 };
      this.pos += 1;
      return { k: "bad" };
    }
    let value = c - 0x30;
    for (;;) {
      c = this.at(++this.pos);
      if (c >= 0x30 && c <= 0x39) {
        if (divideBy !== 0) divideBy *= 10;
        value = value * 10 + (c - 0x30);
      } else if (c === 0x2e) {
        if (divideBy === 0) divideBy = 1;
        else break;
      } else if (c !== 0x2d) break;
    }
    if (divideBy !== 0) value /= divideBy;
    return { k: "num", v: sign * value };
  }

  /** pdf.js `Lexer.getName`: `#xx` decoded, a bad escape kept as written. */
  private name(): Token {
    let out = "";
    let c = this.at(++this.pos);
    while (!isSpecial(c)) {
      if (c === 0x23) {
        c = this.at(++this.pos);
        if (isSpecial(c)) {
          out += "#";
          break;
        }
        const x = hexDigit(c);
        if (x === -1) {
          out += "#" + String.fromCharCode(c);
        } else {
          const first = c;
          c = this.at(++this.pos);
          const x2 = hexDigit(c);
          if (x2 === -1) {
            out += "#" + String.fromCharCode(first);
            if (isSpecial(c)) break;
            out += String.fromCharCode(c);
          } else out += String.fromCharCode((x << 4) | x2);
        }
      } else out += String.fromCharCode(c);
      c = this.at(++this.pos);
    }
    return { k: "name", v: out };
  }

  private string(): Token {
    let depth = 1;
    let c = this.at(++this.pos);
    while (c >= 0 && depth > 0) {
      if (c === 0x5c) this.pos += 1;
      else if (c === 0x28) depth += 1;
      else if (c === 0x29) depth -= 1;
      c = this.at(++this.pos);
    }
    return { k: "str" };
  }
}

/**
 * pdf.js's parser: `n g R` is a reference, `<< >>` a dictionary. Only the
 * two arrays the scan reads (/W and /Index at a dictionary's top level) are
 * kept, as plain numbers; every other array and every nested dictionary is
 * parsed to move past it and then dropped, so a dictionary holding a huge
 * array costs the scan its bytes in time, not many times its bytes in
 * memory.
 */
function parseValue(
  lex: Lexer,
  token: Token,
  depth: number,
  keep = false,
): Value {
  if (depth > 64) throw new TooDeep();
  switch (token.k) {
    case "end":
      throw new Incomplete();
    case "num": {
      if (Number.isInteger(token.v)) {
        const back = lex.pos;
        const gen = lex.next();
        if (gen.k === "num" && Number.isInteger(gen.v)) {
          const r = lex.next();
          if (r.k === "word" && r.v === "R") return { t: "ref", num: token.v };
        }
        lex.pos = back;
      }
      return { t: "num", v: token.v };
    }
    case "name":
      return { t: "name", v: token.v };
    case "word":
      return { t: "word", v: token.v };
    case "punct":
      if (token.v === "[") {
        const nums: number[] = [];
        for (let t = lex.next(); ; t = lex.next()) {
          if (t.k === "punct" && t.v === "]")
            return keep ? { t: "nums", v: nums } : { t: "arr", v: [] };
          if (t.k === "end") throw new Incomplete();
          const item = parseValue(lex, t, depth + 1);
          // pdf.js does not resolve an array's references: a reference, like
          // any other non-number, is not the integer its checks ask for.
          if (keep) nums.push(item.t === "num" ? item.v : NaN);
        }
      }
      if (token.v === "<<") {
        parseDictBody(lex, depth, false);
        return { t: "dict", v: new Map() };
      }
      return { t: "word", v: token.v };
    default:
      return { t: "str" };
  }
}

const KEPT_ARRAYS = new Set(["W", "Index"]);

function parseDictBody(
  lex: Lexer,
  depth: number,
  top = true,
): Map<string, Value> {
  const dict = new Map<string, Value>();
  for (let t = lex.next(); ; t = lex.next()) {
    if (t.k === "punct" && t.v === ">>") return dict;
    if (t.k === "end") throw new Incomplete();
    // pdf.js skips a key that is not a name, and a later key wins.
    if (t.k !== "name") continue;
    // A `>>` in a value's place is pdf.js's value too (a command object),
    // and the dictionary goes on after it.
    const value = parseValue(
      lex,
      lex.next(),
      depth + 1,
      top && KEPT_ARRAYS.has(t.v),
    );
    if (top) dict.set(t.v, value);
  }
}

/** A dictionary read by {@link dictAt}. */
interface ReadDict {
  readonly dict: Map<string, Value>;
  /** The token after `>>` (`stream` makes it a stream). */
  readonly then: Token;
  /** The offset just past that token. */
  readonly after: number;
}

/**
 * The dictionary that starts at the next token after `from`, or null, and
 * the token after it. Reads at most `span` bytes, each charged to `budget`.
 * Throws {@link Incomplete} when the dictionary does not close within
 * `span` (or the file), {@link TooDeep} past 64 levels, and
 * {@link OutOfBudget} when the budget, not the span, cut it short.
 */
function dictAt(
  bytes: Uint8Array,
  from: number,
  span: number,
  budget: Budget,
): ReadDict | null {
  const hard = Math.min(bytes.length, from + span);
  const end = Math.min(hard, from + Math.max(0, budget.left));
  const lex = new Lexer(bytes, from, end);
  const spent = () => Math.min(lex.pos, end) - from;
  try {
    const t = lex.next();
    if (t.k !== "punct" || t.v !== "<<") {
      if (t.k === "end" && end < hard) throw new OutOfBudget();
      charge(budget, spent());
      return null;
    }
    const dict = parseDictBody(lex, 0);
    const then = lex.next();
    // The budget may have cut off the very `stream` that would count.
    if (then.k === "end" && end < hard) throw new OutOfBudget();
    charge(budget, spent());
    return { dict, then, after: Math.min(lex.pos, end) };
  } catch (err) {
    if (err instanceof Incomplete && end < hard) throw new OutOfBudget();
    if (!(err instanceof OutOfBudget)) charge(budget, spent());
    throw err;
  }
}

/** `word` in `bytes`, at or after `from` (before `end`). */
function indexOfWord(
  bytes: Uint8Array,
  word: string,
  from: number,
  end = bytes.length,
): number {
  const first = word.charCodeAt(0);
  for (let i = bytes.indexOf(first, from); i >= 0 && i < end;) {
    let k = 1;
    while (k < word.length && bytes[i + k] === word.charCodeAt(k)) k += 1;
    if (k === word.length) return i;
    i = bytes.indexOf(first, i + 1);
  }
  return -1;
}

/** `word` in `bytes`, last starting before `before` (and at or after `floor`). */
function lastIndexOfWord(
  bytes: Uint8Array,
  word: string,
  before: number,
  floor = 0,
): number {
  const first = word.charCodeAt(0);
  for (let i = bytes.lastIndexOf(first, before - 1); i >= floor;) {
    let k = 1;
    while (k < word.length && bytes[i + k] === word.charCodeAt(k)) k += 1;
    if (k === word.length) return i;
    if (i === 0) return -1;
    i = bytes.lastIndexOf(first, i - 1);
  }
  return -1;
}

/**
 * The /Index ranges pdf.js walks, as flat `first, n` pairs with `n > 0`, or
 * null when only a reference could say. pdf.js reads
 * `dict.get("Index") || [0, Size]` and walks pairs until one is not two
 * integers. Anything but an array falls back to /Size here: that is pdf.js's
 * reading of every falsy value (`0`, `null`, `false`, and an empty string
 * `()` or `<>`, which review 2 found), and for a truthy non-array pdf.js
 * walks nothing, so the fallback only ever counts more. A reference in
 * /Index or /Size is one ISO 32000-1 7.5.8.2 forbids ("indirect references
 * shall not be permitted").
 */
function rowRanges(dict: Map<string, Value>): number[] | null {
  const index = dict.get("Index");
  if (index?.t === "ref") return null;
  const out: number[] = [];
  if (index?.t === "nums") {
    for (let i = 0; i + 1 < index.v.length; i += 2) {
      const first = index.v[i]!;
      const n = index.v[i + 1]!;
      if (!Number.isInteger(first) || !Number.isInteger(n)) break;
      if (n > 0) out.push(first, n);
    }
    return out;
  }
  const size = dict.get("Size");
  if (size?.t === "ref") return null;
  if (size?.t === "num" && Number.isInteger(size.v) && size.v > 0)
    out.push(0, size.v);
  return out;
}

/** The sum of /W's first three widths as pdf.js reads them, or null. */
function rowWidth(w: Value): number | null {
  if (w.t !== "nums" || w.v.length < 3) return null;
  let total = 0;
  for (const x of w.v.slice(0, 3)) {
    if (!Number.isInteger(x)) return null;
    // A negative width reads no bytes (pdf.js's `j < width` loop).
    total += Math.max(0, x);
  }
  return total;
}

/** Every xref-stream row the file can make pdf.js walk, summed. */
class RowLedger {
  /** Flat `first, n` pairs of every walk, for the union. */
  private readonly ranges: number[] = [];
  rows = 0;
  rowBytes = 0;
  streams = 0;

  constructor(private readonly fileLength: number) {}

  /**
   * One stream dictionary, its data starting at `dataStart`. Throws
   * {@link Refuse} for what no bound can be put on.
   */
  add(dict: Map<string, Value>, dataStart: number): void {
    const w = dict.get("W");
    // pdf.js reads no rows without /W (its destructuring throws first).
    if (w === undefined) return;
    this.streams += 1;
    const ranges = rowRanges(dict);
    if (ranges === null) throw new Refuse();
    if (w.t === "ref") {
      // An indirect /W (7.5.8.2 forbids it): its widths could be zero, or a
      // megabyte a row. Nothing to walk is still nothing.
      if (ranges.length > 0) throw new Refuse();
      return;
    }
    const width = rowWidth(w);
    // pdf.js rejects the widths ("Invalid XRef entry fields length").
    if (width === null) return;
    // Rows that read bytes stop where the bytes do. Unfiltered, those are
    // the file's; a filter can make any number of them. pdf.js reads the
    // filter as `dict.get("F", "Filter")` (review 3: `/F /FlateDecode` was
    // capped as unfiltered and drove pdf.js to 3.4 GB), so either key, with
    // any value, counts as a filter here. xref-prescan.test.ts reads the
    // keys back out of the shipped pdf.js worker.
    let cap =
      width > 0 && !dict.has("Filter") && !dict.has("F")
        ? Math.floor(Math.max(0, this.fileLength - dataStart) / width)
        : Infinity;
    let walked = 0;
    for (let i = 0; i < ranges.length && cap > 0; i += 2) {
      const n = Math.min(ranges[i + 1]!, cap);
      cap -= n;
      walked += n;
      this.ranges.push(ranges[i]!, n);
    }
    // A zero-width row reads nothing: no producer writes one, so only a few
    // are left for pdf.js to recover.
    if (width === 0 && walked > ZERO_WIDTH_ROW_LIMIT) throw new Refuse();
    this.rows += walked;
    this.rowBytes += walked * Math.max(1, width);
    if (this.rowBytes > ROW_BYTES_PER_ENTRY * xrefEntryLimit(this.fileLength))
      throw new Refuse();
  }

  /** The distinct entries pdf.js would store: the union of every walk. */
  entries(): number {
    const pairs: [number, number][] = [];
    for (let i = 0; i < this.ranges.length; i += 2)
      pairs.push([this.ranges[i]!, this.ranges[i]! + this.ranges[i + 1]!]);
    pairs.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let to = -Infinity;
    for (const [lo, hi] of pairs) {
      if (hi <= to) continue;
      total += hi - Math.max(lo, to);
      to = hi;
    }
    return total;
  }
}

/**
 * pdf.js `startXRef`: the last `startxref`, its digits read by `parseInt`;
 * 0 when there is none or it reads as no number.
 */
function startxrefOffset(bytes: Uint8Array): number {
  const at = lastIndexOfWord(bytes, "startxref", bytes.length);
  if (at < 0) return 0;
  let i = at + 9;
  while (i < bytes.length && isWhite(bytes[i]!)) i += 1;
  let digits = "";
  while (i < bytes.length && bytes[i]! >= 0x20 && bytes[i]! <= 0x39)
    digits += String.fromCharCode(bytes[i++]!);
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * pdf.js `Linearization.create`: a first object with a positive
 * /Linearized and an /L equal to the file's length moves the first section
 * to just after the first `endobj`.
 */
function linearizedStart(bytes: Uint8Array, budget: Budget): number | null {
  const lex = new Lexer(bytes, 0, Math.min(bytes.length, 1024));
  // Skip the header line: `%PDF-x.y` is a comment to the lexer.
  const n = lex.next();
  const g = lex.next();
  const obj = lex.next();
  if (n.k !== "num" || g.k !== "num" || obj.k !== "word" || obj.v !== "obj")
    return null;
  let dict: Map<string, Value> | undefined;
  try {
    dict = dictAt(bytes, lex.pos, DICT_SPAN_LIMIT, budget)?.dict;
  } catch (err) {
    if (err instanceof OutOfBudget) throw err;
    return null;
  }
  const lin = dict?.get("Linearized");
  const l = dict?.get("L");
  if (lin?.t !== "num" || lin.v <= 0) return null;
  if (l?.t !== "num" || l.v !== bytes.length) return null;
  let at = indexOfWord(bytes, "endobj", 0);
  if (at < 0) return null;
  at += 6;
  while (at < bytes.length && isWhite(bytes[at]!)) at += 1;
  return at;
}

/** One section of the chain: its dictionary and where it points next. */
function sectionAt(
  bytes: Uint8Array,
  offset: number,
  budget: Budget,
): { dict: Map<string, Value>; next: number[] } | null {
  const lex = new Lexer(
    bytes,
    offset,
    Math.min(bytes.length, offset + DICT_SPAN_LIMIT),
  );
  const first = lex.next();
  let dict: Map<string, Value>;
  let table = false;
  if (first.k === "word" && first.v === "xref") {
    table = true;
    const searchEnd = Math.min(
      bytes.length,
      lex.pos + Math.max(0, budget.left),
    );
    const at = indexOfWord(bytes, "trailer", lex.pos, searchEnd);
    charge(budget, (at < 0 ? searchEnd : at) - offset);
    if (at < 0) {
      if (searchEnd < bytes.length) throw new OutOfBudget();
      return null;
    }
    const read = dictAt(bytes, at + 7, DICT_SPAN_LIMIT, budget);
    if (!read) return null;
    dict = read.dict;
  } else if (first.k === "num" && Number.isInteger(first.v)) {
    const gen = lex.next();
    const obj = lex.next();
    charge(budget, lex.pos - offset);
    if (gen.k !== "num" || obj.k !== "word" || obj.v !== "obj") return null;
    // pdf.js takes the object as a section only when it is a stream.
    const read = dictAt(bytes, lex.pos, DICT_SPAN_LIMIT, budget);
    if (!read || read.then.k !== "word" || read.then.v !== "stream")
      return null;
    dict = read.dict;
  } else return null;
  // Only direct offsets are followed here. The newest section (the one
  // that names the trailer) is never reached through a reference, and the
  // rows of every section ANY offset can reach, a reference's integer
  // object included, are counted by prescanXref's scan of every stream.
  const next: number[] = [];
  const stm = dict.get("XRefStm");
  if (table && stm?.t === "num" && Number.isInteger(stm.v)) next.push(stm.v);
  const prev = dict.get("Prev");
  if (prev?.t === "num" && Number.isInteger(prev.v)) next.push(prev.v);
  return { dict, next };
}

/** What the scan found. */
export interface XrefPrescan {
  /** pdf.js would walk rows past a bound, or the scan could not tell: refuse. */
  readonly unbounded: boolean;
  /**
   * The newest section's dictionary carries /Encrypt (the trailer pdf.js
   * decrypts with), or, when that section cannot be read and pdf.js would
   * rebuild the cross-reference by scanning, any trailer it could find does.
   */
  readonly namesEncrypt: boolean;
  /** Section dictionaries read and checked (a health check for tests). */
  readonly sections: number;
  /** Streams with a /W whose rows were counted (a health check). */
  readonly streams: number;
  /** Distinct entries those rows would make pdf.js store. */
  readonly entries: number;
  /** Bytes lexed or searched past, against {@link scanBudget}. */
  readonly lexed: number;
}

/** Read the sections. Never throws. */
export function prescanXref(bytes: Uint8Array): XrefPrescan {
  const limit = xrefEntryLimit(bytes.length);
  const budget: Budget = { left: scanBudget(bytes.length) };
  const ledger = new RowLedger(bytes.length);
  let sections = 0;
  const result = (unbounded: boolean, namesEncrypt: boolean) => ({
    unbounded,
    namesEncrypt,
    sections,
    streams: ledger.streams,
    entries: unbounded ? 0 : ledger.entries(),
    lexed: scanBudget(bytes.length) - budget.left,
  });
  try {
    // 1. The rows: every `obj` whose dictionary is followed by `stream`.
    // `endobj` is not one, nor is a longer word that starts `obj`. Nothing
    // read here outlives its iteration: a Map kept per object cost about 23
    // bytes of heap per file byte on the caller's thread (review 3), so step
    // 3 reads again the few dictionaries it needs.
    for (
      let at = indexOfWord(bytes, "obj", 0);
      at >= 0;
      at = indexOfWord(bytes, "obj", at + 3)
    ) {
      const read = objDictAt(bytes, at, budget);
      if (read?.then.k === "word" && read.then.v === "stream")
        ledger.add(read.dict, read.after);
    }
    sections += ledger.streams;
    // The union only matters once the plain sum is past the bound.
    if (ledger.rows > limit && ledger.entries() > limit) throw new Refuse();

    // 2. The chain pdf.js reads first, for the trailer it decrypts with.
    const lin = linearizedStart(bytes, budget);
    const tail = startxrefOffset(bytes);
    // pdf.js starts from one of these; the other is read too (a superset
    // only adds sections to check), but only pdf.js's names the trailer.
    const starts = lin === null ? [tail] : [lin, tail];
    let top: Map<string, Value> | null = null;
    let topRead = false;
    const seen = new Set<number>();
    const queue = [...starts];
    while (queue.length > 0 && seen.size < CHAIN_LIMIT) {
      const offset = queue.shift()!;
      if (seen.has(offset) || offset < 0 || offset >= bytes.length) continue;
      seen.add(offset);
      let section: ReturnType<typeof sectionAt> = null;
      try {
        section = sectionAt(bytes, offset, budget);
      } catch (err) {
        // A section dictionary that does not close within 1 MiB (or nests
        // past 64): nothing in it can be checked, and pdf.js would still
        // read it. No real producer writes one.
        if (err instanceof Incomplete || err instanceof TooDeep)
          throw new Refuse();
        throw err;
      }
      if (!topRead) {
        topRead = true;
        top = section?.dict ?? null;
      }
      if (!section) continue;
      sections += 1;
      queue.push(...section.next);
    }
    if (top) return result(false, top.has("Encrypt"));

    // 3. No readable newest section: pdf.js rebuilds, and prefers a trailer
    // that has /Encrypt over one that does not (`indexObjects`). Its
    // candidates: every object whose body names /XRef, and every `trailer`.
    const fallbackTrailers: Map<string, Value>[] = [];
    let floor = 0;
    for (let at = indexOfWord(bytes, "/XRef", 0); at >= 0;) {
      const after = bytes[at + 5];
      if (after === undefined || after < 64) {
        // Each object is read at most once: a second /XRef in the same body
        // finds no header above the first (`floor`).
        const obj = objHeaderBefore(bytes, at, floor);
        const dict = obj >= 0 ? objDictAt(bytes, obj, budget)?.dict : undefined;
        if (dict) fallbackTrailers.push(dict);
      }
      floor = at;
      at = indexOfWord(bytes, "/XRef", at + 5);
    }
    for (let at = indexOfWord(bytes, "trailer", 0); at >= 0;) {
      try {
        const dict = dictAt(bytes, at + 7, DICT_SPAN_LIMIT, budget)?.dict;
        if (dict) fallbackTrailers.push(dict);
      } catch (err) {
        // an unclosed trailer: pdf.js cannot read it either
        if (err instanceof OutOfBudget) throw err;
      }
      at = indexOfWord(bytes, "trailer", at + 7);
    }
    return result(
      false,
      fallbackTrailers.some((d) => d.has("Encrypt")),
    );
  } catch {
    // Refuse, TooDeep and OutOfBudget all mean "cannot be bounded". Any
    // other error is a defect here, and refusing is the side that cannot
    // hand pdf.js an unbounded walk (the legit corpus keeps it honest).
    return result(true, false);
  }
}

/**
 * The dictionary of the object whose `obj` keyword is at `at`, or null when
 * that is `endobj`, a longer word, or a dictionary still open at the end of
 * the file (pdf.js cannot read it either). Throws {@link TooDeep} and
 * {@link OutOfBudget}.
 */
function objDictAt(
  bytes: Uint8Array,
  at: number,
  budget: Budget,
): ReadDict | null {
  if (isEndobj(bytes, at)) return null;
  if (!isSpecial(at + 3 < bytes.length ? bytes[at + 3]! : -1)) return null;
  try {
    // No span: a stream dictionary pdf.js can read may run any length, and
    // the budget bounds what all of them cost together.
    return dictAt(bytes, at + 3, bytes.length, budget);
  } catch (err) {
    if (!(err instanceof Incomplete)) throw err;
    return null;
  }
}

/** `obj` at `at` is the tail of `endobj`. */
function isEndobj(bytes: Uint8Array, at: number): boolean {
  return (
    at >= 3 &&
    bytes[at - 3] === 0x65 &&
    bytes[at - 2] === 0x6e &&
    bytes[at - 1] === 0x64
  );
}

/** The `obj` keyword that opens the object holding `at` (not `endobj`). */
function objHeaderBefore(bytes: Uint8Array, at: number, floor: number): number {
  for (let i = lastIndexOfWord(bytes, "obj", at, floor); i >= floor;) {
    if (!isEndobj(bytes, i)) return i;
    if (i === 0) return -1;
    i = lastIndexOfWord(bytes, "obj", i, floor);
  }
  return -1;
}
