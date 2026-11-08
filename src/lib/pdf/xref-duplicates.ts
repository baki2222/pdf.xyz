import type { PDFDocument, PDFObject, PDFRef as PDFRefT } from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "./pdf-lib";

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

/** Parse the body of the object whose header is at `offset`, if it is `num gen`. */
function parseBodyAt(
  lib: PdfLibModule,
  doc: PDFDocument,
  bytes: Uint8Array,
  offset: number,
  num: number,
  gen: number,
): PDFObject | null {
  if (offset < 0 || offset >= bytes.length) return null;
  const m = HEADER.exec(latin1.decode(bytes.subarray(offset, offset + 48)));
  if (!m || Number(m[1]) !== num || Number(m[2]) !== gen) return null;
  return lib.PDFObjectParser.forBytes(
    bytes.subarray(offset + m[0].length),
    doc.context,
  ).parseObject();
}

/** Streams whose job is structure, not content: never swapped in here. */
function isStructuralStream(lib: PdfLibModule, obj: PDFObject): boolean {
  if (!(obj instanceof lib.PDFRawStream)) return false;
  const type = obj.dict.get(lib.PDFName.of("Type"));
  return type === lib.PDFName.of("ObjStm") || type === lib.PDFName.of("XRef");
}

/** Member `index` of an object stream body, by its own header table. */
function objStmMember(
  lib: PdfLibModule,
  doc: PDFDocument,
  stream: PDFObject,
  index: number,
  num: number,
): PDFObject | null {
  if (!(stream instanceof lib.PDFRawStream)) return null;
  const n = stream.dict.get(lib.PDFName.of("N"));
  const first = stream.dict.get(lib.PDFName.of("First"));
  if (!(n instanceof lib.PDFNumber) || !(first instanceof lib.PDFNumber))
    return null;
  if (index >= n.asNumber()) return null;
  const data = lib.decodePDFRawStream(stream).decode();
  const table = latin1
    .decode(data.subarray(0, first.asNumber()))
    .trim()
    .split(/[\0\t\n\f\r ]+/);
  if (Number(table[index * 2]) !== num) return null;
  const at = Number(table[index * 2 + 1]);
  if (!Number.isInteger(at) || at < 0) return null;
  return lib.PDFObjectParser.forBytes(
    data.subarray(first.asNumber() + at),
    doc.context,
  ).parseObject();
}

/**
 * Make every object pdf-lib holds the one the xref selects (see the module
 * comment). Returns the same document, corrected in place, and how many
 * objects were replaced.
 */
export async function honourXrefDuplicates(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<{ doc: PDFDocument; replaced: number }> {
  const scan = scanObjectHeaders(bytes);
  if (!scan.repeated && !scan.objectStreams) return { doc, replaced: 0 };

  const lib = await loadPdfLib();
  let entries: Awaited<
    ReturnType<typeof import("./security/document").readXref>
  >["entries"];
  try {
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
  /** Object streams already parsed here, by number. */
  const streams = new Map<number, PDFObject | null>();
  const streamBody = (num: number): PDFObject | null => {
    if (streams.has(num)) return streams.get(num)!;
    const entry = entries.get(num);
    let body: PDFObject | null = null;
    if (entry?.type === 1 && entry.offset >= 0) {
      try {
        body = parseBodyAt(lib, doc, bytes, entry.offset, num, entry.gen);
      } catch {
        body = null;
      }
    }
    streams.set(num, body);
    return body;
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
        body = parseBodyAt(lib, doc, bytes, entry.offset, num, entry.gen);
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
        const stream = streamBody(entry.stream);
        if (!stream) continue;
        body = objStmMember(lib, doc, stream, entry.index, num);
      }
    } catch {
      body = null;
    }
    // An xref entry that does not land on its object: pdf.js rebuilds by
    // scanning (last body wins), which is what pdf-lib already holds.
    if (!body || isStructuralStream(lib, body)) continue;
    const gen = entry.type === 1 ? entry.gen : 0;
    replacements.push([lib.PDFRef.of(num, gen), body]);
  }
  if (replacements.length === 0) return { doc, replaced: 0 };

  for (const [ref, body] of replacements) doc.context.assign(ref, body);

  // `PDFDocument` reads the catalog once, in its constructor; and its default
  // load wrote Producer/ModDate into whichever Info dictionary it held then.
  const { Root, Info } = doc.context.trailerInfo;
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
