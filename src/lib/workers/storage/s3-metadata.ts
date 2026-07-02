/**
 * Safe encoding/decoding of the **original display filename** as S3 object
 * user-metadata.
 *
 * The upload contract signs the content-type of an input object; Phase 18 also
 * carries the sanitized original filename as an `x-amz-meta-filename` header so a
 * deployed worker can recover a user-friendly name for the output without the app
 * server ever persisting the raw name or letting it near an object key.
 *
 * Why encode at all: an S3 user-metadata value travels as an HTTP header and is
 * folded into the SigV4 signature, so it must be pure ASCII with no leading/
 * trailing space (Unicode filenames and stray whitespace would either be rejected
 * or, worse, silently altered and break the signature). We therefore RFC 3986
 * percent-encode the *already sanitized* display name: the stored value is a
 * stable ASCII token the client can echo byte-for-byte on its signed PUT, and the
 * worker decodes + re-sanitizes it on read. Both sides run the same
 * {@link sanitizeDisplayFilename}, so a tampered or malformed value can only ever
 * collapse to a safe name — it can never influence the object key (keys derive
 * from opaque ids alone) or escape as a path.
 *
 * Node-free (pure string ops), so both the app-server provider (`./s3.ts`, which
 * signs the header) and the worker executor storage (`../executor/s3-storage.ts`,
 * which reads it) share this one leaf and can never disagree on the format.
 */

import { sanitizeDisplayFilename } from "@/lib/jobs/filenames";

/**
 * The S3 user-metadata header carrying the sanitized original filename. Lowercase
 * because it is signed as a canonical SigV4 header and echoed verbatim by the
 * client's PUT. The bytes are metadata on the object — never part of its key.
 */
export const FILENAME_METADATA_HEADER = "x-amz-meta-filename";

/** RFC 3986 percent-encoding — stricter than `encodeURIComponent` (also `!*'()`). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Encode a client filename into the ASCII-safe value for
 * {@link FILENAME_METADATA_HEADER}. Sanitizes first (so only a safe display name
 * is ever stored), then percent-encodes so the value is header- and SigV4-safe.
 * Total: any input yields a stable, non-empty ASCII token.
 */
export function encodeFilenameMetadata(rawName: unknown): string {
  return encodeRfc3986(sanitizeDisplayFilename(rawName));
}

/**
 * Recover a safe display filename from a stored {@link FILENAME_METADATA_HEADER}
 * value. Returns `null` when the header is absent or blank (the caller then falls
 * back to a content-type-derived name). A present-but-malformed value never
 * throws and never escapes: it is decoded best-effort and re-sanitized, so the
 * worst case is the neutral fallback name, not an unsafe string.
 */
export function decodeFilenameMetadata(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    // Malformed percent-encoding — sanitize the raw value rather than throwing.
    decoded = trimmed;
  }
  return sanitizeDisplayFilename(decoded);
}

/** The response header that makes a browser download an object under a chosen name. */
export const CONTENT_DISPOSITION_HEADER = "content-disposition";

/**
 * Build a safe `Content-Disposition: attachment` value for a produced artifact,
 * so a *direct* signed-URL download (bypassing the app's own download code) still
 * saves under the friendly name. Emits both a plain-ASCII `filename=` (broad
 * compatibility) and an RFC 5987 `filename*=UTF-8''…` (Unicode-correct); the name
 * is sanitized first, so no control character, quote, or CR/LF can be injected
 * into the header. Total: any input yields a valid, single-line header value.
 */
export function contentDispositionAttachment(rawName: unknown): string {
  const safe = sanitizeDisplayFilename(rawName);
  // ASCII fallback for the quoted form: replace any non-printable-ASCII and the
  // header-breaking quote/backslash. `[^ -~]` is the printable-ASCII complement,
  // and `safe` is already control-free, so nothing can break the header line.
  const ascii = safe.replace(/[^ -~]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeRfc3986(safe);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
