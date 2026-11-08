/**
 * Hostile PDF generators for the "conversion-out" matrix
 * (`conversion-out.hostile.test.ts`) — every fixture built in code,
 * deterministically, from nothing but these lines (no downloads, no binary
 * files). The classes (H01–H24) are the survey's; each generator says which.
 *
 * Owned by the conversion-out family (other families keep their own
 * `*.fixtures.ts` beside it). Importing from here is fine; never change what
 * an existing generator returns, since the matrix pins its outcome.
 *
 * Every builder writes its own xref with REAL offsets unless the class is a
 * lie about offsets, so a fixture is hostile only in the way its name says —
 * a fixture that is broken for a second, accidental reason tests that reason
 * instead. A matrix that uses these runs the positive control (`CONTROL`)
 * through every engine beside them, and checks the shape each fixture claims
 * (conversion-out's "fixture health" block does, with pdf-lib and pdf.js).
 */
import { createDeflate, deflateSync } from "node:zlib";

/** Text every text-bearing fixture draws, so an engine's output can be checked. */
export const MARKER = "HOSTILE MARKER";

const enc = (s: string) => Buffer.from(s, "latin1");

/** One object body: a dictionary/value, or a stream with its dictionary. */
export type RawObj =
  string | { dict: string; stream: Uint8Array | string; noLength?: boolean };

export interface RawPdfOptions {
  header?: string;
  /** Object number of the catalog. */
  root?: number;
  /** More trailer entries, written inside the trailer dictionary. */
  trailer?: string;
  /** Add this to every xref offset (H05: offsets all wrong). */
  offsetShift?: number;
  /** Trailer /Prev pointing at this xref section itself (H06). */
  prevSelf?: boolean;
  /** Write a cross-reference STREAM instead of a classic table. */
  xrefStream?: boolean;
}

function body(obj: RawObj): Buffer {
  if (typeof obj === "string") return enc(obj);
  const data =
    typeof obj.stream === "string" ? enc(obj.stream) : Buffer.from(obj.stream);
  const length = obj.noLength ? "" : ` /Length ${data.length}`;
  return Buffer.concat([
    enc(`<< ${obj.dict}${length} >>\nstream\n`),
    data,
    enc("\nendstream"),
  ]);
}

/** A cross-reference stream body (uncompressed, /W [1 4 2]). */
function xrefStreamObject(
  entries: { type: 0 | 1 | 2; a: number; b: number }[],
  dict: string,
): RawObj {
  const data = Buffer.alloc(entries.length * 7);
  entries.forEach((e, i) => {
    data.writeUInt8(e.type, i * 7);
    data.writeUInt32BE(e.a, i * 7 + 1);
    data.writeUInt16BE(e.b, i * 7 + 5);
  });
  return {
    dict: `/Type /XRef /W [1 4 2] /Size ${entries.length} ${dict}`,
    stream: data,
  };
}

/**
 * Objects numbered 1..n (a `null` slot is a free entry), written with an xref
 * whose offsets are true unless an option says otherwise.
 */
export function rawPdf(
  objects: (RawObj | null)[],
  opts: RawPdfOptions = {},
): Uint8Array {
  const header = opts.header ?? "%PDF-1.7";
  const parts: Buffer[] = [enc(`${header}\n%\xe2\xe3\xcf\xd3\n`)];
  let length = parts[0]!.length;
  const offsets: (number | null)[] = [];
  objects.forEach((obj, i) => {
    if (obj === null) {
      offsets.push(null);
      return;
    }
    offsets.push(length);
    const chunk = Buffer.concat([
      enc(`${i + 1} 0 obj\n`),
      body(obj),
      enc("\nendobj\n"),
    ]);
    parts.push(chunk);
    length += chunk.length;
  });
  const shift = opts.offsetShift ?? 0;
  const root = opts.root ?? 1;
  const xrefAt = length;
  const prev = opts.prevSelf ? ` /Prev ${xrefAt}` : "";
  if (opts.xrefStream) {
    const num = objects.length + 1;
    const entries: { type: 0 | 1 | 2; a: number; b: number }[] = [
      { type: 0, a: 0, b: 65535 },
      ...offsets.map((o) =>
        o === null
          ? { type: 0 as const, a: 0, b: 0 }
          : { type: 1 as const, a: o + shift, b: 0 },
      ),
      { type: 1, a: xrefAt, b: 0 },
    ];
    const xs = xrefStreamObject(
      entries,
      `/Root ${root} 0 R${prev} ${opts.trailer ?? ""}`,
    );
    parts.push(
      Buffer.concat([enc(`${num} 0 obj\n`), body(xs), enc("\nendobj\n")]),
    );
    parts.push(enc(`startxref\n${xrefAt}\n%%EOF\n`));
    return new Uint8Array(Buffer.concat(parts));
  }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) {
    xref +=
      o === null
        ? "0000000000 00000 f \n"
        : `${String(o + shift).padStart(10, "0")} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R${prev} ` +
    `${opts.trailer ?? ""} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(enc(xref));
  return new Uint8Array(Buffer.concat(parts));
}

const HELVETICA = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
const textOps = (text = MARKER, y = 100) =>
  `BT /F1 14 Tf 20 ${y} Td (${text}) Tj ET`;

export interface SimplePdfParts {
  header?: string;
  catalogExtra?: string;
  pagesExtra?: string;
  pageExtra?: string;
  mediaBox?: string;
  /** Page content; the marker text by default. */
  content?: RawObj;
  /** More resources inside the page /Resources (beside /Font /F1 5 0 R). */
  resources?: string;
  /** Objects 6.. (refer to them by number from the parts above). */
  extra?: RawObj[];
  options?: RawPdfOptions;
}

/**
 * The one-page shape most classes perturb: 1 catalog, 2 pages, 3 page,
 * 4 content, 5 Helvetica, 6.. `extra`.
 */
export function simplePdf(parts: SimplePdfParts = {}): Uint8Array {
  return rawPdf(
    [
      `<< /Type /Catalog /Pages 2 0 R ${parts.catalogExtra ?? ""} >>`,
      `<< /Type /Pages /Kids [3 0 R] /Count 1 ${parts.pagesExtra ?? ""} >>`,
      `<< /Type /Page /Parent 2 0 R /MediaBox ${parts.mediaBox ?? "[0 0 300 200]"} ` +
        `/Resources << /Font << /F1 5 0 R >> ${parts.resources ?? ""} >> ` +
        `/Contents 4 0 R ${parts.pageExtra ?? ""} >>`,
      parts.content ?? { dict: "", stream: textOps() },
      HELVETICA,
      ...(parts.extra ?? []),
    ],
    { header: parts.header, ...parts.options },
  );
}

/** The positive control: a valid one-page PDF that draws {@link MARKER}. */
export const CONTROL = (): Uint8Array => simplePdf();

/* ------------------------------------------------------------------ *
 *  H01–H03 not a PDF
 * ------------------------------------------------------------------ */

/** Deterministic bytes (mulberry32), so "random" is the same every run. */
export function seededBytes(n: number, seed = 0x5eed): Uint8Array {
  const out = new Uint8Array(n);
  let a = seed >>> 0;
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

export const zeroBytePdf = (): Uint8Array => new Uint8Array(0);
export const pngMagicPdf = (): Uint8Array =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...seededBytes(200, 1),
  ]);
export const zipMagicPdf = (): Uint8Array =>
  new Uint8Array([
    0x50,
    0x4b,
    0x03,
    0x04,
    ...enc("[Content_Types].xml"),
    ...seededBytes(200, 2),
  ]);
export const random4kPdf = (): Uint8Array => seededBytes(4096, 3);
export const htmlPdf = (): Uint8Array =>
  new Uint8Array(
    enc("<!doctype html><html><body><h1>Not a PDF</h1></body></html>\n"),
  );
export const headerOnlyPdf = (): Uint8Array =>
  new Uint8Array(enc("%PDF-1.7\n"));

/* ------------------------------------------------------------------ *
 *  H04 truncated, H05 broken xref
 * ------------------------------------------------------------------ */

export const truncatedHalfPdf = (): Uint8Array => {
  const full = CONTROL();
  return full.slice(0, Math.floor(full.length / 2));
};

/** Cut right after the last `endobj`: every object, no xref, no trailer. */
export const truncatedAtEndobjPdf = (): Uint8Array => {
  const full = Buffer.from(CONTROL());
  const at = full.lastIndexOf("endobj");
  return new Uint8Array(full.subarray(0, at + "endobj\n".length));
};

export const xrefOffsetsWrongPdf = (): Uint8Array =>
  simplePdf({ options: { offsetShift: 7 } });

export const xrefGarbagePdf = (): Uint8Array => {
  const text = Buffer.from(CONTROL()).toString("latin1");
  const at = text.lastIndexOf("xref\n0 ");
  const trailer = text.indexOf("trailer", at);
  return new Uint8Array(
    enc(
      text.slice(0, at) +
        "xref\n0 6\nthis is not 20 byte xref garbage\n%%%%\n" +
        text.slice(trailer),
    ),
  );
};

/* ------------------------------------------------------------------ *
 *  H06 xref loops
 * ------------------------------------------------------------------ */

export const prevSelfPdf = (): Uint8Array =>
  simplePdf({ options: { prevSelf: true } });

export const prevSelfXrefStreamPdf = (): Uint8Array =>
  simplePdf({ options: { prevSelf: true, xrefStream: true } });

/**
 * Two classic xref sections whose trailers name each other in /Prev: the
 * original's trailer is patched (fixed-width digits) to point FORWARD at an
 * appended update section, whose /Prev points back.
 */
export const prevCyclePdf = (): Uint8Array => {
  const base = Buffer.from(
    simplePdf({ options: { trailer: "/Prev 0000000000" } }),
  ).toString("latin1");
  const baseXref = base.lastIndexOf("xref\n0 ");
  const content = textOps("UPDATED " + MARKER);
  const obj4 = `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  const obj4At = base.length;
  const updateXref = obj4At + obj4.length;
  const update =
    obj4 +
    `xref\n0 1\n0000000000 65535 f \n4 1\n${String(obj4At).padStart(10, "0")} 00000 n \n` +
    `trailer\n<< /Size 6 /Root 1 0 R /Prev ${baseXref} >>\nstartxref\n${updateXref}\n%%EOF\n`;
  const patched = base.replace(
    "/Prev 0000000000",
    `/Prev ${String(updateXref).padStart(10, "0")}`,
  );
  return new Uint8Array(enc(patched + update));
};

/* ------------------------------------------------------------------ *
 *  H07 self-reference
 * ------------------------------------------------------------------ */

export const parentCyclePdf = (): Uint8Array =>
  rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 3 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: textOps() },
    HELVETICA,
  ]);

export const kidsSelfPdf = (): Uint8Array =>
  rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: textOps() },
    HELVETICA,
  ]);

/** The catalog's /Pages is object 6, whose whole value is `6 0 R`. */
export const objectSelfRefPdf = (): Uint8Array =>
  rawPdf([
    "<< /Type /Catalog /Pages 6 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: textOps() },
    HELVETICA,
    "6 0 R",
  ]);

/* ------------------------------------------------------------------ *
 *  H08 deep nesting
 * ------------------------------------------------------------------ */

/** A /Kids chain `depth` Pages nodes deep, one real page at the bottom. */
export function deepKidsPdf(depth = 2000): Uint8Array {
  // 1 catalog, 2 content, 3 font, 4 page, 5.. pages nodes (5 is the root).
  const objs: RawObj[] = [
    "<< /Type /Catalog /Pages 5 0 R >>",
    { dict: "", stream: textOps() },
    HELVETICA,
    `<< /Type /Page /Parent ${4 + depth} 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 2 0 R >>`,
  ];
  for (let i = 0; i < depth; i++) {
    const num = 5 + i;
    const kid = i === depth - 1 ? 4 : num + 1;
    const parent = i === 0 ? "" : `/Parent ${num - 1} 0 R`;
    objs.push(`<< /Type /Pages /Kids [${kid} 0 R] /Count 1 ${parent} >>`);
  }
  return rawPdf(objs);
}

/** A chain of `depth` Form XObjects, each drawing the next; the last draws text. */
export function nestedFormsPdf(depth = 2000): Uint8Array {
  const extra: RawObj[] = [];
  for (let i = 0; i < depth; i++) {
    const num = 6 + i;
    const last = i === depth - 1;
    extra.push({
      dict:
        `/Type /XObject /Subtype /Form /BBox [0 0 300 200] ` +
        `/Resources << /Font << /F1 5 0 R >>${last ? "" : ` /XObject << /X ${num + 1} 0 R >>`} >>`,
      stream: last ? textOps() : "/X Do",
    });
  }
  return simplePdf({
    content: { dict: "", stream: "/X Do" },
    resources: "/XObject << /X 6 0 R >>",
    extra,
  });
}

/** A Form XObject whose own resources name itself, and which draws itself. */
export const formSelfDoPdf = (): Uint8Array =>
  simplePdf({
    content: { dict: "", stream: `${textOps()} /X Do` },
    resources: "/XObject << /X 6 0 R >>",
    extra: [
      {
        dict: "/Type /XObject /Subtype /Form /BBox [0 0 300 200] /Resources << /XObject << /X 6 0 R >> >>",
        stream: "0 0 m 10 10 l S /X Do",
      },
    ],
  });

/* ------------------------------------------------------------------ *
 *  H09 /Count lies, H10 page boxes
 * ------------------------------------------------------------------ */

export const countHugePdf = (): Uint8Array =>
  rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 2147483647 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: textOps() },
    HELVETICA,
  ]);
export const countNegativePdf = (): Uint8Array =>
  rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count -1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: textOps() },
    HELVETICA,
  ]);
export const countNonIntegerPdf = (): Uint8Array =>
  rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1.5 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: textOps() },
    HELVETICA,
  ]);

export const mediaBoxHugePdf = (): Uint8Array =>
  simplePdf({ mediaBox: "[0 0 1e9 1e9]" });
/** pdf.js and pdf-lib both read `1e9` as a number only if they read exponents. */
export const mediaBoxHugePlainPdf = (): Uint8Array =>
  simplePdf({ mediaBox: "[0 0 1000000000 1000000000]" });
export const mediaBoxZeroPdf = (): Uint8Array =>
  simplePdf({ mediaBox: "[0 0 0 0]" });
export const mediaBoxInvertedPdf = (): Uint8Array =>
  simplePdf({ mediaBox: "[300 200 0 0]" });
/** 14,400 pt (the spec's maximum page side) at /UserUnit 1000. */
export const userUnitHugePdf = (): Uint8Array =>
  simplePdf({ mediaBox: "[0 0 14400 14400]", pageExtra: "/UserUnit 1000" });

/* ------------------------------------------------------------------ *
 *  H11 huge image, H12 decompression bombs
 * ------------------------------------------------------------------ */

const IMAGE_DO = "q 100 0 0 100 50 50 cm /Im1 Do Q";

export const imageHugeDimsPdf = (): Uint8Array =>
  simplePdf({
    content: { dict: "", stream: `${textOps()} ${IMAGE_DO}` },
    resources: "/XObject << /Im1 6 0 R >>",
    extra: [
      {
        dict: "/Type /XObject /Subtype /Image /Width 100000 /Height 100000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
        stream: deflateSync(Buffer.alloc(1024)),
      },
    ],
  });

/** Deflate `total` zero bytes without holding them (1 MiB chunks). */
export function deflatedZeros(total: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const d = createDeflate({ level: 9 });
    const chunks: Buffer[] = [];
    d.on("data", (c: Buffer) => chunks.push(c));
    d.on("error", reject);
    d.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    const zero = Buffer.alloc(1 << 20);
    let left = Math.ceil(total / zero.length);
    const write = () => {
      while (left > 0) {
        left -= 1;
        if (!d.write(zero)) {
          d.once("drain", write);
          return;
        }
      }
      d.end();
    };
    write();
  });
}

/**
 * H12: page content is [marker, bomb]; the bomb is ~100 KB that inflates to
 * 100 MiB of zeros.
 */
export async function flateBombPdf(): Promise<Uint8Array> {
  const bomb = await deflatedZeros(100 << 20);
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents [4 0 R 6 0 R] >>",
    { dict: "", stream: textOps() },
    HELVETICA,
    { dict: "/Filter /FlateDecode", stream: bomb },
  ]);
}

/** H12: [/FlateDecode /FlateDecode], ~2 KB on disk, 1 GiB of zeros inflated. */
export async function chainedFlateBombPdf(): Promise<Uint8Array> {
  const inner = await deflatedZeros(1 << 30);
  const outer = deflateSync(inner, { level: 9 });
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents [4 0 R 6 0 R] >>",
    { dict: "", stream: textOps() },
    HELVETICA,
    { dict: "/Filter [/FlateDecode /FlateDecode]", stream: outer },
  ]);
}

/**
 * H12 inside the pixel cap: a 10,000 x 10,000 RGB image (exactly 100 MP,
 * 300 MB of samples) whose stream is ~300 KB of deflated zeros.
 */
export async function imageBombAtCapPdf(): Promise<Uint8Array> {
  const data = await deflatedZeros(10000 * 10000 * 3);
  return simplePdf({
    content: { dict: "", stream: `${textOps()} ${IMAGE_DO}` },
    resources: "/XObject << /Im1 6 0 R >>",
    extra: [
      {
        dict: "/Type /XObject /Subtype /Image /Width 10000 /Height 10000 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode",
        stream: data,
      },
    ],
  });
}

/* ------------------------------------------------------------------ *
 *  H13 invalid fonts
 * ------------------------------------------------------------------ */

function trueTypeFontPdf(fontFile: Uint8Array): Uint8Array {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: textOps() },
    "<< /Type /Font /Subtype /TrueType /BaseFont /Hostile /FirstChar 32 /LastChar 126 /Widths 7 0 R /FontDescriptor 6 0 R /Encoding /WinAnsiEncoding >>",
    "<< /Type /FontDescriptor /FontName /Hostile /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 8 0 R >>",
    `[${Array.from({ length: 95 }, () => "500").join(" ")}]`,
    { dict: "", stream: fontFile },
  ]);
}

/** An sfnt header that claims ten tables and then stops. */
export const truncatedFontFile2Pdf = (): Uint8Array => {
  const head = Buffer.alloc(12 + 16 * 2);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt16BE(10, 4);
  head.write("glyf", 12, "latin1");
  head.writeUInt32BE(0x7fffffff, 12 + 8);
  head.writeUInt32BE(0x7fffffff, 12 + 12);
  head.write("loca", 28, "latin1");
  head.writeUInt32BE(40, 28 + 8);
  head.writeUInt32BE(0xffff, 28 + 12);
  return trueTypeFontPdf(head);
};

/** A complete-looking sfnt whose loca runs backwards and past glyf. */
export const bogusLocaPdf = (): Uint8Array => {
  const tables: [string, Buffer][] = [];
  const headT = Buffer.alloc(54);
  headT.writeUInt32BE(0x00010000, 0);
  headT.writeUInt32BE(0x5f0f3cf5, 12);
  headT.writeUInt16BE(1000, 18); // unitsPerEm
  headT.writeInt16BE(0, 50); // indexToLocFormat: short
  const maxp = Buffer.alloc(6);
  maxp.writeUInt32BE(0x00005000, 0);
  maxp.writeUInt16BE(4, 4);
  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x00010000, 0);
  hhea.writeUInt16BE(1, 34);
  const hmtx = Buffer.alloc(4);
  hmtx.writeUInt16BE(500, 0);
  const loca = Buffer.alloc(10);
  [0, 0xffff, 3, 0xfff0, 1].forEach((v, i) => loca.writeUInt16BE(v, i * 2));
  const glyf = Buffer.from([0xff, 0xff, 0, 0, 0, 0, 0x7f, 0xff]);
  tables.push(
    ["glyf", glyf],
    ["head", headT],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["loca", loca],
    ["maxp", maxp],
  );
  const dirLen = 12 + 16 * tables.length;
  const dir = Buffer.alloc(dirLen);
  dir.writeUInt32BE(0x00010000, 0);
  dir.writeUInt16BE(tables.length, 4);
  let offset = dirLen;
  const datas: Buffer[] = [];
  tables.forEach(([tag, data], i) => {
    const at = 12 + i * 16;
    dir.write(tag, at, "latin1");
    dir.writeUInt32BE(offset, at + 8);
    dir.writeUInt32BE(data.length, at + 12);
    const padded = Buffer.concat([
      data,
      Buffer.alloc((4 - (data.length % 4)) % 4),
    ]);
    datas.push(padded);
    offset += padded.length;
  });
  return trueTypeFontPdf(new Uint8Array(Buffer.concat([dir, ...datas])));
};

/** A Type3 font whose only glyph draws itself in the same font. */
export const type3RecursivePdf = (): Uint8Array =>
  rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R /T3 6 0 R >> >> /Contents 4 0 R >>",
    { dict: "", stream: `${textOps()} BT /T3 24 Tf 20 40 Td (aaa) Tj ET` },
    HELVETICA,
    "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /a 7 0 R >> /Encoding << /Type /Encoding /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [1000] /Resources << /Font << /T3 6 0 R >> >> >>",
    { dict: "", stream: "1000 0 d0 BT /T3 24 Tf 0 0 Td (a) Tj ET" },
  ]);

/* ------------------------------------------------------------------ *
 *  H16 active content
 * ------------------------------------------------------------------ */

export const jsOpenActionPdf = (): Uint8Array =>
  simplePdf({
    catalogExtra:
      "/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> /AA << /WC << /S /JavaScript /JS (app.alert\\(2\\)) >> >>",
    pageExtra: "/AA << /O << /S /JavaScript /JS (app.alert\\(3\\)) >> >>",
  });

export const launchActionPdf = (): Uint8Array =>
  simplePdf({
    pageExtra: "/Annots [6 0 R]",
    extra: [
      "<< /Type /Annot /Subtype /Link /Rect [15 95 200 115] /Border [0 0 0] /A << /S /Launch /F (calc.exe) /Win << /F (cmd.exe) /P (/c calc) >> >> >>",
    ],
  });

/** A link over the marker text whose URI is `javascript:`. */
export const javascriptUriPdf = (): Uint8Array =>
  simplePdf({
    pageExtra: "/Annots [6 0 R]",
    extra: [
      "<< /Type /Annot /Subtype /Link /Rect [15 95 200 115] /Border [0 0 0] /A << /S /URI /URI (javascript:alert\\(document.cookie\\)) >> >>",
    ],
  });

export const embeddedFilesPdf = (): Uint8Array =>
  simplePdf({
    catalogExtra:
      "/Names << /EmbeddedFiles << /Names [(evil.exe) 6 0 R] >> >> /PageMode /UseAttachments",
    extra: [
      "<< /Type /Filespec /F (evil.exe) /UF (evil.exe) /EF << /F 7 0 R >> >>",
      {
        dict: "/Type /EmbeddedFile /Subtype /application#2Fx-msdownload",
        stream: "MZ\x90\x00 not really an exe",
      },
    ],
  });

/* ------------------------------------------------------------------ *
 *  H17 signed, then updated
 * ------------------------------------------------------------------ */

/**
 * A signed revision (a /Sig field whose /ByteRange covers revision 1) with an
 * incremental update appended that changes the page's text.
 */
export const signedThenUpdatedPdf = (): Uint8Array => {
  const contents = "0".repeat(512);
  const base = Buffer.from(
    simplePdf({
      catalogExtra: "/AcroForm << /Fields [6 0 R] /SigFlags 3 >>",
      pageExtra: "/Annots [6 0 R]",
      extra: [
        "<< /FT /Sig /T (Signature1) /V 7 0 R /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R /F 132 >>",
        `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0000000000 0000000000 0000000000] /Contents <${contents}> /M (D:20260101000000Z) >>`,
      ],
    }),
  ).toString("latin1");
  // Real ByteRange around /Contents <...>, fixed-width digits.
  const cAt = base.indexOf(`<${contents}>`);
  const afterAt = cAt + contents.length + 2;
  const pad = (n: number) => String(n).padStart(10, "0");
  const signed = base.replace(
    "/ByteRange [0 0000000000 0000000000 0000000000]",
    `/ByteRange [0 ${pad(cAt)} ${pad(afterAt)} ${pad(base.length - afterAt)}]`,
  );
  const baseXref = signed.lastIndexOf("xref\n0 ");
  const content = textOps("UPDATED AFTER SIGNING");
  const obj4 = `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  const obj4At = signed.length;
  const xrefAt = obj4At + obj4.length;
  const update =
    obj4 +
    `xref\n0 1\n0000000000 65535 f \n4 1\n${pad(obj4At)} 00000 n \n` +
    `trailer\n<< /Size 8 /Root 1 0 R /Prev ${baseXref} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(enc(signed + update));
};

/* ------------------------------------------------------------------ *
 *  H18 hostile numbers, H19 duplicate ids
 * ------------------------------------------------------------------ */

export const numbersMediaBoxPdf = (): Uint8Array =>
  simplePdf({ mediaBox: "[0 0 1e309 99999999999999999999]" });
export const numbersRotatePdf = (): Uint8Array =>
  simplePdf({ pageExtra: "/Rotate --5" });
export const numbersMatrixPdf = (): Uint8Array =>
  simplePdf({
    content: { dict: "", stream: `${textOps()} 1e309 -0 . --5 0 0 cm /X Do` },
    resources: "/XObject << /X 6 0 R >>",
    extra: [
      {
        dict: "/Type /XObject /Subtype /Form /BBox [0 0 . 1e309] /Matrix [1 0 0 1 --5 .] /Resources << /Font << /F1 5 0 R >> >>",
        stream: textOps("FORM", 60),
      },
    ],
  });

/**
 * Object 3 (the page) defined twice; `which` says which definition the xref
 * points at. The first is 300 x 200 with the marker, the second 400 x 400
 * with "SECOND DEFINITION".
 */
export function duplicateObjectPdf(which: "first" | "second"): Uint8Array {
  const header = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";
  const second = textOps("SECOND DEFINITION");
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${textOps().length} >>\nstream\n${textOps()}\nendstream\nendobj\n`,
    `5 0 obj\n${HELVETICA}\nendobj\n`,
    `6 0 obj\n<< /Length ${second.length} >>\nstream\n${second}\nendstream\nendobj\n`,
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>\nendobj\n",
  ];
  let text = header;
  const at: number[] = [];
  for (const o of objs) {
    at.push(text.length);
    text += o;
  }
  const page = which === "first" ? at[2]! : at[6]!;
  const offsets = [at[0]!, at[1]!, page, at[3]!, at[4]!, at[5]!];
  const xrefAt = text.length;
  text += "xref\n0 7\n0000000000 65535 f \n";
  for (const o of offsets) text += `${String(o).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(enc(text));
}

/* ------------------------------------------------------------------ *
 *  H20 PDF 2.0, object streams only; H23 lying object streams
 * ------------------------------------------------------------------ */

/**
 * PDF 2.0 header; catalog, pages, page and font live in an object stream
 * (object 6); the only cross-reference is a stream (object 7).
 */
export function objectStreamOnlyPdf(
  lie: { n?: number; first?: number } = {},
  header = "%PDF-2.0",
): Uint8Array {
  const members: [number, string][] = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    ],
    [5, HELVETICA],
  ];
  let objData = "";
  const pairs: string[] = [];
  for (const [num, src] of members) {
    pairs.push(`${num} ${objData.length}`);
    objData += `${src}\n`;
  }
  const head = `${pairs.join(" ")}\n`;
  const first = lie.first ?? head.length;
  const n = lie.n ?? members.length;
  const out: Buffer[] = [enc(`${header}\n%\xe2\xe3\xcf\xd3\n`)];
  let length = out[0]!.length;
  const content = textOps();
  const obj4 = `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  const obj4At = length;
  out.push(enc(obj4));
  length += obj4.length;
  const stmData = head + objData;
  const obj6 = `6 0 obj\n<< /Type /ObjStm /N ${n} /First ${first} /Length ${stmData.length} >>\nstream\n${stmData}\nendstream\nendobj\n`;
  const obj6At = length;
  out.push(enc(obj6));
  length += obj6.length;
  const xrefAt = length;
  const entries: { type: 0 | 1 | 2; a: number; b: number }[] = [
    { type: 0, a: 0, b: 65535 },
    { type: 2, a: 6, b: 0 },
    { type: 2, a: 6, b: 1 },
    { type: 2, a: 6, b: 2 },
    { type: 1, a: obj4At, b: 0 },
    { type: 2, a: 6, b: 3 },
    { type: 1, a: obj6At, b: 0 },
    { type: 1, a: xrefAt, b: 0 },
  ];
  const xs = xrefStreamObject(entries, "/Root 1 0 R");
  out.push(Buffer.concat([enc("7 0 obj\n"), body(xs), enc("\nendobj\n")]));
  out.push(enc(`startxref\n${xrefAt}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(out));
}

/* ------------------------------------------------------------------ *
 *  H21 many pages, H22 rotation, H24 content-stream abuse
 * ------------------------------------------------------------------ */

/** `n` pages sharing one tiny content stream (object 4). */
export function manyPagesPdf(n = 2000): Uint8Array {
  const objs: RawObj[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${6 + i} 0 R`).join(" ")}] /Count ${n} >>`,
    "null",
    { dict: "", stream: textOps() },
    HELVETICA,
  ];
  for (let i = 0; i < n; i++) {
    objs.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    );
  }
  return rawPdf(objs);
}

export const rotate45Pdf = (): Uint8Array =>
  simplePdf({ pageExtra: "/Rotate 45" });
export const rotateHugePdf = (): Uint8Array =>
  simplePdf({ pageExtra: "/Rotate 1000000000" });
/** /Rotate 90 on the Pages node only: the page inherits it (300 x 200 → 200 x 300). */
export const rotateInheritedPdf = (): Uint8Array =>
  simplePdf({ pagesExtra: "/Rotate 90" });

export const unbalancedQPdf = (): Uint8Array =>
  simplePdf({
    content: { dict: "", stream: `${"q ".repeat(100000)}${textOps()}` },
  });

export const inlineImageHugePdf = (): Uint8Array =>
  simplePdf({
    content: {
      dict: "",
      stream: `${textOps()} q 100 0 0 100 50 50 cm BI /W 100000 /H 100000 /BPC 8 /CS /RGB ID \x00\x00\x00\x00\x00\x00 EI Q`,
    },
  });

/** Unbalanced the other way: 100,000 `Q` with no `q`. */
export const unbalancedCloseQPdf = (): Uint8Array =>
  simplePdf({
    content: { dict: "", stream: `${"Q ".repeat(100000)}${textOps()}` },
  });
