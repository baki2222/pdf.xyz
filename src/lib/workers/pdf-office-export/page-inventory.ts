/**
 * What each page of a PDF will make pdf.js DECODE, and where its pictures are
 * painted — read from the file with pdf-lib, BEFORE pdf.js touches a page.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * pdf.js decodes every image a page uses while it builds the page's operator
 * list, and keeps the pixels until the page is cleaned up. Two defects came
 * from not knowing, before that, what a page would cost:
 *
 *  - With a pixel ceiling on one image (`maxImageSize`, 64 MP until
 *    2026-10-11) pdf.js REMOVES a larger image from the operator list and
 *    says nothing, so the deck lost it and the panel said the page had
 *    "nothing on it": a 124 MP bilevel A1 drawing at 400 dpi exported as a
 *    blank slide. The ceiling counted pixels, and pixels are not memory: that
 *    drawing is 15.5 MB as pdf.js holds it (one bit a pixel), while one
 *    8000 × 8000 RGB photo is 256 MB.
 *  - With no ceiling, a page's memory grows with the number of large images
 *    on it: six 8000² photos on one page measured 4.2 GB of peak RSS, from a
 *    20 MB upload, in the worker daemon's own process.
 *
 * So the page scan asks THIS module first: every image each page will make
 * pdf.js decode, with its pixel size and the bytes pdf.js will hold for it
 * (`decodeBudgetPlan` in `./page-scan` turns that into a per-page ceiling,
 * and into the list of pictures the result must say were not carried).
 *
 * The fidelity instrument (`./fidelity`) asks it too, for the opposite
 * reason: it must not be the same reader as the one it judges. A source page
 * that paints a picture or visible text, yet rasterises to nothing, is a
 * comparison that cannot conclude — and the picture boxes here are where it
 * scores each picture on its own.
 *
 * ── WHAT "USES" MEANS, AND WHERE IT IS DERIVED FROM ─────────────────────────
 *
 * Not the images a page DECLARES: many generators hang every image of the
 * document off one shared /Resources dictionary, and counting those would
 * charge each page for the whole book. This walks the content streams pdf.js
 * walks — the page's, each form XObject it invokes (`Do`), each tiling
 * pattern it fills with (`scn`/`SCN`), each soft-mask group it sets (`gs`),
 * each Type3 font it shows text in (`Tf`; pdf.js builds every glyph of such a
 * font when it loads it), each annotation's appearance — and records the
 * images invoked there (`Do`, and inline `BI … ID … EI`).
 *
 * ── AN ENCRYPTED FILE IS READ ──────────────────────────────────────────────
 *
 * pdf-lib loads an encrypted file and never decrypts it. The streams this
 * walks are decrypted here instead (`./standard-security`: the Standard
 * handler with the empty user password, as every viewer opens an
 * owner-password PDF), and in the layout Acrobat and Word write — catalog
 * and page tree inside an encrypted object stream pdf-lib could not parse —
 * that object stream is decrypted and read into the document first
 * ({@link unlockObjectStreams}). So a locked file's pages are read exactly,
 * as the unlocked file's are. Until 2026-10-11 they could not be, and both
 * ways of guessing what such a page paints failed in production on one day
 * (see the module).
 *
 * ── WHEN THE CONTENT CANNOT BE READ ─────────────────────────────────────────
 *
 * A content stream it still cannot decode (damaged data, a filter it does
 * not know, an encryption it does not read) falls back to every image
 * XObject its resources DECLARE — through forms, tiling patterns, soft-mask
 * groups and Type3 fonts — and marks the page inexact. That set is an upper
 * bound on what the page paints, never a count of it: until 2026-10-11 the
 * decode budget counted it, and an owner-password file whose pages share one
 * /Resources lost every photo to a ceiling set under their size, with a note
 * blaming 144 pictures' size where 12 were painted. The budget now holds an
 * inexact page to the page budget over that whole set — an upper bound, so
 * the bound holds whatever the page paints — and counts none of it
 * (`decodeBudgetPlan`).
 *
 * A file whose page TREE still cannot be read has no inventory at all
 * ({@link readInventory}). Its pictures are still known
 * ({@link documentImages}): an image is a stream, a stream is never inside an
 * object stream, and encryption leaves a dictionary's names and numbers in
 * the clear (ISO 32000-1 §7.5.7, §7.6.1).
 */
import { inflateSync, constants as zlibConstants } from "node:zlib";
import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFCatalog,
  PDFDict,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFObjectParser,
  PDFObjectStreamParser,
  PDFRawStream,
  PDFRef,
  type PDFDocument,
  type PDFObject,
} from "pdf-lib";
import { standardDecryptor, type StreamDecryptor } from "./standard-security";

/* ------------------------------------------------------------------ *
 *  What it returns
 * ------------------------------------------------------------------ */

/** One image a page makes pdf.js decode. */
export interface InventoryImage {
  /** "12R" / "12R3" for an XObject (pdf.js's own spelling), null inline. */
  ref: string | null;
  inline: boolean;
  /** Pixel size, from the image dictionary: what pdf.js's ceiling compares. */
  width: number;
  height: number;
  /** An /ImageMask stencil: pdf.js paints it itself, through a canvas. */
  mask: boolean;
  /**
   * Bytes pdf.js holds for the decoded image until the page is cleaned up,
   * plus the buffers it decodes through. Conservative: see `decodedBytes`.
   */
  bytes: number;
}

/** Where a picture is painted: the image's unit square under its CTM. */
export interface InventoryPlacement {
  /** Index into the page's `images`. */
  image: number;
  /** Axis-aligned bounds on the displayed page, points, origin top-left. */
  box: [number, number, number, number];
}

export interface PageInventory {
  pageNumber: number;
  /** As displayed (rotation and crop box applied), points. */
  width: number;
  height: number;
  /** Distinct per page: an XObject used twice is decoded once. */
  images: InventoryImage[];
  /** Pictures painted by the page's content and the forms it invokes. */
  placements: InventoryPlacement[];
  /** Text-showing operators in a visible render mode (not 3 or 7). */
  visibleTextOps: number;
  /**
   * False when some content stream could not be read, so `images` fell back
   * to what that stream's resources DECLARE: an upper bound on what the
   * page paints, not a count of it (see "When the content cannot be read").
   */
  exact: boolean;
}

/* ------------------------------------------------------------------ *
 *  What pdf.js holds for a decoded image
 * ------------------------------------------------------------------ */

/** The next power of two at or above `n`: pdf.js's decode buffers grow so. */
function pow2(n: number): number {
  let size = 512;
  while (size < n) size *= 2;
  return size;
}

interface ImageFacts {
  width: number;
  height: number;
  bpc: number;
  comps: number;
  mask: boolean;
  /** A soft mask or a mask image: decoded with it, into RGBA. */
  alpha: { width: number; height: number; bpc: number } | null;
  filter: string | null;
  deviceRgb: boolean;
  decode: boolean;
}

/**
 * The bytes pdf.js 6.2 holds for one decoded image (`PDFImage.
 * createImageData`, no OffscreenCanvas, not forced to RGBA), plus the
 * buffers it decodes through. Read from that function, and conservative where
 * it branches on what a dictionary cannot say:
 *
 *  - a stream filter decodes into a buffer that GROWS BY DOUBLING
 *    (`DecodeStream.ensureBuffer`), so at its last growth the old buffer and
 *    the new one are both alive: 1.5 × the next power of two;
 *  - a stencil mask, or a 1-bit grey image: that buffer, packed 1 bit a pixel;
 *  - 8-bit DeviceRGB with no mask or Decode: that buffer IS the pixels;
 *  - a DCT image with no mask: 3 bytes a pixel out, the components in;
 *  - anything else: 3 bytes a pixel out (4 with a mask), the stream's buffer,
 *    and the mask's.
 *
 * MEASURED 2026-10-11 (Node 24, Windows, `src/tests/page-scan-rss.ts`: peak
 * RSS of a fresh process scanning one page, less its peak after a warm-up
 * scan), estimate against measurement, MB: Flate RGB 8000² 403 / 394; Flate
 * grey 8-bit 8000² 293 / 285; Flate CMYK 6000² 511 / 367; Flate RGB 4000²
 * with a grey soft mask 206 / 132; DCT RGB 6000² 216 / 178; 1-bit 8200 × 8000
 * 13 / 37. Every estimate is at or above its measurement except the last,
 * whose difference is the page scan's OWN output buffers (a 3,600-px
 * picture): bounded by the output size, not by the image.
 */
export function decodedBytes(f: ImageFacts): number {
  const px = f.width * f.height;
  const packed = Math.ceil(f.width / 8) * f.height;
  const grown = (n: number) => 1.5 * pow2(n);
  if (f.mask) return grown(packed);
  if (f.comps === 1 && f.bpc === 1 && !f.alpha && f.filter !== "DCTDecode")
    return grown(packed);
  if (
    f.deviceRgb &&
    f.bpc === 8 &&
    !f.alpha &&
    !f.decode &&
    f.filter !== "DCTDecode" &&
    f.filter !== "JPXDecode"
  )
    return grown(3 * px);
  if (f.filter === "DCTDecode" && !f.alpha) return 3 * px + px * f.comps;
  const raw = grown(Math.ceil((f.width * f.comps * f.bpc) / 8) * f.height);
  const alpha = f.alpha
    ? grown(Math.ceil((f.alpha.width * f.alpha.bpc) / 8) * f.alpha.height) + px
    : 0;
  return (f.alpha ? 4 : 3) * px + raw + alpha;
}

/* ------------------------------------------------------------------ *
 *  Geometry
 * ------------------------------------------------------------------ */

type Matrix = [number, number, number, number, number, number];

/** m · n: apply n first, then m (canvas order). */
function mul(m: readonly number[], n: readonly number[]): Matrix {
  return [
    m[0]! * n[0]! + m[2]! * n[1]!,
    m[1]! * n[0]! + m[3]! * n[1]!,
    m[0]! * n[2]! + m[2]! * n[3]!,
    m[1]! * n[2]! + m[3]! * n[3]!,
    m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
    m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
  ];
}

function unitBox(m: readonly number[]): [number, number, number, number] {
  const xs = [m[4]!, m[0]! + m[4]!, m[2]! + m[4]!, m[0]! + m[2]! + m[4]!];
  const ys = [m[5]!, m[1]! + m[5]!, m[3]! + m[5]!, m[1]! + m[3]! + m[5]!];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * The displayed page's transform at scale 1, as pdf.js's `PageViewport`
 * builds it: user space → points from the top-left of the page as shown.
 */
export function displayTransform(
  view: readonly number[],
  rotate: number,
): { transform: Matrix; width: number; height: number } {
  const r = (((rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const [a, b, c, d] =
    r === 90
      ? [0, 1, 1, 0]
      : r === 180
        ? [-1, 0, 0, 1]
        : r === 270
          ? [0, -1, -1, 0]
          : [1, 0, 0, -1];
  const cx = (view[2]! + view[0]!) / 2;
  const cy = (view[3]! + view[1]!) / 2;
  let ox: number;
  let oy: number;
  let width: number;
  let height: number;
  if (a === 0) {
    ox = Math.abs(cy - view[1]!);
    oy = Math.abs(cx - view[0]!);
    width = Math.abs(view[3]! - view[1]!);
    height = Math.abs(view[2]! - view[0]!);
  } else {
    ox = Math.abs(cx - view[0]!);
    oy = Math.abs(cy - view[1]!);
    width = Math.abs(view[2]! - view[0]!);
    height = Math.abs(view[3]! - view[1]!);
  }
  return {
    transform: [a, b, c, d, ox - a * cx - c * cy, oy - b * cx - d * cy],
    width,
    height,
  };
}

/* ------------------------------------------------------------------ *
 *  Content streams: a lexer that knows strings, arrays, dicts, inline images
 * ------------------------------------------------------------------ */

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([
  0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25,
]);

class Name {
  constructor(readonly name: string) {}
}
type Operand =
  number | Name | Operand[] | Map<string, Operand> | string | boolean | null;

const ARRAY_START = Symbol("[");
const DICT_START = Symbol("<<");

/** A content stream's operators, each with its operands; inline images whole. */
export function* contentOperators(
  bytes: Uint8Array,
): Generator<{ op: string; args: Operand[]; inline?: Map<string, Operand> }> {
  let p = 0;
  const n = bytes.length;
  const stack: (Operand | typeof ARRAY_START | typeof DICT_START)[] = [];
  const regular = (c: number) => !WS.has(c) && !DELIM.has(c);
  const readToken = (): string => {
    const start = p;
    while (p < n && regular(bytes[p]!)) p++;
    return String.fromCharCode(...bytes.subarray(start, p));
  };
  const collapse = (marker: symbol): Operand[] => {
    const out: Operand[] = [];
    while (stack.length > 0) {
      const v = stack.pop()!;
      if (v === marker) break;
      if (typeof v === "symbol") continue; // an unbalanced other marker
      out.unshift(v);
    }
    return out;
  };
  const push = (v: Operand) => stack.push(v);
  const operands = (): Operand[] =>
    stack.filter((v): v is Operand => typeof v !== "symbol");

  while (p < n) {
    const c = bytes[p]!;
    if (WS.has(c)) {
      p++;
      continue;
    }
    if (c === 0x25) {
      // % comment, to end of line
      while (p < n && bytes[p] !== 0x0a && bytes[p] !== 0x0d) p++;
      continue;
    }
    if (c === 0x28) {
      // ( literal string ), nested, with escapes
      let depth = 1;
      p++;
      while (p < n && depth > 0) {
        const b = bytes[p]!;
        if (b === 0x5c) p += 2;
        else {
          if (b === 0x28) depth++;
          else if (b === 0x29) depth--;
          p++;
        }
      }
      push("");
      continue;
    }
    if (c === 0x3c) {
      if (bytes[p + 1] === 0x3c) {
        stack.push(DICT_START);
        p += 2;
      } else {
        while (p < n && bytes[p] !== 0x3e) p++;
        p++;
        push("");
      }
      continue;
    }
    if (c === 0x3e) {
      p += bytes[p + 1] === 0x3e ? 2 : 1;
      const items = collapse(DICT_START);
      const dict = new Map<string, Operand>();
      for (let i = 0; i + 1 < items.length; i += 2) {
        const k = items[i];
        if (k instanceof Name) dict.set(k.name, items[i + 1]!);
      }
      push(dict);
      continue;
    }
    if (c === 0x5b) {
      stack.push(ARRAY_START);
      p++;
      continue;
    }
    if (c === 0x5d) {
      p++;
      push(collapse(ARRAY_START));
      continue;
    }
    if (c === 0x7b || c === 0x7d) {
      p++;
      continue;
    }
    if (c === 0x2f) {
      p++;
      push(new Name(readToken()));
      continue;
    }
    if (c === 0x29) {
      p++;
      continue;
    }
    const token = readToken();
    if (token.length === 0) {
      p++;
      continue;
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      push(Number(token));
      continue;
    }
    if (token === "true" || token === "false") {
      push(token === "true");
      continue;
    }
    if (token === "null") {
      push(null);
      continue;
    }
    if (
      token === "R" &&
      typeof stack.at(-1) === "number" &&
      typeof stack.at(-2) === "number"
    ) {
      // An indirect reference (inside a marked-content property list).
      stack.splice(-2, 2, null);
      continue;
    }
    if (token === "BI") {
      stack.length = 0;
      // Key/value pairs up to ID, then the data, then EI.
      const pairs: Operand[] = [];
      while (p < n) {
        while (p < n && WS.has(bytes[p]!)) p++;
        if (
          bytes[p] === 0x49 &&
          bytes[p + 1] === 0x44 &&
          (p + 2 >= n || !regular(bytes[p + 2]!))
        ) {
          p += 2;
          break;
        }
        const before = p;
        const sub = contentOperatorsValue(bytes, p);
        p = sub.end;
        if (p === before) p++;
        if (sub.value !== undefined) pairs.push(sub.value);
      }
      const dict = new Map<string, Operand>();
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        const k = pairs[i];
        if (k instanceof Name) dict.set(k.name, pairs[i + 1]!);
      }
      p++; // the single white-space byte after ID
      p = inlineImageEnd(bytes, p, dict);
      yield { op: "BI", args: [], inline: dict };
      continue;
    }
    yield { op: token, args: operands() };
    stack.length = 0;
  }
}

/** One operand value starting at `p` (for BI dictionaries). */
function contentOperatorsValue(
  bytes: Uint8Array,
  p: number,
): { value: Operand | undefined; end: number } {
  // Reuse the lexer on a bounded slice: read tokens until one value closes.
  const n = bytes.length;
  const c = bytes[p]!;
  if (c === 0x2f) {
    let q = p + 1;
    while (q < n && !WS.has(bytes[q]!) && !DELIM.has(bytes[q]!)) q++;
    return {
      value: new Name(String.fromCharCode(...bytes.subarray(p + 1, q))),
      end: q,
    };
  }
  if (c === 0x5b) {
    const items: Operand[] = [];
    let q = p + 1;
    while (q < n && bytes[q] !== 0x5d) {
      if (WS.has(bytes[q]!)) {
        q++;
        continue;
      }
      const sub = contentOperatorsValue(bytes, q);
      if (sub.end === q) q++;
      else q = sub.end;
      if (sub.value !== undefined) items.push(sub.value);
    }
    return { value: items, end: q + 1 };
  }
  if (c === 0x28 || c === 0x3c) {
    // A string (or hex string) inside an inline image dictionary: skip it.
    if (c === 0x28) {
      let depth = 1;
      let q = p + 1;
      while (q < n && depth > 0) {
        if (bytes[q] === 0x5c) q += 2;
        else {
          if (bytes[q] === 0x28) depth++;
          else if (bytes[q] === 0x29) depth--;
          q++;
        }
      }
      return { value: "", end: q };
    }
    let q = p + 1;
    while (q < n && bytes[q] !== 0x3e) q++;
    return { value: "", end: q + 1 };
  }
  let q = p;
  while (q < n && !WS.has(bytes[q]!) && !DELIM.has(bytes[q]!)) q++;
  const token = String.fromCharCode(...bytes.subarray(p, q));
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token))
    return { value: Number(token), end: q };
  if (token === "true" || token === "false")
    return { value: token === "true", end: q };
  return { value: token === "" ? undefined : token, end: q };
}

const INLINE_KEYS: Readonly<Record<string, string>> = {
  W: "Width",
  H: "Height",
  BPC: "BitsPerComponent",
  CS: "ColorSpace",
  IM: "ImageMask",
  F: "Filter",
  D: "Decode",
  DP: "DecodeParms",
  I: "Interpolate",
  L: "Length",
};
const INLINE_CS: Readonly<Record<string, string>> = {
  G: "DeviceGray",
  RGB: "DeviceRGB",
  CMYK: "DeviceCMYK",
  I: "Indexed",
};
const INLINE_FILTERS: Readonly<Record<string, string>> = {
  AHx: "ASCIIHexDecode",
  A85: "ASCII85Decode",
  LZW: "LZWDecode",
  Fl: "FlateDecode",
  RL: "RunLengthDecode",
  CCF: "CCITTFaxDecode",
  DCT: "DCTDecode",
};

function inlineGet(dict: Map<string, Operand>, key: string): Operand {
  const abbr = Object.entries(INLINE_KEYS).find(([, v]) => v === key)?.[0];
  return dict.get(key) ?? (abbr ? dict.get(abbr) : undefined) ?? null;
}

/** Past the inline image's data and its EI. */
function inlineImageEnd(
  bytes: Uint8Array,
  start: number,
  dict: Map<string, Operand>,
): number {
  const n = bytes.length;
  const length = inlineGet(dict, "Length");
  const filter = inlineGet(dict, "Filter");
  if (typeof length === "number" && length >= 0) {
    const end = start + length;
    // EI follows, after optional white space.
    let q = end;
    while (q < n && WS.has(bytes[q]!)) q++;
    if (bytes[q] === 0x45 && bytes[q + 1] === 0x49) return q + 2;
  }
  const unfiltered =
    filter === null || (Array.isArray(filter) && filter.length === 0);
  if (unfiltered) {
    const w = inlineGet(dict, "Width");
    const h = inlineGet(dict, "Height");
    const bpc = inlineGet(dict, "BitsPerComponent");
    const mask = inlineGet(dict, "ImageMask") === true;
    const cs = inlineGet(dict, "ColorSpace");
    const comps = mask ? 1 : inlineComps(cs);
    if (typeof w === "number" && typeof h === "number") {
      const b = mask ? 1 : typeof bpc === "number" ? bpc : 8;
      const end = start + Math.ceil((w * comps * b) / 8) * h;
      let q = end;
      while (q < n && WS.has(bytes[q]!)) q++;
      if (bytes[q] === 0x45 && bytes[q + 1] === 0x49) return q + 2;
    }
  }
  // Search: white space, EI, then white space or the end.
  for (let q = start; q + 1 < n; q++)
    if (
      bytes[q] === 0x45 &&
      bytes[q + 1] === 0x49 &&
      (q === start || WS.has(bytes[q - 1]!)) &&
      (q + 2 >= n || WS.has(bytes[q + 2]!))
    )
      return q + 2;
  return n;
}

function inlineComps(cs: Operand): number {
  const name =
    cs instanceof Name
      ? (INLINE_CS[cs.name] ?? cs.name)
      : Array.isArray(cs) && cs[0] instanceof Name
        ? (INLINE_CS[cs[0].name] ?? cs[0].name)
        : "DeviceGray";
  return componentsOfName(name, Array.isArray(cs) ? cs : null) ?? 3;
}

/* ------------------------------------------------------------------ *
 *  Colour spaces
 * ------------------------------------------------------------------ */

function componentsOfName(
  name: string,
  array: readonly unknown[] | null,
): number | null {
  switch (name) {
    case "DeviceGray":
    case "CalGray":
    case "Indexed":
    case "Separation":
    case "G":
    case "I":
      return 1;
    case "DeviceRGB":
    case "CalRGB":
    case "Lab":
    case "RGB":
      return 3;
    case "DeviceCMYK":
    case "CMYK":
      return 4;
    case "DeviceN": {
      const names = array?.[1];
      if (names instanceof PDFArray) return names.size();
      if (Array.isArray(names)) return names.length;
      return 4;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 *  The walk
 * ------------------------------------------------------------------ */

const MAX_DEPTH = 16;

function refKey(ref: PDFRef): string {
  return ref.generationNumber === 0
    ? `${ref.objectNumber}R`
    : `${ref.objectNumber}R${ref.generationNumber}`;
}

function num(v: PDFObject | undefined, fallback = 0): number {
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

/** An encrypted document's decryptor, and each stream's own reference. */
interface Decryption {
  decryptor: StreamDecryptor | null;
  refs: Map<PDFRawStream, PDFRef>;
}
const decryptions = new WeakMap<PDFDocument, Decryption>();

/**
 * How to read `doc`'s streams in the clear. Its streams are indexed once,
 * by their indirect reference: the per-object key is derived from it.
 */
function decryptionOf(doc: PDFDocument): Decryption {
  let known = decryptions.get(doc);
  if (!known) {
    const decryptor = standardDecryptor(doc);
    const refs = new Map<PDFRawStream, PDFRef>();
    if (decryptor)
      for (const [ref, obj] of doc.context.enumerateIndirectObjects())
        if (obj instanceof PDFRawStream) refs.set(obj, ref);
    known = { decryptor, refs };
    decryptions.set(doc, known);
  }
  return known;
}

/**
 * Decode a content stream's bytes — decrypted first when the file is
 * encrypted — or null when they cannot be read.
 */
function streamBytes(
  doc: PDFDocument,
  stream: PDFRawStream,
): Uint8Array | null {
  let raw = stream.contents;
  if (doc.isEncrypted) {
    const { decryptor, refs } = decryptionOf(doc);
    const ref = refs.get(stream);
    const plain = decryptor && ref ? decryptor.decrypt(ref, stream) : null;
    if (!plain) return null;
    raw = plain;
  }
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  try {
    if (filter === undefined) return raw;
    if (
      filter instanceof PDFName &&
      filter.asString() === "/FlateDecode" &&
      !stream.dict.has(PDFName.of("DecodeParms"))
    )
      return new Uint8Array(
        inflateSync(raw, {
          finishFlush: zlibConstants.Z_SYNC_FLUSH,
        }),
      );
    return decodePDFRawStream(
      raw === stream.contents ? stream : PDFRawStream.of(stream.dict, raw),
    ).decode();
  } catch {
    return null;
  }
}

interface Ctx {
  doc: PDFDocument;
  images: Map<string, InventoryImage>;
  imageIndex: Map<string, number>;
  list: InventoryImage[];
  placements: InventoryPlacement[];
  visibleTextOps: number;
  exact: boolean;
  display: Matrix;
  /** Streams being walked, against cycles. */
  active: Set<string>;
  /** Fonts, patterns and groups already walked on this page. */
  walked: Set<string>;
}

function lookupDict(
  doc: PDFDocument,
  obj: PDFObject | undefined,
): PDFDict | null {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFRawStream) return v.dict;
  return null;
}

function resourceEntry(
  doc: PDFDocument,
  resources: PDFDict | null,
  category: string,
  name: string,
): { ref: PDFRef | null; obj: PDFObject | undefined } | null {
  const cat = lookupDict(doc, resources?.get(PDFName.of(category)));
  if (!cat) return null;
  const raw = cat.get(PDFName.of(name));
  if (raw === undefined) return null;
  return {
    ref: raw instanceof PDFRef ? raw : null,
    obj: raw instanceof PDFRef ? doc.context.lookup(raw) : raw,
  };
}

function colourComponents(
  doc: PDFDocument,
  cs: PDFObject | undefined,
  resources: PDFDict | null,
): number {
  const v = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  if (v instanceof PDFName) {
    const name = v.asString().slice(1);
    const known = componentsOfName(name, null);
    if (known !== null) return known;
    const named = resourceEntry(doc, resources, "ColorSpace", name);
    return named ? colourComponents(doc, named.obj, null) : 3;
  }
  if (v instanceof PDFArray) {
    const head = v.lookup(0);
    const name = head instanceof PDFName ? head.asString().slice(1) : "";
    if (name === "ICCBased") {
      const icc = v.lookup(1);
      const dict = icc instanceof PDFRawStream ? icc.dict : null;
      return num(dict?.lookup(PDFName.of("N")), 3);
    }
    return componentsOfName(name, v.asArray()) ?? 3;
  }
  return 3;
}

function lastFilter(dict: PDFDict): string | null {
  const f = dict.lookup(PDFName.of("Filter"));
  if (f instanceof PDFName) return f.asString().slice(1);
  if (f instanceof PDFArray && f.size() > 0) {
    const last = f.lookup(f.size() - 1);
    return last instanceof PDFName ? last.asString().slice(1) : null;
  }
  return null;
}

function imageFactsOf(
  doc: PDFDocument,
  dict: PDFDict,
  resources: PDFDict | null,
): ImageFacts {
  const width = num(dict.lookup(PDFName.of("Width")));
  const height = num(dict.lookup(PDFName.of("Height")));
  const im = dict.lookup(PDFName.of("ImageMask"));
  const mask = im instanceof PDFBool && im.asBoolean();
  const filter = lastFilter(dict);
  const cs = dict.get(PDFName.of("ColorSpace"));
  const comps = mask
    ? 1
    : filter === "JPXDecode" && cs === undefined
      ? 4
      : colourComponents(doc, cs, resources);
  const csValue = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  const deviceRgb =
    csValue instanceof PDFName && csValue.asString() === "/DeviceRGB";
  let alpha: ImageFacts["alpha"] = null;
  for (const key of ["SMask", "Mask"]) {
    const m = dict.lookup(PDFName.of(key));
    if (m instanceof PDFRawStream)
      alpha = {
        width: num(m.dict.lookup(PDFName.of("Width")), width),
        height: num(m.dict.lookup(PDFName.of("Height")), height),
        bpc: num(m.dict.lookup(PDFName.of("BitsPerComponent")), 8),
      };
    else if (m instanceof PDFArray && !alpha) alpha = { width, height, bpc: 0 };
  }
  return {
    width,
    height,
    bpc: mask ? 1 : num(dict.lookup(PDFName.of("BitsPerComponent")), 8),
    comps,
    mask,
    alpha,
    filter,
    deviceRgb,
    decode: dict.has(PDFName.of("Decode")),
  };
}

function inlineFacts(
  doc: PDFDocument,
  dict: Map<string, Operand>,
  resources: PDFDict | null,
): ImageFacts {
  const w = inlineGet(dict, "Width");
  const h = inlineGet(dict, "Height");
  const mask = inlineGet(dict, "ImageMask") === true;
  const bpc = inlineGet(dict, "BitsPerComponent");
  const f = inlineGet(dict, "Filter");
  const fname =
    f instanceof Name
      ? (INLINE_FILTERS[f.name] ?? f.name)
      : Array.isArray(f) && f.at(-1) instanceof Name
        ? (INLINE_FILTERS[(f.at(-1) as Name).name] ?? (f.at(-1) as Name).name)
        : null;
  const cs = inlineGet(dict, "ColorSpace");
  let comps = 1;
  if (!mask) {
    if (cs instanceof Name && !INLINE_CS[cs.name]) {
      const known = componentsOfName(cs.name, null);
      if (known !== null) comps = known;
      else {
        const named = resourceEntry(doc, resources, "ColorSpace", cs.name);
        comps = named ? colourComponents(doc, named.obj, null) : 3;
      }
    } else comps = inlineComps(cs);
  }
  const width = typeof w === "number" ? w : 0;
  const height = typeof h === "number" ? h : 0;
  return {
    width,
    height,
    bpc: mask ? 1 : typeof bpc === "number" ? bpc : 8,
    comps,
    mask,
    alpha: null,
    filter: fname,
    deviceRgb:
      cs instanceof Name && (cs.name === "RGB" || cs.name === "DeviceRGB"),
    decode: inlineGet(dict, "Decode") !== null,
  };
}

function addImage(
  ctx: Ctx,
  key: string | null,
  facts: ImageFacts,
  ctm: Matrix | null,
): void {
  if (!(facts.width > 0) || !(facts.height > 0)) return;
  let index = key !== null ? ctx.imageIndex.get(key) : undefined;
  if (index === undefined) {
    const image: InventoryImage = {
      ref: key,
      inline: key === null,
      width: facts.width,
      height: facts.height,
      mask: facts.mask,
      bytes: decodedBytes(facts),
    };
    index = ctx.list.length;
    ctx.list.push(image);
    if (key !== null) {
      ctx.imageIndex.set(key, index);
      ctx.images.set(key, image);
    }
  }
  if (ctm && !facts.mask)
    ctx.placements.push({ image: index, box: unitBox(mul(ctx.display, ctm)) });
}

/**
 * Every image XObject a resources dictionary declares, and every one the
 * resources of what it declares declare — forms, tiling patterns, soft-mask
 * groups, Type3 fonts, the places a content walk would go: the fallback
 * when a content stream cannot be read, and an upper bound on what it
 * paints (inline images aside: they live in the unreadable stream itself).
 */
function declaredImages(
  ctx: Ctx,
  resources: PDFDict | null,
  depth: number,
): void {
  if (!resources || depth > MAX_DEPTH) return;
  const each = (category: string) =>
    lookupDict(ctx.doc, resources.get(PDFName.of(category)))?.entries() ?? [];
  /** The resources of `holder` (a stream's or a dictionary's), once each. */
  const nested = (raw: PDFObject, holder: PDFDict) => {
    const key = raw instanceof PDFRef ? refKey(raw) : null;
    if (key && (ctx.active.has(key) || ctx.walked.has(key))) return;
    if (key) {
      ctx.active.add(key);
      ctx.walked.add(key);
    }
    declaredImages(
      ctx,
      lookupDict(ctx.doc, holder.get(PDFName.of("Resources"))),
      depth + 1,
    );
    if (key) ctx.active.delete(key);
  };
  for (const [, raw] of each("XObject")) {
    const obj = raw instanceof PDFRef ? ctx.doc.context.lookup(raw) : raw;
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.lookup(PDFName.of("Subtype"));
    if (subtype === PDFName.of("Image"))
      addImage(
        ctx,
        raw instanceof PDFRef ? refKey(raw) : null,
        imageFactsOf(ctx.doc, obj.dict, resources),
        null,
      );
    else if (subtype === PDFName.of("Form")) nested(raw, obj.dict);
  }
  for (const [, raw] of each("Pattern")) {
    const obj = raw instanceof PDFRef ? ctx.doc.context.lookup(raw) : raw;
    if (obj instanceof PDFRawStream) nested(raw, obj.dict);
  }
  for (const [, raw] of each("ExtGState")) {
    const smask = lookupDict(
      ctx.doc,
      lookupDict(ctx.doc, raw)?.get(PDFName.of("SMask")),
    );
    const g = smask?.get(PDFName.of("G"));
    const group = g instanceof PDFRef ? ctx.doc.context.lookup(g) : g;
    if (g && group instanceof PDFRawStream) nested(g, group.dict);
  }
  for (const [, raw] of each("Font")) {
    const font = lookupDict(ctx.doc, raw);
    if (font && font.lookup(PDFName.of("Subtype")) === PDFName.of("Type3"))
      nested(raw, font);
  }
}

function matrixOf(obj: PDFObject | undefined): Matrix | null {
  if (!(obj instanceof PDFArray) || obj.size() !== 6) return null;
  const m = obj.asArray().map((v) => num(v, NaN));
  return m.every(Number.isFinite) ? (m as Matrix) : null;
}

/** Walk one content stream. `ctm` null: count images, record no placement. */
function walkContent(
  ctx: Ctx,
  bytes: Uint8Array | null,
  resources: PDFDict | null,
  ctm: Matrix | null,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  if (!bytes) {
    ctx.exact = false;
    declaredImages(ctx, resources, depth);
    return;
  }
  const stack: { ctm: Matrix | null; tr: number }[] = [];
  let state = { ctm, tr: 0 };
  for (const { op, args, inline } of contentOperators(bytes)) {
    switch (op) {
      case "q":
        stack.push({ ...state });
        break;
      case "Q":
        state = stack.pop() ?? state;
        break;
      case "cm": {
        const m = args.slice(-6);
        if (
          state.ctm &&
          m.length === 6 &&
          m.every((v) => typeof v === "number")
        )
          state.ctm = mul(state.ctm, m as number[]);
        break;
      }
      case "Tr":
        if (typeof args.at(-1) === "number") state.tr = args.at(-1) as number;
        break;
      case "Tj":
      case "TJ":
      case "'":
      case '"':
        if (state.tr !== 3 && state.tr !== 7) ctx.visibleTextOps++;
        break;
      case "BI":
        if (inline)
          addImage(
            ctx,
            null,
            inlineFacts(ctx.doc, inline, resources),
            state.ctm,
          );
        break;
      case "Do": {
        const name = args.at(-1);
        if (name instanceof Name)
          invokeXObject(ctx, resources, name.name, state.ctm, depth);
        break;
      }
      case "gs": {
        const name = args.at(-1);
        if (name instanceof Name) softMask(ctx, resources, name.name, depth);
        break;
      }
      case "scn":
      case "SCN": {
        const name = args.at(-1);
        if (name instanceof Name) pattern(ctx, resources, name.name, depth);
        break;
      }
      case "Tf": {
        const name = args.at(-2);
        if (name instanceof Name) type3Font(ctx, resources, name.name, depth);
        break;
      }
      default:
        break;
    }
  }
}

function invokeXObject(
  ctx: Ctx,
  resources: PDFDict | null,
  name: string,
  ctm: Matrix | null,
  depth: number,
): void {
  const entry = resourceEntry(ctx.doc, resources, "XObject", name);
  if (!entry || !(entry.obj instanceof PDFRawStream)) return;
  const dict = entry.obj.dict;
  const subtype = dict.lookup(PDFName.of("Subtype"));
  const key = entry.ref ? refKey(entry.ref) : null;
  if (subtype === PDFName.of("Image")) {
    addImage(ctx, key, imageFactsOf(ctx.doc, dict, resources), ctm);
    return;
  }
  if (subtype !== PDFName.of("Form")) return;
  const guard = key ?? `form:${name}:${depth}`;
  if (ctx.active.has(guard)) return;
  ctx.active.add(guard);
  const matrix = matrixOf(dict.lookup(PDFName.of("Matrix")));
  const own = lookupDict(ctx.doc, dict.get(PDFName.of("Resources")));
  walkContent(
    ctx,
    streamBytes(ctx.doc, entry.obj),
    own ?? resources,
    ctm ? (matrix ? mul(ctm, matrix) : ctm) : null,
    depth + 1,
  );
  ctx.active.delete(guard);
}

function walkOnce(ctx: Ctx, key: string, walk: () => void): void {
  if (ctx.walked.has(key) || ctx.active.has(key)) return;
  ctx.walked.add(key);
  ctx.active.add(key);
  walk();
  ctx.active.delete(key);
}

function softMask(
  ctx: Ctx,
  resources: PDFDict | null,
  name: string,
  depth: number,
): void {
  const entry = resourceEntry(ctx.doc, resources, "ExtGState", name);
  const gs = lookupDict(ctx.doc, entry?.obj);
  const smask = lookupDict(ctx.doc, gs?.get(PDFName.of("SMask")));
  const g = smask?.get(PDFName.of("G"));
  const group = g instanceof PDFRef ? ctx.doc.context.lookup(g) : g;
  if (!(group instanceof PDFRawStream)) return;
  walkOnce(ctx, g instanceof PDFRef ? refKey(g) : `gs:${name}`, () =>
    walkContent(
      ctx,
      streamBytes(ctx.doc, group),
      lookupDict(ctx.doc, group.dict.get(PDFName.of("Resources"))) ?? resources,
      null,
      depth + 1,
    ),
  );
}

function pattern(
  ctx: Ctx,
  resources: PDFDict | null,
  name: string,
  depth: number,
): void {
  const entry = resourceEntry(ctx.doc, resources, "Pattern", name);
  if (!entry || !(entry.obj instanceof PDFRawStream)) return;
  const stream = entry.obj;
  if (num(stream.dict.lookup(PDFName.of("PatternType"))) !== 1) return;
  walkOnce(ctx, entry.ref ? refKey(entry.ref) : `pat:${name}`, () =>
    walkContent(
      ctx,
      streamBytes(ctx.doc, stream),
      lookupDict(ctx.doc, stream.dict.get(PDFName.of("Resources"))) ??
        resources,
      null,
      depth + 1,
    ),
  );
}

function type3Font(
  ctx: Ctx,
  resources: PDFDict | null,
  name: string,
  depth: number,
): void {
  const entry = resourceEntry(ctx.doc, resources, "Font", name);
  const font = lookupDict(ctx.doc, entry?.obj);
  if (!font || font.lookup(PDFName.of("Subtype")) !== PDFName.of("Type3"))
    return;
  walkOnce(ctx, entry?.ref ? refKey(entry.ref) : `t3:${name}`, () => {
    const procs = lookupDict(ctx.doc, font.get(PDFName.of("CharProcs")));
    const own =
      lookupDict(ctx.doc, font.get(PDFName.of("Resources"))) ?? resources;
    for (const [, raw] of procs?.entries() ?? []) {
      const proc = raw instanceof PDFRef ? ctx.doc.context.lookup(raw) : raw;
      if (proc instanceof PDFRawStream)
        walkContent(ctx, streamBytes(ctx.doc, proc), own, null, depth + 1);
    }
  });
}

function annotations(ctx: Ctx, pageDict: PDFDict, depth: number): void {
  const annots = pageDict.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return;
  for (const raw of annots.asArray()) {
    const annot = lookupDict(ctx.doc, raw);
    const ap = lookupDict(ctx.doc, annot?.get(PDFName.of("AP")));
    const normal = ap?.get(PDFName.of("N"));
    const resolved =
      normal instanceof PDFRef ? ctx.doc.context.lookup(normal) : normal;
    const streams: PDFRawStream[] = [];
    if (resolved instanceof PDFRawStream) streams.push(resolved);
    else if (resolved instanceof PDFDict)
      for (const [, s] of resolved.entries()) {
        const v = s instanceof PDFRef ? ctx.doc.context.lookup(s) : s;
        if (v instanceof PDFRawStream) streams.push(v);
      }
    for (const s of streams)
      walkContent(
        ctx,
        streamBytes(ctx.doc, s),
        lookupDict(ctx.doc, s.dict.get(PDFName.of("Resources"))),
        null,
        depth + 1,
      );
  }
}

function inheritedOf(node: PDFDict, key: string): PDFObject | undefined {
  let cur: PDFDict | undefined = node;
  for (let i = 0; cur && i < 64; i++) {
    const v = cur.get(PDFName.of(key));
    if (v !== undefined) return v;
    const parent: PDFObject | undefined = cur.lookup(PDFName.of("Parent"));
    cur = parent instanceof PDFDict ? parent : undefined;
  }
  return undefined;
}

function boxOf(
  doc: PDFDocument,
  obj: PDFObject | undefined,
): [number, number, number, number] | null {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (!(v instanceof PDFArray) || v.size() !== 4) return null;
  const [a, b, c, d] = v.asArray().map((x) => num(x, NaN));
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return [
    Math.min(a!, c!),
    Math.min(b!, d!),
    Math.max(a!, c!),
    Math.max(b!, d!),
  ];
}

/**
 * Per page of `doc`, the map from the page as pdf.js DISPLAYS it (points
 * from the top left of its crop box, /Rotate applied) to the frame poppler's
 * `pdftotext -bbox-layout` reports in (the same, from the MEDIA box): the
 * identity unless the crop box is not the media box. Read from poppler's
 * `pdftotext.cc` (`printDocBBox` displays each page with `useMediaBox`),
 * not measured here: `pnpm worker:docx-pictures-proof` runs a cropped page
 * through the real poppler. Null when the page tree cannot be read.
 */
export function mediaFrames(doc: PDFDocument): Matrix[] | null {
  try {
    if (!(doc.catalog instanceof PDFDict)) return null;
    return doc.getPages().map((page) => {
      const node = page.node;
      const media = boxOf(doc, inheritedOf(node, "MediaBox")) ?? [
        0, 0, 612, 792,
      ];
      const crop = boxOf(doc, inheritedOf(node, "CropBox"));
      const view: [number, number, number, number] = crop
        ? [
            Math.max(media[0], crop[0]),
            Math.max(media[1], crop[1]),
            Math.min(media[2], crop[2]),
            Math.min(media[3], crop[3]),
          ]
        : media;
      const valid = view[2] > view[0] && view[3] > view[1] ? view : media;
      const rotate = num(inheritedOf(node, "Rotate") as PDFObject | undefined);
      const shown = displayTransform(valid, rotate).transform;
      const poppler = displayTransform(media, rotate).transform;
      // poppler ∘ shown⁻¹ — both are a signed axis swap and a shift, so the
      // inverse is exact.
      const det = shown[0]! * shown[3]! - shown[1]! * shown[2]!;
      const inv: Matrix = [
        shown[3]! / det,
        -shown[1]! / det,
        -shown[2]! / det,
        shown[0]! / det,
        (shown[2]! * shown[5]! - shown[3]! * shown[4]!) / det,
        (shown[1]! * shown[4]! - shown[0]! * shown[5]!) / det,
      ];
      return mul(poppler, inv);
    });
  } catch {
    return null;
  }
}

/**
 * The inventory of every page of `doc` (already loaded by pdf-lib, which may
 * be shared with the caller). One entry per page, in order.
 */
export function inventoryOf(doc: PDFDocument): PageInventory[] {
  return doc.getPages().map((page, i) => {
    const node = page.node;
    const media = boxOf(doc, inheritedOf(node, "MediaBox")) ?? [0, 0, 612, 792];
    const crop = boxOf(doc, inheritedOf(node, "CropBox"));
    const view: [number, number, number, number] = crop
      ? [
          Math.max(media[0], crop[0]),
          Math.max(media[1], crop[1]),
          Math.min(media[2], crop[2]),
          Math.min(media[3], crop[3]),
        ]
      : media;
    const valid = view[2] > view[0] && view[3] > view[1] ? view : media;
    const rotate = num(inheritedOf(node, "Rotate") as PDFObject | undefined);
    const display = displayTransform(valid, rotate);
    const ctx: Ctx = {
      doc,
      images: new Map(),
      imageIndex: new Map(),
      list: [],
      placements: [],
      visibleTextOps: 0,
      exact: true,
      display: display.transform,
      active: new Set(),
      walked: new Set(),
    };
    const resources = lookupDict(doc, inheritedOf(node, "Resources"));
    const contents = node.get(PDFName.of("Contents"));
    const resolved =
      contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
    const parts: PDFRawStream[] = [];
    if (resolved instanceof PDFRawStream) parts.push(resolved);
    else if (resolved instanceof PDFArray)
      for (const v of resolved.asArray()) {
        const s = v instanceof PDFRef ? doc.context.lookup(v) : v;
        if (s instanceof PDFRawStream) parts.push(s);
      }
    const chunks = parts.map((s) => streamBytes(doc, s));
    if (chunks.some((c) => c === null))
      walkContent(ctx, null, resources, null, 0);
    else {
      // Joined with a space: a page's streams are one content stream.
      const total = chunks.reduce((n, c) => n + c!.length + 1, 0);
      const joined = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) {
        joined.set(c!, at);
        joined[at + c!.length] = 0x20;
        at += c!.length + 1;
      }
      walkContent(ctx, joined, resources, [1, 0, 0, 1, 0, 0], 0);
    }
    annotations(ctx, node, 0);
    return {
      pageNumber: i + 1,
      width: display.width,
      height: display.height,
      images: ctx.list,
      placements: ctx.placements,
      visibleTextOps: ctx.visibleTextOps,
      exact: ctx.exact,
    };
  });
}

/**
 * {@link inventoryOf}, or null when this file's page tree cannot be read
 * here. Never a throw: no inventory is not a failure, only less to go on.
 *
 * pdf-lib LOADS an encrypted file it cannot decrypt (`ignoreEncryption`).
 * In the layout Acrobat and Word write, the catalog and page tree are inside
 * an encrypted object stream and pdf-lib has no catalog at all until
 * {@link unlockObjectStreams} reads it. Until 2026-10-11 the page scan
 * called `inventoryOf` on that document outside any try, it threw "Cannot
 * read properties of undefined (reading 'Pages')", and every such file —
 * which every viewer opens — failed PDF to PowerPoint as a retryable
 * `failed` job. A damaged page tree that throws anywhere in the walk is the
 * same case.
 */
export function readInventory(doc: PDFDocument): PageInventory[] | null {
  if (!(doc.catalog instanceof PDFDict)) return null;
  try {
    return inventoryOf(doc);
  } catch {
    return null;
  }
}

/**
 * Every image XObject in the file, whichever page paints it, each once (a
 * soft mask or mask image is counted with the image it masks, as pdf.js
 * decodes it): what is known of the pictures of a file with no inventory
 * ({@link readInventory}), and an upper bound on what any one page decodes.
 * Null when the file's objects cannot be walked.
 */
export function documentImages(doc: PDFDocument): InventoryImage[] | null {
  try {
    const images: [PDFRef, PDFRawStream][] = [];
    const masks = new Set<string>();
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      if (obj.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image"))
        continue;
      images.push([ref, obj]);
      for (const key of ["SMask", "Mask"]) {
        const m = obj.dict.get(PDFName.of(key));
        if (m instanceof PDFRef) masks.add(refKey(m));
      }
    }
    const out: InventoryImage[] = [];
    for (const [ref, obj] of images) {
      const key = refKey(ref);
      if (masks.has(key)) continue;
      const facts = imageFactsOf(doc, obj.dict, null);
      if (!(facts.width > 0) || !(facts.height > 0)) continue;
      out.push({
        ref: key,
        inline: false,
        width: facts.width,
        height: facts.height,
        mask: facts.mask,
        bytes: decodedBytes(facts),
      });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Read an encrypted file's object streams into `doc`, so that its catalog
 * and page tree — packed inside them, in the layout Acrobat and Word write —
 * are there to walk. pdf-lib parses an object stream as it loads the file;
 * an encrypted one is ciphertext to it, so it keeps the whole object as an
 * unparsed `PDFInvalidObject` and the document has no catalog. Here each
 * such object stream is decrypted with its own key (`./standard-security`)
 * and parsed in, and the catalog set. A file that is not encrypted, already
 * has a catalog, or cannot be decrypted here is left as it is. Never throws.
 */
export async function unlockObjectStreams(doc: PDFDocument): Promise<void> {
  if (!doc.isEncrypted || doc.catalog instanceof PDFDict) return;
  const { decryptor } = decryptionOf(doc);
  if (!decryptor) return;
  const OBJSTM = PDFName.of("ObjStm");
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFInvalidObject)) continue;
    try {
      // What pdf-lib could not parse, as it stood between "obj" and "endobj".
      const bytes = (obj as unknown as { data: Uint8Array }).data;
      const stream = PDFObjectParser.forBytes(bytes, doc.context).parseObject();
      if (
        !(stream instanceof PDFRawStream) ||
        stream.dict.lookup(PDFName.of("Type")) !== OBJSTM
      )
        continue;
      const plain = decryptor.decrypt(ref, stream);
      if (!plain) continue;
      await PDFObjectStreamParser.forStream(
        PDFRawStream.of(stream.dict, plain),
      ).parseIntoContext();
    } catch {
      // This object stream stays unread; the next may still hold the tree.
    }
  }
  try {
    const root = doc.context.lookup(doc.context.trailerInfo.Root);
    // pdf-lib sets `catalog` once, as it loads; set it as it would have.
    if (root instanceof PDFCatalog)
      (doc as unknown as { catalog: PDFCatalog }).catalog = root;
  } catch {
    // No catalog: the caller falls back to what the file's images say.
  }
}

/** Load `bytes` with pdf-lib and inventory it; null when pdf-lib cannot. */
export async function inventoryPages(
  bytes: Uint8Array,
): Promise<PageInventory[] | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    await unlockObjectStreams(doc);
    return readInventory(doc);
  } catch {
    return null;
  }
}
