/**
 * What pdf.js will read as a cross-reference section, found in the bytes
 * before pdf.js is asked (lane l02 of the hostile-input matrix, SIB-03 and
 * SIB-09). Loaded only by `./pdf-access-guard`, which is its own chunk.
 *
 * The questions are pdf.js's, so the answers are read the way pdf.js reads
 * them, not the way a well-formed file writes them:
 *  - numbers through pdf.js's lexer rules (`0.0`, `-0`, `+0`, `.0`, `--0`
 *    and a bare `-` are all 0), names with `#xx` escapes decoded (`/#57` is
 *    `/W`), and a repeated key resolved to its LAST value, as pdf.js's
 *    dictionary stores it;
 *  - the sections pdf.js reads: the chain from `startxref` (or, for a
 *    linearized file, from the first `endobj`), through every /Prev and
 *    /XRefStm, without asking a section's /Type; plus every object whose
 *    body holds `/XRef`, which is what pdf.js reads when it rebuilds a
 *    broken cross-reference by scanning;
 *  - the trailer pdf.js takes /Encrypt from: the newest section's
 *    dictionary.
 *
 * Nothing here decodes the whole file into a string: it reads bytes in
 * place, and each dictionary only as far as it goes.
 */

/** A value as pdf.js's parser hands it to a dictionary. */
type Value =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "ref"; num: number }
  | { t: "arr"; v: Value[] }
  | { t: "dict"; v: Map<string, Value> }
  | { t: "word"; v: string }
  | { t: "str" };

/** The dictionary did not close inside the bytes it may use. */
class Incomplete extends Error {}

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

/** pdf.js's parser: `n g R` is a reference, `<< >>` a dictionary. */
function parseValue(lex: Lexer, token: Token, depth: number): Value {
  if (depth > 64) throw new Incomplete();
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
        const items: Value[] = [];
        for (let t = lex.next(); ; t = lex.next()) {
          if (t.k === "punct" && t.v === "]") return { t: "arr", v: items };
          if (t.k === "end") throw new Incomplete();
          items.push(parseValue(lex, t, depth + 1));
        }
      }
      if (token.v === "<<") return { t: "dict", v: parseDictBody(lex, depth) };
      return { t: "word", v: token.v };
    default:
      return { t: "str" };
  }
}

function parseDictBody(lex: Lexer, depth: number): Map<string, Value> {
  const dict = new Map<string, Value>();
  for (let t = lex.next(); ; t = lex.next()) {
    if (t.k === "punct" && t.v === ">>") return dict;
    if (t.k === "end") throw new Incomplete();
    // pdf.js skips a key that is not a name, and a later key wins.
    if (t.k !== "name") continue;
    // A `>>` in a value's place is pdf.js's value too (a command object),
    // and the dictionary goes on after it.
    dict.set(t.v, parseValue(lex, lex.next(), depth + 1));
  }
}

/**
 * The dictionary that starts at the next token after `from`, or null, and
 * the next token after it. Throws {@link Incomplete} past
 * {@link DICT_SPAN_LIMIT}.
 */
function dictAt(
  bytes: Uint8Array,
  from: number,
): { dict: Map<string, Value>; then: Token } | null {
  const lex = new Lexer(
    bytes,
    from,
    Math.min(bytes.length, from + DICT_SPAN_LIMIT),
  );
  const t = lex.next();
  if (t.k !== "punct" || t.v !== "<<") return null;
  const dict = parseDictBody(lex, 0);
  return { dict, then: lex.next() };
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
 * Could pdf.js's xref-stream loop (`readXRefStream`) run long over `dict`?
 * Mirrors its checks: a row with no bytes in it is the only way the loop
 * outlives the data, and its count is /Index's (pdf.js: `Index || [0, Size]`).
 * A width or range pdf.js rejects (`Number.isInteger` fails) stops it; a
 * value it would resolve through a reference cannot be read here, so it
 * counts as unknown — and an indirect /W, /Index or /Size is one ISO
 * 32000-1 7.5.8.2 says "shall" not be written.
 */
function zeroWidthRowsUnbounded(dict: Map<string, Value>): boolean {
  const w = dict.get("W");
  if (w?.t === "arr") {
    const widths = w.v.slice(0, 3);
    if (widths.length < 3) return false;
    let total = 0;
    for (const x of widths) {
      if (x.t !== "num" || !Number.isInteger(x.v)) return false;
      total += Math.max(0, x.v);
    }
    if (total > 0) return false;
  } else if (w?.t !== "ref") return false;
  const rows = rowCount(dict);
  return rows === null || rows > ZERO_WIDTH_ROW_LIMIT;
}

/** Rows pdf.js would walk, or null when only a reference could say. */
function rowCount(dict: Map<string, Value>): number | null {
  const index = dict.get("Index");
  if (index?.t === "ref") return null;
  const falsy =
    index === undefined ||
    (index.t === "num" && index.v === 0) ||
    (index.t === "word" && (index.v === "null" || index.v === "false"));
  if (!falsy) {
    if (index.t !== "arr") return 0;
    let rows = 0;
    for (let i = 0; i + 1 < index.v.length; i += 2) {
      const first = index.v[i]!;
      const n = index.v[i + 1]!;
      if (first.t !== "num" || n.t !== "num") break;
      if (!Number.isInteger(first.v) || !Number.isInteger(n.v)) break;
      rows += Math.max(0, n.v);
    }
    return rows;
  }
  const size = dict.get("Size");
  if (size?.t === "ref") return null;
  return size?.t === "num" && Number.isInteger(size.v)
    ? Math.max(0, size.v)
    : 0;
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
function linearizedStart(bytes: Uint8Array): number | null {
  const lex = new Lexer(bytes, 0, Math.min(bytes.length, 1024));
  // Skip the header line: `%PDF-x.y` is a comment to the lexer.
  const n = lex.next();
  const g = lex.next();
  const obj = lex.next();
  if (n.k !== "num" || g.k !== "num" || obj.k !== "word" || obj.v !== "obj")
    return null;
  let dict: Map<string, Value> | undefined;
  try {
    dict = dictAt(bytes, lex.pos)?.dict;
  } catch {
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
    const at = indexOfWord(bytes, "trailer", lex.pos);
    if (at < 0) return null;
    const read = dictAt(bytes, at + 7);
    if (!read) return null;
    dict = read.dict;
  } else if (first.k === "num" && Number.isInteger(first.v)) {
    const gen = lex.next();
    const obj = lex.next();
    if (gen.k !== "num" || obj.k !== "word" || obj.v !== "obj") return null;
    // pdf.js takes the object as a section only when it is a stream.
    const read = dictAt(bytes, lex.pos);
    if (!read || read.then.k !== "word" || read.then.v !== "stream")
      return null;
    dict = read.dict;
  } else return null;
  const next: number[] = [];
  const stm = dict.get("XRefStm");
  if (table && stm?.t === "num" && Number.isInteger(stm.v)) next.push(stm.v);
  const prev = dict.get("Prev");
  if (prev?.t === "num" && Number.isInteger(prev.v)) next.push(prev.v);
  else if (prev?.t === "ref") next.push(prev.num);
  return { dict, next };
}

/** What the scan found. */
export interface XrefPrescan {
  /** A section pdf.js would walk row by row past any bound: refuse. */
  readonly unbounded: boolean;
  /**
   * The newest section's dictionary carries /Encrypt (the trailer pdf.js
   * decrypts with), or, when that section cannot be read and pdf.js would
   * rebuild the cross-reference by scanning, any trailer it could find does.
   */
  readonly namesEncrypt: boolean;
  /** Section dictionaries read and checked (a health check for tests). */
  readonly sections: number;
}

/** Read the sections. Never throws. */
export function prescanXref(bytes: Uint8Array): XrefPrescan {
  let unbounded = false;
  let sections = 0;
  const check = (dict: Map<string, Value>) => {
    sections += 1;
    if (zeroWidthRowsUnbounded(dict)) unbounded = true;
  };

  // The chain pdf.js reads first.
  const lin = linearizedStart(bytes);
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
    let incomplete = false;
    try {
      section = sectionAt(bytes, offset);
    } catch {
      incomplete = true;
    }
    if (!topRead) {
      topRead = true;
      top = section?.dict ?? null;
    }
    if (incomplete) {
      // A section dictionary that does not close within 1 MiB (or nests
      // past 64): nothing in it can be checked, and pdf.js would still
      // read it. No real producer writes one.
      unbounded = true;
      continue;
    }
    if (!section) continue;
    check(section.dict);
    queue.push(...section.next);
  }

  // Every object whose body names /XRef: what pdf.js's rebuild reads.
  const fallbackTrailers: Map<string, Value>[] = [];
  let floor = 0;
  for (let at = indexOfWord(bytes, "/XRef", 0); at >= 0;) {
    const after = bytes[at + 5];
    if (after === undefined || after < 64) {
      const obj = objHeaderBefore(bytes, at, floor);
      if (obj >= 0) {
        try {
          const dict = dictAt(bytes, obj + 3)?.dict;
          if (dict) {
            check(dict);
            fallbackTrailers.push(dict);
          }
        } catch {
          unbounded = true;
        }
      }
    }
    floor = at;
    at = indexOfWord(bytes, "/XRef", at + 5);
  }

  let namesEncrypt: boolean;
  if (top) namesEncrypt = top.has("Encrypt");
  else {
    // No readable newest section: pdf.js rebuilds, and prefers a trailer
    // that has /Encrypt over one that does not (`indexObjects`).
    for (let at = indexOfWord(bytes, "trailer", 0); at >= 0;) {
      try {
        const dict = dictAt(bytes, at + 7)?.dict;
        if (dict) fallbackTrailers.push(dict);
      } catch {
        // an unclosed trailer: pdf.js cannot read it either
      }
      at = indexOfWord(bytes, "trailer", at + 7);
    }
    namesEncrypt = fallbackTrailers.some((d) => d.has("Encrypt"));
  }
  return { unbounded, namesEncrypt, sections };
}

/** The `obj` keyword that opens the object holding `at` (not `endobj`). */
function objHeaderBefore(bytes: Uint8Array, at: number, floor: number): number {
  for (let i = lastIndexOfWord(bytes, "obj", at, floor); i >= floor;) {
    if (i < 3 || bytes[i - 3] !== 0x65 /* e of endobj */) return i;
    if (i === 0) return -1;
    i = lastIndexOfWord(bytes, "obj", i, floor);
  }
  return -1;
}
