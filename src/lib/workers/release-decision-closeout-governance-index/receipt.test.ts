import { describe, expect, it } from "vitest";
import { buildGovernanceIndexReceipt } from "./receipt";
import { makeIndex, closedGovernance, blockedGovernance } from "./fixtures";

describe("buildGovernanceIndexReceipt — flattened, content-free", () => {
  it("flattens the verdict + counts + latest + trend class + disclosure", () => {
    const result = makeIndex([closedGovernance(), blockedGovernance()]);
    const r = buildGovernanceIndexReceipt(result.generatedAt, result.ledger, result.governanceIndex);
    expect(r).toMatchObject({
      category: "worker-release-decision-closeout-governance-index",
      verdict: "index-blocked",
      exitCode: 4,
      governanceSupplied: 2,
      governanceConsidered: 2,
      governanceUsable: 2,
      latest: "governance-blocked",
      trendClass: "blocked-present",
    });
    expect(r.verdictCounts.closed).toBe(1);
    expect(r.verdictCounts["governance-blocked"]).toBe(1);
    expect(r.disclosure).toMatch(/INDEX SUMMARY ONLY/);
  });

  it("is carried on the built result and matches the top-level verdict", () => {
    const result = makeIndex([closedGovernance()]);
    expect(result.receipt.verdict).toBe(result.governanceIndex.verdict);
    expect(result.receipt.at).toBe(result.generatedAt);
  });

  it("every value is a bounded enum / small int / stable id — no locator shape", () => {
    const r = makeIndex([closedGovernance()]).receipt;
    const flat = JSON.stringify(r);
    for (const bad of ["://", "\\", "@", ".json"]) {
      expect(flat.includes(bad), `receipt leaked ${bad}`).toBe(false);
    }
  });
});
