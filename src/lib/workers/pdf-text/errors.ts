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
export const PDF_REFUSAL_EXIT_CODES: ReadonlySet<number> = new Set([1, 3]);

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
