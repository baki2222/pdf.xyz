/**
 * Raw PDF byte builders for the page-structure hostile family.
 *
 * Family-owned on purpose: a shared `fixtures.ts` existed briefly in this
 * directory and was moved by another family mid-sweep, which broke every
 * importer at once. These builders are small; owning them is cheaper than a
 * cross-family dependency nobody can see.
 *
 *  - {@link rawPdf}: objects numbered 1..n behind a classic xref table whose
 *    offsets are real unless the caller lies on purpose.
 *  - {@link xrefStreamPdf}: the same objects behind a cross-reference STREAM,
 *    optionally with some objects packed into one object stream.
 *  - {@link zeroBomb}: a zlib stream inflating to N MiB of zeros, built from
 *    one repeated full-flush block so the generator never holds N MiB.
 */
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

/** A plain object body, or a stream (dict WITHOUT `<<`/`>>` and /Length). */
export type RawObject =
  string | { dict: string; stream: Uint8Array; length?: string };

function objectBytes(num: number, obj: RawObject): Uint8Array {
  if (typeof obj === "string") return latin1(`${num} 0 obj\n${obj}\nendobj\n`);
  const len = obj.length ?? String(obj.stream.length);
  return concatBytes(
    latin1(`${num} 0 obj\n<< ${obj.dict} /Length ${len} >>\nstream\n`),
    obj.stream,
    latin1("\nendstream\nendobj\n"),
  );
}

const HEAD = (h?: string) => latin1(`${h ?? "%PDF-1.7"}\n%\xe2\xe3\xcf\xd3\n`);

export interface RawPdfOptions {
  objects: RawObject[];
  header?: string;
  /** Extra trailer entries after `/Size N /Root 1 0 R`. */
  trailer?: string;
  /** Write this after `startxref` instead of the real offset. */
  startxref?: string;
  /** Rewrite each real offset before it is written. */
  offset?: (real: number, num: number) => number;
  /** Object number per body (default 1..n); repeats allowed, last wins. */
  numbers?: number[];
}

export function rawPdf(opts: RawPdfOptions): Uint8Array {
  const parts: Uint8Array[] = [HEAD(opts.header)];
  let length = parts[0]!.length;
  const offsets = new Map<number, number>();
  opts.objects.forEach((obj, i) => {
    const num = opts.numbers?.[i] ?? i + 1;
    const bytes = objectBytes(num, obj);
    offsets.set(num, length);
    parts.push(bytes);
    length += bytes.length;
  });
  const max = Math.max(0, ...offsets.keys());
  const xrefAt = length;
  let xref = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= max; n += 1) {
    const real = offsets.get(n);
    if (real === undefined) xref += "0000000000 00000 f \n";
    else {
      const off = opts.offset ? opts.offset(real, n) : real;
      xref += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
  }
  xref += `trailer\n<< /Size ${max + 1} /Root 1 0 R ${opts.trailer ?? ""} >>\nstartxref\n${opts.startxref ?? xrefAt}\n%%EOF\n`;
  parts.push(latin1(xref));
  return concatBytes(...parts);
}

export interface XrefStreamOptions {
  objects: RawObject[];
  header?: string;
  /** Extra entries in the xref stream's dictionary. */
  trailer?: string;
  /** Written as /W (rows are still [1 4 2]). */
  w?: string;
  /** 1-based object numbers to pack into one object stream (dicts only). */
  pack?: number[];
  objStmN?: string;
  objStmFirst?: string;
}

export function xrefStreamPdf(opts: XrefStreamOptions): Uint8Array {
  const n = opts.objects.length;
  const packed = new Set(opts.pack ?? []);
  const objStmNum = packed.size > 0 ? n + 1 : 0;
  const xrefNum = (objStmNum || n) + 1;
  const parts: Uint8Array[] = [HEAD(opts.header)];
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
    const bytes = objectBytes(num, obj);
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
    const bytes = objectBytes(objStmNum, {
      dict: `/Type /ObjStm /N ${opts.objStmN ?? inStream.length} /First ${opts.objStmFirst ?? head.length}`,
      stream: latin1(head + data),
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
  const dict = `/Type /XRef /Size ${rows.length} /W ${opts.w ?? "[1 4 2]"} /Root 1 0 R ${opts.trailer ?? ""}`;
  parts.push(objectBytes(xrefNum, { dict, stream: table }));
  parts.push(latin1(`startxref\n${xrefAt}\n%%EOF\n`));
  return concatBytes(...parts);
}

/** Catalog, Pages, one Page with a tiny content stream. */
export const ONE_PAGE: RawObject[] = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
  { dict: "", stream: latin1("0 0 m 100 100 l S") },
];

export const onePagePdf = (): Uint8Array => rawPdf({ objects: ONE_PAGE });

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
      latin1("PK\x03\x04\x14\x00\x00\x00\x08\x00[Content_Types].xml"),
      noise(200, 11),
    ),
  random4k: () => noise(4096, 1234),
  html: () =>
    latin1("<!doctype html><html><body><h1>Not a PDF</h1></body></html>\n"),
  headerOnly: () => latin1("%PDF-1.7\n"),
};

export const truncateAt = (bytes: Uint8Array, fraction: number) =>
  bytes.slice(0, Math.floor(bytes.length * fraction));

/** `bytes` cut right after its last `endobj` (no xref, no trailer). */
export function truncateAtLastEndobj(bytes: Uint8Array): Uint8Array {
  const at = text(bytes).lastIndexOf("endobj");
  if (at < 0) throw new Error("no endobj to cut at");
  return bytes.slice(0, at + "endobj\n".length);
}

/** A zlib stream inflating to `mebibytes` MiB of zeros. */
export function zeroBomb(mebibytes: number): Uint8Array {
  const block = new Uint8Array(
    deflateRawSync(Buffer.alloc(1 << 20), { finishFlush: zc.Z_FULL_FLUSH }),
  );
  const final = new Uint8Array(deflateRawSync(Buffer.alloc(0)));
  const total = mebibytes * (1 << 20);
  const adler = (((total % 65521) << 16) | 1) >>> 0;
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler);
  const parts: Uint8Array[] = [Uint8Array.from([0x78, 0x9c])];
  for (let i = 0; i < mebibytes; i++) parts.push(block);
  parts.push(final, tail);
  return concatBytes(...parts);
}

/** A second /FlateDecode layer over `inner`. */
export const reflate = (inner: Uint8Array): Uint8Array =>
  new Uint8Array(deflateSync(inner, { level: 9 }));

/** `pages` pages sharing one content stream (Pages 2, content 3, pages 4..). */
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

/** A page tree `depth` Pages nodes deep, one kid each, the page last. */
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
