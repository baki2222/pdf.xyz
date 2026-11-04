import { inflateRawSync } from "node:zlib";

/**
 * Why a LibreOffice conversion failed, kept on the error so the engine can
 * tell a DOCUMENT that will never convert from a run that merely did not
 * finish.
 *
 * The runner used to throw one untyped `Error` for every outcome, the engine
 * collapsed all of them to `failed`, and the processor marked `failed`
 * retryable. A password-protected or corrupt deck — the same bytes, the same
 * answer on every attempt — was converted three times with backoff, and a deck
 * that hit the timeout was retried into three timeouts: about 370 s of worker
 * time behind a browser that stops waiting long before that.
 *
 * Deliberately absent: a reason for spawn errors, IO errors and a signal kill
 * the runner did not ask for (an OOM). Those are the one class a retry can
 * change, so they stay plain errors and stay retryable.
 */
export type LibreOfficeFailureReason =
  /** The runner killed it at the configured timeout. */
  | "timeout"
  /** LibreOffice exited non-zero on its own. */
  | "exit"
  /** Exit 0 and no output file: soffice's answer to a file it cannot load. */
  | "no_output"
  /** An output file that is empty or not a PDF. */
  | "bad_output"
  /** An output over the worker's ceiling. */
  | "too_large";

export class LibreOfficeRunError extends Error {
  readonly reason: LibreOfficeFailureReason;

  constructor(reason: LibreOfficeFailureReason) {
    super(`LibreOffice conversion failed (${reason}).`);
    this.name = "LibreOfficeRunError";
    this.reason = reason;
  }
}

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
/** The stream Office writes a password-protected OOXML package into (UTF-16LE). */
const ENCRYPTED_PACKAGE = new Uint8Array(
  [..."EncryptedPackage"].flatMap((c) => [c.charCodeAt(0), 0]),
);

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1)
      if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * True for a password-protected .docx/.xlsx/.pptx.
 *
 * An OOXML file is a ZIP. Once Office encrypts it, it is an OLE compound file
 * holding an `EncryptionInfo` stream and an `EncryptedPackage` stream. The
 * compound-file signature alone is NOT the test: a legacy .doc/.xls/.ppt is a
 * compound file by design, and so is one renamed to .docx, which LibreOffice
 * converts by content. Only the `EncryptedPackage` entry says "locked".
 */
export function isEncryptedOoxml(bytes: Uint8Array): boolean {
  if (bytes.length < CFB_MAGIC.length) return false;
  for (let i = 0; i < CFB_MAGIC.length; i += 1)
    if (bytes[i] !== CFB_MAGIC[i]) return false;
  return indexOf(bytes, ENCRYPTED_PACKAGE) !== -1;
}

/** Where an OpenDocument package lists its parts. */
const ODF_MANIFEST = "META-INF/manifest.xml";
/** The manifest element every encrypted part carries (`manifest:encryption-data`). */
const ENCRYPTION_DATA = "encryption-data";
/** A manifest is a few KB; anything bigger is not one worth inflating. */
const MAX_MANIFEST_BYTES = 1 << 20;

const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number): number =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

/**
 * The bytes of one ZIP entry, found through the central directory, or null:
 * not a ZIP, no such entry, ZIP64, a method other than stored/deflate, an
 * offset outside the file, or an entry that inflates past `MAX_MANIFEST_BYTES`.
 * Null is "cannot tell", never "not locked": the caller then lets LibreOffice
 * decide, as before this check existed.
 */
function zipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  // End of central directory: 22 bytes, then up to a 64 KB comment.
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= floor; i -= 1)
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  const count = u16(bytes, eocd + 10);
  let at = u32(bytes, eocd + 16);
  const wanted = new TextEncoder().encode(name);
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) return null;
    const method = u16(bytes, at + 10);
    const size = u32(bytes, at + 20);
    const nameLength = u16(bytes, at + 28);
    const skip = nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
    const local = u32(bytes, at + 42);
    const entryName = bytes.subarray(at + 46, at + 46 + nameLength);
    at += 46 + skip;
    if (
      entryName.length !== wanted.length ||
      !entryName.every((c, i) => c === wanted[i])
    )
      continue;
    if (size === 0xffffffff || local === 0xffffffff) return null;
    if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50)
      return null;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    if (start + size > bytes.length) return null;
    const data = bytes.subarray(start, start + size);
    if (method === 0) return data.length <= MAX_MANIFEST_BYTES ? data : null;
    if (method !== 8) return null;
    try {
      return new Uint8Array(
        inflateRawSync(data, { maxOutputLength: MAX_MANIFEST_BYTES }),
      );
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * True for a password-protected OpenDocument file (.odt, .ods, .odp).
 *
 * Unlike OOXML, a locked ODF file is still a ZIP whose first entry is its
 * plain `mimetype`, so `officeContentRefusal` passes it as what it says it
 * is. LibreOffice's answer to one, headless and without a password, is exit
 * 0 and no PDF — measured on LibreOffice 7.4.7.2 in the worker image on
 * 2026-11-04 with files that LibreOffice itself locked
 * (`src/tests/odf-locked-fixtures/`) — which the engine could only call
 * `unreadable`, with advice about Word. The manifest is never encrypted, and
 * lists a `<manifest:encryption-data>` for every part that is (ODF 1.2 Part
 * 3, §3.8; 8 to 10 of them in each fixture, 0 in its unlocked twin).
 */
export function isEncryptedOdf(bytes: Uint8Array): boolean {
  const manifest = zipEntry(bytes, ODF_MANIFEST);
  if (manifest === null) return false;
  return indexOf(manifest, new TextEncoder().encode(ENCRYPTION_DATA)) !== -1;
}
