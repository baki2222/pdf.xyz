// One hostile cost case for the duplicate-object guard (xref-duplicates.ts),
// run in a child process by xref-duplicates-cost.test.ts. Builds the file,
// times pdf-lib's own load (the baseline every engine pays anyway) and then
// `loadPdf` (the same load plus the guard), and reports both.
//
//   objstm-twins N  one object stream of N members, and a second stream whose
//                   data repeats `10 0 obj`, `11 0 obj`, ... (each member has a
//                   top-level "twin" header pdf-lib never parses)
//   w000            a 1 KB file whose newest xref stream has /W [0 0 0] and
//                   /Index [0 2000000000], plus the bare name /ObjStm
//   xref-bomb       the newest xref stream claims 4 rows, and inflates to
//                   256 MiB (a 256 KB deflate of zeros), plus the name /ObjStm
//   hidden-objstms K M  K streams carrying /N and /First but NO /Type /ObjStm
//                   (so pdf-lib's load never decodes them), each inflating
//                   to M MiB, named by type-2 xref entries whose members have
//                   a top-level "twin" header: the guard opens every one
//   nested N        N objects whose first headers sit inside one another's
//                   strings, each defined again later, the xref naming the
//                   nested (first) one: every re-parse runs to the end
import { createDeflate, deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { loadPdf } from "@/lib/pdf/engine";
import { startMemoryMeter } from "./memory";
import { reportResult } from "./report";

const [mode = "", nArg = "0", mArg = "0"] = process.argv.slice(2);
const N = Number(nArg);
const M = Number(mArg);

const parts: Buffer[] = [];
let len = 0;
const push = (s: string | Buffer) => {
  const b = typeof s === "string" ? Buffer.from(s, "latin1") : s;
  parts.push(b);
  len += b.length;
};
const row = (o: number) => `${String(o).padStart(10, "0")} 00000 n \n`;

function objstmTwins(): Uint8Array {
  const offs: Record<number, number> = {};
  push("%PDF-1.7\n");
  offs[1] = len;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offs[2] = len;
  push("2 0 obj\n<< /Type /Pages /Kids [6 0 R] /Count 1 >>\nendobj\n");
  offs[6] = len;
  push(
    "6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n",
  );
  let table = "";
  let body = "";
  for (let i = 0; i < N; i += 1) {
    table += `${10 + i} ${body.length} `;
    body += "<< >>\n";
  }
  const z = deflateSync(Buffer.from(table + body, "latin1"));
  offs[3] = len;
  push(
    `3 0 obj\n<< /Type /ObjStm /N ${N} /First ${table.length} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`,
  );
  push(z);
  push("\nendstream\nendobj\n");
  let twins = "";
  for (let i = 0; i < N; i += 1) twins += `${10 + i} 0 obj\n`;
  offs[4] = len;
  push(
    `4 0 obj\n<< /Length ${twins.length} >>\nstream\n${twins}\nendstream\nendobj\n`,
  );
  offs[5] = len;
  const rows: Buffer[] = [];
  const xrow = (t: number, a: number, b: number) => {
    const r = Buffer.alloc(7);
    r[0] = t;
    r.writeUInt32BE(a, 1);
    r.writeUInt16BE(b, 5);
    rows.push(r);
  };
  xrow(0, 0, 65535);
  for (const n of [1, 2, 3, 4, 5, 6]) xrow(1, offs[n]!, 0);
  for (let i = 0; i < N; i += 1) xrow(2, 3, i);
  const xd = Buffer.concat(rows);
  push(
    `5 0 obj\n<< /Type /XRef /Size ${10 + N} /W [1 4 2] /Index [0 7 10 ${N}] /Root 1 0 R /Length ${xd.length} >>\nstream\n`,
  );
  push(xd);
  push(`\nendstream\nendobj\nstartxref\n${offs[5]}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}

function w000(): Uint8Array {
  push("%PDF-1.7\n");
  const o1 = len;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const o2 = len;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  const o3 = len;
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n",
  );
  const x = len;
  push(
    `xref\n0 4\n0000000000 65535 f \n${row(o1)}${row(o2)}${row(o3)}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`,
  );
  push("% /ObjStm\n");
  const s = len;
  push(
    `99 0 obj\n<< /Size 100 /W [0 0 0] /Index [0 2000000000] /Root 1 0 R /Prev ${x} /Length 0 >>\nstream\n\nendstream\nendobj\nstartxref\n${s}\n%%EOF\n`,
  );
  return new Uint8Array(Buffer.concat(parts));
}

function xrefBomb(z: Buffer): Uint8Array {
  push("%PDF-1.7\n");
  const o1 = len;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const o2 = len;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  const o3 = len;
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n",
  );
  const x = len;
  push(
    `xref\n0 4\n0000000000 65535 f \n${row(o1)}${row(o2)}${row(o3)}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`,
  );
  push("% /ObjStm\n");
  const s = len;
  push(
    `99 0 obj\n<< /Size 4 /W [1 2 1] /Index [0 4] /Root 1 0 R /Prev ${x} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`,
  );
  push(z);
  push(`\nendstream\nendobj\nstartxref\n${s}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}

function nested(): Uint8Array {
  push("%PDF-1.7\n");
  const o1 = len;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const o2 = len;
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  const o3 = len;
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n",
  );
  // Objects 10..10+N-1: each first header opens a string the next one sits in.
  const first: number[] = [];
  push("4 0 obj\n(");
  for (let i = 0; i < N; i += 1) {
    first.push(len);
    push(`${10 + i} 0 obj (`);
  }
  push("x".repeat(64 * 1024));
  push(")".repeat(N));
  push(")\nendobj\n");
  // ...and each is defined again, last, as pdf-lib's linear parse keeps.
  for (let i = 0; i < N; i += 1) push(`${10 + i} 0 obj\nnull\nendobj\n`);
  const x = len;
  let rows = `xref\n0 4\n0000000000 65535 f \n${row(o1)}${row(o2)}${row(o3)}10 ${N}\n`;
  for (const o of first) rows += row(o);
  push(
    `${rows}trailer\n<< /Size ${10 + N} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`,
  );
  return new Uint8Array(Buffer.concat(parts));
}

/** 256 MiB of zeros, deflated a chunk at a time (never held whole). */
async function zeros(): Promise<Buffer> {
  const out: Buffer[] = [];
  const z = createDeflate({ level: 9 });
  z.on("data", (d: Buffer) => out.push(d));
  const done = new Promise((resolve) => z.on("end", resolve));
  const mib = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < 256; i += 1)
    if (!z.write(mib)) await new Promise((r) => z.once("drain", r));
  z.end();
  await done;
  return Buffer.concat(out);
}

/** One member table + body, padded with zeros to `mib` MiB, deflated in chunks. */
async function hiddenStreamData(
  num: number,
  mib: number,
): Promise<{ z: Buffer; first: number }> {
  const head = `${num} 0 `;
  const out: Buffer[] = [];
  const z = createDeflate({ level: 9 });
  z.on("data", (d: Buffer) => out.push(d));
  const done = new Promise((resolve) => z.on("end", resolve));
  z.write(Buffer.from(`${head}<< >>\n`, "latin1"));
  const chunk = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < mib; i += 1)
    if (!z.write(chunk)) await new Promise((r) => z.once("drain", r));
  z.end();
  await done;
  return { z: Buffer.concat(out), first: head.length };
}

async function hiddenObjstms(k: number, mib: number): Promise<Uint8Array> {
  const offs = new Map<number, number>();
  push("%PDF-1.7\n% /ObjStm\n");
  offs.set(1, len);
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offs.set(2, len);
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  offs.set(3, len);
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n",
  );
  for (let i = 0; i < k; i += 1) {
    const { z, first } = await hiddenStreamData(1000 + i, mib);
    offs.set(100 + i, len);
    push(
      `${100 + i} 0 obj\n<< /N 1 /First ${first} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`,
    );
    push(z);
    push("\nendstream\nendobj\n");
  }
  // Each member's top-level "twin", inside a stream pdf-lib never parses as objects.
  let twins = "";
  for (let i = 0; i < k; i += 1) twins += `${1000 + i} 0 obj\n`;
  offs.set(4, len);
  push(
    `4 0 obj\n<< /Length ${twins.length} >>\nstream\n${twins}\nendstream\nendobj\n`,
  );
  offs.set(5, len);
  const rows: Buffer[] = [];
  const xrow = (t: number, a: number, b: number) => {
    const r = Buffer.alloc(7);
    r[0] = t;
    r.writeUInt32BE(a, 1);
    r.writeUInt16BE(b, 5);
    rows.push(r);
  };
  xrow(0, 0, 65535);
  for (const n of [1, 2, 3, 4, 5]) xrow(1, offs.get(n)!, 0);
  for (let i = 0; i < k; i += 1) xrow(1, offs.get(100 + i)!, 0);
  for (let i = 0; i < k; i += 1) xrow(2, 100 + i, 0);
  const xd = Buffer.concat(rows);
  push(
    `5 0 obj\n<< /Type /XRef /Size ${1000 + k} /W [1 4 2] /Index [0 6 100 ${k} 1000 ${k}] /Root 1 0 R /Length ${xd.length} >>\nstream\n`,
  );
  push(xd);
  push(`\nendstream\nendobj\nstartxref\n${offs.get(5)}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}

async function build(): Promise<Uint8Array> {
  if (mode === "objstm-twins") return objstmTwins();
  if (mode === "w000") return w000();
  if (mode === "xref-bomb") return xrefBomb(await zeros());
  if (mode === "nested") return nested();
  if (mode === "hidden-objstms") return hiddenObjstms(N, M);
  throw new Error(`unknown mode ${mode}`);
}

async function main() {
  const bytes = await build();
  let t = performance.now();
  await PDFDocument.load(bytes);
  const baseMs = performance.now() - t;
  // Peak resident memory added by the load below, so a buffer freed before
  // the end still counts (./memory.ts).
  const meter = startMemoryMeter();
  t = performance.now();
  let outcome: string;
  try {
    outcome = `pages:${(await loadPdf(bytes)).getPageCount()}`;
  } catch (err) {
    outcome = `error:${(err as Error).name}:${(err as Error).message}`;
  }
  reportResult({
    outcome,
    kb: Math.round(bytes.length / 1024),
    baseMs: Math.round(baseMs),
    ms: Math.round(performance.now() - t),
    rssMb: Math.round(meter.growthMb()),
    meter: meter.method,
  });
}
void main();
