/**
 * Object-level readers for the pdf.js preflight's stream scan
 * (./pdfjs-guard.ts): where each object's dictionary REALLY ends, which
 * objects a page's /Contents names, and the names and arrays some objects
 * hold. Each is linear in the file, or charges its work to a budget the
 * caller bounds.
 *
 * Third review of lane l07: the scan found streams by the bytes `>>stream`
 * and paired `<<` with `>>` byte by byte, so `/X (>>stream)` in a content
 * stream's dictionary ended it at the string and hid the /Filter after it;
 * and it trusted labels (/Subtype /Image, /Length1, /Type /Metadata) that
 * pdf.js never reads for page content. pdf.js reads an object from its
 * `num gen obj` header, with a lexer that knows strings and comments, and
 * reads a page's /Contents whatever the stream's dictionary says.
 *
 * Its own module so that nothing here reaches a first-load bundle
 * (pdfjs-guard is loaded with `import()`).
 */
import {
  ascii,
  indexOfWord,
  isDelimiter,
  isWhite,
  matchesAt,
} from "./pdf-scan-bytes";

const OBJ = ascii("obj");
const STREAM = ascii("stream");
const ENDOBJ = ascii("endobj");

/** How far back from `obj` its header may start: 256 bytes. */
const HEADER_WINDOW = 256;

/** A byte of a number token: digits, sign, point (pdf.js reads `+5` and `5.0`). */
const isNumberByte = (b: number | undefined): boolean =>
  b !== undefined &&
  ((b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2d || b === 0x2e);

/** Neither whitespace nor a delimiter: part of a name, number or keyword. */
const isRegular = (b: number | undefined): boolean =>
  b !== undefined && !isWhite(b) && !isDelimiter(b);

const latin1 = new TextDecoder("latin1");

/**
 * Back from `p` over whitespace and comments: the last byte at or before `p`
 * that is neither, or `floor - 1`. A comment runs from `%` to the end of its
 * line, so a byte is in one when its line holds a `%` before it. A number
 * byte is taken as a token (so a header's digits never cost a line scan).
 */
function skipBack(bytes: Uint8Array, p: number, floor: number): number {
  for (;;) {
    while (p >= floor && isWhite(bytes[p]!)) p -= 1;
    if (p < floor || isNumberByte(bytes[p])) return p;
    const line = bytes.subarray(floor, p + 1);
    const lineStart =
      Math.max(line.lastIndexOf(0x0a), line.lastIndexOf(0x0d)) + 1;
    const pct = line.indexOf(0x25, lineStart);
    if (pct === -1) return p;
    p = floor + pct - 1;
  }
}

/** Forward from `i` over whitespace and comments: the first other byte. */
export function skipForward(bytes: Uint8Array, i: number): number {
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (isWhite(b)) i += 1;
    else if (b === 0x25) {
      while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) {
        i += 1;
      }
    } else break;
  }
  return i;
}

/**
 * The object number of the header whose `obj` keyword starts at `objAt`:
 * `num gen obj`, whitespace or comments between the tokens, as pdf.js's
 * lexer reads them. NaN when it is a header whose number is not a whole
 * number; null when the keyword is not a header (`endobj`, a word).
 */
export function objectHeaderNumber(
  bytes: Uint8Array,
  objAt: number,
): number | null {
  if (isRegular(bytes[objAt + 3])) return null;
  const floor = Math.max(0, objAt - HEADER_WINDOW);
  const p = skipBack(bytes, objAt - 1, floor);
  let q = p;
  while (q >= floor && isNumberByte(bytes[q])) q -= 1;
  if (q === p || p - q > 12) return null;
  const s = skipBack(bytes, q, floor);
  if (s === q) return null;
  let t = s;
  while (t >= floor && isNumberByte(bytes[t])) t -= 1;
  if (t === s || s - t > 12) return null;
  const num = Number(latin1.decode(bytes.subarray(t + 1, s + 1)));
  return Number.isInteger(num) && num >= 0 ? num : NaN;
}

export interface ObjectHeader {
  /** Where the `obj` keyword starts. */
  objAt: number;
  /** Its object number; NaN when it is not a whole number. */
  num: number;
}

/** Every object header in the file, in file order. */
export function findObjectHeaders(bytes: Uint8Array): ObjectHeader[] {
  const out: ObjectHeader[] = [];
  for (
    let o = indexOfWord(bytes, OBJ, 0);
    o !== -1;
    o = indexOfWord(bytes, OBJ, o + 3)
  ) {
    const num = objectHeaderNumber(bytes, o);
    if (num !== null) out.push({ objAt: o, num });
  }
  return out;
}

/**
 * The end (exclusive) of the dictionary that opens at `i` (a `<<`), as
 * pdf.js's parser reads it: strings (nested, escaped), hex strings and
 * comments are skipped; a `>>` inside an array is an array element, not a
 * close; a `]` inside a dictionary is ignored. -1 when it does not close
 * before `limit`.
 */
export function dictEnd(bytes: Uint8Array, i: number, limit: number): number {
  const stop = Math.min(limit, bytes.length);
  /** 1 for `<<`, 2 for `[`. */
  const stack: number[] = [];
  while (i < stop) {
    const b = bytes[i]!;
    if (b === 0x28) {
      let depth = 0;
      for (; i < stop; i += 1) {
        const c = bytes[i];
        if (c === 0x5c) i += 1;
        else if (c === 0x28) depth += 1;
        else if (c === 0x29) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      i += 1;
    } else if (b === 0x25) {
      while (i < stop && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i += 1;
    } else if (b === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        stack.push(1);
        i += 2;
      } else {
        const close = bytes.indexOf(0x3e, i + 1);
        i = close === -1 || close >= stop ? stop : close + 1;
      }
    } else if (b === 0x3e && bytes[i + 1] === 0x3e) {
      i += 2;
      if (stack[stack.length - 1] === 1) {
        stack.pop();
        if (stack.length === 0) return i;
      }
    } else if (b === 0x5b) {
      stack.push(2);
      i += 1;
    } else if (b === 0x5d) {
      if (stack[stack.length - 1] === 2) stack.pop();
      i += 1;
    } else {
      i += 1;
    }
  }
  return -1;
}

export interface ParsedObject {
  /** Bytes read to parse it (charged to the caller's budget). */
  cost: number;
  /** The dictionary [dictStart, dictEnd), when the object is one. */
  dictStart: number;
  dictEnd: number;
  /** The `stream` keyword after the dictionary, or -1. */
  streamKw: number;
}

/**
 * Parse the object whose header's `obj` starts at `objAt`, reading at most
 * `budget` bytes: its dictionary's true end, and the `stream` keyword that
 * follows it (whitespace or comments between, as pdf.js allows).
 */
export function parseObjectAt(
  bytes: Uint8Array,
  objAt: number,
  budget: number,
): ParsedObject {
  const none = (cost: number): ParsedObject => ({
    cost,
    dictStart: -1,
    dictEnd: -1,
    streamKw: -1,
  });
  const k = skipForward(bytes, objAt + 3);
  if (k - objAt > budget) return none(budget + 1);
  if (!(bytes[k] === 0x3c && bytes[k + 1] === 0x3c)) return none(k - objAt);
  const end = dictEnd(bytes, k, objAt + budget + 1);
  if (end === -1)
    return none(Math.min(bytes.length, objAt + budget + 1) - objAt);
  const p = skipForward(bytes, end);
  const isStream = matchesAt(bytes, p, STREAM) && !isRegular(bytes[p + 6]);
  return {
    cost: p - objAt,
    dictStart: k,
    dictEnd: end,
    streamKw: isStream ? p : -1,
  };
}

const decodeName = (raw: string): string =>
  raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );

/**
 * Objects whose whole body is one name (`7 0 obj /Image endobj`), by object
 * number, from the file's plain text. An object defined twice with
 * different names maps to "?" (unknown). A name held in an object stream is
 * not seen.
 */
export function nameObjects(
  bytes: Uint8Array,
  headers: readonly ObjectHeader[],
): Map<number, string> {
  const out = new Map<number, string>();
  for (const h of headers) {
    if (!Number.isInteger(h.num)) continue;
    const k = skipForward(bytes, h.objAt + 3);
    if (bytes[k] !== 0x2f) continue;
    let j = k + 1;
    while (j < bytes.length && j - k < 128 && isRegular(bytes[j])) j += 1;
    if (!matchesAt(bytes, skipForward(bytes, j), ENDOBJ)) continue;
    const name = decodeName(latin1.decode(bytes.subarray(k + 1, j)));
    const had = out.get(h.num);
    out.set(h.num, had === undefined || had === name ? name : "?");
  }
  return out;
}

/**
 * The `num gen R` references inside the array that opens at `i` (a `[`),
 * up to its `]`, reading at most `limit` bytes.
 */
function arrayRefsAt(bytes: Uint8Array, i: number, limit: number): number[] {
  const out: number[] = [];
  const ints: number[] = [];
  const stop = Math.min(bytes.length, i + limit);
  let j = i + 1;
  while (j < stop) {
    j = skipForward(bytes, j);
    const b = bytes[j];
    if (b === undefined || b === 0x5d) break;
    if (!isRegular(b)) {
      ints.length = 0;
      j += 1;
      continue;
    }
    let e = j;
    while (e < stop && isRegular(bytes[e])) e += 1;
    const word = latin1.decode(bytes.subarray(j, e));
    if (/^\d+$/.test(word)) ints.push(Number(word));
    else if (word === "R" && ints.length >= 2) {
      out.push(ints[ints.length - 2]!);
      ints.length = 0;
    } else ints.length = 0;
    j = e;
  }
  return out;
}

/**
 * The plain-text array objects among `nums` (`5 0 obj [4 0 R 6 0 R]`): the
 * references each holds, by object number.
 */
export function arrayObjectRefs(
  bytes: Uint8Array,
  headers: readonly ObjectHeader[],
  nums: ReadonlySet<number>,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const h of headers) {
    if (!nums.has(h.num)) continue;
    const k = skipForward(bytes, h.objAt + 3);
    if (bytes[k] !== 0x5b) continue;
    const refs = arrayRefsAt(bytes, k, bytes.length);
    out.set(h.num, [...(out.get(h.num) ?? []), ...refs]);
  }
  return out;
}

const S_SCAN = 0;
const S_NAME = 1;
const S_VALUE = 2;
const S_REF = 3;
const S_ARRAY = 4;
const CONTENTS = "Contents";

/**
 * What every `/Contents` key names, read from text fed in chunks (the
 * file's bytes, and each decoded object stream): `arrays` holds each
 * reference inside a direct array (each names a content stream), `direct`
 * each lone reference (a content stream, or an array object of them). Name
 * escapes are decoded (`/Cont#65nts`) and comments skipped, as pdf.js does.
 * It reads stream data too, so it may find more than a page names; never
 * fewer, for any text it is fed.
 */
export class ContentsRefs {
  readonly arrays = new Set<number>();
  readonly direct = new Set<number>();
  private state = S_SCAN;
  private comment = false;
  private name = "";
  private tok = "";
  private ints: number[] = [];

  /**
   * End the text fed so far (a reference that ends it is counted) and
   * forget the tokenizer state: the next chunk does not continue this one.
   */
  reset(): void {
    if (this.state === S_REF || this.state === S_ARRAY) this.flush();
    this.state = S_SCAN;
    this.comment = false;
    this.name = "";
    this.tok = "";
    this.ints = [];
  }

  feed(chunk: Uint8Array): void {
    let i = 0;
    while (i < chunk.length) {
      if (this.state === S_SCAN) {
        const slash = chunk.indexOf(0x2f, i);
        if (slash === -1) return;
        this.state = S_NAME;
        this.name = "";
        i = slash + 1;
        continue;
      }
      const b = chunk[i]!;
      if (this.comment) {
        if (b === 0x0a || b === 0x0d) this.comment = false;
        i += 1;
        continue;
      }
      if (this.state === S_NAME) {
        if (isRegular(b)) {
          if (this.name.length < 64) this.name += String.fromCharCode(b);
          i += 1;
          continue;
        }
        this.state = decodeName(this.name) === CONTENTS ? S_VALUE : S_SCAN;
        continue; // the delimiter is read again in the new state
      }
      if (this.state === S_VALUE) {
        if (isWhite(b)) i += 1;
        else if (b === 0x25) {
          this.comment = true;
          i += 1;
        } else if (b === 0x5b) {
          this.state = S_ARRAY;
          this.ints = [];
          this.tok = "";
          i += 1;
        } else if (isRegular(b)) {
          this.state = S_REF;
          this.ints = [];
          this.tok = "";
        } else this.state = S_SCAN;
        continue;
      }
      // S_REF or S_ARRAY: tokens of `num gen R`.
      if (isRegular(b)) {
        if (this.tok.length < 16) this.tok += String.fromCharCode(b);
        i += 1;
        continue;
      }
      const ended = this.flush();
      if (this.state === S_REF && ended) {
        this.state = S_SCAN;
        continue;
      }
      if (b === 0x25) {
        this.comment = true;
        i += 1;
      } else if (isWhite(b)) {
        i += 1;
      } else if (this.state === S_ARRAY && b === 0x5d) {
        this.state = S_SCAN;
        i += 1;
      } else if (this.state === S_REF) {
        this.state = S_SCAN; // a delimiter ends a lone reference's value
      } else {
        this.ints = [];
        i += 1;
      }
    }
  }

  /** Finish the token in progress; true when a lone reference's value ended. */
  private flush(): boolean {
    const tok = this.tok;
    this.tok = "";
    if (tok === "") return false;
    if (/^\d+$/.test(tok)) {
      this.ints.push(Number(tok));
      if (this.ints.length > 2) this.ints.shift();
      return false;
    }
    if (tok === "R" && this.ints.length === 2) {
      const num = this.ints[0]!;
      (this.state === S_ARRAY ? this.arrays : this.direct).add(num);
      this.ints = [];
      return true;
    }
    this.ints = [];
    return true;
  }
}
