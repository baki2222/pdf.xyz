import { describe, expect, it } from "vitest";
import { buildGovernanceReceipt } from "./receipt";
import { makeGovernance, passAudit, promoteReadyReport, stableTrend, NOW } from "./fixtures";
import { RELEASE_GOVERNANCE_POLICY_ID } from "./types";

describe("buildGovernanceReceipt", () => {
  it("flattens the policy + coverage + rollup into a content-free receipt", () => {
    const r = makeGovernance(
      { trend: stableTrend(), report: promoteReadyReport(), audit: passAudit() },
      { requireReport: true },
    );
    expect(r.receipt).toEqual({
      category: "worker-release-governance",
      policyId: RELEASE_GOVERNANCE_POLICY_ID,
      policyVersion: 1,
      at: NOW,
      verdict: "healthy",
      exitCode: 0,
      sourcesSupplied: 3,
      sourcesUsable: 3,
      hasTrend: true,
      hasReport: true,
      hasAudit: true,
      blocking: 0,
      insufficiencies: 0,
      advisories: 0,
      requireReport: true,
      requireAudit: false,
      strictWatch: false,
    });
  });

  it("carries only bounded enums / small ints / the run stamp (no ingested value)", () => {
    const receipt = buildGovernanceReceipt(
      NOW,
      { requireReport: false, requireAudit: false, strictWatch: false },
      {
        sourcesSupplied: 1,
        sourcesUsable: 1,
        trend: "usable",
        report: "absent",
        audit: "absent",
        hasTrend: true,
        hasReport: false,
        hasAudit: false,
      },
      {
        verdict: "healthy",
        exitCode: 0,
        healthy: true,
        reasons: [],
        blocking: 0,
        insufficiencies: 0,
        advisories: 0,
        requireReport: false,
        requireAudit: false,
        strictWatch: false,
        strictWatchEscalated: false,
        detail: "",
      },
    );
    expect(receipt.at).toBe(NOW);
    expect(receipt.verdict).toBe("healthy");
    // The receipt has no free-text field beyond the fixed category + policy id.
    expect(Object.values(receipt).every((v) => typeof v !== "object")).toBe(true);
  });
});
