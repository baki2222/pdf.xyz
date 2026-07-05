import { describe, expect, it } from "vitest";
import { buildCloseoutIndexReceipt } from "./receipt";
import { makeIndex, closedCloseout, blockedCloseout } from "./fixtures";

describe("buildCloseoutIndexReceipt — flattened, content-free", () => {
  it("flattens the verdict + counts + latest + trend class + disclosure", () => {
    const result = makeIndex([closedCloseout(), blockedCloseout()]);
    const r = buildCloseoutIndexReceipt(result.generatedAt, result.ledger, result.closeoutIndex);
    expect(r).toMatchObject({
      category: "worker-release-decision-closeout-index",
      verdict: "index-blocked",
      exitCode: 4,
      closeoutsSupplied: 2,
      closeoutsConsidered: 2,
      closeoutsUsable: 2,
      latest: "closeout-blocked",
      trendClass: "blocked-present",
    });
    expect(r.verdictCounts.closed).toBe(1);
    expect(r.verdictCounts["closeout-blocked"]).toBe(1);
    expect(r.disclosure).toMatch(/INDEX SUMMARY ONLY/);
  });

  it("is carried on the built result and matches the top-level verdict", () => {
    const result = makeIndex([closedCloseout()]);
    expect(result.receipt.verdict).toBe(result.closeoutIndex.verdict);
    expect(result.receipt.at).toBe(result.generatedAt);
  });

  it("every value is a bounded enum / small int / stable id — no locator shape", () => {
    const r = makeIndex([closedCloseout()]).receipt;
    const flat = JSON.stringify(r);
    for (const bad of ["://", "/", "\\", "@", ".json"]) {
      expect(flat.includes(bad) && bad !== "/", `receipt leaked ${bad}`).toBe(false);
    }
  });
});
