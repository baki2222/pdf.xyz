/**
 * Renderer tests: both formats are stable and content-free; the text summary surfaces the rollup,
 * provenance, gate, ops-bundle, integrity, guidance, and caveats; absent label/commit render as
 * bounded placeholders; and the verify outcome renders in both formats.
 */

import { describe, expect, it } from "vitest";
import { assembleArtifact, buildBody, buildMetadata } from "./build";
import { renderReleaseArtifact, renderVerifyOutcome } from "./render";
import type {
  ReleaseArtifact,
  ReleaseArtifactGate,
  ReleaseArtifactIntegrity,
  ReleaseArtifactOpsBundle,
  ReleaseArtifactVerifyOutcome,
  ReleaseGitProvenance,
} from "./types";

const INTEGRITY: ReleaseArtifactIntegrity = {
  algorithm: "sha256",
  encoding: "hex",
  canonicalization: "pdfxyz-sorted-keys/1",
  digest: "abc123".padEnd(64, "0"),
};
const OPS: ReleaseArtifactOpsBundle = { source: "not-configured", present: false, severity: null, detail: "no bundle" };

function gate(): ReleaseArtifactGate {
  return {
    source: "generated",
    present: true,
    verdict: "warn",
    includedChecks: 11,
    passedChecks: 10,
    skippedChecks: 1,
    blockers: ["worker-engines"],
    checks: [{ id: "worker-engines", status: "warn" }],
    detail: "the gate warned",
  };
}

function artifact(git: ReleaseGitProvenance, label: string | null): ReleaseArtifact {
  const body = buildBody("2026-07-03T00:00:00.000Z", buildMetadata(label, git), gate(), OPS);
  return assembleArtifact(body, INTEGRITY);
}

const CLEAN_GIT: ReleaseGitProvenance = { cleanliness: "clean", refClass: "release", commit: "27a5555fd3e3", commitPresent: true };
const UNKNOWN_GIT: ReleaseGitProvenance = { cleanliness: "unknown", refClass: "unknown", commit: null, commitPresent: false };

describe("renderReleaseArtifact — json", () => {
  it("is valid JSON that round-trips the schema, digest, and receipt", () => {
    const out = renderReleaseArtifact(artifact(CLEAN_GIT, "v1.2.3"), "json");
    const parsed = JSON.parse(out);
    expect(parsed.schema).toBe("pdfxyz.release-artifact/1");
    expect(parsed.integrity.digest).toBe(INTEGRITY.digest);
    expect(parsed.receipt.digest).toBe(INTEGRITY.digest);
    expect(parsed.body.metadata.label).toBe("v1.2.3");
  });

  it("compacts with pretty=false", () => {
    const out = renderReleaseArtifact(artifact(CLEAN_GIT, null), "json", false);
    expect(out).not.toContain("\n  ");
  });
});

describe("renderReleaseArtifact — text", () => {
  it("surfaces every section", () => {
    const out = renderReleaseArtifact(artifact(CLEAN_GIT, "v1.2.3"), "text");
    expect(out).toContain("ROLLUP: WARN (exit 3)");
    expect(out).toContain("drivers: gate-warn");
    expect(out).toContain("label:  v1.2.3");
    expect(out).toContain("git:    clean, ref-class=release, commit=27a5555fd3e3");
    expect(out).toContain("RELEASE GATE  (source: generated)");
    expect(out).toContain("verdict: warn   checks: 10/11 passed (1 skipped)");
    expect(out).toContain("blockers: worker-engines");
    expect(out).toContain("OPS BUNDLE  (source: not-configured)");
    expect(out).toContain("INTEGRITY");
    expect(out).toContain(INTEGRITY.digest);
    expect(out).toContain("GUIDANCE");
    expect(out).toContain("CAVEATS");
  });

  it("renders absent label/commit as bounded placeholders", () => {
    const out = renderReleaseArtifact(artifact(UNKNOWN_GIT, null), "text");
    expect(out).toContain("label:  (none)");
    expect(out).toContain("commit=n/a");
    expect(out).toContain("ref-class=unknown");
  });
});

describe("renderVerifyOutcome", () => {
  const verified: ReleaseArtifactVerifyOutcome = {
    schema: "pdfxyz.release-artifact/1",
    ok: true,
    reason: "verified",
    exitCode: 0,
    claimedDigest: "d".repeat(64),
    computedDigest: "d".repeat(64),
    verdict: "pass",
    detail: "matches",
  };
  const mismatch: ReleaseArtifactVerifyOutcome = {
    ...verified,
    ok: false,
    reason: "digest-mismatch",
    exitCode: 4,
    claimedDigest: "d".repeat(64),
    computedDigest: "e".repeat(64),
    detail: "altered",
  };

  it("renders a verified outcome (json + text)", () => {
    expect(JSON.parse(renderVerifyOutcome(verified, "json")).ok).toBe(true);
    const text = renderVerifyOutcome(verified, "text");
    expect(text).toContain("VERIFIED (exit 0, reason verified)");
    expect(text).toContain("archived rollup verdict: pass");
  });

  it("renders a mismatch outcome showing both digests", () => {
    const text = renderVerifyOutcome(mismatch, "text");
    expect(text).toContain("FAILED (exit 4, reason digest-mismatch)");
    expect(text).toContain("d".repeat(64));
    expect(text).toContain("e".repeat(64));
  });
});
