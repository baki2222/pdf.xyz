// @vitest-environment node
/**
 * `aesCbcDecryptJs` is the page map's cipher for small streams: it must give
 * exactly what the WebCrypto path the security handler uses gives
 * (`aesCbcDecrypt`, then `aesCbcDecryptNoPad` when the padding is bad).
 */
import { describe, expect, it } from "vitest";
import { aesCbcDecryptJs } from "./aes-js";
import {
  aesCbcDecrypt,
  aesCbcDecryptNoPad,
  aesCbcEncrypt,
  aesCbcEncryptNoPad,
} from "./aes";

/** A deterministic byte source (no Math.random: a failure must replay). */
function bytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

async function webcrypto(key: Uint8Array, iv: Uint8Array, data: Uint8Array) {
  try {
    return await aesCbcDecrypt(key, iv, data);
  } catch {
    return aesCbcDecryptNoPad(key, iv, data);
  }
}

describe("aesCbcDecryptJs is WebCrypto's AES-CBC, byte for byte", () => {
  it("FIPS-197 C.1 and C.3: the known answers decrypt", async () => {
    const hex = (s: string) =>
      Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
    const zero = new Uint8Array(16);
    // One block, IV zero, no padding to strip (the last byte is not a pad).
    expect(
      aesCbcDecryptJs(
        hex("000102030405060708090a0b0c0d0e0f"),
        zero,
        hex("69c4e0d86a7b0430d8cdb78070b4c55a"),
      ),
    ).toEqual(hex("00112233445566778899aabbccddeeff"));
    expect(
      aesCbcDecryptJs(
        hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"),
        zero,
        hex("8ea2b7ca516745bfeafc49904b496089"),
      ),
    ).toEqual(hex("00112233445566778899aabbccddeeff"));
  });

  it.each([16, 32])(
    "%i-byte keys: padded plaintexts of every length to 70, and unpadded block runs",
    async (keyLength) => {
      let checked = 0;
      for (let n = 0; n <= 70; n += 1) {
        const key = bytes(keyLength, 7 * n + keyLength);
        const iv = bytes(16, 11 * n + 3);
        const plain = bytes(n, 13 * n + 5);
        const padded = await aesCbcEncrypt(key, iv, plain);
        const js = aesCbcDecryptJs(key, iv, padded);
        expect(js).toEqual(plain);
        expect(js).toEqual(await webcrypto(key, iv, padded));
        checked += 1;
        if (n > 0 && n % 16 === 0) {
          // No padding: whatever the last block's bytes, the same answer.
          const raw = await aesCbcEncryptNoPad(key, iv, plain);
          expect(aesCbcDecryptJs(key, iv, raw)).toEqual(
            await webcrypto(key, iv, raw),
          );
          checked += 1;
        }
      }
      expect(checked).toBe(71 + 4);
    },
  );

  it("bad padding keeps every block, as the handler's fallback does", async () => {
    const key = bytes(16, 99);
    const iv = bytes(16, 98);
    for (let seed = 1; seed <= 40; seed += 1) {
      const data = bytes(48, seed);
      expect(aesCbcDecryptJs(key, iv, data)).toEqual(
        await webcrypto(key, iv, data),
      );
    }
  });
});
