import { createHash } from "node:crypto";

/**
 * Build a REAL encrypted PDF in the test process — the Standard security
 * handler, RC4 128-bit (V 2 / R 3), computed from ISO 32000-1 §7.6.3.3
 * (Algorithms 2, 3 and 5).
 *
 * WHY THIS EXISTS. pdf-lib cannot write encryption, and the repo had no
 * encrypted fixture at all, so every test of "what happens to an encrypted PDF"
 * pinned a source string instead of running a file through the reader. The
 * distinction a user actually meets — a PDF with only an OWNER password (it
 * opens in every viewer, but carries editing restrictions) versus one with a
 * USER password (it will not open without one) — lives entirely in the /O and
 * /U entries, so a fixture must compute them, not fake them.
 *
 * The document has no content stream and no strings outside the /Encrypt
 * dictionary and the trailer /ID (neither of which is ever encrypted), so the
 * file is complete without encrypting any object: the two passwords are the
 * only thing that differs between the two variants.
 *
 * Checked independently of pdf.js (the reader the product uses) with poppler:
 * `pdfinfo` opens the owner-only variant with no password and refuses the
 * user-password one ("Incorrect password"), and `qpdf --is-encrypted` would
 * report both as encrypted.
 */

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const KEY_BYTES = 16;
/** Print allowed; modify, copy, annotate, fill, assemble all denied. */
const PERMISSIONS = -3900;

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
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function pad(password: string): Uint8Array {
  const bytes = new TextEncoder().encode(password).slice(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PAD.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

function xorKey(key: Uint8Array, i: number): Uint8Array {
  return key.map((b) => b ^ i);
}

/** Algorithm 3: the /O entry. */
function ownerEntry(owner: string, user: string): Uint8Array {
  let h = md5(pad(owner || user));
  for (let i = 0; i < 50; i++) h = md5(h);
  const key = h.subarray(0, KEY_BYTES);
  let out = rc4(key, pad(user));
  for (let i = 1; i <= 19; i++) out = rc4(xorKey(key, i), out);
  return out;
}

/** Algorithm 2: the file key. */
function fileKey(user: string, o: Uint8Array, id: Uint8Array): Uint8Array {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, PERMISSIONS, true);
  let h = md5(pad(user), o, p, id);
  for (let i = 0; i < 50; i++) h = md5(h.subarray(0, KEY_BYTES));
  return h.subarray(0, KEY_BYTES);
}

/** Algorithm 5: the /U entry (R3). */
function userEntry(key: Uint8Array, id: Uint8Array): Uint8Array {
  let out = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++) out = rc4(xorKey(key, i), out);
  const u = new Uint8Array(32);
  u.set(out);
  return u;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex").toUpperCase();

export interface EncryptedPdfOptions {
  /** The password that OPENS the file. `""` means it opens with none. */
  userPassword: string;
  /** The password that lifts the restrictions. */
  ownerPassword: string;
}

export function encryptedPdf({
  userPassword,
  ownerPassword,
}: EncryptedPdfOptions): Uint8Array {
  const id = md5(new TextEncoder().encode(`pdfxyz-fixture-${ownerPassword}`));
  const o = ownerEntry(ownerPassword, userPassword);
  const key = fileKey(userPassword, o, id);
  const u = userEntry(key, id);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${PERMISSIONS} /O <${hex(o)}> /U <${hex(u)}> >>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets)
    body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R ` +
    `/ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/** Opens in any viewer with no password; editing is restricted. */
export const ownerOnlyEncryptedPdf = () =>
  encryptedPdf({ userPassword: "", ownerPassword: "owner-secret" });

/** Will not open without its password. */
export const userPasswordEncryptedPdf = () =>
  encryptedPdf({ userPassword: "open-sesame", ownerPassword: "owner-secret" });

/** Algorithm 1: the RC4 key for object `num` generation `gen`. */
function objectKey(key: Uint8Array, num: number, gen: number): Uint8Array {
  const salt = Uint8Array.from([
    num & 0xff,
    (num >> 8) & 0xff,
    (num >> 16) & 0xff,
    gen & 0xff,
    (gen >> 8) & 0xff,
  ]);
  return md5(key, salt).subarray(0, Math.min(KEY_BYTES + 5, 16));
}

const latin1 = (text: string) => Uint8Array.from(Buffer.from(text, "latin1"));

/**
 * The same lock, written the way PDF 1.5+ writers (Acrobat, Word, most modern
 * producers) save an encrypted file: the Catalog, Pages and Page objects live
 * INSIDE an object stream (object 1, RC4-encrypted with its own object key),
 * and the cross-reference is an uncompressed /XRef stream (/W [1 4 2]) that
 * carries /Encrypt and /ID. Neither the /XRef stream nor the /Encrypt
 * dictionary is encrypted (ISO 32000-1 §7.5.8.2, §7.6.1).
 *
 * This is the shape `src/lib/pdf/encryption.ts` warns about: pdf-lib with
 * `ignoreEncryption` cannot read the page tree, so `readPdfFrames` returns
 * null for it, while pdf.js decrypts the object stream and opens it.
 */
export function encryptedObjectStreamPdf({
  userPassword,
  ownerPassword,
  handler = "Standard",
}: EncryptedPdfOptions & {
  /** The security handler /Filter names; pdf.js decrypts only Standard. */
  handler?: string;
}): Uint8Array {
  const id = md5(new TextEncoder().encode(`pdfxyz-objstm-${ownerPassword}`));
  const o = ownerEntry(ownerPassword, userPassword);
  const key = fileKey(userPassword, o, id);
  const u = userEntry(key, id);

  // Objects 2, 3 and 4, packed into object stream 1.
  const packed = [
    "<< /Type /Catalog /Pages 3 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 200] >>",
  ];
  let data = "";
  const within: number[] = [];
  for (const obj of packed) {
    within.push(data.length);
    data += `${obj}\n`;
  }
  const header = `${packed.map((_, i) => `${i + 2} ${within[i]}`).join(" ")}\n`;
  const plain = latin1(header + data);
  const sealed = rc4(objectKey(key, 1, 0), plain);

  const chunks: Uint8Array[] = [];
  let length = 0;
  const write = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  write(latin1("%PDF-1.5\n%\xe2\xe3\xcf\xd3\n"));
  const offsets: Record<number, number> = {};
  offsets[1] = length;
  write(
    latin1(
      `1 0 obj\n<< /Type /ObjStm /N ${packed.length} /First ${header.length} /Length ${sealed.length} >>\nstream\n`,
    ),
  );
  write(sealed);
  write(latin1("\nendstream\nendobj\n"));
  offsets[5] = length;
  write(
    latin1(
      `5 0 obj\n<< /Filter /${handler} /V 2 /R 3 /Length 128 /P ${PERMISSIONS} /O <${hex(o)}> /U <${hex(u)}> >>\nendobj\n`,
    ),
  );
  offsets[6] = length;
  const size = 7;
  const row = (type: number, field2: number, field3: number) => {
    const r = new Uint8Array(7);
    const view = new DataView(r.buffer);
    r[0] = type;
    view.setUint32(1, field2);
    view.setUint16(5, field3);
    return r;
  };
  const rows = [
    row(0, 0, 0xffff),
    row(1, offsets[1]!, 0),
    row(2, 1, 0),
    row(2, 1, 1),
    row(2, 1, 2),
    row(1, offsets[5]!, 0),
    row(1, offsets[6]!, 0),
  ];
  const table = new Uint8Array(rows.length * 7);
  rows.forEach((r, i) => table.set(r, i * 7));
  write(
    latin1(
      `6 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 2] /Root 2 0 R /Encrypt 5 0 R /ID [<${hex(id)}> <${hex(id)}>] /Length ${table.length} >>\nstream\n`,
    ),
  );
  write(table);
  write(latin1(`\nendstream\nendobj\nstartxref\n${offsets[6]}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Object-stream file that opens with no password; editing is restricted. */
export const ownerOnlyObjectStreamPdf = () =>
  encryptedObjectStreamPdf({ userPassword: "", ownerPassword: "owner-secret" });

/** Object-stream file that will not open without its password. */
export const userPasswordObjectStreamPdf = () =>
  encryptedObjectStreamPdf({
    userPassword: "open-sesame",
    ownerPassword: "owner-secret",
  });

/** Object-stream file under a handler no browser reader decrypts (public key). */
export const unknownHandlerObjectStreamPdf = () =>
  encryptedObjectStreamPdf({
    userPassword: "",
    ownerPassword: "owner-secret",
    handler: "Adobe.PubSec",
  });
