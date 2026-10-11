/**
 * An encrypted PDF's streams, read the way a viewer reads them when it opens
 * the file with no password — for the page inventory (`./page-inventory`),
 * which has to know what a page paints BEFORE pdf.js decodes it.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * pdf-lib loads an encrypted file (`ignoreEncryption`) and never decrypts it,
 * so every content stream of an owner-password PDF — a bank statement, an
 * e-invoice, a publisher's book: files every viewer opens without a prompt —
 * was ciphertext to the inventory. The page scan then could not know what
 * such a page decodes, and every way of guessing was wrong in production:
 * charging each page for every image its resources declare lost all twelve
 * photos of a twelve-page album whose pages share one /Resources (the first
 * repair, 2026-10-11); charging it for nothing let one page of six 8000²
 * photos, locked with an owner password, decode 2.2 GB in the worker daemon
 * (the second repair, the same day — the memory blocker the first review had
 * closed, reopened for every encrypted upload). Reading the page is the only
 * answer that is right both ways.
 *
 * ── WHAT IT READS ───────────────────────────────────────────────────────────
 *
 * The Standard security handler (ISO 32000-2 §7.6.4), revisions 2 to 6, with
 * the EMPTY user password: RC4 (40 to 128 bits), AES-128 (crypt filter
 * AESV2) and AES-256 (AESV3). That is every encrypted file the scan reads:
 * pdftotext refuses a file that needs a password before the scan runs, and
 * pdf.js reads no other handler without one. The key is checked against /U
 * before it is trusted, so a file that does need a password yields null here,
 * never plaintext-shaped garbage. What it cannot read — another handler, a
 * stream with its own /Crypt filter — is null too, and the caller treats that
 * stream as unreadable (the inventory's `exact: false`).
 *
 * The algorithms follow pdf.js's `CipherTransformFactory`, which is what the
 * scan decodes the same file with; the tests hold them to fixtures pdf.js
 * itself opens.
 */
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from "pdf-lib";

/** ISO 32000-1 §7.6.3.3: the 32 bytes an empty password is padded to. */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

type Cipher = "identity" | "rc4" | "aes-128" | "aes-256";

/** Reads one indirect stream's bytes in the clear (its filters still on). */
export interface StreamDecryptor {
  /**
   * `stream` (the indirect object `ref`) decrypted, its /Filter still to be
   * applied; null when this handler cannot decrypt it.
   */
  decrypt(ref: PDFRef, stream: PDFRawStream): Uint8Array | null;
}

function hash(algorithm: string, ...parts: Uint8Array[]): Uint8Array {
  const h = createHash(algorithm);
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

/** AES-CBC over whole blocks, no padding either way. */
function aesCbc(
  mode: "encrypt" | "decrypt",
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const name = `aes-${key.length * 8}-cbc`;
  const c =
    mode === "encrypt"
      ? createCipheriv(name, key, iv)
      : createDecipheriv(name, key, iv);
  c.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([c.update(data), c.final()]));
}

/**
 * An AES-encrypted string or stream: 16 bytes of IV, then CBC blocks, the
 * last padded PKCS#5-style. Like pdf.js, a pad byte over 16 is left alone and
 * a trailing partial block is dropped.
 */
function aesDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 32) return new Uint8Array(0);
  const body = data.subarray(16, 16 + Math.floor((data.length - 16) / 16) * 16);
  const plain = aesCbc("decrypt", key, data.subarray(0, 16), body);
  const pad = plain[plain.length - 1]!;
  return pad >= 1 && pad <= 16 ? plain.subarray(0, plain.length - pad) : plain;
}

/** ISO 32000-2 §7.6.4.3.4, Algorithm 2.B: the revision 6 password hash. */
function hashR6(
  password: Uint8Array,
  salt: Uint8Array,
  userKey: Uint8Array,
): Uint8Array {
  let k: Uint8Array = hash("sha256", password, salt, userKey);
  let e: Uint8Array = new Uint8Array([0]);
  for (let i = 0; i < 64 || e[e.length - 1]! > i - 32; i++) {
    const round = concat(password, k, userKey);
    const k1 = new Uint8Array(round.length * 64);
    for (let r = 0; r < 64; r++) k1.set(round, r * round.length);
    e = aesCbc("encrypt", k.subarray(0, 16), k.subarray(16, 32), k1);
    // The first 16 bytes as one big-endian number, mod 3: 256 ≡ 1 (mod 3).
    const sum = e.subarray(0, 16).reduce((n, b) => n + b, 0) % 3;
    k = hash(sum === 0 ? "sha256" : sum === 1 ? "sha384" : "sha512", e);
  }
  return k.subarray(0, 32);
}

function bytesOf(obj: PDFObject | undefined): Uint8Array | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString)
    return obj.asBytes();
  return null;
}

function numberOf(obj: PDFObject | undefined): number | null {
  return obj instanceof PDFNumber ? obj.asNumber() : null;
}

/** The file key for the empty user password, or null when it is not one. */
function fileKey(
  revision: number,
  enc: PDFDict,
  id: Uint8Array,
  keyBytes: number,
): Uint8Array | null {
  const O = bytesOf(enc.lookup(PDFName.of("O")));
  const U = bytesOf(enc.lookup(PDFName.of("U")));
  if (!O || !U) return null;
  if (revision >= 5) {
    const UE = bytesOf(enc.lookup(PDFName.of("UE")));
    if (!UE || U.length < 48 || UE.length < 32) return null;
    const none = new Uint8Array(0);
    const derive = (salt: Uint8Array) =>
      revision === 5 ? hash("sha256", none, salt) : hashR6(none, salt, none);
    if (!sameBytes(derive(U.subarray(32, 40)), U.subarray(0, 32))) return null;
    return aesCbc(
      "decrypt",
      derive(U.subarray(40, 48)),
      new Uint8Array(16),
      UE.subarray(0, 32),
    );
  }
  if (O.length < 32 || U.length < 16) return null;
  const P = numberOf(enc.lookup(PDFName.of("P"))) ?? 0;
  const flags = new Uint8Array(4);
  new DataView(flags.buffer).setInt32(0, P | 0, true);
  const meta = enc.lookup(PDFName.of("EncryptMetadata"));
  const skipMetadata =
    revision >= 4 && meta instanceof PDFBool && !meta.asBoolean();
  let key: Uint8Array = hash(
    "md5",
    PAD,
    O.subarray(0, 32),
    flags,
    id,
    skipMetadata ? Uint8Array.of(0xff, 0xff, 0xff, 0xff) : new Uint8Array(0),
  );
  if (revision >= 3)
    for (let i = 0; i < 50; i++) key = hash("md5", key.subarray(0, keyBytes));
  key = key.subarray(0, keyBytes);
  if (revision === 2)
    return sameBytes(rc4(key, PAD), U.subarray(0, 32)) ? key : null;
  let check = rc4(key, hash("md5", PAD, id));
  for (let pass = 1; pass <= 19; pass++)
    check = rc4(
      key.map((b) => b ^ pass),
      check,
    );
  return sameBytes(check, U.subarray(0, 16)) ? key : null;
}

/** The cipher a stream is encrypted with, from /V and the crypt filters. */
function streamCipher(enc: PDFDict, V: number): Cipher | null {
  if (V === 1 || V === 2) return "rc4";
  if (V !== 4 && V !== 5) return null;
  const stmF = enc.lookup(PDFName.of("StmF"));
  const name = stmF instanceof PDFName ? stmF.decodeText() : "Identity";
  if (name === "Identity") return "identity";
  const filters = enc.lookup(PDFName.of("CF"));
  const filter =
    filters instanceof PDFDict ? filters.lookup(PDFName.of(name)) : undefined;
  if (!(filter instanceof PDFDict)) return null;
  const cfm = filter.lookup(PDFName.of("CFM"));
  switch (cfm instanceof PDFName ? cfm.decodeText() : "None") {
    case "None":
      return "identity";
    case "V2":
      return "rc4";
    case "AESV2":
      return "aes-128";
    case "AESV3":
      return "aes-256";
    default:
      return null;
  }
}

/** The key length in bytes, as pdf.js reads it (`CipherTransformFactory`). */
function keyLength(enc: PDFDict, V: number): number {
  if (V === 1) return 5;
  if (V === 5) return 32;
  let bits = numberOf(enc.lookup(PDFName.of("Length")));
  if (bits === null) {
    const stmF = enc.lookup(PDFName.of("StmF"));
    const filters = enc.lookup(PDFName.of("CF"));
    const filter =
      stmF instanceof PDFName && filters instanceof PDFDict
        ? filters.lookup(stmF)
        : undefined;
    bits =
      (filter instanceof PDFDict
        ? numberOf(filter.lookup(PDFName.of("Length")))
        : null) ?? (V >= 4 ? 128 : 40);
    if (bits < 40) bits *= 8;
  }
  return Math.max(5, Math.min(16, Math.floor(bits / 8)));
}

/**
 * The decryptor for `doc`'s Standard security handler with the empty user
 * password; null when the file is not encrypted that way. Never throws.
 */
export function standardDecryptor(doc: PDFDocument): StreamDecryptor | null {
  try {
    const { trailerInfo } = doc.context;
    const enc = trailerInfo.Encrypt
      ? doc.context.lookup(trailerInfo.Encrypt)
      : undefined;
    if (!(enc instanceof PDFDict)) return null;
    const filter = enc.lookup(PDFName.of("Filter"));
    if (!(filter instanceof PDFName) || filter.decodeText() !== "Standard")
      return null;
    const V = numberOf(enc.lookup(PDFName.of("V"))) ?? 0;
    const R = numberOf(enc.lookup(PDFName.of("R"))) ?? 0;
    if (R < 2 || R > 6) return null;
    const cipher = streamCipher(enc, V);
    if (!cipher) return null;
    const ids = trailerInfo.ID ? doc.context.lookup(trailerInfo.ID) : undefined;
    const id =
      (ids instanceof PDFArray ? bytesOf(ids.lookup(0)) : null) ??
      new Uint8Array(0);
    const key = fileKey(R, enc, id, keyLength(enc, V));
    if (!key) return null;
    const XREF = PDFName.of("XRef");
    const CRYPT = PDFName.of("Crypt");
    return {
      decrypt(ref, stream) {
        // A cross-reference stream is never encrypted (§7.6.2).
        if (stream.dict.lookup(PDFName.of("Type")) === XREF)
          return stream.contents;
        const f = stream.dict.lookup(PDFName.of("Filter"));
        if (
          f === CRYPT ||
          (f instanceof PDFArray && f.asArray().includes(CRYPT))
        )
          return null;
        if (cipher === "identity") return stream.contents;
        if (cipher === "aes-256") return aesDecrypt(key, stream.contents);
        const n = ref.objectNumber;
        const g = ref.generationNumber;
        const objectKey = hash(
          "md5",
          key,
          Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff),
          Uint8Array.of(g & 0xff, (g >> 8) & 0xff),
          cipher === "aes-128"
            ? Uint8Array.of(0x73, 0x41, 0x6c, 0x54) // "sAlT"
            : new Uint8Array(0),
        ).subarray(0, Math.min(key.length + 5, 16));
        return cipher === "aes-128"
          ? aesDecrypt(objectKey, stream.contents)
          : rc4(objectKey, stream.contents);
      },
    };
  } catch {
    return null;
  }
}
