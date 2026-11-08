/**
 * Byte-level readers for the pdf.js preflight's stream scan
 * (./pdfjs-guard.ts), each LINEAR in the file however it is crafted. They run
 * in the caller's thread, before pdf.js and its worker, so a reader that is
 * quadratic on some byte soup freezes the tab (second review of lane l07:
 * 4.5 MB of `>>stream` took 18 s, and 1.6 MB of `<</Length 0>>stream` did not
 * finish in 2 minutes).
 *
 * Its own module so that pdfjs-guard.ts stays the one place a caller imports,
 * and nothing here reaches a first-load bundle (pdfjs-guard is loaded with
 * `import()`).
 */

/** PDF whitespace: NUL, TAB, LF, FF, CR, SPACE. */
export function isWhite(b: number): boolean {
  return (
    b === 0x20 ||
    b === 0x0a ||
    b === 0x0d ||
    b === 0x09 ||
    b === 0x0c ||
    b === 0x00
  );
}

/** A PDF delimiter: ( ) < > [ ] { } / %. */
export function isDelimiter(b: number): boolean {
  return (
    b === 0x28 ||
    b === 0x29 ||
    b === 0x3c ||
    b === 0x3e ||
    b === 0x5b ||
    b === 0x5d ||
    b === 0x7b ||
    b === 0x7d ||
    b === 0x2f ||
    b === 0x25
  );
}

const isDigit = (b: number | undefined): boolean =>
  b !== undefined && b >= 0x30 && b <= 0x39;

export function matchesAt(
  bytes: Uint8Array,
  at: number,
  word: Uint8Array,
): boolean {
  if (at < 0 || at + word.length > bytes.length) return false;
  for (let k = 0; k < word.length; k += 1) {
    if (bytes[at + k] !== word[k]) return false;
  }
  return true;
}

export function indexOfWord(
  bytes: Uint8Array,
  word: Uint8Array,
  from: number,
): number {
  const first = word[0]!;
  for (
    let i = bytes.indexOf(first, from);
    i !== -1;
    i = bytes.indexOf(first, i + 1)
  ) {
    if (matchesAt(bytes, i, word)) return i;
  }
  return -1;
}

export const ascii = (s: string): Uint8Array =>
  Uint8Array.from(s, (c) => c.charCodeAt(0));

/**
 * How far back a stream's dictionary may start: 65,536 bytes. Real stream
 * dictionaries are a few hundred bytes (a Form's inline /Resources can reach
 * a few KB); the first fix's backward search used the same window.
 */
export const DICT_SEARCH_WINDOW = 65_536;

/**
 * Where the dictionary that closes at a given `>>` opens, for queries that
 * move forward through the file: the scan asks once per `stream` keyword, in
 * file order.
 *
 * The first fix walked BACK from each `>>` up to 64 KB, counting `>>` and
 * `<<`, so a file of `>>stream` repeated walked 64 KB per keyword. This
 * matcher reads every byte once, forward, with a stack of open `<<`, and
 * returns exactly what that backward walk returned (a property test pins the
 * two together): the nearest `<<` that balances the `>>`, if it lies within
 * {@link DICT_SEARCH_WINDOW}, else null. Runs of `<` or `>` pair from the
 * right, as the backward walk paired them.
 */
export class DictMatcher {
  private cursor = 0;
  private stack: number[] = [];
  /** Opens popped off the bottom because they are too old to match. */
  private stale = 0;

  constructor(private readonly bytes: Uint8Array) {}

  /**
   * The offset of the `<<` matching the `>>` that ends at `end` (exclusive),
   * or null. `end` must not go backwards between calls, and the byte at
   * `end` must not be `>` (the scan passes the end of a `>>` that whitespace
   * or `stream` follows).
   */
  startBefore(end: number): number | null {
    if (end < this.cursor) {
      throw new Error("DictMatcher: queries must move forward");
    }
    const b = this.bytes;
    let match: number | null = null;
    let i = this.cursor;
    while (i < end) {
      const c = b[i];
      if (c !== 0x3c && c !== 0x3e) {
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < b.length && b[j] === c) j += 1;
      const pairs = (j - i) >> 1;
      if (c === 0x3c) {
        for (let m = pairs; m >= 1; m -= 1) this.push(j - 2 * m, i);
      } else {
        for (let m = pairs; m >= 1; m -= 1) {
          const open = this.pop();
          if (j - 2 * m + 2 === end) match = open;
        }
      }
      i = j;
    }
    this.cursor = i;
    const floor = Math.max(0, end - DICT_SEARCH_WINDOW);
    return match !== null && match >= floor ? match : null;
  }

  private push(open: number, at: number): void {
    const s = this.stack;
    if (s.length >= DICT_SEARCH_WINDOW) {
      // Opens older than the window can never be returned; keep only their
      // count, so the stack stays within one window of entries.
      let k = 0;
      while (k < s.length && s[k]! < at - DICT_SEARCH_WINDOW) k += 1;
      s.splice(0, k);
      this.stale += k;
    }
    s.push(open);
  }

  private pop(): number | null {
    if (this.stack.length > 0) return this.stack.pop()!;
    if (this.stale > 0) {
      this.stale -= 1;
      return -1;
    }
    return null;
  }
}

/** One value of a dictionary's top level, as the scan needs it. */
export type DictValue =
  | { kind: "name"; name: string }
  | { kind: "number"; value: number }
  | { kind: "ref"; num: number }
  | { kind: "array"; raw: string }
  | { kind: "word"; word: string }
  | { kind: "other" };

const WS = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%]/;

function skipString(s: string, i: number): number {
  let depth = 0;
  for (; i < s.length; i += 1) {
    const c = s[i];
    if (c === "\\") i += 1;
    else if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}

/** The end of the array, dictionary or string that starts at `i`. */
function skipComposite(s: string, i: number): number {
  let depth = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "(") {
      i = skipString(s, i);
      if (depth === 0) return i;
      continue;
    }
    if (c === "%") {
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i += 1;
      continue;
    }
    if (c === "<") {
      if (s[i + 1] === "<") {
        depth += 1;
        i += 2;
        continue;
      }
      const close = s.indexOf(">", i + 1);
      i = close === -1 ? s.length : close + 1;
      if (depth === 0) return i;
      continue;
    }
    if (c === ">" && s[i + 1] === ">") {
      depth -= 1;
      i += 2;
      if (depth <= 0) return i;
      continue;
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth <= 0) return i + 1;
    }
    i += 1;
  }
  return s.length;
}

const decodeName = (raw: string): string =>
  raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );

type Token =
  | { t: "name"; v: string }
  | { t: "number"; v: number }
  | { t: "word"; v: string }
  | { t: "array"; raw: string }
  | { t: "other" };

/**
 * The TOP-LEVEL entries of a dictionary `<< ... >>`, every value of every
 * key (a repeated key keeps all of them). Nested dictionaries and arrays are
 * values, never sources of keys: the first fix read the first `/Key` match
 * anywhere in the text, so `/DecodeParms << /BitsPerComponent 1 >>` ahead of
 * `/BitsPerComponent 8` made an 8-bit image read as 1-bit. Names are decoded
 * (`/Wid#74h` is `/Width`), as pdf.js decodes them.
 */
export function dictEntries(dict: string): Map<string, DictValue[]> {
  const tokens: Token[] = [];
  const n = dict.length;
  let i = dict.startsWith("<<") ? 2 : 0;
  while (i < n) {
    const c = dict[i]!;
    if (WS.test(c)) {
      i += 1;
    } else if (c === "%") {
      while (i < n && dict[i] !== "\n" && dict[i] !== "\r") i += 1;
    } else if (c === ">" && dict[i + 1] === ">") {
      break;
    } else if (c === "/") {
      let j = i + 1;
      while (j < n && !WS.test(dict[j]!) && !DELIM.test(dict[j]!)) j += 1;
      tokens.push({ t: "name", v: decodeName(dict.slice(i + 1, j)) });
      i = j;
    } else if (c === "(" || c === "[" || c === "<") {
      const j = skipComposite(dict, i);
      tokens.push(
        c === "[" ? { t: "array", raw: dict.slice(i, j) } : { t: "other" },
      );
      i = j;
    } else if (DELIM.test(c)) {
      i += 1;
    } else {
      let j = i + 1;
      while (j < n && !WS.test(dict[j]!) && !DELIM.test(dict[j]!)) j += 1;
      const word = dict.slice(i, j);
      tokens.push(
        /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)
          ? { t: "number", v: Number(word) }
          : { t: "word", v: word },
      );
      i = j;
    }
  }
  const out = new Map<string, DictValue[]>();
  for (let k = 0; k < tokens.length;) {
    const key = tokens[k]!;
    if (key.t !== "name") {
      k += 1;
      continue;
    }
    const v = tokens[k + 1];
    let value: DictValue;
    let used = 2;
    if (v === undefined) break;
    const g = tokens[k + 2];
    const r = tokens[k + 3];
    if (
      v.t === "number" &&
      g?.t === "number" &&
      r?.t === "word" &&
      r.v === "R"
    ) {
      value = { kind: "ref", num: v.v };
      used = 4;
    } else if (v.t === "name") value = { kind: "name", name: v.v };
    else if (v.t === "number") value = { kind: "number", value: v.v };
    else if (v.t === "array") value = { kind: "array", raw: v.raw };
    else if (v.t === "word") value = { kind: "word", word: v.v };
    else value = { kind: "other" };
    const list = out.get(key.v);
    if (list) list.push(value);
    else out.set(key.v, [value]);
    k += used;
  }
  return out;
}

/** Every value under any of `keys`. */
export function valuesOf(
  entries: Map<string, DictValue[]>,
  ...keys: string[]
): DictValue[] {
  return keys.flatMap((k) => entries.get(k) ?? []);
}

/** The names under any of `keys` (a name value, not an array or a ref). */
export function namesOf(
  entries: Map<string, DictValue[]>,
  ...keys: string[]
): string[] {
  return valuesOf(entries, ...keys).flatMap((v) =>
    v.kind === "name" ? [v.name] : [],
  );
}

const OBJ = ascii("obj");
const ENDOBJ = ascii("endobj");

/**
 * Read back from `objAt` (the `o` of an `obj` keyword) over `num gen` and
 * return `num`, or null when the keyword is not an object header.
 */
function headerNumber(bytes: Uint8Array, objAt: number): number | null {
  let p = objAt - 1;
  if (p < 0 || !isWhite(bytes[p]!)) return null;
  while (p >= 0 && isWhite(bytes[p]!) && objAt - p < 64) p -= 1;
  let q = p;
  while (q >= 0 && isDigit(bytes[q]) && p - q < 10) q -= 1;
  if (q === p || q < 0 || !isWhite(bytes[q]!)) return null;
  let s = q;
  while (s >= 0 && isWhite(bytes[s]!) && q - s < 64) s -= 1;
  let t = s;
  while (t >= 0 && isDigit(bytes[t]) && s - t < 10) t -= 1;
  if (t === s) return null;
  if (t >= 0 && !isWhite(bytes[t]!) && !isDelimiter(bytes[t]!)) return null;
  let num = 0;
  for (let k = t + 1; k <= s; k += 1) num = num * 10 + (bytes[k]! - 0x30);
  return num;
}

/**
 * The object number of the stream whose dictionary opens at `dictStart`: the
 * `num gen obj` before it, with only whitespace or comments between `obj`
 * and `<<`. Null when there is no such header.
 */
export function streamObjectNumber(
  bytes: Uint8Array,
  dictStart: number,
): number | null {
  const floor = Math.max(0, dictStart - 256);
  for (let o = dictStart - 3; o >= floor; o -= 1) {
    if (!matchesAt(bytes, o, OBJ)) continue;
    // Only whitespace or comment lines between `obj` and the dictionary.
    let k = o + 3;
    while (k < dictStart) {
      if (isWhite(bytes[k]!)) k += 1;
      else if (bytes[k] === 0x25) {
        while (k < dictStart && bytes[k] !== 0x0a && bytes[k] !== 0x0d) k += 1;
      } else break;
    }
    return k === dictStart ? headerNumber(bytes, o) : null;
  }
  return null;
}

/**
 * Indirect objects whose whole body is one number (`7 0 obj 10000 endobj`),
 * by object number, read once from the file's plain text. A number held in
 * an object stream is not seen. When an object is defined more than once
 * (incremental updates), the LARGEST value is kept: every caller uses it as
 * an upper bound.
 */
export function numericObjects(bytes: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  for (
    let o = indexOfWord(bytes, OBJ, 0);
    o !== -1;
    o = indexOfWord(bytes, OBJ, o + 3)
  ) {
    const num = headerNumber(bytes, o);
    if (num === null) continue;
    let k = o + 3;
    while (k < bytes.length && isWhite(bytes[k]!) && k - o < 64) k += 1;
    const from = k;
    while (
      k < bytes.length &&
      k - from < 32 &&
      !isWhite(bytes[k]!) &&
      !isDelimiter(bytes[k]!)
    ) {
      k += 1;
    }
    const word = String.fromCharCode(...bytes.subarray(from, k));
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) continue;
    while (k < bytes.length && isWhite(bytes[k]!) && k - from < 96) k += 1;
    if (!matchesAt(bytes, k, ENDOBJ)) continue;
    const value = Number(word);
    out.set(num, Math.max(out.get(num) ?? -Infinity, value));
  }
  return out;
}

/**
 * Counts `num gen R` references by object number, over text fed in chunks
 * (a chunk boundary may split a reference; the last few bytes are carried).
 * The count is an UPPER bound on how many times any one structure can name
 * the object: a page's /Contents array that lists one stream 24 times names
 * it 24 times, and pdf.js reads it 24 times.
 */
export class RefCounter {
  readonly counts = new Map<number, number>();
  private tail = new Uint8Array(0);

  /** Count the references in `chunk`, a continuation of the last chunk fed. */
  feed(chunk: Uint8Array): void {
    const carried = this.tail.length;
    const text = carried === 0 ? chunk : concat(this.tail, chunk);
    this.countIn(text, carried, text.length);
    this.tail = text.slice(Math.max(0, text.length - 48));
  }

  /** Forget the carried bytes: the next chunk does not continue this one. */
  reset(): void {
    this.tail = new Uint8Array(0);
  }

  /** Count references whose `R` lies in [from, to) of `bytes`. */
  countIn(bytes: Uint8Array, from: number, to: number): void {
    // Search only [from, to): an `indexOf` over the whole array runs to the
    // end of the file when there is no `R`, once per region (quadratic).
    const region = bytes.subarray(0, to);
    for (
      let r = region.indexOf(0x52, from);
      r !== -1;
      r = region.indexOf(0x52, r + 1)
    ) {
      const after = bytes[r + 1];
      if (after !== undefined && !isWhite(after) && !isDelimiter(after)) {
        continue;
      }
      // `num gen R`: headerNumber reads `num gen` before a keyword.
      const num = headerNumber(bytes, r);
      if (num !== null) this.counts.set(num, (this.counts.get(num) ?? 0) + 1);
    }
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
