import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aesCbcDecryptNoPad, aesCbcEncryptNoPad } from "./aes";
import { md5 } from "./md5";
import { rc4 } from "./rc4";

/**
 * The cipher primitives against oracles that are not ours: RFC 1321's own
 * test suite, published RC4 vectors, and Node's OpenSSL for MD5, RC4-free
 * AES and the unpadded AES both directions.
 */

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const text = (s: string) => new TextEncoder().encode(s);

describe("md5", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ])("RFC 1321: md5(%j)", (input, want) => {
    expect(hex(md5(text(input)))).toBe(want);
  });

  it("agrees with OpenSSL at every length across the padding boundaries", () => {
    for (let n = 0; n < 200; n += 1) {
      const data = randomBytes(n);
      expect(hex(md5(data))).toBe(createHash("md5").update(data).digest("hex"));
    }
  });
});

describe("rc4", () => {
  it.each([
    ["Key", "Plaintext", "bbf316e8d940af0ad3"],
    ["Wiki", "pedia", "1021bf0420"],
    ["Secret", "Attack at dawn", "45a01f645fc35b383552544b9bf5"],
  ])("published vector: key %j", (key, plain, want) => {
    expect(hex(rc4(text(key), text(plain)))).toBe(want);
  });

  it("is its own inverse", () => {
    const key = randomBytes(16);
    const data = randomBytes(300);
    expect(hex(rc4(key, rc4(key, data)))).toBe(hex(data));
  });
});

describe("unpadded AES-CBC through WebCrypto", () => {
  it.each([16, 32])("matches OpenSSL with a %i-byte key", async (keyLen) => {
    const key = randomBytes(keyLen);
    const iv = randomBytes(16);
    const data = randomBytes(64);
    const algo = keyLen === 16 ? "aes-128-cbc" : "aes-256-cbc";
    const c = createCipheriv(algo, key, iv).setAutoPadding(false);
    const want = Buffer.concat([c.update(data), c.final()]);
    const got = await aesCbcEncryptNoPad(key, iv, data);
    expect(hex(got)).toBe(want.toString("hex"));
    expect(hex(await aesCbcDecryptNoPad(key, iv, got))).toBe(hex(data));
  });

  it("refuses a length that is not whole blocks", async () => {
    await expect(
      aesCbcEncryptNoPad(randomBytes(16), randomBytes(16), randomBytes(15)),
    ).rejects.toThrow();
  });
});
