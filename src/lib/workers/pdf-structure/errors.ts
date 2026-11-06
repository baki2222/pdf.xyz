/**
 * Why qpdf refused a document, kept on the error so the engine can tell a FILE
 * that will never open from a run that merely did not finish.
 *
 * qpdf exits 2 when it cannot produce output: a user password it was not given,
 * or damage too deep to rebuild. Both are properties of the bytes — the same
 * input gets the same answer every time. The runner used to throw one untyped
 * `Error` for that and for a timeout alike, the engine collapsed both to
 * `failed`, and the processor marked `failed` retryable, so a locked PDF was
 * run three times with backoff and then reported as "could not process this
 * file", with no word about the password.
 *
 * Deliberately absent: a reason for a spawn or IO error, or a kill nobody asked
 * for. Those are the one class a retry can change, so they stay plain errors and
 * stay retryable. A timeout is NOT in that class — see {@link QpdfTimedOutError}.
 *
 * Node-free, so the engine can `instanceof` it without importing the runner.
 */
export type QpdfRefusalReason =
  /** qpdf needs a password to open it (`--requires-password` exits 0). */
  | "password_protected"
  /** Any other exit-2 refusal: nothing qpdf could rebuild into a PDF. */
  | "unrecoverable";

/**
 * qpdf did not finish inside its per-run time limit.
 *
 * Until 2026-11-06 (audit #36) this was the same plain `Error` as a spawn
 * failure, so it stayed retryable: the job was rerun with the same bytes against
 * the same limit, timed out again on every attempt, and ended with "could not
 * process this file", which never said the file took too long. Typed so the
 * engine can make it final and say so.
 */
export class QpdfTimedOutError extends Error {
  constructor() {
    super("qpdf timed out.");
    this.name = "QpdfTimedOutError";
  }
}

export class QpdfRefusedError extends Error {
  readonly reason: QpdfRefusalReason;

  constructor(reason: QpdfRefusalReason) {
    super(`qpdf refused the document (${reason}).`);
    this.name = "QpdfRefusedError";
    this.reason = reason;
  }
}
