/**
 * Generators for the security-in-browser hostile matrix
 * (the security-in-browser matrix (branch test/hostile-matrix, not merged)). The family's own file: the shared
 * `./fixtures.ts` belongs to every family and is not edited from here.
 *
 * Every file is GENERATED in code: deterministic, small on disk, never
 * downloaded. Each builder states the one property it is hostile in;
 * everything else about the file is well-formed, so a refusal is a refusal of
 * THAT property and not of some accident of the fixture.
 *
 *  - {@link rawPdf}: objects numbered 1..n behind a classic xref table whose
 *    offsets are real unless the caller lies on purpose.
 *  - {@link xrefStreamPdf}: the same objects behind a cross-reference STREAM
 *    (no classic table), optionally with some packed in an object stream.
 *  - {@link ownerOnlyEncrypted}: either layout, encrypted with the Standard
 *    handler R3 / RC4-128 and an EMPTY user password (opens anywhere, editing
 *    restricted) — so a structural hostility reaches past the "not encrypted"
 *    early exit of the in-browser security handler.
 *  - {@link zeroBomb}: a zlib stream that inflates to N MiB of zeros, built
 *    from repeated full-flush blocks so the generator never holds N MiB.
 */
import { createHash } from "node:crypto";
import { deflateRawSync, deflateSync, constants as zc } from "node:zlib";

export const latin1 = (s: string): Uint8Array =>
  Uint8Array.from(Buffer.from(s, "latin1"));

export const text = (b: Uint8Array): string =>
  Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An object body: a plain string, or a dictionary with a stream. */
export type RawObject =
  | string
  | {
      /** The dictionary WITHOUT `<<`/`>>` and without /Length (added). */
      dict: string;
      stream: Uint8Array;
      /** Write this /Length instead of the real one (a lie on purpose). */
      length?: string;
    };

export interface RawPdfOptions {
  objects: RawObject[];
  /** Header line, default `%PDF-1.7`. */
  header?: string;
  /** Extra trailer entries, appended after `/Size N /Root 1 0 R`. */
  trailer?: string;
  /** Replace the whole trailer dictionary body (no `<<`/`>>`). */
  trailerBody?: string;
  /** Write this after `startxref` instead of the real offset. */
  startxref?: string;
  /** Rewrite each real offset before it is written (lies on purpose). */
  offset?: (real: number, objectNumber: number) => number;
  /** Object number for each body (default 1..n). Duplicates are allowed. */
  numbers?: number[];
  /** Replace the xref table text (between `xref\n` and `trailer`). */
  table?: string;
}

function objectBytes(num: number, obj: RawObject): Uint8Array {
  if (typeof obj === "string") return latin1(`${num} 0 obj\n${obj}\nendobj\n`);
  const len = obj.length ?? String(obj.stream.length);
  return concatBytes(
    latin1(`${num} 0 obj\n<< ${obj.dict} /Length ${len} >>\nstream\n`),
    obj.stream,
    latin1("\nendstream\nendobj\n"),
  );
}

/** Where the classic xref of {@link rawPdf} output starts. */
export function startxrefOf(bytes: Uint8Array): number {
  const t = text(bytes);
  const m = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(t);
  if (!m) throw new Error("no startxref");
  return Number(m[1]);
}

/** Objects 1..n behind a classic xref table. */
export function rawPdf(opts: RawPdfOptions): Uint8Array {
  const parts: Uint8Array[] = [
    latin1(`${opts.header ?? "%PDF-1.7"}\n%\xe2\xe3\xcf\xd3\n`),
  ];
  let length = parts[0]!.length;
  const offsets = new Map<number, number>();
  opts.objects.forEach((obj, i) => {
    const num = opts.numbers?.[i] ?? i + 1;
    const bytes = objectBytes(num, obj);
    // A duplicate number: the FIRST definition is the one the table names.
    if (!offsets.has(num)) offsets.set(num, length);
    parts.push(bytes);
    length += bytes.length;
  });
  const max = Math.max(0, ...offsets.keys());
  const xrefAt = length;
  let table = `0 ${max + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= max; n += 1) {
    const real = offsets.get(n);
    if (real === undefined) table += "0000000000 00000 f \n";
    else {
      const off = opts.offset ? opts.offset(real, n) : real;
      table += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
  }
  const body =
    opts.trailerBody ?? `/Size ${max + 1} /Root 1 0 R ${opts.trailer ?? ""}`;
  const xref =
    `xref\n${opts.table ?? table}trailer\n<< ${body} >>\n` +
    `startxref\n${opts.startxref ?? xrefAt}\n%%EOF\n`;
  parts.push(latin1(xref));
  return concatBytes(...parts);
}

export interface XrefStreamOptions {
  objects: RawObject[];
  header?: string;
  /** Extra entries in the xref stream's dictionary. */
  trailer?: string;
  /** Replace /W (default `[1 4 2]`). Rows are still written as [1 4 2]. */
  w?: string;
  /** Replace /Size (default the real one). */
  size?: string;
  /** /Index, written verbatim when given. */
  index?: string;
  /** 1-based object numbers to pack into ONE object stream. Strings only. */
  pack?: number[];
  /** Lies in the object stream's dictionary. */
  objStmN?: string;
  objStmFirst?: string;
  /** Replace the xref stream body entirely. */
  xrefBody?: Uint8Array;
  /** Extra dictionary text for the xref stream (e.g. a /Filter). */
  xrefDict?: string;
  startxref?: string;
  /** Encrypt hook: stream bodies (and the object stream) pass through it. */
  seal?: (num: number, data: Uint8Array) => Uint8Array;
}

/** Objects behind a cross-reference STREAM, with an optional object stream. */
export function xrefStreamPdf(opts: XrefStreamOptions): Uint8Array {
  const seal = opts.seal ?? ((_n: number, d: Uint8Array) => d);
  const n = opts.objects.length;
  const packed = new Set(opts.pack ?? []);
  const objStmNum = packed.size > 0 ? n + 1 : 0;
  const xrefNum = (objStmNum || n) + 1;
  const parts: Uint8Array[] = [
    latin1(`${opts.header ?? "%PDF-1.7"}\n%\xe2\xe3\xcf\xd3\n`),
  ];
  let length = parts[0]!.length;
  const rows: [number, number, number][] = [[0, 0, 0xffff]];
  const inStream: { num: number; body: string }[] = [];
  opts.objects.forEach((obj, i) => {
    const num = i + 1;
    if (packed.has(num)) {
      if (typeof obj !== "string") throw new Error("only dicts can be packed");
      rows.push([2, objStmNum, inStream.length]);
      inStream.push({ num, body: obj });
      return;
    }
    const sealed: RawObject =
      typeof obj === "string" ? obj : { ...obj, stream: seal(num, obj.stream) };
    const bytes = objectBytes(num, sealed);
    rows.push([1, length, 0]);
    parts.push(bytes);
    length += bytes.length;
  });
  if (objStmNum) {
    let data = "";
    const within: string[] = [];
    for (const m of inStream) {
      within.push(`${m.num} ${data.length}`);
      data += `${m.body}\n`;
    }
    const head = `${within.join(" ")}\n`;
    const body = seal(objStmNum, latin1(head + data));
    const bytes = objectBytes(objStmNum, {
      dict: `/Type /ObjStm /N ${opts.objStmN ?? inStream.length} /First ${opts.objStmFirst ?? head.length}`,
      stream: body,
    });
    rows.push([1, length, 0]);
    parts.push(bytes);
    length += bytes.length;
  }
  const xrefAt = length;
  rows.push([1, xrefAt, 0]);
  const table = new Uint8Array(rows.length * 7);
  rows.forEach(([t, a, b], i) => {
    const v = new DataView(table.buffer, i * 7, 7);
    v.setUint8(0, t);
    v.setUint32(1, a);
    v.setUint16(5, b);
  });
  const body = opts.xrefBody ?? table;
  const dict =
    `/Type /XRef /Size ${opts.size ?? rows.length} /W ${opts.w ?? "[1 4 2]"} ` +
    `${opts.index ? `/Index ${opts.index} ` : ""}/Root 1 0 R ${opts.xrefDict ?? ""} ${opts.trailer ?? ""}`;
  parts.push(objectBytes(xrefNum, { dict, stream: body }));
  parts.push(latin1(`startxref\n${opts.startxref ?? xrefAt}\n%%EOF\n`));
  return concatBytes(...parts);
}

/** Where the xref STREAM of {@link xrefStreamPdf} output starts. */
export const xrefStreamOffsetOf = startxrefOf;

/* ------------------------------------------------------------------ *
 *  A minimal well-formed document, and the Standard handler R3.
 * ------------------------------------------------------------------ */

/** Catalog, Pages, one Page with a tiny content stream. */
export const ONE_PAGE: RawObject[] = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
  { dict: "", stream: latin1("0 0 m 100 100 l S") },
];

/** {@link ONE_PAGE} with one object replaced (1-based). */
export function onePageWith(replace: Record<number, RawObject>): RawObject[] {
  return ONE_PAGE.map((o, i) => replace[i + 1] ?? o);
}

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function md5(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function padPassword(pw: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  const n = Math.min(32, pw.length);
  out.set(pw.subarray(0, n));
  out.set(PAD.subarray(0, 32 - n), n);
  return out;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex").toUpperCase();

/** /P granting print only: opens freely, every change withheld. */
export const PRINT_ONLY_P = -3900;

export interface StandardR3 {
  /** The /Encrypt dictionary body (no `<<`/`>>`). */
  encryptDict: string;
  /** The trailer's /ID entry. */
  idEntry: string;
  /** Per-object RC4 for a stream or string body. */
  seal: (num: number, data: Uint8Array) => Uint8Array;
}

/** Standard handler R3, RC4-128, user password `user` (default empty). */
export function standardR3(
  owner = "hostile-owner",
  user = "",
  p = PRINT_ONLY_P,
): StandardR3 {
  const id = md5(latin1(`hostile ${owner} ${user}`));
  let h = md5(padPassword(latin1(owner)));
  for (let i = 0; i < 50; i++) h = md5(h);
  const okey = h.subarray(0, 16);
  let o = rc4(okey, padPassword(latin1(user)));
  for (let i = 1; i <= 19; i++)
    o = rc4(
      okey.map((b) => b ^ i),
      o,
    );
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, p, true);
  let k = md5(padPassword(latin1(user)), o, pBytes, id);
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, 16));
  const key = k.subarray(0, 16);
  let u = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++)
    u = rc4(
      key.map((b) => b ^ i),
      u,
    );
  const u32 = concatBytes(u, new Uint8Array(16));
  const seal = (num: number, data: Uint8Array) =>
    rc4(
      md5(
        key,
        Uint8Array.from([
          num & 0xff,
          (num >> 8) & 0xff,
          (num >> 16) & 0xff,
          0,
          0,
        ]),
      ).subarray(0, 16),
      data,
    );
  return {
    encryptDict: `/Filter /Standard /V 2 /R 3 /Length 128 /P ${p} /O <${hex(o)}> /U <${hex(u32)}>`,
    idEntry: `/ID [<${hex(id)}> <${hex(id)}>]`,
    seal,
  };
}

export interface OwnerOnlyOptions {
  layout?: "table" | "stream";
  header?: string;
  trailer?: string;
  /** 1-based object numbers to pack into an object stream (stream layout). */
  pack?: number[];
  objStmN?: string;
  objStmFirst?: string;
  owner?: string;
  user?: string;
  /** Replace the /Encrypt body (hostile handler parameters). */
  encryptDict?: (real: string) => string;
  /** Replace the /Encrypt entry of the trailer (e.g. a dangling ref). */
  encryptEntry?: (encNum: number) => string;
  /** Stream layout: replace the xref stream body / add to its dictionary. */
  xrefBody?: Uint8Array;
  xrefDict?: string;
}

/**
 * `objects` encrypted with an EMPTY user password (R3), or with `user`. The
 * /Encrypt dictionary is appended as the last object. Stream bodies are sealed
 * with their object key, and every `{{S:text}}` in a string object becomes
 * that text as a hex string sealed with its object key (in an object stream:
 * plain, since the stream itself is sealed).
 */
export function ownerOnlyEncrypted(
  objects: RawObject[],
  opts: OwnerOnlyOptions = {},
): Uint8Array {
  const r3 = standardR3(opts.owner, opts.user);
  const encNum = objects.length + 1;
  const encBody = opts.encryptDict
    ? opts.encryptDict(r3.encryptDict)
    : r3.encryptDict;
  const packed = new Set(opts.pack ?? []);
  const strings = (num: number, obj: string) =>
    obj.replace(/\{\{S:([^}]*)\}\}/g, (_m, s: string) =>
      packed.has(num)
        ? `<${hex(latin1(s))}>`
        : `<${hex(r3.seal(num, latin1(s)))}>`,
    );
  const all: RawObject[] = [
    ...objects.map((o, i) => (typeof o === "string" ? strings(i + 1, o) : o)),
    `<< ${encBody} >>`,
  ];
  const encryptEntry = opts.encryptEntry
    ? opts.encryptEntry(encNum)
    : `${encNum} 0 R`;
  const trailer = `/Encrypt ${encryptEntry} ${r3.idEntry} ${opts.trailer ?? ""}`;
  if (opts.layout === "stream" || opts.pack || opts.xrefBody) {
    return xrefStreamPdf({
      objects: all,
      trailer,
      seal: (n, d) => (n === encNum ? d : r3.seal(n, d)),
      ...(opts.header ? { header: opts.header } : {}),
      ...(opts.pack ? { pack: opts.pack } : {}),
      ...(opts.objStmN ? { objStmN: opts.objStmN } : {}),
      ...(opts.objStmFirst ? { objStmFirst: opts.objStmFirst } : {}),
      ...(opts.xrefBody ? { xrefBody: opts.xrefBody } : {}),
      ...(opts.xrefDict ? { xrefDict: opts.xrefDict } : {}),
    });
  }
  const sealed = all.map((obj, i) =>
    typeof obj === "string"
      ? obj
      : { ...obj, stream: r3.seal(i + 1, obj.stream) },
  );
  return rawPdf({
    objects: sealed,
    trailer,
    ...(opts.header ? { header: opts.header } : {}),
  });
}

/* ------------------------------------------------------------------ *
 *  Bytes that are not a PDF, or barely one.
 * ------------------------------------------------------------------ */

/** Deterministic pseudo-random bytes (xorshift32). */
export function noise(length: number, seed = 0x9e3779b9): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

export const NOT_PDF = {
  empty: () => new Uint8Array(0),
  png: () =>
    concatBytes(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      noise(256, 7),
    ),
  zip: () =>
    concatBytes(
      latin1("PK\x03\x04\x14\x00\x00\x00\x08\x00"),
      latin1("[Content_Types].xml"),
      noise(200, 11),
    ),
  random4k: () => noise(4096, 1234),
  html: () =>
    latin1("<!doctype html><html><body><h1>Not a PDF</h1></body></html>\n"),
  headerOnly: () => latin1("%PDF-1.7\n"),
};

/** `bytes` cut at `fraction` of its length. */
export const truncateAt = (bytes: Uint8Array, fraction: number) =>
  bytes.slice(0, Math.floor(bytes.length * fraction));

/** `bytes` cut right after its last `endobj` (no xref, no trailer). */
export function truncateAtLastEndobj(bytes: Uint8Array): Uint8Array {
  const at = text(bytes).lastIndexOf("endobj");
  if (at < 0) throw new Error("no endobj to cut at");
  return bytes.slice(0, at + "endobj\n".length);
}

/* ------------------------------------------------------------------ *
 *  Decompression bomb.
 * ------------------------------------------------------------------ */

/**
 * A zlib stream that inflates to `mebibytes` MiB of zeros. One MiB of zeros
 * is deflated once with Z_FULL_FLUSH (a non-final block that resets the
 * window, so it is byte-identical every time), repeated, then closed with a
 * final empty block and the Adler-32 of the whole.
 */
export function zeroBomb(mebibytes: number): Uint8Array {
  const block = new Uint8Array(
    deflateRawSync(Buffer.alloc(1 << 20), { finishFlush: zc.Z_FULL_FLUSH }),
  );
  const final = new Uint8Array(deflateRawSync(Buffer.alloc(0)));
  const total = mebibytes * (1 << 20);
  // Adler-32 of `total` zero bytes: a = 1, b = total mod 65521.
  const adler = (((total % 65521) << 16) | 1) >>> 0;
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler);
  const parts: Uint8Array[] = [Uint8Array.from([0x78, 0x9c])];
  for (let i = 0; i < mebibytes; i++) parts.push(block);
  parts.push(final, tail);
  return concatBytes(...parts);
}

/** Compress again: a second /FlateDecode layer over `inner`. */
export const reflate = (inner: Uint8Array): Uint8Array =>
  new Uint8Array(deflateSync(inner, { level: 9 }));

/* ------------------------------------------------------------------ *
 *  Page trees.
 * ------------------------------------------------------------------ */

/**
 * `pages` pages sharing ONE tiny content stream; Pages is object 2, the
 * content stream object 3, pages from 4.
 */
export function manyPageObjects(pages: number): RawObject[] {
  const kids: string[] = [];
  for (let i = 0; i < pages; i++) kids.push(`${i + 4} 0 R`);
  const objs: RawObject[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`,
    { dict: "", stream: latin1("0 0 m 10 10 l S") },
  ];
  for (let i = 0; i < pages; i++)
    objs.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 3 0 R >>",
    );
  return objs;
}

/**
 * A page tree `depth` levels deep: each intermediate Pages node has one kid.
 * Catalog 1, Pages nodes 2..depth+1, the page last.
 */
export function deepPageTreeObjects(depth: number): RawObject[] {
  const objs: RawObject[] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  for (let d = 0; d < depth; d++) {
    const num = d + 2;
    const parent = d === 0 ? "" : `/Parent ${num - 1} 0 R `;
    objs.push(`<< /Type /Pages ${parent}/Kids [${num + 1} 0 R] /Count 1 >>`);
  }
  objs.push(
    `<< /Type /Page /Parent ${depth + 1} 0 R /MediaBox [0 0 100 100] >>`,
  );
  return objs;
}

/**
 * Patch a fixed-width 10-digit placeholder `/Prev 0000000000` in `bytes`
 * with `value` — lengths are unchanged, so every offset stays true.
 */
export function patchPrev(
  bytes: Uint8Array,
  placeholder: string,
  value: number,
): Uint8Array {
  const t = text(bytes);
  const at = t.indexOf(placeholder);
  if (at < 0) throw new Error(`no ${placeholder}`);
  const digits = String(value).padStart(10, "0");
  if (digits.length !== 10) throw new Error("offset too wide");
  const out = bytes.slice();
  out.set(latin1(placeholder.replace(/0{10}$/, digits)), at);
  return out;
}
