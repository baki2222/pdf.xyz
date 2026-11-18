/**
 * One PDF password field of a job's `options`, validated — for every tool
 * that carries one: Protect PDF and Unlock PDF (`./pdf-security`) and OCR
 * PDF's owner password for a restricted file (`./ocr`, competitor-audit
 * backlog #11).
 *
 * A leaf (its one import is `./responses`), so the OCR contract, which the
 * OCR panel loads, gets the rule without the Protect/Unlock contract.
 *
 * Every field parsed here is a password, and every password is SEALED
 * before the queue broker sees it (`SEALED_OPTION_FIELDS` in
 * `@/lib/workers/queue/sealed-options`): `sealed-options.chain.test.ts`
 * discovers the fields from the calls to {@link parsePassword} in
 * `src/lib/jobs` and requires the two sets to be equal.
 *
 * Content-free by construction: a message names the RULE that failed
 * (missing, empty, too long, illegal character) and NEVER echoes the value.
 */
import { apiError, type ParseResult } from "./responses";

/**
 * Maximum password length, in UTF-8 bytes. This is the PDF 2.0 / AES-256 (R6)
 * hard limit: a password longer than this cannot be represented by the format, so
 * we reject it up front rather than accept a value qpdf would silently truncate
 * (which would let a user set a password they could never reproduce). One byte is
 * the floor — an empty password is not a password.
 */
export const MAX_PDF_PASSWORD_BYTES = 127;

// A C0 control character (U+0000–U+001F, includes TAB/LF/CR) or DEL (U+007F),
// written with code points so this module's source never carries a literal
// control byte. Rejected in passwords: they cannot survive the worker's
// line-oriented argument transport to qpdf and have no place in a password.
const CONTROL_CHAR = /[\u0000-\u001F\u007F]/;

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

/**
 * Validate one password field. Returns the string on success. `field` names
 * the offending option so a client sees a precise, safe validation error.
 */
export function parsePassword(
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
