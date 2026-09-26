/**
 * Generated PDFs for the PDF to Office export tests, and a way to find a REAL
 * poppler `pdftotext` to run them through.
 *
 * Every fixture is built here, so a test can say exactly what is on the page.
 * The encrypted ones are written by hand because pdf-lib cannot encrypt: the
 * Standard security handler, revision 2 (RC4, 40-bit), which every PDF reader
 * and poppler build accepts. That is enough for the property under test —
 * "needs a password to open" versus "encrypted but opens" — and small enough
 * to read.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** The left column of {@link twoColumnReportPdf}, one printed line each. */
export const LEFT_COLUMN = [
  "The quarterly results show that revenue",
  "grew by twelve percent while operating",
  "costs fell for the third straight quarter.",
] as const;
/** The right column, drawn on the same baselines as the left. */
export const RIGHT_COLUMN = [
  "Risks include currency exposure in the",
  "European segment and supplier delays",
  "that may affect the next two quarters.",
] as const;

/** A report page: a title, then two columns of prose on shared baselines. */
export async function twoColumnReportPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText("Quarterly Report", { x: 50, y: 740, size: 18, font: bold });
  LEFT_COLUMN.forEach((line, i) =>
    page.drawText(line, { x: 50, y: 690 - i * 14, size: 11, font }),
  );
  RIGHT_COLUMN.forEach((line, i) =>
    page.drawText(line, { x: 320, y: 690 - i * 14, size: 11, font }),
  );
  return doc.save();
}

/** The grid {@link quarterlyTablePdf} draws, row by row. */
export const TABLE_ROWS = [
  ["Region", "Q1", "Q2", "Q3"],
  ["North", "1200", "1350", "1410"],
  ["South", "980", "1020", "1100"],
] as const;

/** A 4×3 table with no rules — cells placed on a grid, nothing else. */
export async function quarterlyTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  TABLE_ROWS.forEach((row, r) =>
    row.forEach((cell, c) =>
      page.drawText(cell, { x: 50 + c * 110, y: 700 - r * 16, size: 11, font }),
    ),
  );
  return doc.save();
}

/**
 * A scan with a typed line: `textPages` get `stamp` as their only text, every
 * other page is a grey rectangle standing in for a scanned image — no text at
 * all, which is what a scan is to a text extractor.
 */
export async function partlyScannedPdf(
  pageCount: number,
  textPages: readonly number[],
  stamp = "RECEIVED 2026-09-01 BATES 000123",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pageCount; n += 1) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({
      x: 40,
      y: 40,
      width: 532,
      height: 680,
      color: rgb(0.85, 0.85, 0.85),
    });
    if (textPages.includes(n))
      page.drawText(stamp, { x: 50, y: 750, size: 10, font });
  }
  return doc.save();
}

// ─────────────────────────── hand-written RC4 PDF ───────────────────────────

const PASSWORD_PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function md5(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function padded(password: string): Uint8Array {
  const bytes = new TextEncoder().encode(password).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PASSWORD_PAD.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/**
 * A one-page PDF encrypted with the Standard security handler, R2 / RC4-40.
 * `userPassword: ""` makes an owner-password-only file: encrypted, and opens
 * without asking — which a correct export must keep converting.
 */
export function rc4EncryptedPdf(opts: {
  userPassword: string;
  ownerPassword: string;
  text?: string;
}): Uint8Array {
  const text = opts.text ?? "Locked quarterly figures";
  const id = md5(new TextEncoder().encode(`pdfxyz-fixture-${text}`));
  const permissions = -44;
  const pLe = new Uint8Array(4);
  new DataView(pLe.buffer).setInt32(0, permissions, true);

  const owner = rc4(
    md5(padded(opts.ownerPassword)).subarray(0, 5),
    padded(opts.userPassword),
  );
  const fileKey = md5(padded(opts.userPassword), owner, pLe, id).subarray(0, 5);
  const user = rc4(fileKey, PASSWORD_PAD);
  const objectKey = (num: number) =>
    md5(
      fileKey,
      Uint8Array.from([
        num & 0xff,
        (num >> 8) & 0xff,
        (num >> 16) & 0xff,
        0,
        0,
      ]),
    ).subarray(0, 10);

  const content = new TextEncoder().encode(
    `BT /F1 14 Tf 72 700 Td (${text}) Tj ET`,
  );
  const encryptedContent = rc4(objectKey(5), content);

  const chunks: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    chunks.push(part);
    length +=
      typeof part === "string"
        ? Buffer.byteLength(part, "latin1")
        : part.length;
  };
  const obj = (num: number, body: string | (string | Uint8Array)[]) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  obj(5, [
    `<< /Length ${encryptedContent.length} >>\nstream\n`,
    encryptedContent,
    "\nendstream",
  ]);
  obj(
    6,
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(owner)}> /U <${hex(user)}> /P ${permissions} >>`,
  );
  const xref = length;
  push("xref\n0 7\n0000000000 65535 f \n");
  for (let n = 1; n <= 6; n += 1)
    push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(
    `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of chunks) {
    const bytes = typeof part === "string" ? Buffer.from(part, "latin1") : part;
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

// ───────────────────────────── a real poppler ───────────────────────────────

/**
 * The first `pdftotext` on PATH that is POPPLER's, or null.
 *
 * Not simply the first on PATH: Git for Windows ships Xpdf's `pdftotext` 4.00,
 * which has no `-bbox-layout` and orders text differently, so a test run
 * against it would fail — or pass — for reasons that say nothing about the
 * worker, which runs poppler. `PDFXYZ_TEST_PDFTOTEXT` pins one explicitly.
 */
export function findPopplerPdfToText(): string | null {
  const explicit = process.env.PDFXYZ_TEST_PDFTOTEXT?.trim();
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE").split(";").filter(Boolean)
      : [""];
  const candidates = explicit
    ? [explicit]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .flatMap((dir) => exts.map((ext) => path.join(dir, `pdftotext${ext}`)));
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
      // poppler prints its banner on stderr; read both streams.
      const run = spawnSync(candidate, ["-v"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      });
      if (/poppler/i.test(`${run.stdout ?? ""}${run.stderr ?? ""}`))
        return candidate;
    } catch {
      // Not runnable here; try the next one.
    }
  }
  return null;
}

/**
 * The two-column property, over paragraphs as a reader gets them: each
 * column's sentence is ONE paragraph, and the left one comes first. The
 * shape PDF to Word used to ship — each left line glued to its right-hand
 * neighbour — fails it.
 */
export function columnsReadInOrder(paragraphs: readonly string[]): boolean {
  const left = paragraphs.findIndex((p) => p.includes(LEFT_COLUMN.join(" ")));
  const right = paragraphs.findIndex((p) => p.includes(RIGHT_COLUMN.join(" ")));
  return left >= 0 && right > left;
}
