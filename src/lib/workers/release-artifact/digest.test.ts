// @vitest-environment node
/**
 * Proof that the integrity digest is a real, reproducible sha256 over the canonical body, and that
 * verification is fail-closed. Uses the SAME `node:crypto` sha256 the CLI entry injects, so the
 * vectors here are exactly what a verifier reproduces.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalize } from "./canonicalize";
import { computeIntegrity, isSha256Hex, verifyIntegrity, type HashFn } from "./digest";
import { RELEASE_ARTIFACT_CANONICALIZATION } from "./types";
import type { ReleaseArtifactBody } from "./types";

const sha256: HashFn = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** A minimal but well-typed body (values are irrelevant to the digest mechanics). */
function body(over: Partial<ReleaseArtifactBody> = {}): ReleaseArtifactBody {
  return {
    generatedAt: "2026-07-03T00:00:00.000Z",
    metadata: {
      schemaVersion: 1,
      policyId: "pdfxyz-worker-release-evidence-artifact",
      policyVersion: 1,
      label: null,
      git: { cleanliness: "clean", refClass: "topic", commit: "27a5555fd3e3", commitPresent: true },
    },
    gate: {
      source: "supplied",
      present: true,
      verdict: "pass",
      includedChecks: 11,
      passedChecks: 11,
      skippedChecks: 0,
      blockers: [],
      checks: [],
      detail: "d",
    },
    opsBundle: { source: "not-configured", present: false, severity: null, detail: "d" },
    rollup: { verdict: "pass", exitCode: 0, ready: true, drivers: [], detail: "d" },
    guidance: [],
    caveats: [],
    ...over,
  };
}

describe("computeIntegrity", () => {
  it("computes the sha256 of the canonical body, tagged with the scheme", () => {
    const b = body();
    const integrity = computeIntegrity(b, sha256);
    expect(integrity.algorithm).toBe("sha256");
    expect(integrity.encoding).toBe("hex");
    expect(integrity.canonicalization).toBe(RELEASE_ARTIFACT_CANONICALIZATION);
    // The digest is exactly sha256(canonicalize(body)) — reproducible by any verifier.
    expect(integrity.digest).toBe(sha256(canonicalize(b)));
    expect(isSha256Hex(integrity.digest)).toBe(true);
  });

  it("is deterministic: the same body yields the same digest", () => {
    expect(computeIntegrity(body(), sha256).digest).toBe(computeIntegrity(body(), sha256).digest);
  });

  it("changes when any body field changes (the digest actually covers the body)", () => {
    const base = computeIntegrity(body(), sha256).digest;
    const changed = computeIntegrity(body({ generatedAt: "2026-07-03T00:00:01.000Z" }), sha256).digest;
    expect(changed).not.toBe(base);
  });
});

describe("verifyIntegrity", () => {
  it("accepts the digest it just computed", () => {
    const b = body();
    const { digest } = computeIntegrity(b, sha256);
    const result = verifyIntegrity(b, digest, sha256);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.digest).toBe(digest);
  });

  it("rejects a tampered body as a mismatch (recomputes, does not trust the claim)", () => {
    const original = body();
    const { digest } = computeIntegrity(original, sha256);
    const tampered = body({ rollup: { verdict: "fail", exitCode: 4, ready: false, drivers: ["gate-fail"], detail: "d" } });
    const result = verifyIntegrity(tampered, digest, sha256);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("mismatch");
      expect(result.claimed).toBe(digest);
      expect(result.computed).toBe(sha256(canonicalize(tampered)));
    }
  });

  it("rejects a malformed claimed digest without echoing it", () => {
    const result = verifyIntegrity(body(), "not-a-real-sha256-/tmp/secret.pdf", sha256);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed-digest");
      // The untrusted malformed claim is never echoed back.
      expect(result.claimed).toBe("");
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  it("verifies over the canonical body, not raw bytes (a JSON round-trip still matches)", () => {
    const b = body();
    const { digest } = computeIntegrity(b, sha256);
    // A parse of the serialized body (which canonicalization re-normalizes) must still verify.
    expect(verifyIntegrity(JSON.parse(JSON.stringify(b)), digest, sha256).ok).toBe(true);
  });
});

describe("isSha256Hex", () => {
  it("accepts 64 lowercase hex chars and rejects everything else", () => {
    expect(isSha256Hex("a".repeat(64))).toBe(true);
    expect(isSha256Hex("A".repeat(64))).toBe(false); // uppercase rejected
    expect(isSha256Hex("a".repeat(63))).toBe(false);
    expect(isSha256Hex("a".repeat(65))).toBe(false);
    expect(isSha256Hex("z".repeat(64))).toBe(false);
    expect(isSha256Hex(123)).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
  });
});
