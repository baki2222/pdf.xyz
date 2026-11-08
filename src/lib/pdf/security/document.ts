import type {
  PDFArray as PDFArrayT,
  PDFContext,
  PDFDict as PDFDictT,
  PDFObject,
  PDFRawStream as PDFRawStreamT,
  PDFRef as PDFRefT,
} from "pdf-lib";
import { loadPdfLib, type PdfLibModule } from "../pdf-lib";
import {
  StandardSecurityHandler,
  UnsupportedEncryptionError,
  type CryptMethod,
  type EncryptParams,
} from "./standard-handler";

/**
 * Read an encrypted PDF's structure through its OWN cross-reference data,
 * and decrypt every object into a plain pdf-lib context with the object
 * numbers unchanged — so a change made to the plain copy can be written
 * back to the ORIGINAL file under the same number (`./incremental.ts`).
 *
 * Why not pdf-lib's parser: it scans the file top to bottom and unpacks
 * object streams as it meets them — but in an encrypted file those streams
 * are ciphertext, and it needs the key before it has read the /Encrypt
 * dictionary. So the xref is read here (tables, streams, hybrid /XRefStm,
 * the /Prev chain — newest definition wins, as a reader resolves it), each
 * live object is parsed where the xref says it is, and objects packed in
 * object streams are read out of the decrypted stream. pdf-lib's own object
 * parser does the syntax.
 */

export class UnreadablePdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadablePdfError";
  }
}

type XrefEntry =
  | { type: 1; offset: number; gen: number }
  | { type: 2; stream: number; index: number };

export interface XrefInfo {
  /** Newest-first merge of every section: object number → where it lives. */
  entries: Map<number, XrefEntry>;
  /** The newest section's trailer (a table's `trailer`, or the stream's dict). */
  trailer: PDFDictT;
  /** Was the newest section a cross-reference STREAM? */
  usesXrefStream: boolean;
  /** Offset of the newest section: the update's /Prev. */
  startxref: number;
  /** Object numbers of cross-reference streams (never decrypted, never kept). */
  xrefStreams: Set<number>;
}

const ascii = new TextDecoder("latin1");

/*
 * Bounds on what a hostile file can make this reader do (lane l02 of the
 * hostile-input matrix). Every loop below is driven by a number the file
 * states, so each is clamped by something the file must also CONTAIN, and
 * every inflate stops at what the reader needs. `security-bounds.test.ts`
 * holds each bound to its finding, and `security-legit-headroom.test.ts`
 * measures the real-producer corpus against the same numbers.
 */

/**
 * ISO 32000-1 Annex C.2 (PDF 1.7 implementation limits): at most 8,388,607
 * indirect objects in a file. A cross-reference that maps more is not one a
 * conforming reader is expected to hold.
 */
export const MAX_XREF_OBJECTS = 8_388_607;

/**
 * Cross-reference entries a file of `fileBytes` may map: one per 4 bytes,
 * never fewer than 65,536, never more than {@link MAX_XREF_OBJECTS}. An
 * in-use object costs at least its `n 0 obj` header or, packed, its
 * `num offset` pair in an object stream. The real-producer corpus spends 312
 * bytes or more per entry (`security-legit-headroom.test.ts`), a 78x margin
 * over 4; the floor keeps every small file's ordinary free list.
 */
export function xrefEntryLimit(fileBytes: number): number {
  return Math.min(
    MAX_XREF_OBJECTS,
    Math.max(65_536, Math.floor(fileBytes / 4)),
  );
}

/**
 * What all of one document's object streams together may inflate to: 32x
 * the file, at least 32 MiB, at most 512 MiB. Object streams hold only
 * dictionaries, arrays and numbers (never streams); a deflate bomb (up to
 * 1,032x) is refused long before it costs the tab its memory. The corpus
 * inflates its object streams to at most 0.15x its file size
 * (`security-legit-headroom.test.ts`), a 200x margin under 32x.
 */
export function objectStreamBudget(fileBytes: number): number {
  return Math.min(512 * 2 ** 20, Math.max(32 * 2 ** 20, 32 * fileBytes));
}

/**
 * Inflate `stream` one filter at a time, each stage stopped after `cap`
 * bytes, so neither a bomb nor a chain of them (a stage that consumes
 * gigabytes to emit nothing) can grow past the cap. `overflow` says the
 * stream had more to give than `cap`.
 */
function decodeCapped(
  lib: PdfLibModule,
  stream: PDFRawStreamT,
  cap: number,
): { data: Uint8Array; overflow: boolean } {
  const filter = stream.dict.lookup(lib.PDFName.of("Filter"));
  const parms = stream.dict.lookup(lib.PDFName.of("DecodeParms"));
  const stages: PDFObject[] =
    filter instanceof lib.PDFArray
      ? filter.asArray()
      : filter === undefined
        ? []
        : [filter];
  let data = stream.contents;
  for (let i = 0; i < stages.length; i += 1) {
    const dict = lib.PDFDict.withContext(stream.dict.context);
    dict.set(lib.PDFName.of("Filter"), stages[i]!);
    const p =
      filter instanceof lib.PDFArray
        ? parms instanceof lib.PDFArray
          ? parms.lookup(i)
          : undefined
        : parms;
    if (p instanceof lib.PDFDict) dict.set(lib.PDFName.of("DecodeParms"), p);
    const decoder = lib.decodePDFRawStream(lib.PDFRawStream.of(dict, data));
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total <= cap) {
      const want = Math.min(1 << 16, cap + 1 - total);
      const got = decoder.getBytes(want);
      if (got.length > 0) chunks.push(new Uint8Array(got));
      total += got.length;
      if (got.length < want) break;
    }
    // Past the cap, a middle stage's output is cut-off input to the next, so
    // only the last stage's first `cap` bytes are worth handing back.
    if (total > cap && i < stages.length - 1)
      return { data: new Uint8Array(0), overflow: true };
    data = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      data.set(c, at);
      at += c.length;
    }
  }
  if (data.length > cap) return { data: data.subarray(0, cap), overflow: true };
  return { data, overflow: false };
}

/** Where each `n g obj` header is (the last one wins): the reader's recovery. */
function scanObjectHeaders(bytes: Uint8Array): Map<number, number> {
  const found = new Map<number, number>();
  const re =
    /(?<![0-9])(\d{1,10})[\0\t\n\f\r ]+\d{1,5}[\0\t\n\f\r ]+obj(?![A-Za-z0-9])/g;
  for (const m of ascii.decode(bytes).matchAll(re))
    found.set(Number(m[1]), m.index);
  return found;
}

function lastIndexOf(bytes: Uint8Array, word: string, before = bytes.length) {
  const w = [...word].map((c) => c.charCodeAt(0));
  outer: for (
    let i = Math.min(before, bytes.length) - w.length;
    i >= 0;
    i -= 1
  ) {
    for (let j = 0; j < w.length; j += 1)
      if (bytes[i + j] !== w[j]) continue outer;
    return i;
  }
  return -1;
}

function indexOf(bytes: Uint8Array, word: string, from: number) {
  const w = [...word].map((c) => c.charCodeAt(0));
  outer: for (let i = from; i <= bytes.length - w.length; i += 1) {
    for (let j = 0; j < w.length; j += 1)
      if (bytes[i + j] !== w[j]) continue outer;
    return i;
  }
  return -1;
}

const HEADER = /^[\0\t\n\f\r ]*(\d+)[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+obj/;

/** Parse the indirect object whose header starts at `offset`. */
function parseAt(
  lib: PdfLibModule,
  context: PDFContext,
  bytes: Uint8Array,
  offset: number,
): { num: number; gen: number; object: PDFObject } {
  const head = ascii.decode(bytes.subarray(offset, offset + 48));
  const m = HEADER.exec(head);
  if (!m) throw new UnreadablePdfError(`No object at offset ${offset}.`);
  const parser = lib.PDFObjectParser.forBytes(
    bytes.subarray(offset + m[0].length),
    context,
  );
  return { num: Number(m[1]), gen: Number(m[2]), object: parser.parseObject() };
}

function num(
  obj: PDFObject | undefined,
  lib: PdfLibModule,
): number | undefined {
  return obj instanceof lib.PDFNumber ? obj.asNumber() : undefined;
}

/**
 * Undo a PNG predictor (/DecodeParms /Predictor 10–15), which pdf-lib's
 * decoder does not: almost every producer writes xref streams with one.
 */
function unpredict(
  lib: PdfLibModule,
  dict: PDFDictT,
  data: Uint8Array,
): Uint8Array {
  const parms = dict.lookup(lib.PDFName.of("DecodeParms"));
  const p = parms instanceof lib.PDFArray ? parms.lookup(0) : parms;
  if (!(p instanceof lib.PDFDict)) return data;
  const predictor = num(p.get(lib.PDFName.of("Predictor")), lib) ?? 1;
  if (predictor < 10) {
    if (predictor !== 1)
      throw new UnreadablePdfError(`Predictor ${predictor} is not supported.`);
    return data;
  }
  const colors = num(p.get(lib.PDFName.of("Colors")), lib) ?? 1;
  const bpc = num(p.get(lib.PDFName.of("BitsPerComponent")), lib) ?? 8;
  const columns = num(p.get(lib.PDFName.of("Columns")), lib) ?? 1;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLength = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  for (let r = 0; r < rows; r += 1) {
    const type = data[r * (rowLength + 1)]!;
    const src = r * (rowLength + 1) + 1;
    const dst = r * rowLength;
    for (let i = 0; i < rowLength; i += 1) {
      const raw = data[src + i]!;
      const left = i >= bpp ? out[dst + i - bpp]! : 0;
      const up = r > 0 ? out[dst - rowLength + i]! : 0;
      const upLeft = r > 0 && i >= bpp ? out[dst - rowLength + i - bpp]! : 0;
      let v = raw;
      if (type === 1) v = raw + left;
      else if (type === 2) v = raw + up;
      else if (type === 3) v = raw + ((left + up) >> 1);
      else if (type === 4) {
        const base = left + up - upLeft;
        const pa = Math.abs(base - left);
        const pb = Math.abs(base - up);
        const pc = Math.abs(base - upLeft);
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

function readStartxref(bytes: Uint8Array): number {
  const at = lastIndexOf(bytes, "startxref");
  if (at < 0) throw new UnreadablePdfError("No startxref.");
  const m = /^startxref[\0\t\n\f\r ]+(\d+)/.exec(
    ascii.decode(bytes.subarray(at, at + 40)),
  );
  if (!m) throw new UnreadablePdfError("Bad startxref.");
  return Number(m[1]);
}

/** Read every cross-reference section, newest first. */
export async function readXref(
  lib: PdfLibModule,
  bytes: Uint8Array,
): Promise<XrefInfo> {
  const context = lib.PDFContext.create();
  const entries = new Map<number, XrefEntry>();
  const xrefStreams = new Set<number>();
  const startxref = readStartxref(bytes);
  let newest: { trailer: PDFDictT; stream: boolean } | null = null;
  const seen = new Set<number>();
  const queue: number[] = [startxref];
  const limit = xrefEntryLimit(bytes.length);

  const addStream = (offset: number): PDFDictT => {
    const { num: n, object } = parseAt(lib, context, bytes, offset);
    if (!(object instanceof lib.PDFRawStream))
      throw new UnreadablePdfError(
        "The cross-reference stream is not a stream.",
      );
    xrefStreams.add(n);
    const dict = object.dict;
    const w = (dict.lookup(lib.PDFName.of("W"), lib.PDFArray) as PDFArrayT)
      .asArray()
      .map((x) => num(x, lib) ?? 0);
    const size = num(dict.get(lib.PDFName.of("Size")), lib) ?? 0;
    const index = dict.get(lib.PDFName.of("Index"));
    const ranges =
      index instanceof lib.PDFArray
        ? index.asArray().map((x) => num(x, lib) ?? 0)
        : [0, size];
    const [w0 = 0, w1 = 0, w2 = 0] = w;
    const rowLength = w0 + w1 + w2;
    // A field wider than 8 bytes is past what a number holds; a zero-width
    // row reads nothing, so its /Index count alone would drive the loop.
    if (w.some((x) => !Number.isInteger(x) || x < 0 || x > 8))
      throw new UnreadablePdfError("The cross-reference stream's /W is bad.");
    if (rowLength === 0)
      throw new UnreadablePdfError("The cross-reference rows are empty.");
    let rowsWanted = 0;
    for (let r = 1; r < ranges.length; r += 2)
      if (Number.isFinite(ranges[r]!) && ranges[r]! > 0)
        rowsWanted += ranges[r]!;
    // Inflate only the rows the reader will use (+1 byte a row: a PNG
    // predictor's tag), and never more rows than the file can hold.
    const cap = Math.min(rowsWanted, limit + 1) * (rowLength + 1);
    const data = unpredict(lib, dict, decodeCapped(lib, object, cap).data);
    const field = (at: number, width: number) => {
      let v = 0;
      for (let i = 0; i < width; i += 1) v = v * 256 + (data[at + i] ?? 0);
      return v;
    };
    let row = 0;
    for (let r = 0; r + 1 < ranges.length; r += 2) {
      const first = ranges[r]!;
      const count = ranges[r + 1]!;
      for (let i = 0; i < count; i += 1, row += 1) {
        const at = row * rowLength;
        if (at + rowLength > data.length) break;
        const type = w0 === 0 ? 1 : field(at, w0);
        const b = field(at + w0, w1);
        const c = field(at + w0 + w1, w2);
        const n = first + i;
        if (entries.has(n)) continue;
        if (type === 1) entries.set(n, { type: 1, offset: b, gen: c });
        else if (type === 2) entries.set(n, { type: 2, stream: b, index: c });
        else if (type === 0) entries.set(n, { type: 1, offset: -1, gen: c });
        if (entries.size > limit)
          throw new UnreadablePdfError(
            "The cross-reference maps more objects than the file can hold.",
          );
      }
    }
    return dict;
  };

  const addTable = (offset: number): PDFDictT => {
    const trailerAt = indexOf(bytes, "trailer", offset + 4);
    if (trailerAt < 0) throw new UnreadablePdfError("No trailer.");
    const tokens = ascii
      .decode(bytes.subarray(offset + 4, trailerAt))
      .trim()
      .split(/\s+/);
    let i = 0;
    while (i + 1 < tokens.length) {
      const first = Number(tokens[i]);
      const count = Number(tokens[i + 1]);
      i += 2;
      if (!Number.isInteger(first) || !Number.isInteger(count)) break;
      for (let k = 0; k < count && i + 2 < tokens.length; k += 1, i += 3) {
        const n = first + k;
        if (entries.has(n)) continue;
        const off = Number(tokens[i]);
        const gen = Number(tokens[i + 1]);
        entries.set(n, {
          type: 1,
          offset: tokens[i + 2] === "n" ? off : -1,
          gen,
        });
      }
    }
    const dict = lib.PDFObjectParser.forBytes(
      bytes.subarray(trailerAt + "trailer".length),
      context,
    ).parseObject();
    if (!(dict instanceof lib.PDFDict))
      throw new UnreadablePdfError("Bad trailer.");
    return dict;
  };

  while (queue.length > 0) {
    const offset = queue.shift()!;
    if (seen.has(offset) || offset < 0 || offset >= bytes.length) continue;
    seen.add(offset);
    const isTable = ascii.decode(bytes.subarray(offset, offset + 4)) === "xref";
    const trailer = isTable ? addTable(offset) : addStream(offset);
    newest ??= { trailer, stream: !isTable };
    // A hybrid file's table section names its stream half: entries the
    // table does not carry come from it, before any older section.
    const xrefStm = num(trailer.get(lib.PDFName.of("XRefStm")), lib);
    if (isTable && xrefStm !== undefined) addStream(xrefStm);
    const prev = num(trailer.get(lib.PDFName.of("Prev")), lib);
    if (prev !== undefined) queue.push(prev);
  }
  if (!newest) throw new UnreadablePdfError("No cross-reference section.");
  return {
    entries,
    trailer: newest.trailer,
    usesXrefStream: newest.stream,
    startxref,
    xrefStreams,
  };
}

function bytesOf(lib: PdfLibModule, obj: PDFObject | undefined): Uint8Array {
  if (obj instanceof lib.PDFString || obj instanceof lib.PDFHexString)
    return obj.asBytes();
  return new Uint8Array(0);
}

function cryptMethod(
  lib: PdfLibModule,
  encrypt: PDFDictT,
  filterName: PDFObject | undefined,
  v: number,
): CryptMethod {
  if (v < 4) return "rc4";
  const name =
    filterName instanceof lib.PDFName ? filterName.decodeText() : "Identity";
  if (name === "Identity") return "identity";
  const cf = encrypt.lookup(lib.PDFName.of("CF"));
  const filter =
    cf instanceof lib.PDFDict ? cf.lookup(lib.PDFName.of(name)) : undefined;
  if (!(filter instanceof lib.PDFDict))
    throw new UnsupportedEncryptionError(`Crypt filter ${name} is missing.`);
  const cfm = filter.lookup(lib.PDFName.of("CFM"));
  const method = cfm instanceof lib.PDFName ? cfm.decodeText() : "None";
  if (method === "V2") return "rc4";
  if (method === "AESV2") return "aesv2";
  if (method === "AESV3") return "aesv3";
  if (method === "None") return "identity";
  throw new UnsupportedEncryptionError(
    `Crypt method ${method} is not supported.`,
  );
}

/** The /Encrypt dictionary as {@link EncryptParams}. */
export function encryptParams(
  lib: PdfLibModule,
  encrypt: PDFDictT,
  id: PDFObject | undefined,
): EncryptParams {
  const filter = encrypt.lookup(lib.PDFName.of("Filter"));
  if (!(filter instanceof lib.PDFName) || filter.decodeText() !== "Standard")
    throw new UnsupportedEncryptionError(
      "Only the Standard (password) security handler is supported.",
    );
  const get = (key: string) => encrypt.lookup(lib.PDFName.of(key));
  const v = num(get("V"), lib) ?? 0;
  const r = num(get("R"), lib) ?? 0;
  const id0 =
    id instanceof lib.PDFArray ? bytesOf(lib, id.lookup(0)) : new Uint8Array(0);
  const em = get("EncryptMetadata");
  const p = (num(get("P"), lib) ?? 0) | 0;
  return {
    v,
    r,
    lengthBits: num(get("Length"), lib) ?? (v === 1 ? 40 : 128),
    o: bytesOf(lib, get("O")),
    u: bytesOf(lib, get("U")),
    oe: bytesOf(lib, get("OE")),
    ue: bytesOf(lib, get("UE")),
    perms: bytesOf(lib, get("Perms")),
    p,
    encryptMetadata: !(em instanceof lib.PDFBool) || em.asBoolean(),
    stream: cryptMethod(lib, encrypt, get("StmF"), v),
    string: cryptMethod(lib, encrypt, get("StrF"), v),
    id0,
  };
}

function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** What is never encrypted (ISO 32000-1 §7.6.1, §7.6.3.1, §12.8.1). */
function streamIsPlain(
  lib: PdfLibModule,
  dict: PDFDictT,
  params: EncryptParams,
): boolean {
  const type = dict.lookup(lib.PDFName.of("Type"));
  if (type === lib.PDFName.of("XRef")) return true;
  if (type === lib.PDFName.of("Metadata") && !params.encryptMetadata)
    return true;
  const f = dict.lookup(lib.PDFName.of("Filter"));
  const first = f instanceof lib.PDFArray ? f.lookup(0) : f;
  return first === lib.PDFName.of("Crypt");
}

/**
 * Apply `transform` to every string and stream body of an object — the walk
 * decryption and encryption share. Returns a NEW object; dictionaries keep
 * their key order. A signature's /Contents (a dict with /ByteRange) is left
 * as it is.
 */
export async function mapCrypt(
  lib: PdfLibModule,
  context: PDFContext,
  object: PDFObject,
  params: EncryptParams,
  transform: (
    kind: "string" | "stream",
    data: Uint8Array,
  ) => Promise<Uint8Array>,
  remap: (ref: PDFRefT) => PDFRefT = (ref) => ref,
): Promise<PDFObject> {
  const walk = async (
    obj: PDFObject,
    skipStrings = false,
  ): Promise<PDFObject> => {
    if (obj instanceof lib.PDFRef) return remap(obj);
    if (obj instanceof lib.PDFString || obj instanceof lib.PDFHexString) {
      if (skipStrings) return obj;
      return lib.PDFHexString.of(hex(await transform("string", obj.asBytes())));
    }
    if (obj instanceof lib.PDFArray) {
      const out = lib.PDFArray.withContext(context);
      for (const item of obj.asArray()) out.push(await walk(item, skipStrings));
      return out;
    }
    if (obj instanceof lib.PDFStream) {
      const dict = (await walk(obj.dict)) as PDFDictT;
      const contents = obj.getContents();
      const body = streamIsPlain(lib, obj.dict, params)
        ? contents
        : await transform("stream", contents);
      return lib.PDFRawStream.of(dict, body);
    }
    if (obj instanceof lib.PDFDict) {
      const out = lib.PDFDict.withContext(context);
      const signature = obj.has(lib.PDFName.of("ByteRange"));
      for (const [key, value] of obj.entries()) {
        const plain = signature && key === lib.PDFName.of("Contents");
        out.set(key, plain ? value : await walk(value, skipStrings));
      }
      return out;
    }
    return obj;
  };
  return walk(object);
}

/** A decrypted document: pdf-lib's context, numbers as in the file. */
export interface DecryptedDocument {
  context: PDFContext;
  xref: XrefInfo;
  /** The /Encrypt dictionary's object number, when it is indirect. */
  encryptRef: PDFRefT | null;
}

/** Open the file's /Encrypt with `password` (default: the empty password). */
export async function openHandler(
  bytes: Uint8Array,
  password = "",
): Promise<{
  handler: StandardSecurityHandler | null;
  xref: XrefInfo;
  params: EncryptParams;
}> {
  const lib = await loadPdfLib();
  const xref = await readXref(lib, bytes);
  const scratch = lib.PDFContext.create();
  let encrypt = xref.trailer.get(lib.PDFName.of("Encrypt"));
  if (encrypt instanceof lib.PDFRef) {
    const entry = xref.entries.get(encrypt.objectNumber);
    if (!entry || entry.type !== 1 || entry.offset < 0)
      throw new UnreadablePdfError("The /Encrypt dictionary is missing.");
    encrypt = parseAt(lib, scratch, bytes, entry.offset).object;
  }
  if (!(encrypt instanceof lib.PDFDict))
    throw new UnreadablePdfError("This PDF is not encrypted.");
  const params = encryptParams(
    lib,
    encrypt,
    xref.trailer.get(lib.PDFName.of("ID")),
  );
  return {
    handler: await StandardSecurityHandler.open(params, password),
    xref,
    params,
  };
}

/**
 * Throw when an object the xref names, but that could not be read, is
 * reachable from /Root: the plain copy would silently lack it (a page, its
 * resources), and a document missing part of itself is not "opened".
 */
function refuseIfReachable(
  lib: PdfLibModule,
  context: PDFContext,
  trailer: PDFDictT,
  lost: Set<number>,
): void {
  const seen = new Set<number>();
  const stack: PDFObject[] = [];
  const root = trailer.get(lib.PDFName.of("Root"));
  if (root) stack.push(root);
  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (obj instanceof lib.PDFRef) {
      const n = obj.objectNumber;
      if (lost.has(n))
        throw new UnreadablePdfError(`Object ${n} of this PDF is unreadable.`);
      if (seen.has(n)) continue;
      seen.add(n);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof lib.PDFArray) {
      for (const item of obj.asArray()) stack.push(item);
    } else if (obj instanceof lib.PDFStream) {
      stack.push(obj.dict);
    } else if (obj instanceof lib.PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    }
  }
}

/** Decrypt every live object of `bytes` with `handler`. */
export async function decryptDocument(
  bytes: Uint8Array,
  handler: StandardSecurityHandler,
  xref: XrefInfo,
): Promise<DecryptedDocument> {
  const lib = await loadPdfLib();
  const context = lib.PDFContext.create();
  const params = handler.params;
  const encryptEntry = xref.trailer.get(lib.PDFName.of("Encrypt"));
  const encryptRef = encryptEntry instanceof lib.PDFRef ? encryptEntry : null;

  // Every stream's /Length, resolved where it is an indirect number: pdf-lib
  // falls back to scanning for `endstream` there, which can take an EOL in.
  const lengthOf = (dict: PDFDictT): number | undefined => {
    const length = dict.get(lib.PDFName.of("Length"));
    if (length instanceof lib.PDFNumber) return length.asNumber();
    if (!(length instanceof lib.PDFRef)) return undefined;
    const entry = xref.entries.get(length.objectNumber);
    if (!entry || entry.type !== 1 || entry.offset < 0) return undefined;
    try {
      return num(parseAt(lib, context, bytes, entry.offset).object, lib);
    } catch {
      return undefined;
    }
  };

  const decryptTop = async (n: number, gen: number, object: PDFObject) => {
    let obj = object;
    if (obj instanceof lib.PDFRawStream) {
      const length = lengthOf(obj.dict);
      if (length !== undefined && length < obj.contents.length)
        obj = lib.PDFRawStream.of(obj.dict, obj.contents.subarray(0, length));
    }
    return mapCrypt(lib, context, obj, params, (kind, data) =>
      handler.decrypt(kind, n, gen, data),
    );
  };

  // Object streams, decrypted and split once each.
  const objStreams = new Map<number, Map<number, PDFObject>>();
  let inflateLeft = objectStreamBudget(bytes.length);
  const unpack = async (streamNum: number): Promise<Map<number, PDFObject>> => {
    const done = objStreams.get(streamNum);
    if (done) return done;
    const out = new Map<number, PDFObject>();
    objStreams.set(streamNum, out);
    const entry = xref.entries.get(streamNum);
    if (!entry || entry.type !== 1 || entry.offset < 0) return out;
    const { gen, object } = parseAt(lib, context, bytes, entry.offset);
    const stream = await decryptTop(streamNum, gen, object);
    if (!(stream instanceof lib.PDFRawStream)) return out;
    const inflated = decodeCapped(lib, stream, inflateLeft);
    if (inflated.overflow)
      throw new UnreadablePdfError(
        "An object stream inflates past what this file can hold.",
      );
    inflateLeft -= inflated.data.length;
    const data = unpredict(lib, stream.dict, inflated.data);
    const n = num(stream.dict.get(lib.PDFName.of("N")), lib) ?? 0;
    const first = num(stream.dict.get(lib.PDFName.of("First")), lib) ?? 0;
    const firstAt =
      Number.isInteger(first) && first >= 0 ? Math.min(first, data.length) : 0;
    const head = ascii.decode(data.subarray(0, firstAt)).trim().split(/\s+/);
    // /N is a claim; the header's pairs are what the stream holds.
    const pairs = Math.min(
      Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0,
      Math.floor(head.length / 2),
    );
    for (let i = 0; i < pairs; i += 1) {
      const objNum = Number(head[i * 2]);
      const at = firstAt + Number(head[i * 2 + 1]);
      if (!Number.isInteger(objNum) || !Number.isInteger(at)) continue;
      if (objNum < 0 || at < firstAt || at >= data.length) continue;
      try {
        out.set(
          objNum,
          lib.PDFObjectParser.forBytes(
            data.subarray(at),
            context,
          ).parseObject(),
        );
      } catch {
        // One unparsable member does not lose the others.
      }
    }
    return out;
  };

  // Objects the xref names that nothing here could read. An unreachable one
  // (a stale entry) costs nothing; a reachable one would leave a copy with
  // less in it than the file, so it is refused below.
  const lost = new Set<number>();
  let headers: Map<number, number> | null = null;
  const parseObject = (n: number, offset: number) => {
    try {
      const parsed = parseAt(lib, context, bytes, offset);
      return parsed.num === n ? parsed : null;
    } catch {
      return null;
    }
  };

  for (const [n, entry] of xref.entries) {
    if (n === 0 || xref.xrefStreams.has(n)) continue;
    if (entry.type === 1) {
      if (entry.offset < 0) continue;
      let parsed = parseObject(n, entry.offset);
      if (!parsed) {
        // A wrong offset is recovered as pdf.js recovers it: by the object's
        // own `n g obj` header, the last one in the file.
        headers ??= scanObjectHeaders(bytes);
        const at = headers.get(n);
        if (at !== undefined && at !== entry.offset)
          parsed = parseObject(n, at);
      }
      if (!parsed) {
        lost.add(n);
        continue;
      }
      const object = parsed.object;
      if (object instanceof lib.PDFRawStream) {
        const type = object.dict.lookup(lib.PDFName.of("Type"));
        // Containers, not objects: their members are assigned below.
        if (
          type === lib.PDFName.of("ObjStm") ||
          type === lib.PDFName.of("XRef")
        )
          continue;
      }
      const ref = lib.PDFRef.of(n, entry.gen);
      if (encryptRef && n === encryptRef.objectNumber) {
        context.assign(ref, object);
        continue;
      }
      context.assign(ref, await decryptTop(n, entry.gen, object));
    } else {
      const members = await unpack(entry.stream);
      const object = members.get(n);
      if (object) context.assign(lib.PDFRef.of(n, 0), object);
      else lost.add(n);
    }
  }
  if (lost.size > 0) refuseIfReachable(lib, context, xref.trailer, lost);

  const get = (key: string) => xref.trailer.get(lib.PDFName.of(key));
  context.trailerInfo = {
    Root: get("Root"),
    Info: get("Info"),
    ID: get("ID"),
  } as PDFContext["trailerInfo"];
  // Nothing beyond the file's own numbering is free.
  const size = num(get("Size"), lib) ?? 0;
  context.largestObjectNumber = Math.max(context.largestObjectNumber, size - 1);
  return { context, xref, encryptRef };
}

/** The decrypted document as plain PDF bytes (no /Encrypt), numbers kept. */
export async function writePlain(doc: DecryptedDocument): Promise<Uint8Array> {
  const lib = await loadPdfLib();
  const { context, encryptRef } = doc;
  if (encryptRef) context.delete(encryptRef);
  return lib.PDFWriter.forContext(context, Infinity).serializeToBuffer();
}
