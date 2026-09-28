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
