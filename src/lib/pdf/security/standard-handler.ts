import {
  aesCbcDecrypt,
  aesCbcDecryptNoPad,
  aesCbcEncrypt,
  aesCbcEncryptNoPad,
  randomBytes,
  sha,
  type ShaName,
} from "./aes";
import { md5 } from "./md5";
import { rc4 } from "./rc4";

/**
 * The PDF Standard security handler (ISO 32000-1 §7.6.3, ISO 32000-2 §7.6.4),
 * revisions 2–6, in the browser: authenticate a password, derive the file
 * key, and decrypt or encrypt one string or stream of one object.
 *
 * Why it exists. pdf.js decrypts to render, but exposes neither the key nor
 * a writer, and pdf-lib refuses every /Encrypt. A PDF its author restricted
 * — opens with no password, says "fill in the form but do not change the
 * page" — could therefore only be refused. With the key, the editor can read
 * the document AND write the changes the author allowed back under the
 * author's own encryption (`./incremental.ts`), as Acrobat Reader does.
 *
 * Supported: V1/V2 (RC4, 40–128 bit, R2/R3), V4 (R4: RC4 `/V2` or AES-128
 * `/AESV2` crypt filters, `/Identity`), V5 (R5 — Adobe's deprecated
 * extension level 3 — and R6, AES-256 `/AESV3`). Not supported, refused as
 * unreadable rather than guessed: V3 (never published), public-key
 * (certificate) security handlers, crypt filters other than the standard
 * methods.
 *
 * The oracle is never this file: `standard-handler.test.ts` derives keys for
 * fixtures that qpdf and pypdf encrypted, and every output is read back by
 * pdf.js, which has its own implementation of every algorithm here.
 */

/** ISO 32000-1 §7.6.3.3, Algorithm 2 step (a): the 32-byte password padding. */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export type CryptMethod = "identity" | "rc4" | "aesv2" | "aesv3";

/** The /Encrypt dictionary, as values. */
export interface EncryptParams {
  /** /V */
  v: number;
  /** /R */
  r: number;
  /** /Length in bits (40 for V1). */
  lengthBits: number;
  o: Uint8Array;
  u: Uint8Array;
  oe?: Uint8Array;
  ue?: Uint8Array;
  perms?: Uint8Array;
  /** /P as the signed 32-bit integer it is. */
  p: number;
  encryptMetadata: boolean;
  /** How streams and strings are encrypted (from /StmF, /StrF and /CF). */
  stream: CryptMethod;
  string: CryptMethod;
  /** First element of the trailer's /ID (R2–R4 key derivation). */
  id0: Uint8Array;
}

export class UnsupportedEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedEncryptionError";
  }
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

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function int32le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, n | 0, true);
  return out;
}

/** R2–R4 password bytes: PDFDocEncoding for what Latin-1 can hold, else UTF-8. */
function legacyPasswordCandidates(password: string): Uint8Array[] {
  const utf8 = new TextEncoder().encode(password);
  const latin = [...password].every((c) => c.charCodeAt(0) <= 0xff)
    ? Uint8Array.from([...password].map((c) => c.charCodeAt(0)))
    : null;
  return latin && !equal(latin, utf8) ? [latin, utf8] : [utf8];
}

/** R5/R6 password bytes: UTF-8 of the normalised password, at most 127 bytes. */
function modernPassword(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize("NFKC")).subarray(0, 127);
}

function padPassword(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  const n = Math.min(32, password.length);
  out.set(password.subarray(0, n));
  out.set(PAD.subarray(0, 32 - n), n);
  return out;
}

/** Key length in bytes for R2–R4. */
function legacyKeyLength(params: EncryptParams): number {
  if (params.r === 2) return 5;
  const n = Math.floor((params.lengthBits || 40) / 8);
  return Math.min(16, Math.max(5, n));
}

/** ISO 32000-1 Algorithm 2: the file key from a (user) password. */
function legacyFileKey(
  params: EncryptParams,
  password: Uint8Array,
): Uint8Array {
  const n = legacyKeyLength(params);
  const parts = [padPassword(password), params.o.subarray(0, 32)];
  parts.push(int32le(params.p), params.id0);
  if (params.r >= 4 && !params.encryptMetadata)
    parts.push(Uint8Array.from([0xff, 0xff, 0xff, 0xff]));
  let h = md5(concat(...parts));
  if (params.r >= 3) for (let i = 0; i < 50; i += 1) h = md5(h.subarray(0, n));
  return h.slice(0, n);
}

function xorKey(key: Uint8Array, i: number): Uint8Array {
  return key.map((b) => b ^ i);
}

/** ISO 32000-1 Algorithms 4/5 then 6: does this key open /U? */
function legacyUserMatches(params: EncryptParams, key: Uint8Array): boolean {
  if (params.r === 2) return equal(rc4(key, PAD), params.u.subarray(0, 32));
  let x = rc4(key, md5(concat(PAD, params.id0)));
  for (let i = 1; i <= 19; i += 1) x = rc4(xorKey(key, i), x);
  return equal(x, params.u.subarray(0, 16));
}

/** ISO 32000-1 Algorithm 7 step (a)–(b): the user password /O holds. */
function legacyUserFromOwner(
  params: EncryptParams,
  owner: Uint8Array,
): Uint8Array {
  const n = legacyKeyLength(params);
  let h = md5(padPassword(owner));
  if (params.r >= 3) for (let i = 0; i < 50; i += 1) h = md5(h);
  const key = h.subarray(0, n);
  const o = params.o.subarray(0, 32);
  if (params.r === 2) return rc4(key, o);
  let x = o;
  for (let i = 19; i >= 0; i -= 1) x = rc4(xorKey(key, i), x);
  return x;
}

/** ISO 32000-2 Algorithm 2.B (R6); R5 is a single SHA-256. */
async function hash2B(
  r: number,
  password: Uint8Array,
  salt: Uint8Array,
  udata: Uint8Array,
): Promise<Uint8Array> {
  let k = await sha("SHA-256", concat(password, salt, udata));
  if (r === 5) return k;
  const names: ShaName[] = ["SHA-256", "SHA-384", "SHA-512"];
  for (let round = 0; ; round += 1) {
    const one = concat(password, k, udata);
    const k1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i += 1) k1.set(one, i * one.length);
    const e = await aesCbcEncryptNoPad(
      k.subarray(0, 16),
      k.subarray(16, 32),
      k1,
    );
    let mod = 0;
    for (let i = 0; i < 16; i += 1) mod += e[i]!;
    k = await sha(names[mod % 3]!, e);
    if (round >= 63 && e[e.length - 1]! <= round - 32) break;
  }
  return k.subarray(0, 32);
}

const ZERO_IV = new Uint8Array(16);

/** Who the password authenticated as. */
export type Authenticated = "user" | "owner";

export class StandardSecurityHandler {
  private constructor(
    readonly params: EncryptParams,
    private readonly fileKey: Uint8Array,
    readonly authenticatedAs: Authenticated,
    /** /P after the /Perms cross-check (R5/R6): never more than /P grants. */
    readonly effectiveP: number,
  ) {}

  /**
   * Open with `password` (default: the empty user password). Returns null
   * when it is neither the user nor the owner password. Tries the owner
   * password first, so a correct owner password is known as such.
   */
  static async open(
    params: EncryptParams,
    password = "",
  ): Promise<StandardSecurityHandler | null> {
    if (![2, 3, 4, 5, 6].includes(params.r) || ![1, 2, 4, 5].includes(params.v))
      throw new UnsupportedEncryptionError(
        `Standard security handler V${params.v} R${params.r} is not supported.`,
      );
    if (params.r >= 5)
      return StandardSecurityHandler.openModern(params, password);
    if (password !== "") {
      for (const owner of legacyPasswordCandidates(password)) {
        const user = legacyUserFromOwner(params, owner);
        const key = legacyFileKey(params, user);
        if (legacyUserMatches(params, key))
          return new StandardSecurityHandler(params, key, "owner", params.p);
      }
    }
    for (const user of password === ""
      ? [new Uint8Array(0)]
      : legacyPasswordCandidates(password)) {
      const key = legacyFileKey(params, user);
      if (legacyUserMatches(params, key))
        return new StandardSecurityHandler(params, key, "user", params.p);
    }
    return null;
  }

  private static async openModern(
    params: EncryptParams,
    password: string,
  ): Promise<StandardSecurityHandler | null> {
    const { r, o, u, oe, ue } = params;
    if (
      o.length < 48 ||
      u.length < 48 ||
      !oe ||
      !ue ||
      oe.length < 32 ||
      ue.length < 32
    )
      throw new UnsupportedEncryptionError(
        "The /Encrypt dictionary is incomplete.",
      );
    const pw = modernPassword(password);
    const u48 = u.subarray(0, 48);
    let key: Uint8Array | null = null;
    let as: Authenticated = "user";
    if (
      equal(await hash2B(r, pw, o.subarray(32, 40), u48), o.subarray(0, 32))
    ) {
      const ik = await hash2B(r, pw, o.subarray(40, 48), u48);
      key = await aesCbcDecryptNoPad(ik, ZERO_IV, oe.subarray(0, 32));
      as = "owner";
    } else if (
      equal(
        await hash2B(r, pw, u.subarray(32, 40), new Uint8Array(0)),
        u.subarray(0, 32),
      )
    ) {
      const ik = await hash2B(r, pw, u.subarray(40, 48), new Uint8Array(0));
      key = await aesCbcDecryptNoPad(ik, ZERO_IV, ue.subarray(0, 32));
    }
    if (!key) return null;
    let effectiveP = params.p;
    if (params.perms && params.perms.length >= 16) {
      const perms = await aesCbcDecryptNoPad(
        key,
        ZERO_IV,
        params.perms.subarray(0, 16),
      );
      // Bytes 9–11 are "adb" when /Perms was written with this key. A /P
      // that grants more than /Perms is a tampered /P: the author's grant
      // is the smaller one.
      if (perms[9] === 0x61 && perms[10] === 0x64 && perms[11] === 0x62) {
        const sealed = new DataView(perms.buffer, perms.byteOffset).getInt32(
          0,
          true,
        );
        effectiveP = params.p & sealed;
      }
    }
    return new StandardSecurityHandler(params, key, as, effectiveP);
  }

  /** Is `password` this document's owner password? */
  async isOwnerPassword(password: string): Promise<boolean> {
    if (password === "") return false;
    const h = await StandardSecurityHandler.open(this.params, password);
    return h?.authenticatedAs === "owner";
  }

  private method(kind: "string" | "stream"): CryptMethod {
    return kind === "string" ? this.params.string : this.params.stream;
  }

  private objectKey(num: number, gen: number, method: CryptMethod): Uint8Array {
    if (this.params.r >= 5) return this.fileKey;
    const n = this.fileKey.length;
    const parts = [
      this.fileKey,
      Uint8Array.from([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff]),
      Uint8Array.from([gen & 0xff, (gen >> 8) & 0xff]),
    ];
    if (method === "aesv2")
      parts.push(Uint8Array.from([0x73, 0x41, 0x6c, 0x54]));
    return md5(concat(...parts)).slice(0, Math.min(n + 5, 16));
  }

  /** Decrypt one string or stream body of object `num gen`. */
  async decrypt(
    kind: "string" | "stream",
    num: number,
    gen: number,
    data: Uint8Array,
  ): Promise<Uint8Array> {
    const method = this.method(kind);
    if (method === "identity") return data;
    const key = this.objectKey(num, gen, method);
    if (method === "rc4") return rc4(key, data);
    if (data.length < 32) return new Uint8Array(0);
    const iv = data.subarray(0, 16);
    const body = data.subarray(
      16,
      16 + Math.floor((data.length - 16) / 16) * 16,
    );
    try {
      return await aesCbcDecrypt(key, iv, body);
    } catch {
      // A producer that wrote bad padding: keep the blocks as they decrypt.
      return aesCbcDecryptNoPad(key, iv, body);
    }
  }

  /** Encrypt one string or stream body of object `num gen`. */
  async encrypt(
    kind: "string" | "stream",
    num: number,
    gen: number,
    data: Uint8Array,
  ): Promise<Uint8Array> {
    const method = this.method(kind);
    if (method === "identity") return data;
    const key = this.objectKey(num, gen, method);
    if (method === "rc4") return rc4(key, data);
    const iv = randomBytes(16);
    return concat(iv, await aesCbcEncrypt(key, iv, data));
  }
}
