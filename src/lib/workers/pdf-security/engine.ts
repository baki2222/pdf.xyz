/**
 * PDF security engine (server / secure-worker side) — the qpdf-backed
 * orchestration behind **Protect PDF** (encrypt) and **Unlock PDF** (decrypt).
 *
 * This is the security analogue of `../compression/engine.ts`, and it keeps the
 * exact same honesty posture:
 *
 *   - The transformation genuinely requires the native `qpdf` binary. When no
 *     qpdf runner is wired the engine returns an honest `unsupported` result; it
 *     NEVER fabricates an "encrypted" or "unlocked" file.
 *   - Every failure mode is explicit and typed — an already-encrypted protect
 *     input, a non-encrypted unlock input, a wrong password, an unreadable PDF,
 *     an oversize input, or an engine crash — so the processor can map each to a
 *     precise, content-free job error. There is no branch that dresses up bytes
 *     it did not verify.
 *   - It proves its own work: a protect output must come back genuinely
 *     encrypted, and an unlock output must come back genuinely NOT encrypted, or
 *     the run fails. So a passthrough or a botched engine call can never look like
 *     success.
 *
 * The qpdf runner is INJECTED (`QpdfRunner`), so both the "no binary → honest
 * failure" path and the "binary present → real invocation" path are fully
 * unit-testable without shipping a native binary in CI. The runner is the ONLY
 * place a password is used; this module threads the validated password from the
 * options straight into the runner and never copies it anywhere else — not into
 * the result metadata, not into an error message, not into a log line.
 */

import type {
  ProtectPdfOptions,
  UnlockPdfOptions,
  PdfKeyLength,
} from "@/lib/jobs/pdf-security";
import { looksLikePdf } from "../compression/engine";

/** The two tools this engine powers. */
export const PROTECT_TOOL = "protect-pdf";
export const UNLOCK_TOOL = "unlock-pdf";
export const PDF_SECURITY_TOOLS = [PROTECT_TOOL, UNLOCK_TOOL] as const;
export type PdfSecurityTool = (typeof PDF_SECURITY_TOOLS)[number];

/** The native engine that does the work. Always qpdf for this capability. */
export const PDF_SECURITY_ENGINE = "qpdf" as const;
export type PdfSecurityEngine = typeof PDF_SECURITY_ENGINE;

/** Command name probed for the qpdf engine. */
export const QPDF_BINARY = "qpdf";

/** What the qpdf runner needs to encrypt a PDF. */
export interface QpdfProtectInput {
  /** The user/open password (required to open the resulting PDF). */
  userPassword: string;
  /** The owner/permissions password. */
  ownerPassword: string;
  /** AES key length. */
  keyLength: PdfKeyLength;
}

/** What the qpdf runner needs to decrypt a PDF. */
export interface QpdfUnlockInput {
  /** The password that currently opens the encrypted PDF. */
  password: string;
}

/**
 * The outcome of a decrypt attempt. `wrongPassword` distinguishes an incorrect
 * password (a deterministic, non-retryable user error) from every other engine
 * failure, WITHOUT surfacing the password or any raw engine text.
 */
export type QpdfUnlockOutcome =
  { ok: true; output: Uint8Array } | { ok: false; wrongPassword: boolean };

/**
 * The injected native qpdf runner. A production worker supplies one that shells
 * out to qpdf in an isolated temp directory (`./native`); tests supply a fake.
 * Every method throws on an UNEXPECTED failure (spawn error, timeout, unreadable
 * output) so the engine can classify it honestly; `unlock` additionally reports a
 * wrong password as a normal (non-throwing) outcome.
 */
export interface QpdfRunner {
  /** True when the input bytes are an encrypted PDF (needs no password to answer). */
  isEncrypted(input: Uint8Array): Promise<boolean>;
  /** Encrypt the input and return the encrypted bytes. Throws on failure. */
  protect(input: Uint8Array, opts: QpdfProtectInput): Promise<Uint8Array>;
  /** Decrypt the input with the given password; distinguishes a wrong password. */
  unlock(input: Uint8Array, opts: QpdfUnlockInput): Promise<QpdfUnlockOutcome>;
}

/** Strict resource limits for the native path. */
export interface PdfSecurityLimits {
  /**
   * Max input size accepted, in bytes. When set and the input exceeds it, the run
   * fails honestly as `too_large` before anything is spawned.
   */
  maxInputBytes?: number;
}

/** Everything the engine needs, all injectable for tests. */
export interface PdfSecurityDeps {
  /**
   * The native qpdf runner. Absent when qpdf is not installed/enabled on this
   * host — in which case every request fails honestly as `unsupported`.
   */
  qpdf?: QpdfRunner;
  /**
   * Validate that produced/candidate bytes are a usable PDF. Defaults to
   * {@link looksLikePdf}, a cheap structural header/trailer check.
   */
  validate?: (bytes: Uint8Array) => boolean | Promise<boolean>;
  /** Strict resource limits for the native path. */
  limits?: PdfSecurityLimits;
}

/** Content-free, serializable metrics for a successful run. Never carries a password. */
export interface PdfSecurityResultMeta {
  engine: PdfSecurityEngine;
  /** Which operation ran. */
  operation: "protect" | "unlock";
  /** Encryption strength — present for protect only. */
  keyLength?: PdfKeyLength;
  inputBytes: number;
  outputBytes: number;
}

/**
 * The outcome of a protect/unlock attempt. Every non-success case is explicit and
 * content-free; there is no branch that returns fabricated output, and no message
 * ever carries a password or raw engine text.
 */
export type PdfSecurityRun =
  | { ok: true; output: Uint8Array; meta: PdfSecurityResultMeta }
  | { ok: false; kind: "unsupported"; message: string }
  | { ok: false; kind: "invalid_pdf"; message: string }
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  | { ok: false; kind: "already_encrypted"; message: string }
  | { ok: false; kind: "not_encrypted"; message: string }
  | { ok: false; kind: "wrong_password"; message: string }
  | { ok: false; kind: "failed"; message: string };

// Fixed, content-free messages. None can ever contain a password, a filename, a
// path, or raw engine output — they describe the OUTCOME, never the content.
const UNSUPPORTED_MESSAGE =
  "PDF encryption requires the native qpdf engine, which is not installed in this environment.";
const TOO_LARGE_MESSAGE =
  "The input PDF exceeds the worker's size limit for this operation.";
const INVALID_PDF_MESSAGE = "The input could not be read as a PDF.";
const ALREADY_ENCRYPTED_MESSAGE =
  "This PDF is already password-protected. Unlock it first, then protect it again.";
const NOT_ENCRYPTED_MESSAGE =
  "This PDF isn't password-protected, so there's nothing to unlock.";
const WRONG_PASSWORD_MESSAGE =
  "The password is incorrect, or this PDF cannot be unlocked with it.";
// A blank password is how a restrictions-only file is unlocked; on a file that
// needs a password to OPEN, the honest answer is that it needs one — not that
// the (absent) password was wrong.
const PASSWORD_REQUIRED_MESSAGE =
  "This PDF needs a password to open. Enter that password and try again.";
const FAILED_MESSAGE =
  "The PDF security engine could not process this file. No output was produced.";

const unsupported = (): PdfSecurityRun => ({
  ok: false,
  kind: "unsupported",
  message: UNSUPPORTED_MESSAGE,
});
const failed = (): PdfSecurityRun => ({
  ok: false,
  kind: "failed",
  message: FAILED_MESSAGE,
});

/** Shared preflight: engine present, input within limits, input a readable PDF. */
async function preflight(
  input: Uint8Array,
  deps: PdfSecurityDeps,
): Promise<{ ok: true } | { ok: false; run: PdfSecurityRun }> {
  if (!deps.qpdf) return { ok: false, run: unsupported() };

  const limit = deps.limits?.maxInputBytes;
  if (limit !== undefined && input.byteLength > limit) {
    return {
      ok: false,
      run: {
        ok: false,
        kind: "too_large",
        limitBytes: limit,
        message: TOO_LARGE_MESSAGE,
      },
    };
  }

  const validate = deps.validate ?? looksLikePdf;
  if (!(await validate(input))) {
    return {
      ok: false,
      run: { ok: false, kind: "invalid_pdf", message: INVALID_PDF_MESSAGE },
    };
  }
  return { ok: true };
}

/**
 * Encrypt a PDF with qpdf. Honest guarantees:
 *  - `unsupported` when qpdf is not wired (nothing is executed);
 *  - `too_large` / `invalid_pdf` on a rejected input (before any engine call);
 *  - `already_encrypted` when the input is itself encrypted (qpdf cannot re-encrypt
 *    it without its current password) — a distinct, non-retryable user error;
 *  - `failed` when the engine errors OR produces output that is not a readable,
 *    genuinely-encrypted PDF (proven by re-inspecting the output);
 *  - success carrying the encrypted bytes and content-free size metrics otherwise.
 * The password is used only to call the runner; it is never placed in a result or
 * a message.
 */
export async function runProtect(
  input: Uint8Array,
  options: ProtectPdfOptions,
  deps: PdfSecurityDeps,
): Promise<PdfSecurityRun> {
  const pre = await preflight(input, deps);
  if (!pre.ok) return pre.run;
  const qpdf = deps.qpdf!;
  const validate = deps.validate ?? looksLikePdf;

  // A PDF that is already encrypted cannot be re-encrypted without its current
  // password, so reject it honestly rather than let qpdf fail opaquely.
  let alreadyEncrypted: boolean;
  try {
    alreadyEncrypted = await qpdf.isEncrypted(input);
  } catch {
    return failed();
  }
  if (alreadyEncrypted) {
    return {
      ok: false,
      kind: "already_encrypted",
      message: ALREADY_ENCRYPTED_MESSAGE,
    };
  }

  let output: Uint8Array;
  try {
    output = await qpdf.protect(input, {
      userPassword: options.password,
      ownerPassword: options.ownerPassword,
      keyLength: options.keyLength,
    });
  } catch {
    return failed();
  }

  // Never accept the engine's output without proving it is a readable PDF that is
  // genuinely encrypted — a passthrough or a botched run can never look like success.
  if (!(await validate(output))) return failed();
  let outputEncrypted: boolean;
  try {
    outputEncrypted = await qpdf.isEncrypted(output);
  } catch {
    return failed();
  }
  if (!outputEncrypted) return failed();

  return {
    ok: true,
    output,
    meta: {
      engine: PDF_SECURITY_ENGINE,
      operation: "protect",
      keyLength: options.keyLength,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
    },
  };
}

/**
 * Remove encryption from a PDF with qpdf. Honest guarantees:
 *  - `unsupported` when qpdf is not wired (nothing is executed);
 *  - `too_large` / `invalid_pdf` on a rejected input (before any engine call);
 *  - `not_encrypted` when the input carries no encryption to remove;
 *  - `wrong_password` when the supplied password does not open it — a distinct,
 *    non-retryable user error (unlock never recovers or bypasses an unknown password).
 *    A blank password is how a file that opens freely but carries editing
 *    restrictions is unlocked; on a file that needs a password to open, blank
 *    fails here too, with copy that says a password is needed;
 *  - `failed` when the engine errors OR produces output that is not a readable,
 *    genuinely-DEcrypted PDF (proven by re-inspecting the output);
 *  - success carrying the decrypted bytes and content-free size metrics otherwise.
 */
export async function runUnlock(
  input: Uint8Array,
  options: UnlockPdfOptions,
  deps: PdfSecurityDeps,
): Promise<PdfSecurityRun> {
  const pre = await preflight(input, deps);
  if (!pre.ok) return pre.run;
  const qpdf = deps.qpdf!;
  const validate = deps.validate ?? looksLikePdf;

  // Nothing to unlock if the input is not encrypted — an honest, distinct failure.
  let encrypted: boolean;
  try {
    encrypted = await qpdf.isEncrypted(input);
  } catch {
    return failed();
  }
  if (!encrypted) {
    return { ok: false, kind: "not_encrypted", message: NOT_ENCRYPTED_MESSAGE };
  }

  let outcome: QpdfUnlockOutcome;
  try {
    outcome = await qpdf.unlock(input, { password: options.password });
  } catch {
    return failed();
  }
  if (!outcome.ok) {
    if (!outcome.wrongPassword) return failed();
    return {
      ok: false,
      kind: "wrong_password",
      message:
        options.password.length === 0
          ? PASSWORD_REQUIRED_MESSAGE
          : WRONG_PASSWORD_MESSAGE,
    };
  }

  const output = outcome.output;
  if (!(await validate(output))) return failed();
  // Prove the encryption was actually removed — a result that is still encrypted
  // is a failure, never a success.
  let stillEncrypted: boolean;
  try {
    stillEncrypted = await qpdf.isEncrypted(output);
  } catch {
    return failed();
  }
  if (stillEncrypted) return failed();

  return {
    ok: true,
    output,
    meta: {
      engine: PDF_SECURITY_ENGINE,
      operation: "unlock",
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
    },
  };
}
