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
 * True when pdftotext ran to completion and refused the document: a non-zero
 * exit it chose, not a timeout, a spawn failure or an output ceiling. That
 * answer does not change on retry.
 */
export function isPdfOpenRefusal(error: unknown): boolean {
  return (
    error instanceof PdfTextExecError &&
    error.exitCode !== null &&
    error.exitCode !== 0 &&
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
