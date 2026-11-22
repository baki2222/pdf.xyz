/**
 * Restoring an EPUB's obfuscated fonts, as every reading system does.
 *
 * Font obfuscation scrambles the first bytes of an embedded font so it cannot
 * be lifted out of the book and installed; the key is the book's own
 * identifier, so anything that can read the book can restore it. It is NOT
 * DRM, and the chapters are never touched by it. Two methods exist:
 *
 *  - IDPF (`http://www.idpf.org/2008/embedding`, EPUB OCF 3 "Font
 *    Obfuscation"): the key is the SHA-1 of the package's unique identifier
 *    with all white space (U+0020, U+0009, U+000D, U+000A) removed; the first
 *    1040 bytes of the font are XORed with it, repeating.
 *  - Adobe (`http://ns.adobe.com/pdf/enc#RC`): the key is the 16 bytes of the
 *    UUID in the book's `urn:uuid:` identifier; the first 1024 bytes are
 *    XORed with it, repeating.
 *
 * A restored font must START like a font (TrueType, OpenType, a collection,
 * WOFF or WOFF2). One that does not was obfuscated against some other key, or
 * compressed before it was obfuscated, and is left out rather than handed to
 * Chromium as bytes no reader could use — the caller counts it, and the note
 * beside the download says how many.
 */
import { createHash } from "node:crypto";

export const IDPF_FONT_ALGORITHM = "http://www.idpf.org/2008/embedding";
export const ADOBE_FONT_ALGORITHM = "http://ns.adobe.com/pdf/enc#RC";

/** The identifiers a book declares: its unique one, and every dc:identifier. */
export interface BookIdentifiers {
  /** The dc:identifier the package's `unique-identifier` names, if any. */
  unique: string | null;
  /** Every dc:identifier, in document order. */
  all: readonly string[];
}

/** The first four bytes of every font format a browser loads. */
const FONT_SIGNATURES: readonly number[][] = [
  [0x00, 0x01, 0x00, 0x00], // TrueType
  [0x4f, 0x54, 0x54, 0x4f], // "OTTO": OpenType (CFF)
  [0x74, 0x72, 0x75, 0x65], // "true": old Apple TrueType
  [0x74, 0x74, 0x63, 0x66], // "ttcf": a collection
  [0x77, 0x4f, 0x46, 0x46], // "wOFF"
  [0x77, 0x4f, 0x46, 0x32], // "wOF2"
];

export function looksLikeFont(bytes: Uint8Array): boolean {
  return FONT_SIGNATURES.some((sig) => sig.every((b, i) => bytes[i] === b));
}

function xorHead(bytes: Uint8Array, key: Uint8Array, length: number) {
  const out = bytes.slice();
  for (let i = 0; i < Math.min(length, out.length); i += 1)
    out[i] = out[i]! ^ key[i % key.length]!;
  return out;
}

function idpfKey(ids: BookIdentifiers): Uint8Array | null {
  const uid = ids.unique ?? ids.all[0] ?? null;
  if (uid === null) return null;
  return new Uint8Array(
    createHash("sha1")
      .update(uid.replace(/[ \u0009\u000d\u000a]/g, ""), "utf8")
      .digest(),
  );
}

const UUID =
  /^\s*(?:urn:uuid:)?([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})\s*$/i;

function adobeKey(ids: BookIdentifiers): Uint8Array | null {
  // The unique identifier when it is a UUID, else the first one that is.
  for (const id of [ids.unique, ...ids.all]) {
    const match = id === null ? null : UUID.exec(id);
    if (match)
      return new Uint8Array(Buffer.from(match[1]!.replace(/-/g, ""), "hex"));
  }
  return null;
}

/**
 * The font restored, or null when it cannot be: an algorithm that is not one
 * of the two, no identifier to make a key from, or a result that is not a
 * font.
 */
export function deobfuscateFont(
  algorithm: string,
  bytes: Uint8Array,
  ids: BookIdentifiers,
): Uint8Array | null {
  const restored =
    algorithm === IDPF_FONT_ALGORITHM
      ? withKey(idpfKey(ids), (key) => xorHead(bytes, key, 1040))
      : algorithm === ADOBE_FONT_ALGORITHM
        ? withKey(adobeKey(ids), (key) => xorHead(bytes, key, 1024))
        : null;
  return restored && looksLikeFont(restored) ? restored : null;
}

function withKey(
  key: Uint8Array | null,
  restore: (key: Uint8Array) => Uint8Array,
): Uint8Array | null {
  return key ? restore(key) : null;
}
