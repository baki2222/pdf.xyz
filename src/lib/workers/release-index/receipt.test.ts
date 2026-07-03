import { describe, expect, it } from "vitest";
import { buildReceipt } from "./receipt";
import type { ReleaseIndexDigestCounts, ReleaseIndexRetention, ReleaseIndexRollup } from "./types";

const rollup: ReleaseIndexRollup = {
  verdict: "warn",
  exitCode: 3,
  ready: false,
  drivers: ["retention-count"],
  detail: "x",
};

const retention: ReleaseIndexRetention = {
  maxArtifacts: 2,
  maxAgeDays: 30,
  totalInputs: 4,
  indexedArtifacts: 3,
  skippedInputs: 1,
  overRetentionCount: 1,
  overCount: true,
  overAge: false,
  stale: false,
  newestAgeBucket: "1-24h",
  oldestAgeBucket: "90d+",
};

const digestCounts: ReleaseIndexDigestCounts = { verified: 2, mismatch: 1, malformed: 0, unreadable: 1 };

describe("buildReceipt", () => {
  it("flattens a content-free audit line with bounded fields only", () => {
    const r = buildReceipt("2026-07-03T00:00:00.000Z", rollup, retention, digestCounts);
    expect(r).toEqual({
      category: "worker-release-index",
      policyId: "pdfxyz-worker-release-evidence-index",
      policyVersion: 1,
      at: "2026-07-03T00:00:00.000Z",
      verdict: "warn",
      exitCode: 3,
      indexedArtifacts: 3,
      verifiedArtifacts: 2,
      integrityFailures: 1,
      retentionDrift: true,
    });
  });

  it("sums mismatch + malformed into integrityFailures", () => {
    const r = buildReceipt("t", rollup, retention, { verified: 0, mismatch: 2, malformed: 3, unreadable: 0 });
    expect(r.integrityFailures).toBe(5);
  });

  it("retentionDrift is false only when no retention concern is raised", () => {
    const clean: ReleaseIndexRetention = { ...retention, overCount: false, overAge: false, stale: false };
    expect(buildReceipt("t", rollup, clean, digestCounts).retentionDrift).toBe(false);
    expect(buildReceipt("t", rollup, { ...clean, stale: true }, digestCounts).retentionDrift).toBe(true);
  });
});
