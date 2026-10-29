/**
 * AES-CBC and SHA-2 through WebCrypto — in the browser and in Node alike,
 * so no cipher code of our own runs for AES.
 *
 * WebCrypto's AES-CBC always applies PKCS#7 padding. The PDF handler needs
 * that for streams and strings (AESV2/AESV3), and needs UNPADDED AES in three
 * places of revision 6 (Algorithm 2.B's rounds, and decrypting /UE, /OE and
 * /Perms). Both directions are derived from the padded primitive exactly:
 *
 *  - encrypt, no padding (input a multiple of 16): CBC-encrypt and drop the
 *    last block, which is the padding block and nothing else;
 *  - decrypt, no padding: append the one block that makes the padding valid,
 *    E_k(C_n XOR 0x10…10), so the padded decrypt returns exactly the plain
 *    blocks.
 */

/** A copy whose buffer is a plain ArrayBuffer — what WebCrypto's types ask. */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("This browser has no Web Crypto.");
  return s;
}

async function aesKey(key: Uint8Array, use: KeyUsage[]): Promise<CryptoKey> {
  return subtle().importKey("raw", own(key), { name: "AES-CBC" }, false, use);
}

/** AES-CBC with PKCS#7 padding. */
export async function aesCbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const k = await aesKey(key, ["encrypt"]);
  return new Uint8Array(
    await subtle().encrypt({ name: "AES-CBC", iv: own(iv) }, k, own(data)),
  );
}

/** AES-CBC with PKCS#7 padding; throws on a bad length or padding. */
export async function aesCbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const k = await aesKey(key, ["decrypt"]);
  return new Uint8Array(
    await subtle().decrypt({ name: "AES-CBC", iv: own(iv) }, k, own(data)),
  );
}

/** AES-CBC, no padding: `data.length` must be a multiple of 16. */
export async function aesCbcEncryptNoPad(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (data.length % 16 !== 0) throw new Error("AES block length");
  const padded = await aesCbcEncrypt(key, iv, data);
  return padded.subarray(0, data.length);
}

/** AES-CBC decrypt, no padding: `data.length` must be a multiple of 16. */
export async function aesCbcDecryptNoPad(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (data.length === 0 || data.length % 16 !== 0)
    throw new Error("AES block length");
  const last = data.subarray(data.length - 16);
  const pad = new Uint8Array(16).fill(16);
  // E_k(last XOR pad) is the first block of CBC-encrypting `pad` under IV `last`.
  const extra = (await aesCbcEncrypt(key, last, pad)).subarray(0, 16);
  const joined = new Uint8Array(data.length + 16);
  joined.set(data);
  joined.set(extra, data.length);
  return aesCbcDecrypt(key, iv, joined);
}

export type ShaName = "SHA-256" | "SHA-384" | "SHA-512";

export async function sha(
  name: ShaName,
  data: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest(name, own(data)));
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}
