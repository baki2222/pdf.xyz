/**
 * Pure, node-free **integrity digest** for the release evidence artifact (Phase 47).
 *
 * The artifact's integrity block is a plain content hash of the canonical {@link ReleaseArtifactBody}
 * — a tamper-evidence anchor, NOT a signature (there is no key and no attested identity). This
 * module computes and verifies that digest.
 *
 * The actual hashing is injected as a {@link HashFn} seam (the Node entry passes a real
 * `node:crypto` sha256; tests pass the same real hash to pin known vectors, or a deterministic stub
 * to prove wiring), so the module itself stays node-free and every branch is deterministically
 * testable. The digest is computed over the CANONICAL body (`./canonicalize`), never over rendered/
 * pretty-printed bytes, so a verifier reproduces it from the archived body regardless of formatting.
 *
 * Because the body is already fully content-free (bounded enums, small integers, an ISO stamp, app
 * prose, a validated label, a validated short commit hash), the digest is over safe data — it is
 * itself safe to log, forward, or print.
 */

import { canonicalize } from "./canonicalize";
import {
  RELEASE_ARTIFACT_CANONICALIZATION,
  RELEASE_ARTIFACT_DIGEST_ALGORITHM,
  RELEASE_ARTIFACT_DIGEST_ENCODING,
  type ReleaseArtifactBody,
  type ReleaseArtifactIntegrity,
} from "./types";

/**
 * The hashing capability the digest needs: map a canonical string to its lowercase-hex sha256. Kept
 * behind a seam so this module is node-free; the Node entry provides a `node:crypto` implementation.
 */
export type HashFn = (canonical: string) => string;

/** The strict shape of a well-formed lowercase-hex sha256 digest (64 hex chars). */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** True iff `value` is a well-formed lowercase-hex sha256 digest string. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/**
 * Compute the integrity block for `body`: canonicalize it, hash the canonical string with `hash`,
 * and wrap the digest with the bounded algorithm/encoding/canonicalization tags. Deterministic —
 * the same body (any key order) yields the same digest.
 */
export function computeIntegrity(body: ReleaseArtifactBody, hash: HashFn): ReleaseArtifactIntegrity {
  const digest = hash(canonicalize(body));
  return {
    algorithm: RELEASE_ARTIFACT_DIGEST_ALGORITHM,
    encoding: RELEASE_ARTIFACT_DIGEST_ENCODING,
    canonicalization: RELEASE_ARTIFACT_CANONICALIZATION,
    digest,
  };
}

/** The bounded outcome of verifying an artifact's integrity. */
export type VerifyIntegrityResult =
  /** The recomputed digest matched the claimed one over the canonical body. */
  | { readonly ok: true; readonly digest: string }
  /**
   * The recomputed digest did NOT match, or the claimed digest was not a well-formed sha256 hex.
   * Carries both digests (content-free hex) so a caller can show the mismatch without echoing input.
   */
  | { readonly ok: false; readonly reason: "mismatch" | "malformed-digest"; readonly claimed: string; readonly computed: string };

/**
 * Recompute the digest over `body` and compare it to `claimedDigest`. Fail-closed: a claimed digest
 * that is not a well-formed sha256 hex is a `malformed-digest` failure (never coerced to a match),
 * and any difference is a `mismatch`. Neither branch echoes any input beyond the two hex digests.
 */
export function verifyIntegrity(
  body: unknown,
  claimedDigest: unknown,
  hash: HashFn,
): VerifyIntegrityResult {
  const computed = hash(canonicalize(body));
  if (!isSha256Hex(claimedDigest)) {
    // The claimed digest is untrusted and malformed — never echo it (`claimed` stays empty).
    return { ok: false, reason: "malformed-digest", claimed: "", computed };
  }
  if (claimedDigest !== computed) {
    return { ok: false, reason: "mismatch", claimed: claimedDigest, computed };
  }
  return { ok: true, digest: computed };
}
