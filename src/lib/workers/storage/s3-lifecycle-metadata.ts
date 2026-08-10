/**
 * Safe encoding/decoding of the content-free **artifact lifecycle evidence** as S3 object
 * user-metadata — the lifecycle counterpart to the provenance manifest codec
 * (`./s3-manifest-metadata`).
 *
 * A production bucket cannot tell a live object from an expired-but-not-yet-reaped one: both
 * answer a GET with `200` until the bucket's lifecycle rule physically reaps the object. So
 * Phase 41 records the artifact's retention window (and, where a deployment marks one, a
 * deletion tombstone) AS object metadata (`x-amz-meta-artifact-lifecycle`), exactly the way
 * Phase 18 carries the sanitized filename and Phase 37/39 carry the manifest. The worker
 * signs it onto the artifact PUT; the storage-backed retrieval reader recovers it on the GET
 * and hands it to {@link import("../artifacts/lifecycle").evaluateArtifactLifecycle}, so a
 * logically-expired artifact is denied `410 Gone` BEFORE any bytes are delivered, closing the
 * window between its retention deadline and the bucket lifecycle reap.
 *
 * Why this is content-free: the encoded value is only a coarse expiry instant (the SAME one
 * the client already holds as its {@link import("@/lib/jobs").JobArtifact} `expiresAt`) and an
 * optional presence flag — never a filename, object key, signed URL, bucket, endpoint, id,
 * token, OCR text, or document byte. Encoding it leaks nothing that was not already
 * content-free and client-visible.
 *
 * Why encode: an S3 user-metadata value is an HTTP header folded into the SigV4 signature, so
 * it must be pure ASCII with no stray whitespace. We JSON-serialize the bounded fields and RFC
 * 3986 percent-encode the result into a stable ASCII token, exactly like the manifest codec.
 *
 * Decoding is STRICT and total: a present-but-malformed value never throws and never escapes —
 * the expiry must be a finite, non-negative integer and the optional tombstone marker must be
 * exactly `1`; any deviation collapses the WHOLE record to `null` (no evidence). The lifecycle
 * evaluator then treats `null` as `unknown` (serve; never a fabricated deletion) rather than
 * blessing a half-trusted record — so a tampered value can only ever fail toward serving a
 * present object, never toward a false denial. The metadata is SIGNED by the worker on the
 * PUT, so a client cannot alter it in the first place.
 *
 * Node-free (pure string + JSON ops), so the worker executor storage (`../executor/s3-storage`,
 * which signs the header) and the storage-backed retrieval reader (`../artifacts/retrieval-storage`,
 * which reads it) share this one leaf and can never disagree on the format.
 */

import type { ArtifactLifecycleMetadata } from "../artifacts/lifecycle";

/**
 * The S3 user-metadata header carrying the content-free lifecycle evidence. Lowercase because
 * it is signed as a canonical SigV4 header and echoed verbatim by the worker's PUT. The bytes
 * are metadata ON the object — never part of its key.
 */
export const ARTIFACT_LIFECYCLE_METADATA_HEADER =
  "x-amz-meta-artifact-lifecycle";

/** Defensive ceiling on the raw metadata length (well under S3's ~2 KB user-metadata cap). */
const MAX_RAW_LENGTH = 256;

/** RFC 3986 percent-encoding — stricter than `encodeURIComponent` (also `!*'()`). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** A finite, non-negative integer (the expiry epoch-ms instant). */
function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Serialize content-free {@link ArtifactLifecycleMetadata} into the ASCII-safe value for
 * {@link ARTIFACT_LIFECYCLE_METADATA_HEADER}. The field order is fixed so the token is stable
 * (a client/proxy could compare it byte-for-byte). The tombstone marker is emitted ONLY when
 * set, so a normal (live) artifact carries the minimal `{e}` record. Total: any input yields a
 * header-safe token.
 */
export function encodeArtifactLifecycleMetadata(
  meta: ArtifactLifecycleMetadata,
): string {
  const projection: { e: number; d?: 1 } = { e: meta.expiresAtMs };
  if (meta.deleted) projection.d = 1;
  return encodeRfc3986(JSON.stringify(projection));
}

/**
 * Recover content-free {@link ArtifactLifecycleMetadata} from a stored
 * {@link ARTIFACT_LIFECYCLE_METADATA_HEADER} value, or `null` when the header is absent,
 * oversized, or fails STRICT shape re-validation. Never throws: a malformed percent-encoding
 * or JSON, a non-integer/negative expiry, or a tombstone marker that is present but not
 * exactly `1` all collapse the record to `null`, so a tampered value can only ever become "no
 * lifecycle evidence" — which the evaluator serves as `unknown`, never a false denial.
 */
export function decodeArtifactLifecycleMetadata(
  raw: string | null | undefined,
): ArtifactLifecycleMetadata | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_RAW_LENGTH) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(trimmed));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const m = parsed as Record<string, unknown>;

  const expiresAtMs: unknown = m.e;
  if (!isEpochMs(expiresAtMs)) return null;

  // The tombstone marker is optional, but when present it must be EXACTLY the numeric `1`.
  // Any other value (a stray `0`, a string, a boolean) is a malformed record → null, so a
  // tampered marker can never be half-honored.
  const rawDeleted: unknown = m.d;
  if (rawDeleted !== undefined && rawDeleted !== 1) return null;
  const deleted = rawDeleted === 1;

  return { expiresAtMs, deleted };
}
