import type {
  PDFDict as PDFDictT,
  PDFDocument,
  PDFObject,
  PDFRawStream as PDFRawStreamT,
  PDFRef as PDFRefT,
} from "pdf-lib";
import { DEFAULT_DECODE_BUDGET_BYTES } from "./decode-budget";
import { PdfEngineError, UNREADABLE_PDF_MESSAGE } from "./engine-errors";
import type { PdfLibModule } from "./pdf-lib";

/**
 * Objects defined more than once resolve to the definition the
 * cross-reference data selects — the one pdf.js (our preview and every
 * raster tool) and every viewer show.
 *
 * pdf-lib does not read the xref when it loads a file. It parses the bytes top
 * to bottom and, when an object number comes round again, the later body
 * overwrites the earlier one. For an ordinary incremental update that is the
 * right answer: the newer body is appended, and the newest xref names it. But a
 * file can define `3 0 obj` twice and have its xref name the FIRST body (a
 * hand-patched or concatenated file, a buggy writer, or a crafted one). Then
 * the preview shows one page and the engines write another: a merge downloads
 * a page the user never saw, and a redaction is validated against a page size
 * the raster does not have (hostile matrix PS-08, CO-02, EDIT-08).
 *
 * What this does, after pdf-lib has loaded the file:
 *
 *  1. One pass over the bytes finds every `N G obj` header and its offset
 *     ({@link scanObjectHeaders}): one loop over the bytes, no string
 *     built. Most files have no repeated header and no object stream, and
 *     stop here.
 *  2. Only then is the xref read (classic tables, xref streams, hybrid
 *     /XRefStm, the /Prev chain, newest entry wins), through the same reader
 *     the editor's incremental save uses (`./security/document.ts`), loaded
 *     on demand.
 *  3. Each object whose xref-selected body is not the one pdf-lib's linear
 *     parse kept is re-parsed from where the xref points and put in pdf-lib's
 *     context under the same reference. The catalog and Info dictionary, which
 *     `PDFDocument` reads eagerly at load, are refreshed when they are among
 *     them.
 *
 * Cost stays a constant factor of pdf-lib's own load on any file
 * (xref-duplicates-cost.test.ts): the xref chain is checked for bounded
 * stream sections before it is read ({@link xrefIsBounded}), each object
 * stream is decoded once, and all re-parsing shares one byte budget; bodies
 * that overlap, which only a crafted file has, exhaust it and are refused.
 *
 * Where the xref cannot be trusted (it cannot be read, or an entry does not
 * land on a header of that object and generation), nothing changes: pdf.js
 * rebuilds such a file by scanning, and its scan also keeps the LAST body, so
 * pdf-lib's answer already matches the preview.
 *
 * Not covered, and left as pdf-lib parsed them: two object STREAMS that both
 * carry a member of the same number with no top-level twin (a top-level scan
 * cannot see compressed members), and a duplicated object that is itself an
 * object stream or xref stream whose members disagree.
 */

/** Object number and generation packed into one map key. */
const key = (num: number, gen: number) => num * 0x10000 + gen;

const J = 0x6a; // "j"
const isDigit = (c: number | undefined) =>
  c !== undefined && c >= 0x30 && c <= 0x39;
/** PDF white-space: NUL, TAB, LF, FF, CR, SP. */
const isSpace = (c: number | undefined) =>
  c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0;
/** A byte that may end a keyword: white-space, a delimiter, or end of data. */
const endsToken = (c: number | undefined) =>
  c === undefined ||
  isSpace(c) ||
  "()<>[]{}/%".includes(String.fromCharCode(c));

/** Where each `N G obj` header begins, by object number and generation. */
export interface HeaderScan {
  /** (num, gen) key → header offsets, in file order. */
  headers: Map<number, number[]>;
  /** Did any (num, gen) header occur more than once? */
  repeated: boolean;
  /** Does the file contain the name `/ObjStm` (an object stream)? */
  objectStreams: boolean;
}

/**
 * Find every `N G obj` header. A header inside a stream's data is found too;
 * that is harmless, because it can only ever add a candidate whose
 * xref-selected body is then re-parsed — the body pdf-lib already had.
 */
export function scanObjectHeaders(bytes: Uint8Array): HeaderScan {
  const headers = new Map<number, number[]>();
  let repeated = false;
  // A plain loop, not an `indexOf` hop: a native call per hit costs ~25 ns,
  // and a hostile file can make every byte a hit (measured: 1.7 s on 64 MB).
  let objectStreams = false;
  for (let i = 2; i < bytes.length; i += 1) {
    if (bytes[i] !== J || bytes[i - 1] !== 0x62) continue;
    if (bytes[i - 2] === 0x4f) {
      // "/ObjStm"
      objectStreams ||=
        bytes[i - 3] === 0x2f &&
        bytes[i + 1] === 0x53 &&
        bytes[i + 2] === 0x74 &&
        bytes[i + 3] === 0x6d;
      continue;
    }
    if (bytes[i - 2] !== 0x6f) continue; // "obj"
    if (!endsToken(bytes[i + 1])) continue;
    let p = i - 3;
    if (!isSpace(bytes[p])) continue;
    while (p >= 0 && isSpace(bytes[p])) p -= 1;
    let gen = 0;
    let scale = 1;
    const genEnd = p;
    while (p >= 0 && isDigit(bytes[p]) && genEnd - p < 5) {
      gen += (bytes[p]! - 0x30) * scale;
      scale *= 10;
      p -= 1;
    }
    if (p === genEnd || isDigit(bytes[p]) || !isSpace(bytes[p])) continue;
    while (p >= 0 && isSpace(bytes[p])) p -= 1;
    let num = 0;
    scale = 1;
    const numEnd = p;
    while (p >= 0 && isDigit(bytes[p]) && numEnd - p < 10) {
      num += (bytes[p]! - 0x30) * scale;
      scale *= 10;
      p -= 1;
    }
    if (p === numEnd || isDigit(bytes[p])) continue;
    if (p >= 0 && !endsToken(bytes[p])) continue;
    const k = key(num, gen);
    const list = headers.get(k);
    if (list) {
      list.push(p + 1);
      repeated = true;
    } else headers.set(k, [p + 1]);
  }
  return { headers, repeated, objectStreams };
}

const latin1 = new TextDecoder("latin1");
const HEADER = /^[\0\t\n\f\r ]*(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj/;

/**
 * How many bytes the guard's own parses may consume, all told. The bodies of
 * distinct objects never share bytes in a file a writer produced, so
 * re-parsing xref-selected bodies reads each byte of the file, and of each
 * decoded object stream, at most once. Twice that, plus 64 KiB, leaves room
 * for a parser that peeks past an object's end. Bodies that overlap (a header
 * planted inside another object's string, and an xref naming it) can only be
 * crafted, and following them re-reads the file once per object: past this
 * budget the file is refused. See xref-duplicates-cost.test.ts.
 */
class ParseBudget {
  private left: number;
  constructor(bytes: number) {
    this.left = 2 * bytes + 64 * 1024;
  }
  /** Decoded object-stream data is new input, and earns its own allowance. */
  grow(bytes: number) {
    this.left += 2 * bytes;
  }
  parse(lib: PdfLibModule, doc: PDFDocument, bytes: Uint8Array): PDFObject {
    const parser = lib.PDFObjectParser.forBytes(bytes, doc.context);
    try {
      return parser.parseObject();
    } finally {
      // pdf-lib's parser keeps its position in a `bytes` ByteStream; if that
      // ever changes, charge the whole remaining input instead.
      const read = (
        parser as unknown as { bytes?: { offset?: () => number } }
      ).bytes?.offset?.();
      this.left -= typeof read === "number" ? read : bytes.length;
      if (this.left < 0)
        throw new PdfEngineError(UNREADABLE_PDF_MESSAGE, {
          kind: "unreadable",
        });
    }
  }
}

/** Parse the body of the object whose header is at `offset`, if it is `num gen`. */
function parseBodyAt(
  lib: PdfLibModule,
  doc: PDFDocument,
  budget: ParseBudget,
  bytes: Uint8Array,
  offset: number,
  num: number,
  gen: number,
): PDFObject | null {
  if (offset < 0 || offset >= bytes.length) return null;
  const m = HEADER.exec(latin1.decode(bytes.subarray(offset, offset + 48)));
  if (!m || Number(m[1]) !== num || Number(m[2]) !== gen) return null;
  return budget.parse(lib, doc, bytes.subarray(offset + m[0].length));
}

/** Streams whose job is structure, not content: never swapped in here. */
function isStructuralStream(lib: PdfLibModule, obj: PDFObject): boolean {
  if (!(obj instanceof lib.PDFRawStream)) return false;
  const type = obj.dict.get(lib.PDFName.of("Type"));
  return type === lib.PDFName.of("ObjStm") || type === lib.PDFName.of("XRef");
}

/** An object stream, decoded once: its data and its header table. */
interface ObjStm {
  data: Uint8Array;
  first: number;
  /** num, offset, num, offset, ... in table order. */
  table: number[];
}

/**
 * The most object-stream data this guard inflates for one document, in all:
 * the same total pdf-lib's own load allows every object stream it decodes
 * (the per-load ledger in the patched pdf-lib). A real file's object streams
 * fit within that at load, so they fit here.
 */
export const OBJSTM_DECODE_TOTAL = DEFAULT_DECODE_BUDGET_BYTES;

/** An object stream bigger than what is left of {@link OBJSTM_DECODE_TOTAL}. */
const OVER = Symbol("over");

function openObjStm(
  lib: PdfLibModule,
  stream: PDFObject,
  allowance: number,
): ObjStm | null | typeof OVER {
  if (!(stream instanceof lib.PDFRawStream)) return null;
  const n = stream.dict.get(lib.PDFName.of("N"));
  const first = stream.dict.get(lib.PDFName.of("First"));
  if (!(n instanceof lib.PDFNumber) || !(first instanceof lib.PDFNumber))
    return null;
  // NOT always a stream pdf-lib decoded at load: this reads /N and /First
  // only, and pdf-lib expands a stream only when it says /Type /ObjStm. So
  // the decode is bounded here: at most `allowance` bytes, and one more to
  // tell a stream that would pass it (hidden-objstms, residual review).
  const raw = lib.decodePDFRawStream(stream).getBytes(allowance + 1);
  const data =
    raw instanceof Uint8Array
      ? raw
      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (data.length > allowance) return OVER;
  const table = latin1
    .decode(data.subarray(0, Math.max(0, first.asNumber())))
    .trim()
    .split(/[\0\t\n\f\r ]+/, Math.max(0, 2 * n.asNumber()))
    .map(Number);
  return { data, first: first.asNumber(), table };
}

/** Member `index` of an opened object stream, if it is object `num`. */
function objStmMember(
  lib: PdfLibModule,
  doc: PDFDocument,
  budget: ParseBudget,
  stm: ObjStm,
  index: number,
  num: number,
): PDFObject | null {
  if (stm.table[index * 2] !== num) return null;
  const at = stm.table[index * 2 + 1];
  if (at === undefined || !Number.isInteger(at) || at < 0) return null;
  return budget.parse(lib, doc, stm.data.subarray(stm.first + at));
}

const FAIL = Symbol("unbounded");

/** Byte search, as `./security/document.ts` does it: no string is built. */
function find(bytes: Uint8Array, word: string, from: number, step: 1 | -1) {
  const w = Array.from(word, (c) => c.charCodeAt(0));
  for (let i = from; i >= 0 && i <= bytes.length - w.length; i += step) {
    let j = 0;
    while (j < w.length && bytes[i + j] === w[j]) j += 1;
    if (j === w.length) return i;
  }
  return -1;
}
const lastIndexOfStartxref = (bytes: Uint8Array) =>
  find(bytes, "startxref", bytes.length - 9, -1);
const indexOfTrailer = (bytes: Uint8Array, from: number) =>
  find(bytes, "trailer", from, 1);

/**
 * Every stream section of the xref chain, checked before the chain is handed
 * to `readXref` (the editor's reader, which trusts its input's sizes). It
 * walks the same chain the same way — the last `startxref`, each table's
 * /XRefStm, every /Prev — parsing only dictionaries, and requires of each
 * stream section:
 *
 *  - /W of three integers, each 0..8 bytes, summing to at least 1. A row of
 *    zero bytes never runs out of data, so the reader's loop would run the
 *    full /Index count (2,000,000,000 in the review's 1 KB file);
 *  - /Index (or /Size) counts that are non-negative integers;
 *  - decoded data no longer than its rows need — (row + 1 predictor byte) x
 *    rows, plus 4 KiB — checked by decoding at most that much plus one byte;
 *  - all the decoded data of the chain together, counting a stream as often
 *    as the reader will decode it, within 4x the file plus 1 MiB.
 *
 * A chain that fails is not followed: nothing is corrected, as for an xref
 * that cannot be read. pdf.js rejects the same zero-width rows and rebuilds
 * the file by scanning, which keeps the last body, as pdf-lib does.
 */
export function xrefIsBounded(lib: PdfLibModule, bytes: Uint8Array): boolean {
  const context = lib.PDFContext.create();
  const at = lastIndexOfStartxref(bytes);
  if (at < 0) return true; // readXref throws: nothing is corrected.
  const m = /^startxref[\0\t\n\f\r ]+(\d+)/.exec(
    latin1.decode(bytes.subarray(at, at + 40)),
  );
  if (!m) return true;
  let decodedLeft = 4 * bytes.length + 1024 * 1024;
  const num = (o: PDFObject | undefined) =>
    o instanceof lib.PDFNumber ? o.asNumber() : undefined;

  /** One stream section, as readXref's addStream will read it. */
  const streamOk = (offset: number): PDFRawStreamT | null | typeof FAIL => {
    const head = HEADER.exec(
      latin1.decode(bytes.subarray(offset, offset + 48)),
    );
    if (!head) return null; // readXref throws on it
    const obj = lib.PDFObjectParser.forBytes(
      bytes.subarray(offset + head[0].length),
      context,
    ).parseObject();
    if (!(obj instanceof lib.PDFRawStream)) return null;
    const w = obj.dict.lookup(lib.PDFName.of("W"));
    if (!(w instanceof lib.PDFArray)) return null;
    const widths = w.asArray().map(num);
    if (
      widths.length < 3 ||
      widths.some(
        (x) => x === undefined || !Number.isInteger(x) || x < 0 || x > 8,
      )
    )
      return FAIL;
    const row = widths.slice(0, 3).reduce<number>((a, b) => a + b!, 0);
    if (row < 1) return FAIL;
    const index = obj.dict.get(lib.PDFName.of("Index"));
    const counts =
      index instanceof lib.PDFArray
        ? index
            .asArray()
            .filter((_, i) => i % 2 === 1)
            .map(num)
        : [num(obj.dict.get(lib.PDFName.of("Size"))) ?? 0];
    let rows = 0;
    for (const c of counts) {
      if (c === undefined || !Number.isInteger(c) || c < 0) return FAIL;
      rows += c;
    }
    const allowed = Math.min((row + 1) * rows + 4096, decodedLeft);
    const got = lib.decodePDFRawStream(obj).getBytes(allowed + 1).length;
    if (got > allowed) return FAIL;
    decodedLeft -= got;
    return obj;
  };

  const seen = new Set<number>();
  const queue = [Number(m[1])];
  while (queue.length > 0) {
    const offset = queue.shift()!;
    if (seen.has(offset) || offset < 0 || offset >= bytes.length) continue;
    seen.add(offset);
    let trailer: PDFDictT;
    const isTable =
      latin1.decode(bytes.subarray(offset, offset + 4)) === "xref";
    if (isTable) {
      const t = indexOfTrailer(bytes, offset + 4);
      if (t < 0) return true; // readXref throws
      const dict = lib.PDFObjectParser.forBytes(
        bytes.subarray(t + "trailer".length),
        context,
      ).parseObject();
      if (!(dict instanceof lib.PDFDict)) return true;
      trailer = dict;
      const xrefStm = num(trailer.get(lib.PDFName.of("XRefStm")));
      if (xrefStm !== undefined) {
        const s = streamOk(xrefStm);
        if (s === FAIL) return false;
        if (s === null) return true;
      }
    } else {
      const s = streamOk(offset);
      if (s === FAIL) return false;
      if (s === null) return true;
      trailer = s.dict;
    }
    const prev = num(trailer.get(lib.PDFName.of("Prev")));
    if (prev !== undefined) queue.push(prev);
  }
  return true;
}

/**
 * Make every object pdf-lib holds the one the xref selects (see the module
 * comment). Returns the same document, corrected in place, and how many
 * objects were replaced.
 */
export async function honourXrefDuplicates(
  doc: PDFDocument,
  bytes: Uint8Array,
  /** The caller's pdf-lib module (see `assertPageTree` in ./page-tree). */
  lib: PdfLibModule,
): Promise<{ doc: PDFDocument; replaced: number }> {
  const scan = scanObjectHeaders(bytes);
  if (!scan.repeated && !scan.objectStreams) return { doc, replaced: 0 };

  let entries: Awaited<
    ReturnType<typeof import("./security/document").readXref>
  >["entries"];
  try {
    // `readXref` is the editor's reader and trusts its input's sizes: it is
    // only handed a chain whose every stream section is proven bounded.
    if (!xrefIsBounded(lib, bytes)) return { doc, replaced: 0 };
    const { readXref } = await import("./security/document");
    ({ entries } = await readXref(lib, bytes));
  } catch {
    // No readable xref: pdf.js rebuilds by scanning, and keeps the last body
    // as pdf-lib did. Nothing to correct.
    return { doc, replaced: 0 };
  }

  /** The last top-level header of (num, gen): what pdf-lib's parse kept. */
  const lastHeader = (num: number, gen: number) => {
    const list = scan.headers.get(key(num, gen));
    return list ? list[list.length - 1]! : -1;
  };
  const budget = new ParseBudget(bytes.length);
  /** Object streams already opened here, by number: each decoded ONCE. */
  const streams = new Map<number, ObjStm | null>();
  /** What is left of {@link OBJSTM_DECODE_TOTAL} for this document. */
  let objStmLeft = OBJSTM_DECODE_TOTAL;
  const openStream = (num: number): ObjStm | null => {
    if (streams.has(num)) return streams.get(num)!;
    const entry = entries.get(num);
    let stm: ObjStm | null = null;
    if (entry?.type === 1 && entry.offset >= 0) {
      try {
        const body = parseBodyAt(
          lib,
          doc,
          budget,
          bytes,
          entry.offset,
          num,
          entry.gen,
        );
        const opened = body && openObjStm(lib, body, objStmLeft);
        if (opened === OVER)
          throw new PdfEngineError(UNREADABLE_PDF_MESSAGE, {
            kind: "unreadable",
          });
        stm = opened || null;
        if (stm) objStmLeft -= stm.data.length;
      } catch (err) {
        if (err instanceof PdfEngineError) throw err;
        stm = null;
      }
    }
    if (stm) budget.grow(stm.data.length);
    streams.set(num, stm);
    return stm;
  };

  const replacements: [PDFRefT, PDFObject][] = [];
  for (const [num, entry] of entries) {
    let body: PDFObject | null = null;
    try {
      if (entry.type === 1) {
        if (entry.offset < 0) continue;
        const headers = scan.headers.get(key(num, entry.gen));
        // One header, or the xref names the last one: pdf-lib agrees.
        if (!headers || headers.length < 2) continue;
        if (entry.offset === headers[headers.length - 1]) continue;
        body = parseBodyAt(
          lib,
          doc,
          budget,
          bytes,
          entry.offset,
          num,
          entry.gen,
        );
      } else {
        // A member of object stream `entry.stream`. pdf-lib keeps whichever
        // definition it met last: a top-level header of this number AFTER
        // the stream, or a later copy of the stream itself.
        const streamEntry = entries.get(entry.stream);
        if (streamEntry?.type !== 1 || streamEntry.offset < 0) continue;
        const twin = lastHeader(num, 0) > streamEntry.offset;
        const laterStream =
          lastHeader(entry.stream, streamEntry.gen) > streamEntry.offset;
        if (!twin && !laterStream) continue;
        const stm = openStream(entry.stream);
        if (!stm) continue;
        body = objStmMember(lib, doc, budget, stm, entry.index, num);
      }
    } catch (err) {
      // Over budget: refused (see ParseBudget). Anything else: this entry
      // does not parse, and pdf-lib's body stands.
      if (err instanceof PdfEngineError) throw err;
      body = null;
    }
    // An xref entry that does not land on its object: pdf.js rebuilds by
    // scanning (last body wins), which is what pdf-lib already holds.
    if (!body || isStructuralStream(lib, body)) continue;
    const gen = entry.type === 1 ? entry.gen : 0;
    replacements.push([lib.PDFRef.of(num, gen), body]);
  }
  if (replacements.length === 0) return { doc, replaced: 0 };

  // An xref whose catalog is not a dictionary: pdf.js gives up on that xref
  // and rebuilds the file by scanning, keeping every LAST body, as pdf-lib's
  // parse already did. Nothing to correct.
  const { Root, Info } = doc.context.trailerInfo;
  const newRoot = replacements.find(([ref]) => ref === Root)?.[1];
  if (newRoot && !(newRoot instanceof lib.PDFDict)) return { doc, replaced: 0 };

  for (const [ref, body] of replacements) doc.context.assign(ref, body);

  // `PDFDocument` reads the catalog once, in its constructor; and its default
  // load wrote Producer/ModDate into whichever Info dictionary it held then.
  const touched = new Set(replacements.map(([ref]) => ref));
  const mutable = doc as unknown as {
    catalog: unknown;
    updateInfoDict?: () => void;
  };
  if (Root instanceof lib.PDFRef && touched.has(Root)) {
    mutable.catalog = doc.context.lookup(Root);
  }
  if (Info instanceof lib.PDFRef && touched.has(Info)) {
    mutable.updateInfoDict?.();
  }
  return { doc, replaced: replacements.length };
}
