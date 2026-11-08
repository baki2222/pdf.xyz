import { createDeflate, deflateSync } from "node:zlib";
import { PDFDocument, PDFName } from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { spliceStartxrefPastEnd } from "@/tests/damaged-xref";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
  userPasswordObjectStreamPdf,
  unknownHandlerObjectStreamPdf,
} from "@/tests/encrypted-pdf-fixture";
import { readRestrictedFixture } from "@/tests/restricted-pdf-fixtures";
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";
import { BROKEN_CJK_SUBSET_PDF_BASE64 } from "@/tests/fixtures-broken-subset";

/**
 * The editing family's hostile corpus (the editing matrix (branch test/hostile-matrix, not merged)). The shared
 * `./fixtures.ts` belongs to another family and may change under it, so this
 * family's matrix pins its own generators here — every fixture GENERATED,
 * deterministically and small (the 2,000-page document and the decompression
 * bombs are the exceptions, and say so), except the restricted-PDF files
 * already checked in under `src/tests/fixtures/restricted-pdf/`.
 *
 * Each fixture carries its hostile class (H01..H24 of the survey) and, where
 * meaningful, the number of pages a correct reader finds in it — the second,
 * independent bound a "produced output" cell is checked against
 * (`/Count 2147483647` with one real page must come out as ONE page).
 */

export type HostileClass = `H${"0" | "1" | "2"}${number}`;

export interface HostileFixture {
  /** Stable id, `H05-xref-offsets-wrong` style. */
  id: string;
  cls: HostileClass;
  /** One line: what is wrong with these bytes. */
  what: string;
  bytes: Uint8Array;
  /** Pages a correct reader finds, when the file is readable at all. */
  pages?: number;
  /** Needs a long bound (big file, bomb). */
  slow?: boolean;
  /** Encrypted: a correct engine refuses with the typed encrypted error. */
  encrypted?: "needs-password" | "opens-without-password" | "unknown-handler";
}

const enc = new TextEncoder();
const latin1 = (s: string): Uint8Array =>
  Uint8Array.from(Buffer.from(s, "latin1"));

/** A deterministic byte source (LCG), so "random" bytes are the same every run. */
export function seededBytes(length: number, seed = 0x5eed): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  A raw PDF writer — exact bytes, exact offsets, nothing normalised.
 * ------------------------------------------------------------------ */

export interface RawObject {
  num: number;
  gen?: number;
  /** The object's value, written verbatim between `obj` and `endobj`. */
  body: string | Uint8Array;
}

/** `<< dict /Length n >> stream … endstream` as one object body. */
export function streamBody(
  dict: string,
  data: Uint8Array | string,
): Uint8Array {
  const payload = typeof data === "string" ? latin1(data) : data;
  return concat([
    latin1(`<< ${dict} /Length ${payload.length} >>\nstream\n`),
    payload,
    latin1("\nendstream"),
  ]);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface RawPdfOptions {
  header?: string;
  objects: readonly RawObject[];
  /** Trailer dict CONTENTS (without `<<`/`>>`); `/Size` is added. */
  trailer: string;
  /** Add this to every xref offset (H05: all offsets wrong). */
  offsetShift?: number;
  /** Replace the xref table rows with this text (H05: garbage table). */
  xrefRows?: string;
}

export interface RawPdf {
  bytes: Uint8Array;
  xrefAt: number;
}

export function rawPdf(opts: RawPdfOptions): RawPdf {
  const parts: Uint8Array[] = [];
  let at = 0;
  const push = (p: Uint8Array) => {
    parts.push(p);
    at += p.length;
  };
  push(latin1(`${opts.header ?? "%PDF-1.7"}\n%\xe2\xe3\xcf\xd3\n`));
  const offsets = new Map<number, number>();
  for (const obj of opts.objects) {
    offsets.set(obj.num, at);
    push(latin1(`${obj.num} ${obj.gen ?? 0} obj\n`));
    push(typeof obj.body === "string" ? latin1(obj.body) : obj.body);
    push(latin1("\nendobj\n"));
  }
  const xrefAt = at;
  const size = Math.max(0, ...opts.objects.map((o) => o.num)) + 1;
  let rows = "0000000000 65535 f \n";
  for (let n = 1; n < size; n += 1) {
    const off = offsets.get(n);
    rows +=
      off === undefined
        ? "0000000000 65535 f \n"
        : `${String(off + (opts.offsetShift ?? 0)).padStart(10, "0")} 00000 n \n`;
  }
  push(
    latin1(
      `xref\n0 ${size}\n${opts.xrefRows ?? rows}trailer\n<< /Size ${size} ${opts.trailer} >>\nstartxref\n${xrefAt}\n%%EOF\n`,
    ),
  );
  return { bytes: concat(parts), xrefAt };
}

/** Catalog 1, Pages 2, one Page 3 with content 4 — patched per fixture. */
function onePage(
  page = "/MediaBox [0 0 200 200]",
  pages = "/Kids [3 0 R] /Count 1",
  content = "0 0 1 rg 20 20 80 80 re f",
  extra: RawObject[] = [],
  catalog = "",
): RawObject[] {
  return [
    { num: 1, body: `<< /Type /Catalog /Pages 2 0 R ${catalog} >>` },
    { num: 2, body: `<< /Type /Pages ${pages} >>` },
    {
      num: 3,
      body: `<< /Type /Page /Parent 2 0 R ${page} /Contents 4 0 R /Resources << >> >>`,
    },
    { num: 4, body: streamBody("", content) },
    ...extra,
  ];
}

const simple = (objects: RawObject[], header?: string) =>
  rawPdf({ objects, trailer: "/Root 1 0 R", header }).bytes;

/** A small, valid, pdf-lib-written document with text, saved classic-xref. */
export async function validPdf(pageCount = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(Date.UTC(2026, 0, 1)));
  doc.setModificationDate(new Date(Date.UTC(2026, 0, 1)));
  const labels = Array.from(
    { length: pageCount },
    (_, i) => `HOSTILE-CONTROL-${i + 1}`,
  );
  // Through the chooser, like every module that draws text
  // (src/deploy/text-drawing-call-sites.test.ts).
  const font = await embedDrawingFont(doc, labels);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([300, 400]);
    page.drawText(labels[i]!, {
      x: 30,
      y: 300,
      size: 14,
      font,
    });
  }
  return doc.save({ useObjectStreams: false });
}

/* ------------------------------------------------------------------ *
 *  Cross-reference stream writer (H06, H20, H23).
 * ------------------------------------------------------------------ */

interface XrefStreamOptions {
  header?: string;
  direct: readonly RawObject[];
  objstm?: {
    num: number;
    members: readonly { num: number; body: string }[];
    /** Lie about /N (H23). */
    n?: number;
    /** Lie about /First (H23). */
    first?: number;
  };
  root: number;
  /** `self` writes /Prev at the xref stream's own offset (H06). */
  prev?: "self";
}

export function xrefStreamPdf(opts: XrefStreamOptions): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = 0;
  const push = (p: Uint8Array) => {
    parts.push(p);
    at += p.length;
  };
  push(latin1(`${opts.header ?? "%PDF-1.7"}\n%\xe2\xe3\xcf\xd3\n`));
  const entries = new Map<number, [number, number, number]>();
  for (const obj of opts.direct) {
    entries.set(obj.num, [1, at, 0]);
    push(latin1(`${obj.num} 0 obj\n`));
    push(typeof obj.body === "string" ? latin1(obj.body) : obj.body);
    push(latin1("\nendobj\n"));
  }
  if (opts.objstm) {
    const { num, members } = opts.objstm;
    let head = "";
    let body = "";
    members.forEach((m, i) => {
      head += `${m.num} ${body.length} `;
      body += `${m.body}\n`;
      entries.set(m.num, [2, num, i]);
    });
    const first = head.length;
    entries.set(num, [1, at, 0]);
    push(latin1(`${num} 0 obj\n`));
    push(
      streamBody(
        `/Type /ObjStm /N ${opts.objstm.n ?? members.length} /First ${opts.objstm.first ?? first}`,
        head + body,
      ),
    );
    push(latin1("\nendobj\n"));
  }
  const xrefNum = Math.max(0, ...entries.keys()) + 1;
  const xrefAt = at;
  entries.set(xrefNum, [1, xrefAt, 0]);
  const size = xrefNum + 1;
  const rows = new Uint8Array(size * 7);
  rows.set([0, 0, 0, 0, 0, 0xff, 0xff], 0);
  for (let n = 1; n < size; n += 1) {
    const [t, f2, f3] = entries.get(n) ?? [0, 0, 0];
    const o = n * 7;
    rows[o] = t;
    rows[o + 1] = (f2 >>> 24) & 0xff;
    rows[o + 2] = (f2 >>> 16) & 0xff;
    rows[o + 3] = (f2 >>> 8) & 0xff;
    rows[o + 4] = f2 & 0xff;
    rows[o + 5] = (f3 >>> 8) & 0xff;
    rows[o + 6] = f3 & 0xff;
  }
  const prev = opts.prev === "self" ? ` /Prev ${xrefAt}` : "";
  push(latin1(`${xrefNum} 0 obj\n`));
  push(
    streamBody(
      `/Type /XRef /Size ${size} /W [1 4 2] /Root ${opts.root} 0 R${prev}`,
      rows,
    ),
  );
  push(latin1(`\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`));
  return concat(parts);
}

/* ------------------------------------------------------------------ *
 *  Signed-revision fixtures (H17).
 * ------------------------------------------------------------------ */

const SIG_HEX = 2048;

/**
 * A structurally signed file: an AcroForm /Sig field whose /V carries a
 * /ByteRange covering every byte but the /Contents hex string (no real CMS —
 * only the structure a "kept/broken" verdict reads). `byteRange` overrides
 * the honest range (forged cases).
 */
export function signedPdf(
  byteRange?: (honest: number[]) => number[],
): Uint8Array {
  const placeholder = "[0000000000 0000000000 0000000000 0000000000]";
  const contents = `<${"0".repeat(SIG_HEX)}>`;
  const objects: RawObject[] = [
    {
      num: 1,
      body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >>",
    },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << >> /Annots [5 0 R] >>",
    },
    { num: 4, body: streamBody("", "0 0 1 rg 20 20 80 80 re f") },
    {
      num: 5,
      body: "<< /FT /Sig /T (Signature1) /V 6 0 R /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /F 132 /P 3 0 R >>",
    },
    {
      num: 6,
      body: `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /M (D:20260101000000Z) /ByteRange ${placeholder} /Contents ${contents} >>`,
    },
  ];
  const { bytes } = rawPdf({ objects, trailer: "/Root 1 0 R" });
  const text = Buffer.from(bytes).toString("latin1");
  const from = text.indexOf(contents);
  const to = from + contents.length;
  const honest = [0, from, to, bytes.length - to];
  const range = byteRange ? byteRange(honest) : honest;
  const written = `[${range
    .map((n) =>
      n < 0 ? `-${String(-n).padStart(9, "0")}` : String(n).padStart(10, "0"),
    )
    .join(" ")}]`;
  if (written.length !== placeholder.length)
    throw new Error("ByteRange width changed");
  const out = Uint8Array.from(bytes);
  out.set(latin1(written), text.indexOf(placeholder));
  return out;
}

/** Append an incremental update (new xref section, trailer /Prev); `base` stays a prefix. */
export function appendUpdate(
  base: Uint8Array,
  objects: readonly RawObject[],
  trailerExtra = "/Root 1 0 R",
): Uint8Array {
  const text = Buffer.from(base).toString("latin1");
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  if (!m) throw new Error("base has no final startxref");
  const prev = Number(m[1]);
  let size = 0;
  for (const s of text.matchAll(/\/Size (\d+)/g))
    size = Math.max(size, Number(s[1]));
  const parts: Uint8Array[] = [base];
  let at = base.length;
  const offs: [number, number][] = [];
  for (const obj of objects) {
    offs.push([obj.num, at]);
    const p = concat([
      latin1(`${obj.num} 0 obj\n`),
      typeof obj.body === "string" ? latin1(obj.body) : obj.body,
      latin1("\nendobj\n"),
    ]);
    parts.push(p);
    at += p.length;
    size = Math.max(size, obj.num + 1);
  }
  let x = "xref\n";
  for (const [num, off] of offs)
    x += `${num} 1\n${String(off).padStart(10, "0")} 00000 n \n`;
  x += `trailer\n<< /Size ${size} ${trailerExtra} /Prev ${prev} >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(latin1(x));
  return concat(parts);
}

/* ------------------------------------------------------------------ *
 *  Builders.
 * ------------------------------------------------------------------ */

function deepKids(depth: number): Uint8Array {
  const objects: RawObject[] = [
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
  ];
  const leaf = depth + 2;
  for (let n = 2; n < leaf; n += 1) {
    const parent = n === 2 ? "" : `/Parent ${n - 1} 0 R`;
    objects.push({
      num: n,
      body: `<< /Type /Pages ${parent} /Kids [${n + 1} 0 R] /Count 1 >>`,
    });
  }
  objects.push({
    num: leaf,
    body: `<< /Type /Page /Parent ${leaf - 1} 0 R /MediaBox [0 0 200 200] /Contents ${leaf + 1} 0 R /Resources << >> >>`,
  });
  objects.push({
    num: leaf + 1,
    body: streamBody("", "0 0 1 rg 20 20 80 80 re f"),
  });
  return simple(objects);
}

function deepForms(depth: number): Uint8Array {
  const extra: RawObject[] = [];
  const firstForm = 5;
  for (let i = 0; i < depth; i += 1) {
    const num = firstForm + i;
    const last = i === depth - 1;
    const res = last ? "<< >>" : `<< /XObject << /X ${num + 1} 0 R >> >>`;
    extra.push({
      num,
      body: streamBody(
        `/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources ${res}`,
        last ? "0 0 1 rg 20 20 80 80 re f" : "/X Do",
      ),
    });
  }
  return simple([
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /X ${firstForm} 0 R >> >> >>`,
    },
    { num: 4, body: streamBody("", "/X Do") },
    ...extra,
  ]);
}

function selfDoForm(): Uint8Array {
  return simple([
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /X 5 0 R >> >> >>",
    },
    { num: 4, body: streamBody("", "/X Do") },
    {
      num: 5,
      body: streamBody(
        "/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << /XObject << /X 5 0 R >> >>",
        "/X Do",
      ),
    },
  ]);
}

function prevSelfClassic(): Uint8Array {
  const first = rawPdf({
    objects: onePage(),
    trailer: "/Root 1 0 R /Prev 0000000000",
  });
  const text = Buffer.from(first.bytes).toString("latin1");
  return latin1(
    text.replace(
      "/Prev 0000000000",
      `/Prev ${String(first.xrefAt).padStart(10, "0")}`,
    ),
  );
}

function prevCycleClassic(): Uint8Array {
  const a = rawPdf({
    objects: onePage(),
    trailer: "/Root 1 0 R /Prev 0000000000",
  });
  const updated = appendUpdate(a.bytes, [
    { num: 4, body: streamBody("", "1 0 0 rg 20 20 80 80 re f") },
  ]);
  const text = Buffer.from(updated).toString("latin1");
  const bAt = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1]);
  return latin1(
    text.replace("/Prev 0000000000", `/Prev ${String(bAt).padStart(10, "0")}`),
  );
}

/** Deflate `total` zero bytes without ever holding them: 1 GiB in ~1 MB out. */
export function streamedZeroDeflate(total: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const z = createDeflate({ level: 9 });
    const chunks: Buffer[] = [];
    z.on("data", (c: Buffer) => chunks.push(c));
    z.on("end", () => resolve(Uint8Array.from(Buffer.concat(chunks))));
    z.on("error", reject);
    const block = Buffer.alloc(16 * 1024 * 1024);
    let left = total;
    const pump = () => {
      while (left > 0) {
        const n = Math.min(block.length, left);
        left -= n;
        if (!z.write(n === block.length ? block : block.subarray(0, n))) {
          z.once("drain", pump);
          return;
        }
      }
      z.end();
    };
    pump();
  });
}

/** Deflate of zeros, ~1,030:1 — 100 MiB inflates from ~100 KB. */
function bomb(inflatedBytes: number): Uint8Array {
  return deflateSync(Buffer.alloc(inflatedBytes), { level: 9 });
}

function imageXObjectHuge(): Uint8Array {
  return simple([
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /Im 5 0 R >> >> >>",
    },
    { num: 4, body: streamBody("", "q 100 0 0 100 50 50 cm /Im Do Q") },
    {
      num: 5,
      body: streamBody(
        "/Type /XObject /Subtype /Image /Width 100000 /Height 100000 /ColorSpace /DeviceRGB /BitsPerComponent 8",
        seededBytes(64),
      ),
    },
  ]);
}

function truncatedFontFile2(): Uint8Array {
  const ttf = Uint8Array.from([
    0, 1, 0, 0, 0, 9, 0, 0x80, 0, 3, 0, 0x10, 0x67, 0x6c, 0x79, 0x66,
  ]);
  return simple([
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    },
    { num: 4, body: streamBody("", "BT /F1 24 Tf 20 100 Td (Broken) Tj ET") },
    {
      num: 5,
      body: "<< /Type /Font /Subtype /TrueType /BaseFont /Broken /FirstChar 32 /LastChar 126 /FontDescriptor 6 0 R >>",
    },
    {
      num: 6,
      body: "<< /Type /FontDescriptor /FontName /Broken /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>",
    },
    { num: 7, body: streamBody(`/Length1 ${ttf.length}`, ttf) },
  ]);
}

function type3Recursive(): Uint8Array {
  return simple([
    { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F3 5 0 R >> >> >>",
    },
    { num: 4, body: streamBody("", "BT /F3 24 Tf 20 100 Td (a) Tj ET") },
    {
      num: 5,
      body: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /a 6 0 R >> /Encoding << /Type /Encoding /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [1000] /Resources << /Font << /F3 5 0 R >> >> >>",
    },
    { num: 6, body: streamBody("", "1000 0 d0 BT /F3 1 Tf (a) Tj ET") },
  ]);
}

/** A form whose one text field's /DA names a /DR font that is a broken TrueType. */
function formBrokenDrFont(): Uint8Array {
  const ttf = Uint8Array.from([0, 1, 0, 0, 0, 9, 0, 0x80]);
  return simple([
    {
      num: 1,
      body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DR << /Font << /F1 6 0 R >> >> /DA (/F1 12 Tf 0 g) >> >>",
    },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << >> /Annots [5 0 R] >>",
    },
    { num: 4, body: streamBody("", "") },
    {
      num: 5,
      body: "<< /FT /Tx /T (name) /DA (/F1 12 Tf 0 g) /Type /Annot /Subtype /Widget /Rect [20 200 200 230] /P 3 0 R >>",
    },
    {
      num: 6,
      body: "<< /Type /Font /Subtype /TrueType /BaseFont /Broken /FontDescriptor 7 0 R >>",
    },
    {
      num: 7,
      body: "<< /Type /FontDescriptor /FontName /Broken /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 8 0 R >>",
    },
    { num: 8, body: streamBody("", ttf) },
  ]);
}

/** A text field whose /Kids contains itself (H07 for the AcroForm tree). */
function formKidsCycle(): Uint8Array {
  return simple([
    {
      num: 1,
      body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>",
    },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << >> /Annots [6 0 R] >>",
    },
    { num: 4, body: streamBody("", "") },
    { num: 5, body: "<< /FT /Tx /T (loop) /Kids [5 0 R 6 0 R] >>" },
    {
      num: 6,
      body: "<< /Parent 5 0 R /Type /Annot /Subtype /Widget /Rect [20 200 200 230] /P 3 0 R >>",
    },
  ]);
}

/** A field whose /Parent is itself. */
function formParentCycle(): Uint8Array {
  return simple([
    {
      num: 1,
      body: "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>",
    },
    { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      num: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << >> /Annots [5 0 R] >>",
    },
    { num: 4, body: streamBody("", "") },
    {
      num: 5,
      body: "<< /FT /Tx /T (self) /Parent 5 0 R /Type /Annot /Subtype /Widget /Rect [20 200 200 230] /P 3 0 R >>",
    },
  ]);
}

function activeContent(
  kind: "openaction" | "aa" | "launch" | "uri-js" | "embedded",
): Uint8Array {
  const js = "<< /S /JavaScript /JS (app.alert\\('hostile'\\)) >>";
  const link = (action: string) =>
    simple(
      onePage("/MediaBox [0 0 200 200] /Annots [5 0 R]", undefined, undefined, [
        {
          num: 5,
          body: `<< /Type /Annot /Subtype /Link /Rect [0 0 200 200] /A ${action} >>`,
        },
      ]),
    );
  switch (kind) {
    case "openaction":
      return simple(
        onePage(undefined, undefined, undefined, [], `/OpenAction ${js}`),
      );
    case "aa":
      return simple(
        onePage(
          `/MediaBox [0 0 200 200] /AA << /O ${js} >>`,
          undefined,
          undefined,
          [],
          `/AA << /WC ${js} >>`,
        ),
      );
    case "launch":
      return link(
        "<< /S /Launch /F (cmd.exe) /Win << /F (cmd.exe) /P (/c calc) >> >>",
      );
    case "uri-js":
      return link("<< /S /URI /URI (javascript:alert\\(1\\)) >>");
    case "embedded":
      return simple(
        onePage(
          undefined,
          undefined,
          undefined,
          [
            {
              num: 5,
              body: streamBody("/Type /EmbeddedFile", "MZ-not-really-an-exe"),
            },
            {
              num: 6,
              body: "<< /Type /Filespec /F (payload.exe) /UF (payload.exe) /EF << /F 5 0 R >> >>",
            },
          ],
          "/Names << /EmbeddedFiles << /Names [(payload.exe) 6 0 R] >> >>",
        ),
      );
  }
}

function duplicateIds(which: "first" | "second"): Uint8Array {
  const pageA =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>";
  const pageB =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R /Resources << >> >>";
  const built = rawPdf({
    objects: [
      { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      { num: 3, body: pageA },
      { num: 4, body: streamBody("", "0 0 1 rg 20 20 80 80 re f") },
      { num: 3, body: pageB },
    ],
    trailer: "/Root 1 0 R",
  });
  const text = Buffer.from(built.bytes).toString("latin1");
  const firstAt = text.indexOf("3 0 obj");
  const secondAt = text.indexOf("3 0 obj", firstAt + 1);
  const want = which === "first" ? firstAt : secondAt;
  const xrefStart = text.indexOf("\nxref\n") + 1;
  const lines = text.slice(xrefStart).split("\n");
  // xref, "0 5", free row, obj 1, obj 2, obj 3, obj 4, trailer, …
  lines[5] = `${String(want).padStart(10, "0")} 00000 n `;
  return latin1(text.slice(0, xrefStart) + lines.join("\n"));
}

function numberFixtures(): HostileFixture[] {
  const box = (w: string) => simple(onePage(`/MediaBox [0 0 ${w} 300]`));
  return [
    {
      id: "H18-mediabox-1e309",
      cls: "H18",
      what: "MediaBox width 1e309",
      bytes: box("1e309"),
      pages: 1,
    },
    {
      id: "H18-mediabox-neg-zero",
      cls: "H18",
      what: "MediaBox width -0",
      bytes: box("-0"),
      pages: 1,
    },
    {
      id: "H18-mediabox-dot",
      cls: "H18",
      what: "MediaBox width '.'",
      bytes: box("."),
      pages: 1,
    },
    {
      id: "H18-mediabox-double-minus",
      cls: "H18",
      what: "MediaBox width '--5'",
      bytes: box("--5"),
      pages: 1,
    },
    {
      id: "H18-mediabox-20-digits",
      cls: "H18",
      what: "MediaBox width 99999999999999999999",
      bytes: box("99999999999999999999"),
      pages: 1,
    },
    {
      id: "H18-rotate-1e309",
      cls: "H18",
      what: "/Rotate 1e309",
      bytes: simple(onePage("/MediaBox [0 0 200 300] /Rotate 1e309")),
      pages: 1,
    },
    {
      id: "H18-cropbox-dot-minus",
      cls: "H18",
      what: "CropBox [0 0 . --5]",
      bytes: simple(onePage("/MediaBox [0 0 200 300] /CropBox [0 0 . --5]")),
      pages: 1,
    },
  ];
}

const pageWithObjstm = (
  objstm: NonNullable<XrefStreamOptions["objstm"]>,
  header?: string,
) =>
  xrefStreamPdf({
    header,
    direct: [
      {
        num: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>",
      },
      { num: 4, body: streamBody("", "0 0 1 rg 20 20 80 80 re f") },
    ],
    objstm,
    root: 1,
  });

const CATALOG_MEMBERS = [
  { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
  { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
];

/* ------------------------------------------------------------------ *
 *  The corpus.
 * ------------------------------------------------------------------ */

let cache: Promise<HostileFixture[]> | null = null;
let slowCache: Promise<HostileFixture[]> | null = null;

/** Every fast fixture (all but the 2,000-page document and the bombs). */
export function editingFixtures(): Promise<HostileFixture[]> {
  cache ??= build();
  return cache;
}

/** The slow ones: 2,000 pages (H21) and the decompression bombs (H12). */
export function slowEditingFixtures(): Promise<HostileFixture[]> {
  slowCache ??= buildSlow();
  return slowCache;
}

/** The structurally signed file whose signature the update REDEFINES (kept must be 0). */
export function signedThenSignatureReplaced(): Uint8Array {
  const base = signedPdf();
  return appendUpdate(base, [
    {
      num: 6,
      body: `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 10 20 30] /Contents <${"1".repeat(64)}> >>`,
    },
  ]);
}

async function build(): Promise<HostileFixture[]> {
  const valid = await validPdf(2);
  const validText = Buffer.from(valid).toString("latin1");
  const lastEndobj = validText.lastIndexOf("endobj") + "endobj".length;
  const zipMagic = concat([
    latin1("PK\x03\x04"),
    seededBytes(512, 7),
    latin1("[Content_Types].xml word/document.xml"),
  ]);
  const pngMagic = concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    seededBytes(256, 3),
  ]);

  return [
    {
      id: "CONTROL-valid",
      cls: "H00",
      what: "positive control: a valid 2-page PDF",
      bytes: valid,
      pages: 2,
    },
    {
      id: "H01-zero-byte",
      cls: "H01",
      what: "Uint8Array(0)",
      bytes: new Uint8Array(0),
    },
    {
      id: "H02-png-magic",
      cls: "H02",
      what: "PNG signature + noise",
      bytes: pngMagic,
    },
    { id: "H02-zip-docx", cls: "H02", what: "ZIP/DOCX magic", bytes: zipMagic },
    {
      id: "H02-random-4k",
      cls: "H02",
      what: "4 KB seeded noise",
      bytes: seededBytes(4096),
    },
    {
      id: "H02-html",
      cls: "H02",
      what: "an HTML page",
      bytes: enc.encode(
        "<!doctype html><html><head><title>x</title></head><body>not a pdf</body></html>",
      ),
    },
    {
      id: "H03-header-only",
      cls: "H03",
      what: "'%PDF-1.7\\n' and nothing else",
      bytes: latin1("%PDF-1.7\n"),
    },
    {
      id: "H04-truncated-50pct",
      cls: "H04",
      what: "valid file cut at 50%",
      bytes: valid.slice(0, Math.floor(valid.length / 2)),
    },
    {
      id: "H04-truncated-at-endobj",
      cls: "H04",
      what: "cut after the last endobj (no xref, no trailer)",
      bytes: valid.slice(0, lastEndobj),
      pages: 2,
    },
    {
      id: "H05-xref-offsets-wrong",
      cls: "H05",
      what: "every xref offset +7",
      bytes: rawPdf({
        objects: onePage(),
        trailer: "/Root 1 0 R",
        offsetShift: 7,
      }).bytes,
      pages: 1,
    },
    {
      id: "H05-startxref-past-eof",
      cls: "H05",
      what: "startxref past EOF (spliceStartxrefPastEnd)",
      bytes: spliceStartxrefPastEnd(valid),
      pages: 2,
    },
    {
      id: "H05-xref-garbage",
      cls: "H05",
      what: "xref rows are garbage text",
      bytes: rawPdf({
        objects: onePage(),
        trailer: "/Root 1 0 R",
        xrefRows: "garbage garbage garbage\nzzzz 99 q \n",
      }).bytes,
      pages: 1,
    },
    {
      id: "H06-prev-self-classic",
      cls: "H06",
      what: "trailer /Prev = own xref offset",
      bytes: prevSelfClassic(),
      pages: 1,
    },
    {
      id: "H06-prev-cycle-classic",
      cls: "H06",
      what: "two xref sections, /Prev A->B->A",
      bytes: prevCycleClassic(),
      pages: 1,
    },
    {
      id: "H06-prev-self-xrefstream",
      cls: "H06",
      what: "xref stream /Prev = own offset",
      bytes: xrefStreamPdf({ direct: onePage(), root: 1, prev: "self" }),
      pages: 1,
    },
    {
      id: "H07-page-parent-self",
      cls: "H07",
      what: "page /Parent is the page itself",
      bytes: simple([
        { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
        { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
        {
          num: 3,
          body: "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
        },
        { num: 4, body: streamBody("", "0 0 1 rg 20 20 80 80 re f") },
      ]),
      pages: 1,
    },
    {
      id: "H07-kids-contains-self",
      cls: "H07",
      what: "Pages /Kids contains its own ref",
      bytes: simple(onePage(undefined, "/Kids [3 0 R 2 0 R] /Count 2")),
      // No page count: pdf.js itself reports 2 for this tree.
    },
    {
      id: "H07-pages-is-self-ref",
      cls: "H07",
      what: "catalog /Pages -> object whose value is a ref to itself",
      bytes: simple([
        { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
        { num: 2, body: "2 0 R" },
      ]),
    },
    {
      id: "H07-form-kids-cycle",
      cls: "H07",
      what: "form field /Kids contains itself",
      bytes: formKidsCycle(),
      pages: 1,
    },
    {
      id: "H07-form-parent-self",
      cls: "H07",
      what: "form field /Parent is itself",
      bytes: formParentCycle(),
      pages: 1,
    },
    {
      id: "H08-deep-kids-2000",
      cls: "H08",
      what: "/Kids nested 2,000 deep",
      bytes: deepKids(2000),
      pages: 1,
    },
    {
      id: "H08-deep-forms-2000",
      cls: "H08",
      what: "Form XObjects nested 2,000 deep",
      bytes: deepForms(2000),
      pages: 1,
    },
    {
      id: "H08-form-does-itself",
      cls: "H08",
      what: "a Form XObject that Do's itself",
      bytes: selfDoForm(),
      pages: 1,
    },
    {
      id: "H09-count-int-max",
      cls: "H09",
      what: "/Count 2147483647 with 1 real page",
      bytes: simple(onePage(undefined, "/Kids [3 0 R] /Count 2147483647")),
      pages: 1,
    },
    {
      id: "H09-count-negative",
      cls: "H09",
      what: "/Count -1",
      bytes: simple(onePage(undefined, "/Kids [3 0 R] /Count -1")),
      pages: 1,
    },
    {
      id: "H09-count-non-integer",
      cls: "H09",
      what: "/Count 1.5",
      bytes: simple(onePage(undefined, "/Kids [3 0 R] /Count 1.5")),
      pages: 1,
    },
    {
      id: "H10-mediabox-1e9",
      cls: "H10",
      what: "MediaBox [0 0 1e9 1e9] (written 1000000000)",
      bytes: simple(onePage("/MediaBox [0 0 1000000000 1000000000]")),
      pages: 1,
    },
    {
      id: "H10-mediabox-zero",
      cls: "H10",
      what: "MediaBox [0 0 0 0]",
      bytes: simple(onePage("/MediaBox [0 0 0 0]")),
      pages: 1,
    },
    {
      id: "H10-mediabox-inverted",
      cls: "H10",
      what: "MediaBox [300 400 0 0] (inverted corners)",
      bytes: simple(onePage("/MediaBox [300 400 0 0]")),
      pages: 1,
    },
    {
      id: "H10-userunit",
      cls: "H10",
      what: "MediaBox 14,400 pt with /UserUnit 75000",
      bytes: simple(onePage("/MediaBox [0 0 14400 14400] /UserUnit 75000")),
      pages: 1,
    },
    {
      id: "H11-image-100000-square",
      cls: "H11",
      what: "image XObject 100000x100000x8bpc, a stream of 64 bytes",
      bytes: imageXObjectHuge(),
      pages: 1,
    },
    {
      id: "H13-truncated-fontfile2",
      cls: "H13",
      what: "TrueType FontFile2 cut after its header",
      bytes: truncatedFontFile2(),
      pages: 1,
    },
    {
      id: "H13-type3-recursive",
      cls: "H13",
      what: "Type3 font whose CharProc shows itself",
      bytes: type3Recursive(),
      pages: 1,
    },
    {
      id: "H13-broken-cjk-subset",
      cls: "H13",
      what: "BROKEN_CJK_SUBSET (bogus loca)",
      bytes: Uint8Array.from(
        Buffer.from(BROKEN_CJK_SUBSET_PDF_BASE64, "base64"),
      ),
      pages: 1,
    },
    {
      id: "H13-form-broken-dr-font",
      cls: "H13",
      what: "text field whose /DA font is a broken TrueType",
      bytes: formBrokenDrFont(),
      pages: 1,
    },
    {
      id: "H14-user-password",
      cls: "H14",
      what: "RC4-128 with an open password",
      bytes: userPasswordEncryptedPdf(),
      encrypted: "needs-password",
    },
    {
      id: "H14-user-password-objstm",
      cls: "H14",
      what: "open password, object streams",
      bytes: userPasswordObjectStreamPdf(),
      encrypted: "needs-password",
    },
    {
      id: "H14-open-password-pypdf",
      cls: "H14",
      what: "pypdf r3 open-password",
      bytes: readRestrictedFixture("pypdf-r3-open-password.pdf"),
      encrypted: "needs-password",
    },
    {
      id: "H15-owner-only-generated",
      cls: "H15",
      what: "owner password only, RC4-128 (generated)",
      bytes: ownerOnlyEncryptedPdf(),
      encrypted: "opens-without-password",
    },
    {
      id: "H15-qpdf-r2-rc4-40",
      cls: "H15",
      what: "qpdf r2 RC4-40",
      bytes: readRestrictedFixture("qpdf-r2-rc4-40.pdf"),
      encrypted: "opens-without-password",
    },
    {
      id: "H15-qpdf-r3-rc4-128",
      cls: "H15",
      what: "qpdf r3 RC4-128",
      bytes: readRestrictedFixture("qpdf-r3-rc4-128.pdf"),
      encrypted: "opens-without-password",
    },
    {
      id: "H15-qpdf-r4-aes128",
      cls: "H15",
      what: "qpdf r4 AES-128",
      bytes: readRestrictedFixture("qpdf-r4-aes128.pdf"),
      encrypted: "opens-without-password",
    },
    {
      id: "H15-qpdf-r6-aes256",
      cls: "H15",
      what: "qpdf r6 AES-256",
      bytes: readRestrictedFixture("qpdf-r6-aes256.pdf"),
      encrypted: "opens-without-password",
    },
    {
      id: "H15-unknown-handler",
      cls: "H15",
      what: "/Filter /Adobe.PubSec (unknown handler)",
      bytes: await unsupportedEncryptionPdf(),
      encrypted: "unknown-handler",
    },
    {
      id: "H15-unknown-handler-objstm",
      cls: "H15",
      what: "unknown handler, object streams",
      bytes: unknownHandlerObjectStreamPdf(),
      encrypted: "unknown-handler",
    },
    {
      id: "H16-js-openaction",
      cls: "H16",
      what: "catalog /OpenAction JavaScript",
      bytes: activeContent("openaction"),
      pages: 1,
    },
    {
      id: "H16-js-aa",
      cls: "H16",
      what: "catalog and page /AA JavaScript",
      bytes: activeContent("aa"),
      pages: 1,
    },
    {
      id: "H16-launch",
      cls: "H16",
      what: "link annotation /Launch cmd.exe",
      bytes: activeContent("launch"),
      pages: 1,
    },
    {
      id: "H16-uri-javascript",
      cls: "H16",
      what: "/URI (javascript:...)",
      bytes: activeContent("uri-js"),
      pages: 1,
    },
    {
      id: "H16-embedded-files",
      cls: "H16",
      what: "/EmbeddedFiles name tree",
      bytes: activeContent("embedded"),
      pages: 1,
    },
    {
      id: "H17-signed",
      cls: "H17",
      what: "structurally signed, one revision",
      bytes: signedPdf(),
      pages: 1,
    },
    {
      id: "H17-signed-then-updated",
      cls: "H17",
      what: "signed revision + an incremental update that adds an object",
      bytes: appendUpdate(signedPdf(), [{ num: 7, body: "(appended)" }]),
      pages: 1,
    },
    ...numberFixtures(),
    {
      id: "H19-duplicate-id-xref-first",
      cls: "H19",
      what: "obj 3 defined twice (200 then 400 wide); xref -> first",
      bytes: duplicateIds("first"),
      pages: 1,
    },
    {
      id: "H19-duplicate-id-xref-second",
      cls: "H19",
      what: "obj 3 defined twice; xref -> second",
      bytes: duplicateIds("second"),
      pages: 1,
    },
    {
      id: "H20-pdf20-objstm-catalog",
      cls: "H20",
      what: "%PDF-2.0, xref stream only, catalog inside an object stream",
      bytes: pageWithObjstm({ num: 5, members: CATALOG_MEMBERS }, "%PDF-2.0"),
      pages: 1,
    },
    {
      id: "H22-rotate-45",
      cls: "H22",
      what: "/Rotate 45",
      bytes: simple(onePage("/MediaBox [0 0 200 300] /Rotate 45")),
      pages: 1,
    },
    {
      id: "H22-rotate-1e9",
      cls: "H22",
      what: "/Rotate 1000000000",
      bytes: simple(onePage("/MediaBox [0 0 200 300] /Rotate 1000000000")),
      pages: 1,
    },
    {
      id: "H22-rotate-inherited",
      cls: "H22",
      what: "/Rotate 90 on Pages, inherited",
      bytes: simple(
        onePage("/MediaBox [0 0 200 300]", "/Kids [3 0 R] /Count 1 /Rotate 90"),
      ),
      pages: 1,
    },
    {
      id: "H23-objstm-n-lies",
      cls: "H23",
      what: "object stream /N 50 with 2 members",
      bytes: pageWithObjstm({ num: 5, n: 50, members: CATALOG_MEMBERS }),
      // No page count: pdf.js refuses it too ("Invalid Root reference").
    },
    {
      id: "H23-objstm-first-past-end",
      cls: "H23",
      what: "object stream /First beyond the stream length",
      bytes: pageWithObjstm({
        num: 5,
        first: 100000,
        members: CATALOG_MEMBERS,
      }),
    },
    {
      id: "H24-unbalanced-q-100k",
      cls: "H24",
      what: "content: 'q 0.1 0 0 0.1 0 0 cm' + q x 100,000, no Q",
      bytes: simple(
        onePage(
          "/MediaBox [0 0 200 200]",
          undefined,
          "q 0.1 0 0 0.1 0 0 cm\n" + "q ".repeat(100_000),
        ),
      ),
      pages: 1,
    },
    {
      id: "H24-unclosed-q-cm-2",
      cls: "H24",
      what: "content: 'q 0.1 0 0 0.1 0 0 cm q' + a box, both q left open (the minimal repro)",
      bytes: simple(
        onePage(
          "/MediaBox [0 0 200 200]",
          undefined,
          "q 0.1 0 0 0.1 0 0 cm q 0 0 1 rg 500 500 800 800 re f",
        ),
      ),
      pages: 1,
    },
    {
      id: "H24-unclosed-q-1",
      cls: "H24",
      what: "content: 'q 0.1 0 0 0.1 0 0 cm' left open ONCE (control: the engines' wrapper absorbs it)",
      bytes: simple(
        onePage(
          "/MediaBox [0 0 200 200]",
          undefined,
          "q 0.1 0 0 0.1 0 0 cm 0 0 1 rg 500 500 800 800 re f",
        ),
      ),
      pages: 1,
    },
    {
      id: "H24-unbalanced-Q-100k",
      cls: "H24",
      what: "content: Q x 100,000 (more pops than pushes)",
      bytes: simple(
        onePage(
          "/MediaBox [0 0 200 200]",
          undefined,
          "Q ".repeat(100_000) + "0 0 1 rg 20 20 80 80 re f",
        ),
      ),
      pages: 1,
    },
    {
      id: "H24-inline-image-huge",
      cls: "H24",
      what: "BI inline image declaring 100000x100000 with 16 bytes",
      bytes: simple(
        onePage(
          "/MediaBox [0 0 200 200]",
          undefined,
          "q 100 0 0 100 50 50 cm BI /W 100000 /H 100000 /CS /RGB /BPC 8 ID \x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10 EI Q",
        ),
      ),
      pages: 1,
    },
  ];
}

async function buildSlow(): Promise<HostileFixture[]> {
  const doc = await PDFDocument.create();
  const first = doc.addPage([200, 200]);
  first.drawRectangle({ x: 20, y: 20, width: 80, height: 80 });
  const contents = first.node.get(PDFName.of("Contents"));
  for (let i = 1; i < 2000; i += 1) {
    const page = doc.addPage([200, 200]);
    if (contents) page.node.set(PDFName.of("Contents"), contents);
  }
  const twoThousand = await doc.save({ useObjectStreams: false });

  const bomb100 = bomb(100 * 1024 * 1024);
  const chained = deflateSync(bomb(256 * 1024 * 1024), { level: 9 });
  const gib = await streamedZeroDeflate(1024 * 1024 * 1024);
  const withContent = (filter: string, data: Uint8Array) =>
    simple(
      onePage().map((o) =>
        o.num === 4
          ? { num: 4, body: streamBody(`/Filter ${filter}`, data) }
          : o,
      ),
    );

  return [
    {
      id: "H21-2000-pages",
      cls: "H21",
      what: "2,000 pages sharing one content stream",
      bytes: twoThousand,
      pages: 2000,
      slow: true,
    },
    {
      id: "H12-bomb-content-100mb",
      cls: "H12",
      what: `content stream: ${bomb100.length} B Flate -> 100 MiB`,
      bytes: withContent("/FlateDecode", bomb100),
      pages: 1,
      slow: true,
    },
    {
      id: "H12-bomb-xmp-100mb",
      cls: "H12",
      what: `/Metadata XMP stream: ${bomb100.length} B Flate -> 100 MiB`,
      bytes: simple(
        onePage(
          undefined,
          undefined,
          undefined,
          [
            {
              num: 5,
              body: streamBody(
                "/Type /Metadata /Subtype /XML /Filter /FlateDecode",
                bomb100,
              ),
            },
          ],
          "/Metadata 5 0 R",
        ),
      ),
      pages: 1,
      slow: true,
    },
    {
      id: "H12-bomb-xmp-1gib",
      cls: "H12",
      what: `/Metadata XMP stream: ${gib.length} B Flate -> 1 GiB`,
      bytes: simple(
        onePage(
          undefined,
          undefined,
          undefined,
          [
            {
              num: 5,
              body: streamBody(
                "/Type /Metadata /Subtype /XML /Filter /FlateDecode",
                gib,
              ),
            },
          ],
          "/Metadata 5 0 R",
        ),
      ),
      pages: 1,
      slow: true,
    },
    {
      id: "H12-bomb-content-1gib",
      cls: "H12",
      what: `content stream: ${gib.length} B Flate -> 1 GiB`,
      bytes: withContent("/FlateDecode", gib),
      pages: 1,
      slow: true,
    },
    {
      id: "H12-bomb-chained-256mb",
      cls: "H12",
      what: `content [/FlateDecode /FlateDecode]: ${chained.length} B -> 256 MiB`,
      bytes: withContent("[/FlateDecode /FlateDecode]", chained),
      pages: 1,
      slow: true,
    },
  ];
}
