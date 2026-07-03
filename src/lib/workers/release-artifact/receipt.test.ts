/**
 * The audit receipt flattens the body's bounded verdict/provenance + the integrity digest, carries no
 * ingested prose, and references the digest (so it must live outside the digest-covered body).
 */

import { describe, expect, it } from "vitest";
import { buildBody, buildMetadata } from "./build";
import { buildReceipt } from "./receipt";
import type { ReleaseArtifactGate, ReleaseArtifactIntegrity, ReleaseArtifactOpsBundle } from "./types";

const OPS: ReleaseArtifactOpsBundle = { source: "not-configured", present: false, severity: null, detail: "d" };
const INTEGRITY: ReleaseArtifactIntegrity = {
  algorithm: "sha256",
  encoding: "hex",
  canonicalization: "pdfxyz-sorted-keys/1",
  digest: "f".repeat(64),
};

function gate(): ReleaseArtifactGate {
  return { source: "supplied", present: true, verdict: "fail", includedChecks: 11, passedChecks: 9, skippedChecks: 0, blockers: ["worker-smoke"], checks: [], detail: "d" };
}

describe("buildReceipt", () => {
  it("flattens the bounded verdict/provenance + digest for a SIEM", () => {
    const body = buildBody(
      "2026-07-03T00:00:00.000Z",
      buildMetadata("rc1", { cleanliness: "dirty", refClass: "topic", commit: "27a5555fd3e3", commitPresent: true }),
      gate(),
      OPS,
    );
    const receipt = buildReceipt(body, INTEGRITY);
    expect(receipt).toEqual({
      category: "worker-release-artifact",
      policyId: "pdfxyz-worker-release-evidence-artifact",
      policyVersion: 1,
      at: "2026-07-03T00:00:00.000Z",
      verdict: "fail",
      exitCode: 4,
      gateVerdict: "fail",
      cleanliness: "dirty",
      algorithm: "sha256",
      digest: "f".repeat(64),
    });
  });

  it("carries no label, ref class, commit, ops-bundle, or blocker (only the flattened essentials)", () => {
    // refClass "topic" is chosen so its token is not a substring of the authored policy ids.
    const body = buildBody("2026-07-03T00:00:00.000Z", buildMetadata("my-secret-label", { cleanliness: "clean", refClass: "topic", commit: "abcdef1234", commitPresent: true }), gate(), OPS);
    const serialized = JSON.stringify(buildReceipt(body, INTEGRITY));
    expect(serialized).not.toContain("my-secret-label");
    expect(serialized).not.toContain("abcdef1234");
    expect(serialized).not.toContain("worker-smoke");
    expect(serialized).not.toContain("topic");
  });
});
