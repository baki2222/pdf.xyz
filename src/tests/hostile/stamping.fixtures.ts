/**
 * Hostile inputs for the STAMPING family (watermark text + image, page
 * numbers / Bates, header & footer, overlay, visual signature).
 *
 * Self-contained on purpose: this family's matrix must not move when another
 * family edits or renames a shared generator file, so it carries its own tiny
 * writer ({@link buildPdf}) and reuses only the repo's long-lived fixtures
 * (encrypted, restricted, broken CJK subset, damaged xref, malformed).
 * Every fixture is generated in code, deterministically and small, except the
 * Flate bombs and the 2,000-page document, which say `slow`.
 *
 * Each input carries the number of pages a correct reader finds (`pages`)
 * when the file is readable: the independent bound an "output" cell is held
 * to (a /Count of 2147483647 over one real page must come out as ONE page).
 *
 * Two shapes are here because of HOW the stamping engines work:
 *  - pdf-lib inflates every object stream at PARSE time, so a Flate bomb in
 *    an /ObjStm is a bomb for every stamping engine, while a bomb in a page
 *    content stream is never decoded by them (that cell is the contrast).
 *  - pdf-lib wraps a page's existing content in `q … Q` before appending the
 *    stamp. That balances an unclosed `q … cm`, but not a page that pops MORE
 *    than it pushes: `Q Q … cm` pops the wrapper's own `q`, so the `cm`
 *    outlives the page and the stamp may be drawn inside it.
 */

import { constants, deflateRawSync, deflateSync } from "node:zlib";
import { spliceStartxrefPastEnd } from "../damaged-xref";
import {
  ownerOnlyEncryptedPdf,
  ownerOnlyObjectStreamPdf,
  unknownHandlerObjectStreamPdf,
  userPasswordEncryptedPdf,
  userPasswordObjectStreamPdf,
} from "../encrypted-pdf-fixture";
import { BROKEN_CJK_SUBSET_PDF_BASE64 } from "../fixtures-broken-subset";
import { malformedPdfs } from "../malformed-pdf-fixtures";
import { readRestrictedFixture } from "../restricted-pdf-fixtures";
import { unsupportedEncryptionPdf } from "../unsupported-encryption";

const latin1 = (s: string): Uint8Array =>
  Uint8Array.from(Buffer.from(s, "latin1"));
const text = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

// ------------------------------------------------------------------ writer

/** One indirect object. For a stream, `body` is its dict WITHOUT /Length. */
export interface RawObject {
  num: number;
  body: string;
  stream?: Uint8Array;
}

export interface BuildOptions {
  header?: string;
  objects: readonly RawObject[];
  /** Extra trailer entries beside /Size and /Root 1 0 R. */
  trailer?: string;
  /** "shifted": every offset +7 (all wrong). "garbage": junk rows. "none": no xref/trailer. */
  xref?: "classic" | "none" | "shifted" | "garbage";
  startxref?: number;
}

/** Objects byte-for-byte as given, plus a classic xref (or a broken one). A
 * number defined twice is indexed at its LAST definition. */
export function buildPdf(options: BuildOptions): Uint8Array {
  const parts: Uint8Array[] = [
    latin1(`${options.header ?? "%PDF-1.7"}\n%\xe2\xe3\xcf\xd3\n`),
  ];
  let at = parts[0]!.byteLength;
  const offsets = new Map<number, number>();
  let maxNum = 0;
  for (const obj of options.objects) {
    offsets.set(obj.num, at);
    maxNum = Math.max(maxNum, obj.num);
    const chunk = obj.stream
      ? concat([
          latin1(
            `${obj.num} 0 obj\n${obj.body.replace(/>>\s*$/, ` /Length ${obj.stream.byteLength} >>`)}\nstream\n`,
          ),
          obj.stream,
          latin1("\nendstream\nendobj\n"),
        ])
      : latin1(`${obj.num} 0 obj\n${obj.body}\nendobj\n`);
    parts.push(chunk);
    at += chunk.byteLength;
  }
  const mode = options.xref ?? "classic";
  if (mode === "none") return concat(parts);
  let xref = `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxNum; n += 1) {
    const o = offsets.get(n);
    if (mode === "garbage") xref += "zz$$garbage!!row \n";
    else if (o === undefined) xref += "0000000000 65535 f \n";
    else
      xref += `${String(mode === "shifted" ? o + 7 : o).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${maxNum + 1} /Root 1 0 R ${options.trailer ?? ""} >>\nstartxref\n${options.startxref ?? at}\n%%EOF\n`;
  parts.push(latin1(xref));
  return concat(parts);
}

export const TEXT_OPS = "BT /F1 24 Tf 72 700 Td (Hostile control) Tj ET";
const HELVETICA = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

/** 1 catalog, 2 pages, 3 page, 4 content, 5 Helvetica. */
export function onePageObjects(
  pageExtra = "",
  mediaBox = "[0 0 612 792]",
  content: string | Uint8Array = TEXT_OPS,
  resources = "",
): RawObject[] {
  return [
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Resources << /Font << /F1 5 0 R >> ${resources} >> /Contents 4 0 R ${pageExtra} >>`,
    },
    {
      num: 4,
      body: "<< >>",
      stream: typeof content === "string" ? latin1(content) : content,
    },
    { num: 5, body: HELVETICA },
  ];
}

const pagePdf = (extra: string, mediaBox?: string, content?: string) =>
  buildPdf({ objects: onePageObjects(extra, mediaBox, content) });

/** The valid partner document for overlay cells, and the positive control. */
export const partnerPdf = (): Uint8Array =>
  buildPdf({ objects: onePageObjects() });

/** Mulberry32: "random" bytes that are the same every run. */
export function seededBytes(length: number, seed = 0x5eed): Uint8Array {
  let a = seed >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

function be(value: number, width: number): number[] {
  const out: number[] = [];
  for (let i = width - 1; i >= 0; i -= 1)
    out.push(Math.floor(value / 256 ** i) & 0xff);
  return out;
}

/** Index `objects` with an xref STREAM only (no classic table); optional /Prev to itself. */
function xrefStreamOnly(
  objects: RawObject[],
  opts: {
    header?: string;
    prevSelf?: boolean;
    inObjStm?: Map<number, [number, number]>;
  } = {},
): Uint8Array {
  const noXref = buildPdf({ header: opts.header, objects, xref: "none" });
  const s = text(noXref);
  const maxNum = Math.max(
    ...objects.map((o) => o.num),
    ...(opts.inObjStm?.keys() ?? []),
  );
  const xrefNum = maxNum + 1;
  const xrefAt = noXref.byteLength;
  const rows: number[] = [0, ...be(0, 4), ...be(0xffff, 2)];
  for (let n = 1; n <= maxNum; n += 1) {
    const packed = opts.inObjStm?.get(n);
    if (packed) {
      rows.push(2, ...be(packed[0], 4), ...be(packed[1], 2));
      continue;
    }
    const idx = s.indexOf(`\n${n} 0 obj\n`);
    if (idx < 0) rows.push(0, ...be(0, 4), ...be(0, 2));
    else rows.push(1, ...be(idx + 1, 4), ...be(0, 2));
  }
  rows.push(1, ...be(xrefAt, 4), ...be(0, 2));
  const data = deflateSync(Uint8Array.from(rows));
  const prev = opts.prevSelf ? ` /Prev ${xrefAt}` : "";
  return concat([
    noXref,
    latin1(
      `${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] /Root 1 0 R${prev} /Filter /FlateDecode /Length ${data.byteLength} >>\nstream\n`,
    ),
    data,
    latin1(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`),
  ]);
}

/**
 * A zlib stream inflating to `prefix` followed by `total` bytes of `fill`,
 * built without ever holding `total` bytes: one 1 MiB run is raw-deflated
 * ending on a SYNC flush (no final-block bit, no back-reference past it), so
 * copies of it concatenate into one valid deflate stream; an empty final
 * block, the zlib header and the Adler-32 (extended over the run in closed
 * form) complete it.
 */
function deflateStream(
  prefix: Uint8Array,
  fill: number,
  total: number,
): Uint8Array {
  const MiB = 1 << 20;
  const sync = { finishFlush: constants.Z_SYNC_FLUSH, level: 9 };
  const parts: Uint8Array[] = [Uint8Array.from([0x78, 0xda])];
  if (prefix.byteLength) parts.push(deflateRawSync(prefix, sync));
  const piece = deflateRawSync(Buffer.alloc(MiB, fill), sync);
  for (let left = total; left > 0; left -= MiB) {
    parts.push(
      left >= MiB ? piece : deflateRawSync(Buffer.alloc(left, fill), sync),
    );
  }
  parts.push(deflateRawSync(new Uint8Array(0))); // the final (empty) block
  // Adler-32 of prefix + fill*total.
  const MOD = 65521n;
  let a = 1n;
  let b = 0n;
  for (const byte of prefix) {
    a = (a + BigInt(byte)) % MOD;
    b = (b + a) % MOD;
  }
  const L = BigInt(total);
  const c = BigInt(fill);
  b = (b + L * a + (c * L * (L + 1n)) / 2n) % MOD;
  a = (a + c * L) % MOD;
  const adler = Number((b << 16n) | a) >>> 0;
  parts.push(Uint8Array.from(be(adler, 4)));
  return concat(parts);
}

// ------------------------------------------------------------------ classes

function prevSelfLoop(): Uint8Array {
  const s = text(partnerPdf());
  const xrefAt = s.lastIndexOf("xref\n");
  return latin1(s.replace("/Root 1 0 R ", `/Root 1 0 R /Prev ${xrefAt} `));
}

/** Two classic sections A and B, A./Prev = B and B./Prev = A; startxref names B. */
function prevCycle(): Uint8Array {
  const s = text(partnerPdf());
  const aAt = s.lastIndexOf("xref\n");
  const table = s.slice(aAt, s.indexOf("trailer", aAt));
  // B goes after A; fix the width of A's /Prev so B's offset is known first.
  const pad = (n: number) => String(n).padStart(10, "0");
  const bAt = s.replace("/Root 1 0 R ", `/Root 1 0 R /Prev ${pad(0)} `).length;
  const a = s.replace("/Root 1 0 R ", `/Root 1 0 R /Prev ${pad(bAt)} `);
  const b = `${table}trailer\n<< /Size 6 /Root 1 0 R /Prev ${aAt} >>\nstartxref\n${bAt}\n%%EOF\n`;
  return latin1(a + b);
}

function deepPageTree(depth: number): Uint8Array {
  const objs: RawObject[] = [
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
  ];
  for (let i = 0; i < depth; i += 1) {
    const num = 2 + i;
    const parent = i === 0 ? "" : `/Parent ${num - 1} 0 R`;
    objs.push({
      num,
      body: `<< /Type /Pages ${parent} /Kids [${num + 1} 0 R] /Count 1 >>`,
    });
  }
  const p = depth + 2;
  objs.push({
    num: p,
    body: `<< /Type /Page /Parent ${p - 1} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`,
  });
  objs.push({ num: p + 1, body: "<< >>", stream: latin1(TEXT_OPS) });
  objs.push({ num: p + 2, body: HELVETICA });
  return buildPdf({ objects: objs });
}

function nestedForms(depth: number, selfDo: boolean): Uint8Array {
  const objs = onePageObjects(
    "",
    undefined,
    `${TEXT_OPS}\nq /X0 Do Q`,
    "/XObject << /X0 10 0 R >>",
  );
  for (let i = 0; i < depth; i += 1) {
    const num = 10 + i;
    const last = i === depth - 1;
    const next = selfDo && last ? num : num + 1;
    const leaf = last && !selfDo;
    objs.push({
      num,
      body: `<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] ${leaf ? "" : `/Resources << /XObject << /X0 ${next} 0 R >> >>`} >>`,
      stream: latin1(leaf ? "0 0 1 1 re f" : "q /X0 Do Q"),
    });
  }
  return buildPdf({ objects: objs });
}

function withPagesBody(body: string): Uint8Array {
  const objs = onePageObjects();
  objs[1] = { num: 2, body };
  return buildPdf({ objects: objs });
}

function hugeImageXObject(): Uint8Array {
  const objs = onePageObjects(
    "",
    undefined,
    `${TEXT_OPS}\nq 200 0 0 200 100 100 cm /Im0 Do Q`,
    "/XObject << /Im0 6 0 R >>",
  );
  objs.push({
    num: 6,
    body: "<< /Type /XObject /Subtype /Image /Width 100000 /Height 100000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>",
    stream: deflateSync(new Uint8Array(64)),
  });
  return buildPdf({ objects: objs });
}

function flateBombContent(inflated: number, chained: boolean): Uint8Array {
  const once = deflateStream(new Uint8Array(0), 0x20, inflated);
  const data = chained ? deflateSync(once, { level: 9 }) : once;
  const objs = onePageObjects();
  objs[2] = {
    num: 3,
    body: objs[2]!.body.replace("/Contents 4 0 R", "/Contents [4 0 R 6 0 R]"),
  };
  objs.push({
    num: 6,
    body: `<< /Filter ${chained ? "[/FlateDecode /FlateDecode]" : "/FlateDecode"} >>`,
    stream: data,
  });
  return buildPdf({ objects: objs });
}

/** An /ObjStm holding one tiny object, padded with spaces to `inflated` bytes. SLOW. */
export function objStmBomb(inflated: number): Uint8Array {
  const head = "7 0 ";
  const objs = onePageObjects();
  objs.push({
    num: 6,
    body: `<< /Type /ObjStm /N 1 /First ${head.length} /Filter /FlateDecode >>`,
    stream: deflateStream(latin1(`${head}<< /Bomb true >>`), 0x20, inflated),
  });
  return buildPdf({ objects: objs });
}

function truncatedFontFile2(): Uint8Array {
  const objs = onePageObjects();
  objs[4] = {
    num: 5,
    body: "<< /Type /Font /Subtype /TrueType /BaseFont /Broken /FirstChar 32 /LastChar 126 /FontDescriptor 6 0 R >>",
  };
  objs.push({
    num: 6,
    body: "<< /Type /FontDescriptor /FontName /Broken /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>",
  });
  objs.push({
    num: 7,
    body: "<< /Length1 4000 >>",
    stream: concat([
      Uint8Array.from([0, 1, 0, 0, 0, 9, 0, 0]),
      seededBytes(32, 3),
    ]),
  });
  return buildPdf({ objects: objs });
}

function recursiveType3(): Uint8Array {
  const objs = onePageObjects();
  const diffs = Array.from({ length: 95 }, () => "/a").join(" ");
  objs[4] = {
    num: 5,
    body: `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /a 6 0 R >> /Encoding << /Type /Encoding /Differences [32 ${diffs}] >> /FirstChar 32 /LastChar 126 /Widths [] /Resources << /Font << /F1 5 0 R >> >> >>`,
  };
  objs.push({
    num: 6,
    body: "<< >>",
    stream: latin1("1000 0 d0 BT /F1 1 Tf (H) Tj ET"),
  });
  return buildPdf({ objects: objs });
}

function activeContent(): Uint8Array {
  return buildPdf({
    objects: [
      {
        num: 1,
        body: "<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R /Names << /EmbeddedFiles << /Names [(evil.exe) 8 0 R] >> /JavaScript << /Names [(init) 6 0 R] >> >> >>",
      },
      { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        num: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /AA << /O 6 0 R >> /Annots [7 0 R 10 0 R] >>",
      },
      { num: 4, body: "<< >>", stream: latin1(TEXT_OPS) },
      { num: 5, body: HELVETICA },
      { num: 6, body: "<< /S /JavaScript /JS (app.alert\\('hostile'\\)) >>" },
      {
        num: 7,
        body: "<< /Type /Annot /Subtype /Link /Rect [72 72 200 100] /A << /S /Launch /F (calc.exe) >> >>",
      },
      {
        num: 8,
        body: "<< /Type /Filespec /F (evil.exe) /EF << /F 9 0 R >> >>",
      },
      {
        num: 9,
        body: "<< /Type /EmbeddedFile >>",
        stream: latin1("MZ-not-really"),
      },
      {
        num: 10,
        body: "<< /Type /Annot /Subtype /Link /Rect [72 110 200 140] /A << /S /URI /URI (javascript:alert\\(1\\)) >> >>",
      },
    ],
  });
}

/**
 * A signed revision — a /Sig dict with a /ByteRange, reachable from a /FT /Sig
 * field — followed by an incremental update that rewrites the page content.
 * The signature bytes are zeros: it COUNTS as a signature and never validates.
 */
export function signedThenUpdated(): Uint8Array {
  const objs = onePageObjects("/Annots [6 0 R]");
  objs[0] = {
    num: 1,
    body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /SigFlags 3 >> >>",
  };
  objs.push({
    num: 6,
    body: "<< /Type /Annot /Subtype /Widget /FT /Sig /T (Sig1) /Rect [0 0 0 0] /P 3 0 R /V 7 0 R >>",
  });
  objs.push({
    num: 7,
    body: `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 100 200 300] /Contents <${"0".repeat(64)}> >>`,
  });
  const signed = buildPdf({ objects: objs });
  const prevXref = text(signed).lastIndexOf("xref\n");
  const appendAt = signed.byteLength;
  const content = `${TEXT_OPS} %upd`;
  const upd = `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  const tail = `xref\n4 1\n${String(appendAt).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 8 /Root 1 0 R /Prev ${prevXref} >>\nstartxref\n${appendAt + upd.length}\n%%EOF\n`;
  return concat([signed, latin1(upd + tail)]);
}

/** Object 3 defined twice (612x792 and 300x300); the xref names `pointAt`. */
function duplicateIds(pointAt: "twin" | "original"): Uint8Array {
  const objs = onePageObjects();
  const twin: RawObject = {
    num: 3,
    body: objs[2]!.body.replace("[0 0 612 792]", "[0 0 300 300]"),
  };
  return buildPdf({
    objects: pointAt === "twin" ? [...objs, twin] : [twin, ...objs],
  });
}

function pdf20CatalogInObjStm(): Uint8Array {
  const catalog = "<< /Type /Catalog /Pages 2 0 R >>";
  const pages = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  const head = `1 0 2 ${catalog.length + 1} `;
  const objs = onePageObjects().slice(2); // 3, 4, 5
  objs.push({
    num: 6,
    body: `<< /Type /ObjStm /N 2 /First ${head.length} /Filter /FlateDecode >>`,
    stream: deflateSync(latin1(`${head}${catalog} ${pages}`)),
  });
  return xrefStreamOnly(objs, {
    header: "%PDF-2.0",
    inObjStm: new Map([
      [1, [6, 0]],
      [2, [6, 1]],
    ]),
  });
}

function lyingObjStm(kind: "n" | "first"): Uint8Array {
  const head = "7 0 ";
  const objs = onePageObjects();
  objs.push({
    num: 6,
    body: `<< /Type /ObjStm /N ${kind === "n" ? 50 : 1} /First ${kind === "first" ? 99_999 : head.length} /Filter /FlateDecode >>`,
    stream: deflateSync(latin1(`${head}<< /Lie true >>`)),
  });
  return buildPdf({ objects: objs });
}

function manyPages(count: number): Uint8Array {
  const objs: RawObject[] = [
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    {
      num: 2,
      body: `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${10 + i} 0 R`).join(" ")}] /Count ${count} >>`,
    },
    { num: 4, body: "<< >>", stream: latin1(TEXT_OPS) },
    { num: 5, body: HELVETICA },
  ];
  for (let i = 0; i < count; i += 1) {
    objs.push({
      num: 10 + i,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    });
  }
  return buildPdf({ objects: objs });
}

// ------------------------------------------------------------------ corpus

export interface StampingInput {
  id: string;
  /** H01..H24, or CONTROL. */
  cls: string;
  what: string;
  build: () => Uint8Array | Promise<Uint8Array>;
  /** Pages a correct reader finds; absent when the file is not a readable PDF. */
  pages?: number;
  /** Encrypted: a correct engine refuses with the typed PdfEncryptedError. */
  encrypted?: true;
  /** Long bound; run in a child process only. */
  slow?: boolean;
}

const restricted = (file: string) => () => readRestrictedFixture(file);

/** The whole stamping corpus. Ids start with their class. */
export const STAMPING_INPUTS: readonly StampingInput[] = [
  {
    id: "CONTROL-valid",
    cls: "CONTROL",
    what: "hand-built valid 1-page PDF",
    build: partnerPdf,
    pages: 1,
  },
  {
    id: "H01-zero-bytes",
    cls: "H01",
    what: "Uint8Array(0)",
    build: () => new Uint8Array(0),
  },
  {
    id: "H02-png-magic",
    cls: "H02",
    what: "PNG signature + noise",
    build: () =>
      concat([
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        seededBytes(256, 2),
      ]),
  },
  {
    id: "H02-zip-docx-magic",
    cls: "H02",
    what: "ZIP local header naming [Content_Types].xml",
    build: () =>
      concat([
        Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0]),
        latin1("[Content_Types].xml"),
        seededBytes(256, 7),
      ]),
  },
  {
    id: "H02-random-4k",
    cls: "H02",
    what: "4 KB seeded noise",
    build: () => seededBytes(4096),
  },
  {
    id: "H02-html",
    cls: "H02",
    what: "an HTML page",
    build: () =>
      latin1("<!doctype html><html><body><p>not a pdf</p></body></html>\n"),
  },
  {
    id: "H03-header-only",
    cls: "H03",
    what: "'%PDF-1.7\\n' only",
    build: () => latin1("%PDF-1.7\n"),
  },
  {
    id: "H04-truncated-half",
    cls: "H04",
    what: "valid file cut at 50%",
    build: () => {
      const b = partnerPdf();
      return b.slice(0, Math.floor(b.byteLength / 2));
    },
  },
  {
    id: "H04-truncated-at-endobj",
    cls: "H04",
    what: "every object, no xref/trailer/startxref",
    build: () => buildPdf({ objects: onePageObjects(), xref: "none" }),
    pages: 1,
  },
  {
    id: "H05-xref-offsets-wrong",
    cls: "H05",
    what: "every offset +7",
    build: () => buildPdf({ objects: onePageObjects(), xref: "shifted" }),
    pages: 1,
  },
  {
    id: "H05-xref-garbage",
    cls: "H05",
    what: "xref rows are junk",
    build: () => buildPdf({ objects: onePageObjects(), xref: "garbage" }),
    pages: 1,
  },
  {
    id: "H05-startxref-past-eof",
    cls: "H05",
    what: "spliceStartxrefPastEnd",
    build: () => spliceStartxrefPastEnd(partnerPdf()),
    pages: 1,
  },
  {
    id: "H06-prev-self",
    cls: "H06",
    what: "trailer /Prev = its own xref",
    build: prevSelfLoop,
    pages: 1,
  },
  {
    id: "H06-prev-cycle",
    cls: "H06",
    what: "A./Prev=B, B./Prev=A",
    build: prevCycle,
    pages: 1,
  },
  {
    id: "H06-xrefstm-prev-self",
    cls: "H06",
    what: "xref stream whose /Prev is itself",
    build: () => xrefStreamOnly(onePageObjects(), { prevSelf: true }),
    pages: 1,
  },
  {
    id: "H07-page-parent-self",
    cls: "H07",
    what: "page /Parent is the page itself",
    build: () => {
      const o = onePageObjects();
      o[2] = {
        num: 3,
        body: o[2]!.body.replace("/Parent 2 0 R", "/Parent 3 0 R"),
      };
      return buildPdf({ objects: o });
    },
    pages: 1,
  },
  {
    id: "H07-kids-contain-self",
    cls: "H07",
    what: "/Pages /Kids [3 0 R 2 0 R] /Count 2",
    build: () =>
      withPagesBody("<< /Type /Pages /Kids [3 0 R 2 0 R] /Count 2 >>"),
  },
  {
    id: "H07-contents-self-ref",
    cls: "H07",
    what: "/Contents 6 0 R where object 6 is `6 0 R`",
    build: () => {
      const o = onePageObjects();
      o[2] = {
        num: 3,
        body: o[2]!.body.replace("/Contents 4 0 R", "/Contents 6 0 R"),
      };
      o.push({ num: 6, body: "6 0 R" });
      return buildPdf({ objects: o });
    },
    pages: 1,
  },
  {
    id: "H08-page-tree-depth-2000",
    cls: "H08",
    what: "/Pages chain 2,000 deep",
    build: () => deepPageTree(2000),
    pages: 1,
  },
  {
    id: "H08-form-depth-2000",
    cls: "H08",
    what: "Form XObjects nested 2,000 deep",
    build: () => nestedForms(2000, false),
    pages: 1,
  },
  {
    id: "H08-form-self-do",
    cls: "H08",
    what: "a Form XObject that Do's itself",
    build: () => nestedForms(1, true),
    pages: 1,
  },
  {
    id: "H09-count-int-max",
    cls: "H09",
    what: "/Count 2147483647, one real page",
    build: () =>
      withPagesBody("<< /Type /Pages /Kids [3 0 R] /Count 2147483647 >>"),
    pages: 1,
  },
  {
    id: "H09-count-negative",
    cls: "H09",
    what: "/Count -1",
    build: () => withPagesBody("<< /Type /Pages /Kids [3 0 R] /Count -1 >>"),
    pages: 1,
  },
  {
    id: "H09-count-fraction",
    cls: "H09",
    what: "/Count 1.5",
    build: () => withPagesBody("<< /Type /Pages /Kids [3 0 R] /Count 1.5 >>"),
    pages: 1,
  },
  {
    id: "H10-mediabox-1e9",
    cls: "H10",
    what: "MediaBox [0 0 1000000000 1000000000]",
    build: () => pagePdf("", "[0 0 1000000000 1000000000]"),
    pages: 1,
  },
  {
    id: "H10-mediabox-zero",
    cls: "H10",
    what: "MediaBox [0 0 0 0]",
    build: () => pagePdf("", "[0 0 0 0]"),
    pages: 1,
  },
  {
    id: "H10-mediabox-inverted",
    cls: "H10",
    what: "MediaBox [612 792 0 0]",
    build: () => pagePdf("", "[612 792 0 0]"),
    pages: 1,
  },
  {
    id: "H10-userunit-14400",
    cls: "H10",
    what: "/UserUnit 14400 on a 14400 pt page",
    build: () => pagePdf("/UserUnit 14400", "[0 0 14400 14400]"),
    pages: 1,
  },
  {
    id: "H11-image-100000-square",
    cls: "H11",
    what: "image XObject 100000x100000 over 64 bytes",
    build: hugeImageXObject,
    pages: 1,
  },
  {
    id: "H12-content-bomb-64mb",
    cls: "H12",
    what: "content stream Flate -> 64 MiB",
    build: () => flateBombContent(64 << 20, false),
    pages: 1,
    slow: true,
  },
  {
    id: "H12-content-bomb-chained-256mb",
    cls: "H12",
    what: "content [/FlateDecode /FlateDecode] -> 256 MiB",
    build: () => flateBombContent(256 << 20, true),
    pages: 1,
    slow: true,
  },
  {
    id: "H12-content-bomb-chained-1gb",
    cls: "H12",
    what: "content [/FlateDecode /FlateDecode] -> 1 GiB",
    build: () => flateBombContent(1 << 30, true),
    pages: 1,
    slow: true,
  },
  {
    id: "H12-objstm-bomb-256mb",
    cls: "H12",
    what: "/ObjStm Flate -> 256 MiB (inflated at parse)",
    build: () => objStmBomb(256 << 20),
    pages: 1,
    slow: true,
  },
  {
    id: "H12-objstm-bomb-1gb",
    cls: "H12",
    what: "/ObjStm Flate -> 1 GiB (inflated at parse)",
    build: () => objStmBomb(1 << 30),
    pages: 1,
    slow: true,
  },
  {
    id: "H13-truncated-fontfile2",
    cls: "H13",
    what: "FontFile2 of 40 bytes",
    build: truncatedFontFile2,
    pages: 1,
  },
  {
    id: "H13-type3-recursive",
    cls: "H13",
    what: "Type3 CharProc paints its own font",
    build: recursiveType3,
    pages: 1,
  },
  {
    id: "H13-broken-cjk-subset",
    cls: "H13",
    what: "BROKEN_CJK_SUBSET_PDF_BASE64",
    build: () =>
      Uint8Array.from(Buffer.from(BROKEN_CJK_SUBSET_PDF_BASE64, "base64")),
    pages: 1,
  },
  {
    id: "H14-user-password",
    cls: "H14",
    what: "user-password RC4",
    build: userPasswordEncryptedPdf,
    encrypted: true,
  },
  {
    id: "H14-user-password-objstm",
    cls: "H14",
    what: "user password, object streams",
    build: userPasswordObjectStreamPdf,
    encrypted: true,
  },
  {
    id: "H14-pypdf-open-password",
    cls: "H14",
    what: "pypdf r3 open password",
    build: restricted("pypdf-r3-open-password.pdf"),
    encrypted: true,
  },
  {
    id: "H15-owner-only",
    cls: "H15",
    what: "owner-only (generated)",
    build: ownerOnlyEncryptedPdf,
    encrypted: true,
  },
  {
    id: "H15-owner-only-objstm",
    cls: "H15",
    what: "owner-only, object streams",
    build: ownerOnlyObjectStreamPdf,
    encrypted: true,
  },
  {
    id: "H15-qpdf-r2-rc4-40",
    cls: "H15",
    what: "qpdf R2 RC4-40",
    build: restricted("qpdf-r2-rc4-40.pdf"),
    encrypted: true,
  },
  {
    id: "H15-qpdf-r3-rc4-128",
    cls: "H15",
    what: "qpdf R3 RC4-128",
    build: restricted("qpdf-r3-rc4-128.pdf"),
    encrypted: true,
  },
  {
    id: "H15-qpdf-r4-aes128",
    cls: "H15",
    what: "qpdf R4 AES-128",
    build: restricted("qpdf-r4-aes128.pdf"),
    encrypted: true,
  },
  {
    id: "H15-qpdf-r6-aes256",
    cls: "H15",
    what: "qpdf R6 AES-256",
    build: restricted("qpdf-r6-aes256.pdf"),
    encrypted: true,
  },
  {
    id: "H15-unknown-handler",
    cls: "H15",
    what: "unknown /Filter security handler",
    build: unsupportedEncryptionPdf,
    encrypted: true,
  },
  {
    id: "H15-unknown-handler-objstm",
    cls: "H15",
    what: "unknown handler, object streams",
    build: unknownHandlerObjectStreamPdf,
    encrypted: true,
  },
  {
    id: "H16-active-content",
    cls: "H16",
    what: "JS OpenAction, /AA, /Launch, javascript: URI, EmbeddedFiles",
    build: activeContent,
    pages: 1,
  },
  {
    id: "H17-signed-then-updated",
    cls: "H17",
    what: "signed revision + incremental update",
    build: signedThenUpdated,
    pages: 1,
  },
  {
    id: "H18-mediabox-1e309",
    cls: "H18",
    what: "MediaBox [0 0 1e309 792]",
    build: () => pagePdf("", "[0 0 1e309 792]"),
    pages: 1,
  },
  {
    id: "H18-mediabox-neg-zero",
    cls: "H18",
    what: "MediaBox [-0 -0 612 792]",
    build: () => pagePdf("", "[-0 -0 612 792]"),
    pages: 1,
  },
  {
    id: "H18-mediabox-dot",
    cls: "H18",
    what: "MediaBox [0 0 . 792]",
    build: () => pagePdf("", "[0 0 . 792]"),
    pages: 1,
  },
  {
    id: "H18-mediabox-double-minus",
    cls: "H18",
    what: "MediaBox [0 0 --5 792]",
    build: () => pagePdf("", "[0 0 --5 792]"),
    pages: 1,
  },
  {
    id: "H18-mediabox-20-digits",
    cls: "H18",
    what: "MediaBox [0 0 99999999999999999999 792]",
    build: () => pagePdf("", "[0 0 99999999999999999999 792]"),
    pages: 1,
  },
  {
    id: "H18-rotate-1e309",
    cls: "H18",
    what: "/Rotate 1e309",
    build: () => pagePdf("/Rotate 1e309"),
    pages: 1,
  },
  {
    id: "H18-rotate-20-digits",
    cls: "H18",
    what: "/Rotate 99999999999999999999",
    build: () => pagePdf("/Rotate 99999999999999999999"),
    pages: 1,
  },
  {
    id: "H19-dup-id-xref-twin",
    cls: "H19",
    what: "page defined twice; xref names the 300x300 twin",
    build: () => duplicateIds("twin"),
    pages: 1,
  },
  {
    id: "H19-dup-id-xref-original",
    cls: "H19",
    what: "page defined twice; xref names the 612x792 original",
    build: () => duplicateIds("original"),
    pages: 1,
  },
  {
    id: "H20-pdf20-xrefstm-only",
    cls: "H20",
    what: "%PDF-2.0, xref stream only",
    build: () => xrefStreamOnly(onePageObjects(), { header: "%PDF-2.0" }),
    pages: 1,
  },
  {
    id: "H20-pdf20-catalog-in-objstm",
    cls: "H20",
    what: "%PDF-2.0, catalog + pages inside an /ObjStm",
    build: pdf20CatalogInObjStm,
    pages: 1,
  },
  {
    id: "H21-2000-pages",
    cls: "H21",
    what: "2,000 pages, one shared content stream",
    build: () => manyPages(2000),
    pages: 2000,
    slow: true,
  },
  {
    id: "H22-rotate-45",
    cls: "H22",
    what: "/Rotate 45",
    build: () => pagePdf("/Rotate 45"),
    pages: 1,
  },
  {
    id: "H22-rotate-1e9",
    cls: "H22",
    what: "/Rotate 1000000000",
    build: () => pagePdf("/Rotate 1000000000"),
    pages: 1,
  },
  {
    id: "H22-rotate-inherited-90",
    cls: "H22",
    what: "/Rotate 90 on /Pages, inherited",
    build: () =>
      withPagesBody("<< /Type /Pages /Kids [3 0 R] /Count 1 /Rotate 90 >>"),
    pages: 1,
  },
  {
    id: "H23-objstm-n-lies",
    cls: "H23",
    what: "/ObjStm /N 50 with one member",
    build: () => lyingObjStm("n"),
    pages: 1,
  },
  {
    id: "H23-objstm-first-past-end",
    cls: "H23",
    what: "/ObjStm /First 99999",
    build: () => lyingObjStm("first"),
    pages: 1,
  },
  {
    id: "H24-pops-then-scale",
    cls: "H24",
    what: "Q x 100,000 then `0.1 0 0 0.1 0 0 cm` with no q",
    build: () =>
      pagePdf(
        "",
        undefined,
        `${"Q\n".repeat(100_000)}0.1 0 0 0.1 0 0 cm\n${TEXT_OPS}`,
      ),
    pages: 1,
  },
  {
    id: "H24-unclosed-q-scale",
    cls: "H24",
    what: "`q 0.1 0 0 0.1 0 0 cm` + q x 100,000, never closed",
    build: () =>
      pagePdf(
        "",
        undefined,
        `${TEXT_OPS}\nq 0.1 0 0 0.1 0 0 cm\n${"q\n".repeat(100_000)}`,
      ),
    pages: 1,
  },
  {
    id: "H24-inline-image-huge",
    cls: "H24",
    what: "BI /W 100000 /H 100000 with 3 bytes",
    build: () =>
      pagePdf(
        "",
        undefined,
        `${TEXT_OPS}\nq 100 0 0 100 100 100 cm\nBI /W 100000 /H 100000 /CS /RGB /BPC 8 ID \x00\x00\x00 EI Q`,
      ),
    pages: 1,
  },
  {
    id: "X-malformed-pages-number",
    cls: "H07",
    what: "catalog /Pages is a number",
    build: async () => (await malformedPdfs())[0]!,
  },
  {
    id: "X-malformed-xobject-number",
    cls: "H07",
    what: "page /Resources /XObject is a number",
    build: async () => (await malformedPdfs())[1]!,
    pages: 1,
  },
];
