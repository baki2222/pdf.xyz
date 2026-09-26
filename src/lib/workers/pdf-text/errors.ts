import { PDF_NEEDS_PASSWORD_MESSAGE } from "@/lib/pdf/encryption";
import { UNREADABLE_PDF_MESSAGE } from "@/lib/pdf/engine";

/**
 * Why `pdftotext` could not OPEN a PDF, and the one sentence a user reads for
 * each reason.
 *
 * Every engine that reads a PDF's text on the worker (PDF to Word, Excel and
 * PowerPoint, Summarize, Translate, AI extraction, Chat with PDF, Extract
 * tables) used to catch this failure with a bare `catch {}`. A PDF that needs a
 * password therefore came back as "The PDF could not be exported to an Office
 * file.", labelled a RETRYABLE internal error. The queue retried a file that
 * could never open, and nothing pointed the user at Unlock PDF.
 *
 * HOW THE REASON IS DECIDED, and why it is not decided by poppler's words.
 * `pdfTextArgs` passes `-q`, which silences poppler's stderr, and poppler
 * exits 1 ("error opening a PDF file") for a wrong password and for a damaged
 * file alike. So the classification happens only AFTER an open failure, from
 * the input's own bytes: a file that failed to open AND carries an `/Encrypt`
 * entry is one that needs a password. It is deliberately not a preflight. A
 * PDF with only an owner password (empty user password, editing restrictions)
 * has `/Encrypt` too, yet pdftotext opens it and extracts its text. Rejecting
 * every `/Encrypt` up front would refuse files that work today, and
 * `native.integration.test.ts` runs that owner-only file through the real
 * binary to keep it working.
 *
 * Import-free apart from the two message constants, so the engines (pure
 * modules) can classify the error without importing the Node-side runner.
 */

/** poppler's documented exit status for "Error opening a PDF file". */
export const POPPLER_EXIT_OPEN_FAILED = 1;

export type PdfTextOpenFailure = "needs-password" | "unreadable";

/** The message for each reason. The password one names Unlock PDF, so the panel's ErrorNote links to it. */
export const PDF_TEXT_OPEN_FAILURE_MESSAGES: Readonly<
  Record<PdfTextOpenFailure, string>
> = {
  "needs-password": PDF_NEEDS_PASSWORD_MESSAGE,
  unreadable: UNREADABLE_PDF_MESSAGE,
};

/** pdftotext could not open the file. `reason` says why, in the user's terms. */
export class PdfTextOpenError extends Error {
  readonly reason: PdfTextOpenFailure;
  constructor(reason: PdfTextOpenFailure) {
    super(PDF_TEXT_OPEN_FAILURE_MESSAGES[reason]);
    this.name = "PdfTextOpenError";
    this.reason = reason;
  }
}

/** A subprocess failure, keeping the exit status the classification needs. */
export class PdfTextExecError extends Error {
  /** The process's exit code, or `null` when it did not exit normally (timeout, signal, buffer overflow). */
  readonly exitCode: number | null;
  constructor(exitCode: number | null) {
    super("pdftotext failed.");
    this.name = "PdfTextExecError";
    this.exitCode = exitCode;
  }
}

const ENCRYPT = new TextEncoder().encode("/Encrypt");

/**
 * PDF delimiter and whitespace bytes: a name ends at one of these. It keeps
 * `/EncryptMetadata` (a key INSIDE an encryption dictionary) from counting as
 * the trailer's `/Encrypt` entry on its own.
 */
function endsName(byte: number | undefined): boolean {
  if (byte === undefined) return true;
  return (
    byte === 0x00 ||
    byte === 0x09 ||
    byte === 0x0a ||
    byte === 0x0c ||
    byte === 0x0d ||
    byte === 0x20 ||
    byte === 0x28 || // (
    byte === 0x29 || // )
    byte === 0x2f || // /
    byte === 0x3c || // <
    byte === 0x3e || // >
    byte === 0x5b || // [
    byte === 0x5d || // ]
    byte === 0x7b || // {
    byte === 0x7d || // }
    byte === 0x25 // %
  );
}

/**
 * Does the file carry an `/Encrypt` entry? The trailer (or the cross-reference
 * stream's dictionary, which is never compressed) names it in plain bytes.
 */
export function hasEncryptEntry(bytes: Uint8Array): boolean {
  const last = bytes.length - ENCRYPT.length;
  outer: for (let i = 0; i <= last; i++) {
    if (bytes[i] !== 0x2f) continue;
    for (let j = 1; j < ENCRYPT.length; j++) {
      if (bytes[i + j] !== ENCRYPT[j]) continue outer;
    }
    if (endsName(bytes[i + ENCRYPT.length])) return true;
  }
  return false;
}

/** Why a file that pdftotext could not open failed to open. */
export function classifyOpenFailure(bytes: Uint8Array): PdfTextOpenFailure {
  return hasEncryptEntry(bytes) ? "needs-password" : "unreadable";
}

/**
 * The run failure an engine returns for an extraction error that is really
 * "this file cannot be opened", or `null` for anything else (a timeout, an
 * oversized output), which stays the engine's own generic failure.
 *
 * Matched by `name` as well as class: vitest shares a module cache across
 * files, and an error that crosses a module boundary twice must not lose its
 * meaning to an `instanceof` against a second copy of this class.
 */
export function pdfTextOpenFailure(
  err: unknown,
): { kind: "cannot_open"; retryable: false; message: string } | null {
  const reason =
    err instanceof PdfTextOpenError
      ? err.reason
      : (err as { name?: unknown } | null)?.name === "PdfTextOpenError"
        ? (err as { reason?: unknown }).reason
        : undefined;
  if (reason !== "needs-password" && reason !== "unreadable") return null;
  return {
    kind: "cannot_open",
    retryable: false,
    message: PDF_TEXT_OPEN_FAILURE_MESSAGES[reason],
  };
}
