/**
 * PDF security job contract — the typed, framework-agnostic options and
 * validators for the two qpdf-backed secure-worker tools, **Protect PDF**
 * (encrypt) and **Unlock PDF** (decrypt), plus the deterministic output naming
 * both share.
 *
 * This is the security analogue of `@/lib/jobs/ocr.ts`: pure data plus pure
 * parsers — no Next.js, no storage, no qpdf. It defines exactly what a protect /
 * unlock request may ask for (a password, and for protect an optional owner
 * password + encryption strength) so the UI, the worker processor, and the docs
 * share one honest source of truth. It depends only on `./responses`,
 * `./filenames` and the password-lifetime sentence (`@/lib/privacy/job-queue`,
 * itself one constant deep), so a client component can import a validator
 * without pulling in a Node built-in or the tools catalog.
 *
 * Password honesty rules (load-bearing — see docs/SECURITY.md):
 *  - A password lives ONLY in the validated options object, which exists purely to
 *    be handed to qpdf as the processing step requires. It is NEVER copied into a
 *    metric, a result, an error message, a filename, a log line, or a test
 *    snapshot. Every validation message here is content-free: it describes the
 *    RULE that failed, never the value that failed it.
 *  - Passwords are bounded and control-character-free. The byte bound is the
 *    PDF 2.0 / AES-256 hard limit (a longer secret cannot be represented, so we
 *    reject it rather than let qpdf silently truncate it); control characters are
 *    rejected because they cannot survive the worker's argv/at-file transport and
 *    have no legitimate place in a password.
 */

import { apiError, type ParseResult } from "./responses";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "./filenames";
import {
  ALL_PERMISSIONS_ALLOWED,
  hasRestrictions,
  PDF_PERMISSION_KEYS,
  type PdfPermissionKey,
  type PdfPermissions,
} from "./pdf-permissions";

/** The neutral stem used when nothing safe survives filename sanitization. */
const FALLBACK_STEM = "document";

/**
 * How long a typed password waits on our side — said by the Protect/Unlock
 * panel AND by /privacy §2, from this one constant.
 *
 * Until 2026-10-10 the two disagreed: the panel said this; /privacy said the
 * password "sits in that job record for the same 24 hours". It sits in the
 * job's instructions (the executor spec), which the queue's FINALIZE step
 * deletes when the job ends; the job record's window bounds it only for a job
 * no worker ever finalises.
 *
 * Then review (2026-10-10) found the replacement — "It waits in our job queue
 * only until the job finishes or is cancelled (or, if no worker picks it up,
 * until the queue's retention lapses), then it is deleted." — wrong twice: no
 * figure for the window a signer's email address got, and no word for the
 * queue's on-disk journal, which keeps a deleted key until it is compacted.
 * The sentence lives with the other queue lifetimes now
 * (`@/lib/privacy/job-queue`), re-exported here so both readers are unchanged.
 * That module imports only a constant, so a client component importing a
 * validator from this one still pulls in no Node built-in and no catalogue.
 */
export { PASSWORD_QUEUE_LIFETIME } from "@/lib/privacy/job-queue";

/**
 * Maximum password length, in UTF-8 bytes. This is the PDF 2.0 / AES-256 (R6)
 * hard limit: a password longer than this cannot be represented by the format, so
 * we reject it up front rather than accept a value qpdf would silently truncate
 * (which would let a user set a password they could never reproduce). One byte is
 * the floor — an empty password is not a password.
 */
export const MAX_PDF_PASSWORD_BYTES = 127;

/**
 * The encryption strengths Protect PDF offers. Both are genuine AES (never the
 * legacy, broken RC4 40/128-bit ciphers): `256` is AES-256 (PDF 2.0, the strong
 * default) and `128` is AES-128 (broader reader compatibility). The value is the
 * qpdf `--bits` key length; the worker always forces AES for 128 so a weaker
 * cipher can never be selected by accident.
 */
export const PDF_KEY_LENGTHS = [128, 256] as const;
export type PdfKeyLength = (typeof PDF_KEY_LENGTHS)[number];

/** The default encryption strength when a protect request omits `keyLength`. */
export const DEFAULT_PDF_KEY_LENGTH: PdfKeyLength = 256;

/** A key length plus its human copy, for the protect UI and docs. */
export interface PdfEncryptionLevelInfo {
  keyLength: PdfKeyLength;
  label: string;
  description: string;
}

export const PDF_ENCRYPTION_LEVELS: readonly PdfEncryptionLevelInfo[] = [
  {
    keyLength: 256,
    label: "AES-256",
    description:
      "Strongest. AES-256 encryption (PDF 2.0) — best for modern readers.",
  },
  {
    keyLength: 128,
    label: "AES-128",
    description:
      "Compatible. AES-128 encryption — opens in a wider range of older readers.",
  },
] as const;

const PDF_KEY_LENGTH_SET: ReadonlySet<number> = new Set(PDF_KEY_LENGTHS);

/** True when `value` is a supported PDF encryption key length. */
export function isPdfKeyLength(value: unknown): value is PdfKeyLength {
  return typeof value === "number" && PDF_KEY_LENGTH_SET.has(value);
}

/** Human label for an encryption key length (falls back to a bit count). */
export function describePdfKeyLength(keyLength: PdfKeyLength): string {
  return (
    PDF_ENCRYPTION_LEVELS.find((level) => level.keyLength === keyLength)
      ?.label ?? `${keyLength}-bit`
  );
}

/** Validated options for a `protect-pdf` (encrypt) job. */
export interface ProtectPdfOptions {
  /** The user/open password — required to OPEN the resulting PDF. */
  password: string;
  /**
   * The owner password — controls permission changes (editing, printing). When a
   * request omits it, it defaults to the user password, which is the common
   * "single password protects the whole document" case.
   */
  ownerPassword: string;
  /** Encryption strength (AES key length). */
  keyLength: PdfKeyLength;
  /**
   * What a reader may do without the owner password. The parser always sets
   * it (every key present, default all allowed); optional in the type so a
   * hand-built options object keeps meaning "no restrictions". Not secret,
   * so not sealed — the passwords are.
   */
  permissions?: ProtectPdfPermissions;
}

/**
 * {@link PdfPermissions}, spelled out here so `/privacy`'s options walk (which
 * reads only same-file types) can see that every permission is a boolean and
 * no free text. The two are held equal both ways at compile time below.
 */
export interface ProtectPdfPermissions {
  print: boolean;
  copy: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
  accessibility: boolean;
  assemble: boolean;
}
type SameShape = [PdfPermissions] extends [ProtectPdfPermissions]
  ? [ProtectPdfPermissions] extends [PdfPermissions]
    ? true
    : false
  : false;
/** Fails to compile if the two permission shapes ever differ. */
export const PROTECT_PERMISSIONS_MATCH: SameShape = true;

/** Validated options for an `unlock-pdf` (decrypt) job. */
export interface UnlockPdfOptions {
  /**
   * The password that opens the encrypted PDF — or, for one that opens without
   * a password and only restricts printing/copying/editing, its owner password.
   */
  password: string;
}

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

// A C0 control character (U+0000–U+001F, includes TAB/LF/CR) or DEL (U+007F),
// written with code points so this module's source never carries a literal
// control byte. Rejected in passwords: they cannot survive the worker's
// line-oriented argument transport to qpdf and have no place in a password.
const CONTROL_CHAR = /[\u0000-\u001F\u007F]/;

/**
 * Validate one password field. Content-free by construction: it reports only
 * which RULE failed (missing, empty, too long, illegal character) and NEVER
 * echoes the password. Returns the string on success. `field` names the offending
 * option so a client sees a precise, safe validation error.
 */
function parsePassword(
  value: unknown,
  field: string,
  label: string,
): ParseResult<string> {
  if (typeof value !== "string") {
    return invalid(`\`${field}\` is required and must be a string.`, field);
  }
  if (value.length === 0) {
    return invalid(`${label} cannot be empty.`, field);
  }
  if (CONTROL_CHAR.test(value)) {
    return invalid(`${label} cannot contain control characters.`, field);
  }
  // Bound by UTF-8 byte length: the AES-256 password limit is defined in bytes,
  // and a multi-byte character can exceed the character count.
  if (new TextEncoder().encode(value).length > MAX_PDF_PASSWORD_BYTES) {
    return invalid(
      `${label} is too long (max ${MAX_PDF_PASSWORD_BYTES} bytes).`,
      field,
    );
  }
  return { ok: true, value };
}

/**
 * Parse the free-form `options` bag of a `protect-pdf` job into typed, validated
 * options. Strict: a missing/empty/oversized/illegal password and an unknown
 * encryption strength are all rejected with a content-free field error. The owner
 * password defaults to the user password when omitted. Mirrors
 * `parseCompressionOptions` / `parseOcrOptions`, and is what the worker calls
 * before it ever touches a file.
 */
export function parseProtectPdfOptions(
  options: Record<string, unknown>,
): ParseResult<ProtectPdfOptions> {
  const password = parsePassword(
    options.password,
    "options.password",
    "Password",
  );
  if (!password.ok) return password;

  // Owner password is optional; when present it is validated by the same rules,
  // otherwise it defaults to the user password (single-password protection).
  let ownerPassword = password.value;
  if (options.ownerPassword !== undefined) {
    const owner = parsePassword(
      options.ownerPassword,
      "options.ownerPassword",
      "Owner password",
    );
    if (!owner.ok) return owner;
    ownerPassword = owner.value;
  }

  // Encryption strength defaults to the strongest (AES-256); reject anything not
  // on the offered allowlist rather than silently coercing it.
  let keyLength: PdfKeyLength = DEFAULT_PDF_KEY_LENGTH;
  if (options.keyLength !== undefined) {
    if (!isPdfKeyLength(options.keyLength)) {
      return invalid(
        `\`options.keyLength\` must be one of: ${PDF_KEY_LENGTHS.join(", ")}.`,
        "options.keyLength",
      );
    }
    keyLength = options.keyLength;
  }

  const permissions = parsePermissions(options.permissions);
  if (!permissions.ok) return permissions;
  if (hasRestrictions(permissions.value)) {
    // With one password for both, opening the file IS owner access in most
    // readers, and the restriction would bind nobody. Content-free: the rule,
    // never the value.
    if (options.ownerPassword === undefined) {
      return invalid(
        "Restricting permissions needs an owner password.",
        "options.ownerPassword",
      );
    }
    if (ownerPassword === password.value) {
      return invalid(
        "The owner password must differ from the open password, or the restrictions bind no one.",
        "options.ownerPassword",
      );
    }
  }

  return {
    ok: true,
    value: {
      password: password.value,
      ownerPassword,
      keyLength,
      permissions: permissions.value,
    },
  };
}

/**
 * Parse `options.permissions`: absent ⇒ all allowed; otherwise an object of
 * known keys with boolean values, missing keys allowed. Two combinations are
 * refused rather than written as flags no reader applies: accessibility off
 * (qpdf ignores it for AES) and forms off while comments are on (the annotate
 * bit grants form filling). See `./pdf-permissions`.
 */
function parsePermissions(raw: unknown): ParseResult<PdfPermissions> {
  if (raw === undefined) return { ok: true, value: ALL_PERMISSIONS_ALLOWED };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid(
      "`options.permissions` must be an object.",
      "options.permissions",
    );
  }
  const known: ReadonlySet<string> = new Set(PDF_PERMISSION_KEYS);
  const out: PdfPermissions = { ...ALL_PERMISSIONS_ALLOWED };
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) {
      return invalid(
        `\`options.permissions\` accepts only: ${PDF_PERMISSION_KEYS.join(", ")}.`,
        "options.permissions",
      );
    }
    if (typeof value !== "boolean") {
      return invalid(
        `\`options.permissions.${key}\` must be a boolean.`,
        `options.permissions.${key}`,
      );
    }
    out[key as PdfPermissionKey] = value;
  }
  if (!out.accessibility) {
    return invalid(
      "Text extraction for accessibility cannot be blocked with AES encryption.",
      "options.permissions.accessibility",
    );
  }
  if (!out.fillForms && out.annotate) {
    return invalid(
      "Filling in forms cannot be blocked while comments are allowed.",
      "options.permissions.fillForms",
    );
  }
  return { ok: true, value: out };
}

/**
 * Parse the free-form `options` bag of an `unlock-pdf` job into typed, validated
 * options. Strict: a missing/empty/oversized/illegal password is rejected with a
 * content-free field error. Unlock only ever needs a password the document
 * accepts — the one that opens it, or, for a file that opens freely but restricts
 * printing/copying/editing, its owner password. It removes encryption you can
 * already prove you may access; it never recovers or bypasses an unknown password,
 * so an empty password is refused here even for a file that opens without one.
 */
export function parseUnlockPdfOptions(
  options: Record<string, unknown>,
): ParseResult<UnlockPdfOptions> {
  const password = parsePassword(
    options.password,
    "options.password",
    "Password",
  );
  if (!password.ok) return password;
  return { ok: true, value: { password: password.value } };
}

/** Strip the last extension from an already-sanitized display name. */
function displayBase(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").trim();
  return stem.length > 0 ? stem : FALLBACK_STEM;
}

/**
 * Build a deterministic `<sanitized-base><suffix>.pdf` output name from an
 * untrusted original name. Shared by both tools' namers; identical input always
 * yields identical output, and the suffix can never push the name over the
 * display-name limit. The original name is only ever used for display/output
 * naming — never as a key, path, or argument (see `sanitizeDisplayFilename`).
 */
function suffixedPdfName(originalName: unknown, suffix: string): string {
  const base = displayBase(sanitizeDisplayFilename(originalName));
  const tail = `${suffix}.pdf`;
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const trimmed = base.length > budget ? base.slice(0, budget).trim() : base;
  return `${trimmed || FALLBACK_STEM}${tail}`;
}

/** Deterministic output name for a `protect-pdf` artifact: `report-protected.pdf`. */
export function protectedOutputName(originalName: unknown): string {
  return suffixedPdfName(originalName, "-protected");
}

/** Deterministic output name for an `unlock-pdf` artifact: `report-unlocked.pdf`. */
export function unlockedOutputName(originalName: unknown): string {
  return suffixedPdfName(originalName, "-unlocked");
}
