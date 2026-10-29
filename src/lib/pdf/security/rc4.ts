/**
 * RC4 — the stream cipher of the PDF Standard security handler's V1/V2 and
 * its V4 `/V2` crypt filter. Symmetric: the same call encrypts and decrypts.
 * WebCrypto does not offer it. Checked against published vectors in
 * `primitives.test.ts`.
 */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}
