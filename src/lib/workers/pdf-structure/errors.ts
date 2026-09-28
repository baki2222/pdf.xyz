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
 * Deliberately absent: a reason for a timeout, a spawn or IO error, or a kill
 * nobody asked for. Those are the one class a retry can change, so they stay
 * plain errors and stay retryable.
 *
 * Node-free, so the engine can `instanceof` it without importing the runner.
 */
export type QpdfRefusalReason =
  /** qpdf needs a password to open it (`--requires-password` exits 0). */
  | "password_protected"
  /** Any other exit-2 refusal: nothing qpdf could rebuild into a PDF. */
  | "unrecoverable";

export class QpdfRefusedError extends Error {
  readonly reason: QpdfRefusalReason;

  constructor(reason: QpdfRefusalReason) {
    super(`qpdf refused the document (${reason}).`);
    this.name = "QpdfRefusedError";
    this.reason = reason;
  }
}
