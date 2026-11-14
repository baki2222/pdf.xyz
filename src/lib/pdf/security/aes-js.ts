/**
 * AES-CBC decryption in plain JavaScript, synchronous: for many SMALL
 * streams, where WebCrypto's per-call cost (a key import and an async job
 * each) is the whole cost. The page map (`../pdf-page-images`) decrypts an
 * encrypted file's content streams with it; anything long still goes to
 * WebCrypto (`./aes`), which is faster per byte.
 *
 * History (hostile review r3, 2026-11-14): one WebCrypto call per stream, a
 * 100,000-stream AES file held the preflight 4.3 s where main took 0.86 s;
 * the profile was WebCrypto's own bookkeeping, not AES.
 *
 * Held to WebCrypto byte for byte by `aes-js.test.ts`.
 */

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
const MUL9 = new Uint8Array(256);
const MUL11 = new Uint8Array(256);
const MUL13 = new Uint8Array(256);
const MUL14 = new Uint8Array(256);

const xtime = (a: number): number => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;

function mul(a: number, b: number): number {
  let r = 0;
  for (let x = a, y = b; y > 0; y >>= 1, x = xtime(x)) {
    if (y & 1) r ^= x;
  }
  return r;
}

{
  // The S-box from the multiplicative inverse in GF(2^8) and the affine map.
  const rotl = (x: number, s: number) => ((x << s) | (x >> (8 - s))) & 0xff;
  let p = 1;
  let q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    SBOX[p] = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i += 1) {
    INV_SBOX[SBOX[i]!] = i;
    MUL9[i] = mul(i, 9);
    MUL11[i] = mul(i, 11);
    MUL13[i] = mul(i, 13);
    MUL14[i] = mul(i, 14);
  }
}

/** The round keys of a 16-, 24- or 32-byte key, 16 bytes a round. */
function expandKey(key: Uint8Array): Uint8Array {
  const nk = key.length / 4;
  if (nk !== 4 && nk !== 6 && nk !== 8) throw new Error("AES key length");
  const rounds = nk + 6;
  const w = new Uint8Array(16 * (rounds + 1));
  w.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i += 1) {
    let t0 = w[4 * i - 4]!;
    let t1 = w[4 * i - 3]!;
    let t2 = w[4 * i - 2]!;
    let t3 = w[4 * i - 1]!;
    if (i % nk === 0) {
      const r = t0;
      t0 = SBOX[t1]! ^ rcon;
      t1 = SBOX[t2]!;
      t2 = SBOX[t3]!;
      t3 = SBOX[r]!;
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      t0 = SBOX[t0]!;
      t1 = SBOX[t1]!;
      t2 = SBOX[t2]!;
      t3 = SBOX[t3]!;
    }
    const k = 4 * (i - nk);
    w[4 * i] = w[k]! ^ t0;
    w[4 * i + 1] = w[k + 1]! ^ t1;
    w[4 * i + 2] = w[k + 2]! ^ t2;
    w[4 * i + 3] = w[k + 3]! ^ t3;
  }
  return w;
}

/** Decrypt one 16-byte block of `src` at `at` into `dst` at `at`. */
function decryptBlock(
  w: Uint8Array,
  rounds: number,
  src: Uint8Array,
  dst: Uint8Array,
  at: number,
  s: Uint8Array,
  t: Uint8Array,
): void {
  for (let i = 0; i < 16; i += 1) s[i] = src[at + i]! ^ w[16 * rounds + i]!;
  for (let round = rounds - 1; round >= 0; round -= 1) {
    // InvShiftRows and InvSubBytes: row r moves r columns right.
    for (let c = 0; c < 4; c += 1) {
      for (let r = 0; r < 4; r += 1) {
        t[4 * ((c + r) % 4) + r] = INV_SBOX[s[4 * c + r]!]!;
      }
    }
    const k = 16 * round;
    for (let i = 0; i < 16; i += 1) s[i] = t[i]! ^ w[k + i]!;
    if (round === 0) break;
    // InvMixColumns.
    for (let c = 0; c < 4; c += 1) {
      const a0 = s[4 * c]!;
      const a1 = s[4 * c + 1]!;
      const a2 = s[4 * c + 2]!;
      const a3 = s[4 * c + 3]!;
      s[4 * c] = MUL14[a0]! ^ MUL11[a1]! ^ MUL13[a2]! ^ MUL9[a3]!;
      s[4 * c + 1] = MUL9[a0]! ^ MUL14[a1]! ^ MUL11[a2]! ^ MUL13[a3]!;
      s[4 * c + 2] = MUL13[a0]! ^ MUL9[a1]! ^ MUL14[a2]! ^ MUL11[a3]!;
      s[4 * c + 3] = MUL11[a0]! ^ MUL13[a1]! ^ MUL9[a2]! ^ MUL14[a3]!;
    }
  }
  for (let i = 0; i < 16; i += 1) dst[at + i] = s[i]!;
}

/**
 * AES-CBC decrypt of `data` (a multiple of 16 bytes) under `key` and `iv`,
 * as `./aes`'s `aesCbcDecrypt` then (when the padding is not PKCS#7)
 * `aesCbcDecryptNoPad` give it: the PKCS#7 padding removed when it is
 * valid, every block kept when it is not.
 */
export function aesCbcDecryptJs(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  if (data.length === 0 || data.length % 16 !== 0) {
    throw new Error("AES block length");
  }
  const w = expandKey(key);
  const rounds = key.length / 4 + 6;
  const out = new Uint8Array(data.length);
  const s = new Uint8Array(16);
  const t = new Uint8Array(16);
  for (let at = 0; at < data.length; at += 16) {
    decryptBlock(w, rounds, data, out, at, s, t);
    const prev = at === 0 ? iv : data;
    const from = at === 0 ? 0 : at - 16;
    for (let i = 0; i < 16; i += 1) out[at + i]! ^= prev[from + i]!;
  }
  const pad = out[out.length - 1]!;
  if (pad < 1 || pad > 16) return out;
  for (let i = out.length - pad; i < out.length; i += 1) {
    if (out[i] !== pad) return out;
  }
  return out.subarray(0, out.length - pad);
}
