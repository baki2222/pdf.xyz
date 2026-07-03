/**
 * Safe encoding/decoding of the content-free **artifact provenance manifest** as S3
 * object user-metadata.
 *
 * Phase 37 records an {@link ArtifactManifest} for every published output; the
 * developer-only store keeps it alongside the bytes so the retrieval boundary can
 * re-validate provenance on download. A production bucket has no such side table —
 * the object IS the record — so Phase 39 carries the manifest AS object metadata
 * (`x-amz-meta-artifact-manifest`), exactly the way Phase 18 carries the sanitized
 * filename. The worker signs it onto the artifact PUT; the storage-backed retrieval
 * reader recovers it on the GET and hands it to the SAME `decideArtifactAccess`
 * layer the local path uses.
 *
 * Why encode: an S3 user-metadata value is an HTTP header folded into the SigV4
 * signature, so it must be pure ASCII with no stray whitespace. We JSON-serialize
 * the manifest's bounded fields and RFC 3986 percent-encode the result into a
 * stable ASCII token. This is safe because a manifest is content-free BY
 * CONSTRUCTION (bounded enums, a byte COUNT, a public tool slug, and stable policy
 * constants — never a filename, key, URL, id, path, OCR text, or document byte);
 * encoding it leaks nothing that was not already content-free.
 *
 * Decoding is STRICT and total: a present-but-malformed value never throws and never
 * escapes — every field is re-validated against its bounded enum / shape, and any
 * deviation collapses to `null` (no manifest), never a half-trusted object. The
 * retrieval layer then treats `null` as "no provenance recorded" (its honest
 * manifest-less path) rather than blessing an unvalidated blob.
 *
 * Node-free (pure string + JSON ops), so the worker executor storage (`../executor/s3-storage`,
 * which signs the header) and the storage-backed retrieval reader (`../artifacts/retrieval-source`,
 * which reads it) share this one leaf and can never disagree on the format.
 */

import {
  ARTIFACT_OUTPUT_KINDS,
  ARTIFACT_RETENTION_CLASSES,
  type ArtifactManifest,
  type ArtifactOutputKind,
  type ArtifactRetentionClass,
} from "../artifacts/types";
import { PROCESSOR_KINDS, type ProcessorKind } from "../observability/metrics";

/**
 * The S3 user-metadata header carrying the content-free provenance manifest.
 * Lowercase because it is signed as a canonical SigV4 header and echoed verbatim by
 * the worker's PUT. The bytes are metadata on the object — never part of its key.
 */
export const ARTIFACT_MANIFEST_METADATA_HEADER = "x-amz-meta-artifact-manifest";

/** Defensive ceiling on the raw metadata length (well under S3's ~2 KB user-metadata cap). */
const MAX_RAW_LENGTH = 2048;
/** Bounds for the free-text-ish (but still content-free) string fields. */
const MAX_STRING_LENGTH = 128;

/** RFC 3986 percent-encoding — stricter than `encodeURIComponent` (also `!*'()`). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Serialize a content-free {@link ArtifactManifest} into the ASCII-safe value for
 * {@link ARTIFACT_MANIFEST_METADATA_HEADER}. The field order is fixed so the token is
 * stable (a client/proxy could compare it byte-for-byte). Total: any manifest yields
 * a header-safe token.
 */
export function encodeArtifactManifestMetadata(manifest: ArtifactManifest): string {
  const projection = {
    k: manifest.outputKind,
    c: manifest.contentType,
    b: manifest.byteCount,
    r: manifest.retentionClass,
    t: manifest.toolSlug,
    p: manifest.processor,
    i: manifest.policyId,
    v: manifest.policyVersion,
  };
  return encodeRfc3986(JSON.stringify(projection));
}

/** True when `value` is one of the members of the bounded tuple `allowed`. */
function isMember<T extends string>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** A finite, non-negative integer (a byte count or a schema version). */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A bounded, non-empty string field (tool slug / policy id / content-type). */
function isBoundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING_LENGTH;
}

/**
 * Recover a content-free {@link ArtifactManifest} from a stored
 * {@link ARTIFACT_MANIFEST_METADATA_HEADER} value, or `null` when the header is
 * absent, oversized, or fails STRICT shape/enum re-validation. Never throws: a
 * malformed percent-encoding or JSON, an unknown enum member, or a missing field all
 * collapse to `null`, so a tampered value can only ever become "no provenance
 * recorded" — never a half-trusted manifest the retrieval layer would vouch for.
 */
export function decodeArtifactManifestMetadata(
  raw: string | null | undefined,
): ArtifactManifest | null {
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

  const outputKind: unknown = m.k;
  const contentType: unknown = m.c;
  const byteCount: unknown = m.b;
  const retentionClass: unknown = m.r;
  const toolSlug: unknown = m.t;
  const processor: unknown = m.p;
  const policyId: unknown = m.i;
  const policyVersion: unknown = m.v;

  if (
    !isMember<ArtifactOutputKind>(ARTIFACT_OUTPUT_KINDS, outputKind) ||
    !isBoundedString(contentType) ||
    !isCount(byteCount) ||
    !isMember<ArtifactRetentionClass>(ARTIFACT_RETENTION_CLASSES, retentionClass) ||
    !isBoundedString(toolSlug) ||
    !isMember<ProcessorKind>(PROCESSOR_KINDS, processor) ||
    !isBoundedString(policyId) ||
    !isCount(policyVersion)
  ) {
    return null;
  }

  return {
    outputKind,
    contentType,
    byteCount,
    retentionClass,
    toolSlug,
    processor,
    policyId,
    policyVersion,
  };
}
