// Fixtures for lane res1 of the hostile-input residuals: files that reach
// pdf.js through an open that ran neither the stream preflight nor the xref
// pre-scan (the page board, Compare's cards, Auto-crop, the editor canvas),
// and files that hid a Flate stage behind an ASCII one or put `q` in text.
import { createDeflate, deflateSync } from "node:zlib";
import { rawPdf } from "./conversion-out.fixtures";
import { ONE_PAGE, xrefStreamPdf } from "./page-structure.raw";

const enc = (s: string) => Buffer.from(s, "latin1");

/** `prefix`, then `zeros` zero bytes, deflated, streamed (never held whole). */
function deflatedWithZeros(prefix: string, zeros: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const d = createDeflate({ level: 9 });
    const chunks: Buffer[] = [];
    d.on("data", (c: Buffer) => chunks.push(c));
    d.on("error", reject);
    d.on("end", () => resolve(Buffer.concat(chunks)));
    d.write(enc(prefix));
    const zero = Buffer.alloc(1 << 20);
    let left = Math.ceil(zeros / zero.length);
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

/** One object stream's filters and data, for {@link objStmChainPdf}. */
export interface ObjStmBody {
  filters: string;
  data: Uint8Array;
}

/**
 * Each of `members` in an object stream of its own: member k is object
 * 100 + k, held by stream object k + 1, whose filters and data
 * `streamFor(k, text)` makes from the stream's decoded text. Object 100 is
 * the catalog. An xref stream indexes both ranges.
 */
export async function objStmChainPdf(
  members: readonly string[],
  streamFor: (k: number, text: string) => Promise<ObjStmBody>,
): Promise<Uint8Array> {
  const count = members.length;
  const parts: Buffer[] = [enc("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const head = `${100 + k} 0\n`;
    const { filters, data } = await streamFor(k, `${head}${members[k]}\n`);
    const obj = Buffer.concat([
      enc(
        `${k + 1} 0 obj\n<< /Type /ObjStm /N 1 /First ${head.length} /Filter ${filters} /Length ${data.length} >>\nstream\n`,
      ),
      data,
      enc("\nendstream\nendobj\n"),
    ]);
    offsets.push(length);
    parts.push(obj);
    length += obj.length;
  }
  const xrefAt = length;
  const rows: [number, number, number][] = [[0, 0, 0xffff]];
  for (const o of offsets) rows.push([1, o, 0]);
  rows.push([1, xrefAt, 0]);
  for (let k = 0; k < count; k += 1) rows.push([2, k + 1, 0]);
  const table = Buffer.alloc(rows.length * 7);
  rows.forEach(([t, a, b], i) => {
    table.writeUInt8(t, i * 7);
    table.writeUInt32BE(a, i * 7 + 1);
    table.writeUInt16BE(b, i * 7 + 5);
  });
  parts.push(
    enc(
      `${count + 1} 0 obj\n<< /Type /XRef /Size ${100 + count} /Index [0 ${count + 2} 100 ${count}] /W [1 4 2] /Root 100 0 R /Length ${table.length} >>\nstream\n`,
    ),
    table,
    enc(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * Every object pdf.js needs to open the file and walk its pages sits in an
 * object stream of its own, each behind two Flate stages that inflate to
 * `mebibytes` MiB: the catalog in the first, the page tree in the second,
 * one page in each of the rest (`count - 2` pages). Opening it inflates the
 * catalog's stream; walking the pages inflates every one. A few KB on disk
 * for 20 x 100 MiB.
 */
export function catalogObjStmBombPdf(
  count = 20,
  mebibytes = 100,
): Promise<Uint8Array> {
  const pages = count - 2;
  return objStmChainPdf(
    [
      "<< /Type /Catalog /Pages 101 0 R >>",
      `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${102 + i} 0 R`).join(" ")}] /Count ${pages} >>`,
      ...Array.from(
        { length: pages },
        () => "<< /Type /Page /Parent 101 0 R /MediaBox [0 0 200 200] >>",
      ),
    ],
    async (_, text) => ({
      filters: "[/FlateDecode /FlateDecode]",
      data: deflateSync(await deflatedWithZeros(text, mebibytes << 20), {
        level: 9,
      }),
    }),
  );
}

/**
 * SIB-03's shape: an xref stream whose rows are zero bytes wide over an
 * /Index of two billion entries. pdf.js walks the count and stores an entry
 * each time.
 */
export const zeroWidthXrefPdf = (): Uint8Array =>
  xrefStreamPdf({
    objects: ONE_PAGE,
    w: "[0 0 0]",
    trailer: "/Index [0 2000000000]",
  });

/**
 * One page whose /Contents are `n` streams of `k` unclosed q (the second
 * review's split shape: 32 x 1,020 is 32,640 deep, 66 s of text read).
 */
export function splitQPdf(n: number, k: number): Uint8Array {
  const streams = Array.from({ length: n }, (_, i) => ({
    dict: "",
    stream:
      (i === 0 ? "BT /F1 14 Tf 20 100 Td (MARK) Tj ET\n" : "") +
      "q\n".repeat(k) +
      (i === n - 1 ? "BT /F1 14 Tf 20 50 Td (END) Tj ET\n" : ""),
  }));
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents [${streams.map((_, i) => `${i + 5} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...streams,
  ]);
}

/**
 * An unencrypted file whose root /Pages says /Count -1 over three real
 * kids. pdf-lib repairs the tree and reads three pages; pdf.js reports
 * numPages -1 as given.
 */
export const countMinusOnePdf = (): Uint8Array =>
  rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count -1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 6 0 R >>",
    { dict: "", stream: "0 0 0 rg 50 50 100 100 re f\n" },
  ]);

/** `data` as pdf.js's ASCIIHexDecode reads it, 64 digits a line. */
export function asciiHex(data: Uint8Array): Uint8Array {
  const hex = Buffer.from(data).toString("hex");
  const lines: string[] = [];
  for (let i = 0; i < hex.length; i += 64) lines.push(hex.slice(i, i + 64));
  return new Uint8Array(enc(`${lines.join("\n")}>`));
}

/** `data` as ASCII85 (Adobe's encoding, `~>`-terminated, `z` for zeros). */
export function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  for (; i + 4 <= data.length; i += 4) {
    const v =
      ((data[i]! << 24) |
        (data[i + 1]! << 16) |
        (data[i + 2]! << 8) |
        data[i + 3]!) >>>
      0;
    if (v === 0) {
      out.push(0x7a);
      continue;
    }
    const g = [0, 0, 0, 0, 0];
    let t = v;
    for (let j = 4; j >= 0; j -= 1) {
      g[j] = t % 85;
      t = Math.floor(t / 85);
    }
    for (const c of g) out.push(c + 0x21);
  }
  const rest = data.length - i;
  if (rest > 0) {
    const pad = new Uint8Array(4);
    pad.set(data.subarray(i));
    let t =
      ((pad[0]! << 24) | (pad[1]! << 16) | (pad[2]! << 8) | pad[3]!) >>> 0;
    const g = [0, 0, 0, 0, 0];
    for (let j = 4; j >= 0; j -= 1) {
      g[j] = t % 85;
      t = Math.floor(t / 85);
    }
    for (let j = 0; j <= rest; j += 1) out.push(g[j]! + 0x21);
  }
  out.push(0x7e, 0x3e);
  return new Uint8Array(out);
}

/** One page whose /Contents (object 4) carries `dict` over `stream`. */
export function oneContentPdf(
  dict: string,
  stream: Uint8Array | string,
): Uint8Array {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    { dict, stream },
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

/**
 * Item 3's object-stream variant: the catalog, the page tree and the page,
 * each in an object stream; the PAGE's stream is `filters` over `encode`d
 * deflate of its text and `zeros` zero bytes. Opening it and reading page 1
 * inflates that stream.
 */
export function objStmBehindFiltersPdf(
  filters: string,
  encode: (deflated: Uint8Array) => Uint8Array,
  zeros: number,
): Promise<Uint8Array> {
  return objStmChainPdf(
    [
      "<< /Type /Catalog /Pages 101 0 R >>",
      "<< /Type /Pages /Kids [102 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 101 0 R /MediaBox [0 0 200 200] >>",
    ],
    async (k, text) =>
      k === 2
        ? {
            filters,
            data: encode(new Uint8Array(await deflatedWithZeros(text, zeros))),
          }
        : { filters: "/FlateDecode", data: deflateSync(enc(text)) },
  );
}

/** `pages` pages, each one content stream of `lines` copies of `line`. */
export function textPagesPdf(pages: number, line: string, lines: number) {
  const objects: Parameters<typeof rawPdf>[0] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const body =
    "BT /F1 9 Tf 20 780 Td 11 TL\n" + `${line}\n`.repeat(lines) + "ET\n";
  for (let p = 0; p < pages; p += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * p} 0 R >>`,
      { dict: "", stream: body },
    );
  }
  return rawPdf(objects);
}
