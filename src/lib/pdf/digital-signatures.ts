/**
 * How many digital (certificate) signatures a PDF already carries.
 *
 * WHY A TOOL NEEDS TO KNOW. A digital signature hashes the file's exact bytes
 * — the ranges its `/ByteRange` names. Every client tool that writes a PDF
 * saves through pdf-lib, which has no incremental-update writer: it rewrites
 * the whole file, so the signed bytes are gone and Acrobat reports the
 * signature as invalid ("the document has been altered"). The common case is
 * counter-signing a contract the other party signed through DocuSign or Adobe
 * Sign: the person adds their visual signature and sends back a file whose
 * counterparty signature no longer verifies. The runner warns before Run; this
 * is what it asks.
 *
 * HOW. A byte scan for `/ByteRange [a b c d …]` — two or more PAIRS of
 * integers (ISO 32000-1 12.8.1: "an array of pairs of integers"; every
 * mainstream signer writes exactly two, and a signature always excludes its
 * own `/Contents`, so it hashes at least two ranges). That is the shape only a
 * signature dictionary that has actually been signed carries:
 *
 *  - An unsigned signature FIELD (a `/FT /Sig` box waiting to be signed) has no
 *    value and so no signature dictionary: it is not counted, and nothing about
 *    it is invalidated by a rewrite.
 *  - A signature dictionary cannot sit in a compressed object stream: its
 *    `/ByteRange` names byte offsets in the file and its `/Contents` must be
 *    patched in place at one of them, so both are always literal bytes here.
 *  - Placeholders written before signing (`/ByteRange [0 /********** ...]`)
 *    fail the all-integer, even-count shape.
 *
 * Only a `/ByteRange` KEY counts (hostile matrix PS-14, SIB-11): each hit is
 * placed in its indirect object (`N G obj`, found by a bounded backward
 * search), and the object's text up to the hit is lexed. A hit inside a
 * literal string (`/Subject (/ByteRange [0 10 20 30])`) or after the object's
 * `stream` keyword (an uncompressed page that SHOWS that text) is not a
 * dictionary key and is not counted.
 *
 * One signature per OBJECT, the last revision's array winning (SIB-10): an
 * incremental update that rewrites the signature object with a different
 * array is still one signature. Distinct objects with byte-identical arrays
 * are also one signature (a revision that copies the dictionary to a new
 * object number).
 *
 * Every limit fails toward COUNTING, never toward 0: a false 0 lets a tool
 * break a real signature without a word, a false 1 costs a warning. A hit
 * whose object header is not within {@link OBJECT_REACH}, or that sits outside
 * any object, is counted by its array as before; a file with more than
 * {@link MAX_PLACED_HITS} hits skips the placing and counts every distinct
 * array, as before.
 *
 * No parse, no pdf-lib: this runs on every PDF a single-file tool opens and
 * must not cost a second load, and `doc.getForm()` would ADD an empty
 * `/AcroForm` to a document it inspects. A file with no `/ByteRange` at all
 * (nearly every file) costs exactly the one native `indexOf` walk it always
 * did.
 */

const SLASH = 0x2f;
const NAME = "ByteRange";
const NAME_CODES = Array.from(NAME, (c) => c.charCodeAt(0));
/** Enough for `/ByteRange [` + eight 10-digit integers and generous spacing. */
const WINDOW = 192;
const ARRAY = /^\s*\[\s*(\d+(?:\s+\d+)*)\s*\]/;

/**
 * How far back from a hit the object header (`N G obj`) is looked for. A
 * signature dictionary's size is its `/Contents` hex: twice the CMS blob the
 * signer reserved. Acrobat reserves ~16 KiB of hex, an LTV-enabled CMS with
 * embedded revocation data a few hundred KiB; 1 MiB is several times the
 * largest of those. Beyond it the hit is counted unplaced (toward counting).
 */
const OBJECT_REACH = 1 << 20;

/**
 * More `/ByteRange` hits than this and none are placed: every distinct array
 * counts, as before the placing existed. Placing one hit lexes at most
 * {@link OBJECT_REACH} bytes, so this bounds a hostile file's cost at 16 MiB
 * of lexing (measured 2026-11-08: 0.25 s for 16 hits in a 16 MiB file; 64 hits
 * in 64 MiB took 2.1 s). A real file carries one hit per signature per
 * revision, and 16 signatures is far past any contract.
 */
const MAX_PLACED_HITS = 16;

interface Hit {
  /** Offset of the `/` of `/ByteRange`. */
  at: number;
  /** The array's integers, space-joined. */
  ints: string;
}

export function countDigitalSignatures(bytes: Uint8Array): number {
  const hits: Hit[] = [];
  let at = bytes.indexOf(SLASH);
  while (at !== -1) {
    const start = at + 1;
    if (matchesName(bytes, start)) {
      const after = start + NAME_CODES.length;
      const tail = asciiWindow(bytes, after, WINDOW);
      const ints = ARRAY.exec(tail)?.[1]?.split(/\s+/);
      if (ints && ints.length >= 4 && ints.length % 2 === 0) {
        hits.push({ at, ints: ints.join(" ") });
      }
    }
    at = bytes.indexOf(SLASH, start);
  }
  if (hits.length > MAX_PLACED_HITS) {
    return new Set(hits.map((h) => h.ints)).size;
  }
  // Object (or, unplaced, the array itself) → the array its LAST revision has.
  const latest = new Map<string, string>();
  for (const hit of hits) {
    const place = placeHit(bytes, hit.at);
    if (place === PAYLOAD) continue;
    latest.set(place === null ? `array ${hit.ints}` : `obj ${place}`, hit.ints);
  }
  return new Set(latest.values()).size;
}

const PAYLOAD = Symbol("payload");

/**
 * Where a `/ByteRange` hit sits: {@link PAYLOAD} when it is inside a literal
 * string or a stream body of its object (text, not a key), the object's
 * `"N G"` when it is a key of that object, or `null` when no object could be
 * placed around it (count it).
 */
function placeHit(
  bytes: Uint8Array,
  at: number,
): typeof PAYLOAD | string | null {
  const header = objectHeaderBefore(bytes, at);
  if (!header) return null;
  let depth = 0; // literal-string nesting
  let i = header.body;
  while (i < at) {
    const c = bytes[i]!;
    if (depth > 0) {
      if (c === BACKSLASH) i += 1;
      else if (c === OPEN_PAREN) depth += 1;
      else if (c === CLOSE_PAREN) depth -= 1;
    } else if (c === OPEN_PAREN) {
      depth = 1;
    } else if (c === PERCENT) {
      while (i < at && bytes[i] !== LF && bytes[i] !== CR) i += 1;
    } else if (c === LOWER_S && keywordAt(bytes, i, STREAM)) {
      // The body runs to `endstream`; a hit before that is stream data.
      const end = indexOfSeq(bytes, ENDSTREAM, i + STREAM.length);
      if (end === -1 || end >= at) return PAYLOAD;
      i = end + ENDSTREAM.length;
      continue;
    } else if (c === LOWER_E && keywordAt(bytes, i, ENDOBJ)) {
      return null; // the hit is past this object's end: unplaced
    }
    i += 1;
  }
  return depth > 0 ? PAYLOAD : header.id;
}

/**
 * The nearest `N G obj` before `at`, within {@link OBJECT_REACH}: its id
 * (`"N G"`) and the offset just past `obj`.
 */
function objectHeaderBefore(
  bytes: Uint8Array,
  at: number,
): { id: string; body: number } | null {
  const floor = Math.max(0, at - OBJECT_REACH);
  let o = at;
  while (o > floor) {
    o = bytes.lastIndexOf(LOWER_O, o - 1);
    if (o < floor) return null;
    if (bytes[o + 1] !== LOWER_B || bytes[o + 2] !== LOWER_J) continue;
    if (o + 3 < bytes.length && isRegular(bytes[o + 3]!)) continue;
    // Backwards: white space, generation digits, white space, number digits.
    let j = o - 1;
    const ws1 = j;
    while (j >= 0 && isWhite(bytes[j]!)) j -= 1;
    if (j === ws1) continue;
    const genEnd = j;
    while (j >= 0 && isDigit(bytes[j]!)) j -= 1;
    if (j === genEnd) continue;
    const genStart = j + 1;
    const ws2 = j;
    while (j >= 0 && isWhite(bytes[j]!)) j -= 1;
    if (j === ws2) continue;
    const numEnd = j;
    while (j >= 0 && isDigit(bytes[j]!)) j -= 1;
    if (j === numEnd) continue;
    if (j >= 0 && isRegular(bytes[j]!)) continue;
    const num = ascii(bytes, j + 1, numEnd + 1);
    const gen = ascii(bytes, genStart, genEnd + 1);
    return { id: `${num} ${gen}`, body: o + 3 };
  }
  return null;
}

const BACKSLASH = 0x5c;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const PERCENT = 0x25;
const LF = 0x0a;
const CR = 0x0d;
const LOWER_S = 0x73;
const LOWER_E = 0x65;
const LOWER_O = 0x6f;
const LOWER_B = 0x62;
const LOWER_J = 0x6a;
const codes = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const STREAM = codes("stream");
const ENDSTREAM = codes("endstream");
const ENDOBJ = codes("endobj");
/** ISO 32000-1 Table 2 delimiters. */
const DELIMITERS = new Set(codes("()<>[]{}/%"));

/** ISO 32000-1 Table 1 white space. */
function isWhite(c: number): boolean {
  return (
    c === 0x20 || c === LF || c === CR || c === 0x09 || c === 0x0c || c === 0
  );
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

/** Neither white space nor a delimiter: part of a name or keyword. */
function isRegular(c: number): boolean {
  return !isWhite(c) && !DELIMITERS.has(c);
}

/** `word` at `i` as a whole keyword: no regular character on either side. */
function keywordAt(bytes: Uint8Array, i: number, word: number[]): boolean {
  if (i > 0 && isRegular(bytes[i - 1]!)) return false;
  for (let k = 0; k < word.length; k += 1) {
    if (bytes[i + k] !== word[k]) return false;
  }
  const next = bytes[i + word.length];
  return next === undefined || !isRegular(next);
}

function indexOfSeq(bytes: Uint8Array, seq: number[], from: number): number {
  let i = bytes.indexOf(seq[0]!, from);
  while (i !== -1) {
    let k = 1;
    while (k < seq.length && bytes[i + k] === seq[k]) k += 1;
    if (k === seq.length) return i;
    i = bytes.indexOf(seq[0]!, i + 1);
  }
  return -1;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

function matchesName(bytes: Uint8Array, from: number): boolean {
  if (from + NAME_CODES.length > bytes.length) return false;
  for (let i = 0; i < NAME_CODES.length; i += 1) {
    if (bytes[from + i] !== NAME_CODES[i]) return false;
  }
  // A longer name (`/ByteRangeX`) needs no check here: ARRAY is anchored, so
  // the regular character after the prefix fails it.
  return true;
}

function asciiWindow(bytes: Uint8Array, from: number, length: number): string {
  const end = Math.min(bytes.length, from + length);
  let out = "";
  for (let i = from; i < end; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}
