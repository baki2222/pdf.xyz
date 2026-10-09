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
 * TWO ERRORS, ONE DECISION. The runner (`./native`) rejects every failed run
 * with a {@link PdfTextExecError} carrying the exit status, the kill flag and
 * the output ceiling. When that failure is poppler refusing the DOCUMENT
 * ({@link isPdfOpenRefusal}: exit 1 or 3, run to completion), the runner asks
 * the bytes why and throws a {@link PdfTextOpenError} instead. Summarize,
 * Translate, AI extraction and Chat read it through {@link pdfTextOpenFailure};
 * PDF to Office and Extract tables read the same reason through
 * `classifyPdfTextFailure` (`../pdf-office-export/encryption`), which gives
 * each its own next-step code. Two branches fixed this defect separately and
 * were merged here; the runner's classification is the one both report.
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
  const reason = pdfTextOpenReason(err);
  if (!reason) return null;
  return {
    kind: "cannot_open",
    retryable: false,
    message: PDF_TEXT_OPEN_FAILURE_MESSAGES[reason],
  };
}

/**
 * The reason on a {@link PdfTextOpenError}, or `null` for any other throw.
 * Shared by {@link pdfTextOpenFailure} and the office-export / table-extract
 * classifier (`../pdf-office-export/encryption`), so the runner's one decision
 * about a file is the one every engine reports.
 */
export function pdfTextOpenReason(err: unknown): PdfTextOpenFailure | null {
  const reason =
    err instanceof PdfTextOpenError
      ? err.reason
      : (err as { name?: unknown } | null)?.name === "PdfTextOpenError"
        ? (err as { reason?: unknown }).reason
        : undefined;
  return reason === "needs-password" || reason === "unreadable" ? reason : null;
}

/**
 * How a `pdftotext` run failed — kept on the error so an engine can tell a
 * document that CANNOT be read from a run that merely did not finish.
 *
 * The runner used to reject every failure with a bare `Error("pdftotext
 * failed.")`, which made the two indistinguishable, and the office-export
 * engine mapped both to a retryable `internal_error`. So a password-protected
 * PDF — which fails identically on every attempt — was requeued with backoff
 * and then reported as "could not be exported", with nothing saying it was
 * locked or where to unlock it.
 *
 * Deliberately NOT carried: stderr. The runner passes `-q`, so poppler prints
 * nothing, and its prose changes between versions anyway. The exit status is
 * not enough on its own either: poppler exits 1 for EVERY "error opening PDF",
 * a wrong password and a damaged file alike. It says "this document will not
 * open", and the caller has to ask the document why. Node-free, so engines can
 * import it.
 */
export class PdfTextExecError extends Error {
  /** The process's exit status, or null when it never exited on its own. */
  readonly exitCode: number | null;
  /** True when the runner killed it — the timeout. */
  readonly killed: boolean;
  /** True when stdout outgrew the configured ceiling. */
  readonly outputTooLarge: boolean;

  constructor(detail: {
    exitCode: number | null;
    killed: boolean;
    outputTooLarge: boolean;
  }) {
    super("pdftotext failed.");
    this.name = "PdfTextExecError";
    this.exitCode = detail.exitCode;
    this.killed = detail.killed;
    this.outputTooLarge = detail.outputTooLarge;
  }
}

/**
 * The exit statuses with which poppler's (and Xpdf's) `pdftotext` says the
 * DOCUMENT is the problem: 1 "error opening a PDF file", 3 "error related to
 * PDF permissions". The others are not about the document — 2 is "error
 * opening an output file" and 99 "other error" — so a retry may succeed, and
 * calling them "damaged, try Repair PDF" would send the user to fix a file
 * that is fine. (The first version accepted any non-zero exit.)
 */
export const PDF_REFUSAL_EXIT_CODES: ReadonlySet<number> = new Set([
  POPPLER_EXIT_OPEN_FAILED,
  3,
]);

/**
 * True when pdftotext ran to completion and refused the document: an exit
 * status in {@link PDF_REFUSAL_EXIT_CODES}, not a timeout, a spawn failure, an
 * output ceiling or an environmental error. That answer does not change on
 * retry.
 */
export function isPdfOpenRefusal(error: unknown): boolean {
  return (
    error instanceof PdfTextExecError &&
    error.exitCode !== null &&
    PDF_REFUSAL_EXIT_CODES.has(error.exitCode) &&
    !error.killed &&
    !error.outputTooLarge
  );
}

/** Build the error from what `execFile` handed back. */
export function pdfTextExecErrorFrom(error: {
  code?: unknown;
  killed?: unknown;
}): PdfTextExecError {
  return new PdfTextExecError({
    exitCode: typeof error.code === "number" ? error.code : null,
    killed: error.killed === true,
    outputTooLarge: error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  });
}
