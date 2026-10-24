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
 *   - Every failure mode is explicit and typed — a protect input that already
 *     needs a password to open, a protect input that opens freely but whose
 *     permissions are locked by an owner password, a non-encrypted unlock input,
 *     a wrong password, a wrong password for a file that opens freely (which
 *     needs its OWNER password), a file qpdf cannot open at all, an unreadable
 *     PDF, an oversize input, or an engine crash — so the processor can map
 *     each to a precise, content-free job error. There is no branch that
 *     dresses up bytes it did not verify.
 *   - It proves its own work: a protect output must come back needing a
 *     password to open, and an unlock output must come back genuinely NOT
 *     encrypted, or the run fails. So a passthrough or a botched engine call can
 *     never look like success.
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
import {
  ALL_PERMISSIONS_ALLOWED,
  PDF_PERMISSION_KEYS,
  permissionMismatches,
  type PdfPermissionKey,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import { looksLikePdf } from "../compression/engine";
import { readEncryptPermissions } from "./permission-bits";

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
  /** What a reader may do without the owner password; absent = all allowed. */
  permissions?: PdfPermissions;
}

/** What the qpdf runner needs to decrypt a PDF. */
export interface QpdfUnlockInput {
  /**
   * The password that opens the encrypted PDF — or, for one that opens without
   * a password and only restricts printing/copying/editing, its owner password.
   */
  password: string;
}

/**
 * What qpdf `--requires-password` says about opening a file with no password:
 *  - `needs-password` — it is encrypted and the empty password does not open it;
 *  - `opens-freely` — it is encrypted, but only its PERMISSIONS are locked (by an
 *    owner password): anyone can open it, printing/copying/editing may be
 *    restricted. `isEncrypted` answers "yes" for this case too, which is why it
 *    cannot be what decides "already password-protected";
 *  - `not-encrypted` — no encryption at all, and qpdf can open the file;
 *  - `unreadable` — qpdf cannot open the file at all: damaged beyond repair, or
 *    encrypted with a scheme qpdf does not support.
 *
 * History: qpdf answers 2 for both of the last two, and until 2026-09 the runner
 * reported every 2 as `not-encrypted`. Unlock then told the owner of a damaged
 * or unsupported-encryption PDF "This PDF isn't password-protected". The runner
 * now asks qpdf whether the file opens before it says `not-encrypted`.
 */
export type QpdfPasswordRequirement =
  "needs-password" | "opens-freely" | "not-encrypted" | "unreadable";

/**
 * The outcome of a decrypt attempt. A refusal carries WHY, established
 * positively and never from the decrypt's exit status alone (qpdf exits 2 for a
 * wrong password and for every other error):
 *  - `wrong-password` — qpdf says a password is needed and this one does not
 *    open the file;
 *  - `unreadable` — qpdf cannot open the file at all, whatever the password.
 * Both are deterministic, non-retryable properties of the input; every other
 * engine failure throws. Neither surfaces the password or any raw engine text.
 *
 * History: this was `{ ok: false; wrongPassword: boolean }` and the runner set
 * `wrongPassword: true` on every exit 2, so a damaged encrypted file was "The
 * password is incorrect" and a correct password could never succeed.
 */
export type QpdfUnlockOutcome =
  | { ok: true; output: Uint8Array }
  | { ok: false; reason: "wrong-password" | "unreadable" };

/**
 * The injected native qpdf runner. A production worker supplies one that shells
 * out to qpdf in an isolated temp directory (`./native`); tests supply a fake.
 * Every method throws on an UNEXPECTED failure (spawn error, timeout, unreadable
 * output) so the engine can classify it honestly; `unlock` additionally reports a
 * wrong password as a normal (non-throwing) outcome.
 */
export interface QpdfRunner {
  /**
   * True when the input bytes are an encrypted PDF (needs no password to
   * answer); false only for a file qpdf can open. Throws on a file qpdf cannot
   * open, so an unreadable output can never pass as "no longer encrypted".
   */
  isEncrypted(input: Uint8Array): Promise<boolean>;
  /** Whether opening the input needs a password (needs no password to answer). */
  requiresPassword(input: Uint8Array): Promise<QpdfPasswordRequirement>;
  /** Encrypt the input and return the encrypted bytes. Throws on failure. */
  protect(input: Uint8Array, opts: QpdfProtectInput): Promise<Uint8Array>;
  /** Decrypt the input with the given password; says why when it refuses. */
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
  /**
   * Protect only: the permission switches withheld, by key (never a
   * password). Empty when nothing was restricted.
   */
  restricted?: PdfPermissionKey[];
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
  | { ok: false; kind: "restrictions_only"; message: string }
  | { ok: false; kind: "not_encrypted"; message: string }
  | { ok: false; kind: "wrong_password"; message: string }
  | { ok: false; kind: "owner_password_required"; message: string }
  | { ok: false; kind: "unreadable"; message: string }
  | { ok: false; kind: "failed"; message: string };

// Fixed, content-free messages. None can ever contain a password, a filename, a
// path, or raw engine output — they describe the OUTCOME, never the content.
const UNSUPPORTED_MESSAGE =
  "PDF encryption requires the native qpdf engine, which is not installed in this environment.";
const TOO_LARGE_MESSAGE =
  "The input PDF exceeds the worker's size limit for this operation.";
const INVALID_PDF_MESSAGE = "The input could not be read as a PDF.";
// Shown ONLY when qpdf says a password is needed to open the file. It used to be
// shown for every encrypted input, including files the user had just opened
// without one, so the message contradicted what they could see.
const ALREADY_ENCRYPTED_MESSAGE =
  "This PDF already needs a password to open. Unlock it with that password first, then protect it again.";
// A file that opens freely but whose permissions an owner password locks. Unlock
// and Protect never change a file's protection without the password that set it
// ("can't recover or bypass a password you don't know"), and replacing these
// restrictions with a new password would do exactly that in two steps — so this
// is a truthful refusal that names the password that is actually needed.
const RESTRICTIONS_ONLY_MESSAGE =
  "This PDF opens without a password, but its printing, copying or editing is locked with a separate owner (permissions) password. Unlock it with that owner password first, then protect it.";
const NOT_ENCRYPTED_MESSAGE =
  "This PDF isn't password-protected, so there's nothing to unlock.";
export const WRONG_PASSWORD_MESSAGE =
  "The password is incorrect, or this PDF cannot be unlocked with it.";
// A wrong password for a file that opens WITHOUT one. The user has no "password
// that opens it" to type, so "The password is incorrect" (what they got until
// 2026-09) was a dead end with a false diagnosis. The rule is unchanged — the
// restrictions go only with the owner password — and this names that password.
export const OWNER_PASSWORD_REQUIRED_MESSAGE =
  "That isn't this PDF's owner (permissions) password. This PDF opens without a password — only its printing, copying or editing is restricted — and Unlock removes those restrictions only with the owner password that set them.";
// qpdf cannot open the file at all. Until 2026-09 Unlock called this "The
// password is incorrect" (at the decrypt) or "This PDF isn't password-protected"
// (at the encryption check), and Protect a retryable engine crash.
export const UNREADABLE_MESSAGE =
  "This PDF is damaged or uses a kind of encryption we can't open, so it couldn't be processed. No output was produced.";
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
const unreadable = (): PdfSecurityRun => ({
  ok: false,
  kind: "unreadable",
  message: UNREADABLE_MESSAGE,
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
 *  - `already_encrypted` when opening the input already needs a password — a
 *    distinct, non-retryable user error;
 *  - `restrictions_only` when the input opens without a password but an owner
 *    password locks its permissions — also non-retryable, and never reported as
 *    "already password-protected", which that user has just seen to be false;
 *  - `unreadable` when qpdf cannot open the input at all — non-retryable;
 *  - `failed` when the engine errors OR produces output that is not a readable PDF
 *    that needs the new password to open (proven by re-inspecting the output);
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

  // Ask the question each message states. `isEncrypted` answers "yes" for a
  // file that opens with no password and only restricts printing or copying, so
  // it cannot tell the two refusals apart.
  let requirement: QpdfPasswordRequirement;
  try {
    requirement = await qpdf.requiresPassword(input);
  } catch {
    return failed();
  }
  if (requirement === "needs-password") {
    return {
      ok: false,
      kind: "already_encrypted",
      message: ALREADY_ENCRYPTED_MESSAGE,
    };
  }
  if (requirement === "opens-freely") {
    return {
      ok: false,
      kind: "restrictions_only",
      message: RESTRICTIONS_ONLY_MESSAGE,
    };
  }
  if (requirement === "unreadable") return unreadable();

  const permissions = options.permissions ?? ALL_PERMISSIONS_ALLOWED;
  const restricted = PDF_PERMISSION_KEYS.filter((key) => !permissions[key]);

  let output: Uint8Array;
  try {
    output = await qpdf.protect(input, {
      userPassword: options.password,
      ownerPassword: options.ownerPassword,
      keyLength: options.keyLength,
      permissions,
    });
  } catch {
    return failed();
  }

  // Never accept the engine's output without proving it is a readable PDF that
  // needs a password to OPEN — the promise the user was made. "Encrypted" is not
  // that promise: a permissions-only file is encrypted and opens for anyone, so
  // a user password lost on its way to qpdf would have passed an isEncrypted
  // check. A passthrough or a botched run can never look like success.
  if (!(await validate(output))) return failed();
  let outputRequirement: QpdfPasswordRequirement;
  try {
    outputRequirement = await qpdf.requiresPassword(output);
  } catch {
    return failed();
  }
  if (outputRequirement !== "needs-password") return failed();

  // A restriction is a promise about the file's /P bits, so read them back
  // (`./permission-bits`, no password needed). A /P that grants something the
  // person withheld, or none we can read, fails the run: a "print blocked"
  // file that prints is the wrong document. With nothing restricted this is
  // skipped, so the default path is exactly what it was.
  if (restricted.length > 0) {
    const p = readEncryptPermissions(output);
    if (p === null || permissionMismatches(p, permissions).length > 0)
      return failed();
  }

  return {
    ok: true,
    output,
    meta: {
      engine: PDF_SECURITY_ENGINE,
      operation: "protect",
      keyLength: options.keyLength,
      restricted,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
    },
  };
}

/**
 * Remove encryption from a PDF with qpdf. Honest guarantees:
 *  - `unsupported` when qpdf is not wired (nothing is executed);
 *  - `too_large` / `invalid_pdf` on a rejected input (before any engine call);
 *  - `not_encrypted` when the input carries no encryption to remove (and qpdf
 *    can open it);
 *  - `unreadable` when qpdf cannot open the input at all — damaged, or an
 *    encryption scheme it does not support — found before or at the decrypt;
 *  - `wrong_password` when the supplied password does not open it — a distinct,
 *    non-retryable user error (unlock never recovers or bypasses an unknown password);
 *  - `owner_password_required` when the input opens WITHOUT a password (only its
 *    permissions are locked) and the supplied password is not its owner
 *    password — the password qpdf accepts for removing those restrictions, and
 *    the only one Unlock uses: it never removes them without it;
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

  // Which password (if any) opens the input decides both "nothing to unlock"
  // and what a refused password means. `isEncrypted` cannot tell a file that
  // needs a password to open from one that opens freely with its permissions
  // locked, and the user of the second has no open password to type.
  let requirement: QpdfPasswordRequirement;
  try {
    requirement = await qpdf.requiresPassword(input);
  } catch {
    return failed();
  }
  if (requirement === "not-encrypted") {
    return { ok: false, kind: "not_encrypted", message: NOT_ENCRYPTED_MESSAGE };
  }
  if (requirement === "unreadable") return unreadable();

  let outcome: QpdfUnlockOutcome;
  try {
    outcome = await qpdf.unlock(input, { password: options.password });
  } catch {
    return failed();
  }
  if (!outcome.ok) {
    switch (outcome.reason) {
      case "unreadable":
        return unreadable();
      case "wrong-password":
        return requirement === "opens-freely"
          ? {
              ok: false,
              kind: "owner_password_required",
              message: OWNER_PASSWORD_REQUIRED_MESSAGE,
            }
          : {
              ok: false,
              kind: "wrong_password",
              message: WRONG_PASSWORD_MESSAGE,
            };
      default: {
        const unmapped: never = outcome.reason;
        void unmapped;
        return failed();
      }
    }
  }

  const output = outcome.output;
  if (!(await validate(output))) return failed();
  // Prove the encryption was actually removed — a result that is still encrypted
  // (including a permissions-only one) is a failure, never a success, and so is
  // one qpdf cannot open: `isEncrypted` throws for it rather than say "no".
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
