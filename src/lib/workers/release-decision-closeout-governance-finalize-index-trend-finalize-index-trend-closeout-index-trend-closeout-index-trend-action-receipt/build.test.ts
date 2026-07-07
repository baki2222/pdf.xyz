import { describe, expect, it } from "vitest";
import {
  NOW,
  blockPlan,
  clearPlan,
  invalidPlan,
  investigatePlan,
  makeReceipt,
  monitorPlan,
  notAPlan,
  policyWith,
} from "./fixtures";
import { releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptExitCode } from "./types";

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt build — result assembly", () => {
  it("assembles a stable, content-free completed result over a clear plan", () => {
    const result = makeReceipt(clearPlan(), policyWith({ plan: true, clear: true }));
    expect(result.schema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1");
    expect(result.generatedAt).toBe(NOW);
    expect(result.metadata.planSchema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1",
    );
    expect(result.verdict).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.planClass).toBe("clear");
    expect(result.source.state).toBe("usable");
    expect(result.source.claimedPlanVerdict).toBe("clear");
    expect(result.source.sourceTrendVerdict).toBe("stable");
    expect(result.actionReceipt.verdict).toBe("completed");
    expect(result.nextActions).toEqual(["keep-action-receipt"]);
    expect(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptExitCode(result)).toBe(0);
    expect(result.guidance.length).toBeGreaterThan(0);
    expect(result.caveats.length).toBeGreaterThan(0);
  });

  it("flattens a content-free receipt with the acknowledgement coverage counts (block held-incomplete)", () => {
    const result = makeReceipt(blockPlan(), policyWith({ block: true }));
    // block plan, ack-block but no ack-plan → held-blocked but incomplete (the review ack is missing).
    expect(result.verdict).toBe("incomplete");
    const r = result.receipt;
    expect(r.category).toBe("worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt");
    expect(r.planClass).toBe("block");
    expect(r.sourceState).toBe("usable");
    expect(r.acksRequired).toBe(2); // plan, block
    expect(r.acksSatisfied).toBe(1); // block supplied
    expect(r.acksMissing).toBe(1); // plan
    expect(r.acksMismatched).toBe(0);
    expect(r.disclosure).toMatch(/content-free operational acknowledgement receipt/i);
  });

  it("records the source summary for a not-usable plan without inventing facts", () => {
    const unreadable = makeReceipt(notAPlan(), policyWith({ plan: true }));
    expect(unreadable.source).toMatchObject({
      state: "unreadable",
      claimedPlanVerdict: null,
      planClass: null,
      planUrgency: null,
      planActionClass: null,
      sourceTrendVerdict: null,
      sourceLatestIndex: null,
      blockingActions: 0,
      advisoryActions: 0,
      planStrict: false,
    });
    // An unreadable plan fails closed to invalid, never a vacuous completed pass.
    expect(unreadable.verdict).toBe("invalid");
  });

  it("a plan whose own verdict is invalid resolves to the block class (held), surfacing its claim", () => {
    const result = makeReceipt(invalidPlan(), policyWith({ plan: true }));
    expect(result.verdict).toBe("blocked");
    expect(result.planClass).toBe("block");
    expect(result.source.claimedPlanVerdict).toBe("invalid");
    expect(result.source.state).toBe("usable");
    expect(result.nextActions).toEqual(["hold-promotion", "supply-missing-ack", "keep-action-receipt"]);
  });

  it("surfaces the plan urgency / action class / source trend for a usable investigate plan", () => {
    const result = makeReceipt(investigatePlan(), policyWith({ plan: true }));
    expect(result.source.planUrgency).toBe("soon");
    expect(result.source.planActionClass).toBe("complete-evidence");
    expect(result.source.sourceTrendVerdict).toBe("insufficient");
  });

  it("carries a canonical acknowledgement checklist + fired reasons on a monitor plan", () => {
    const result = makeReceipt(monitorPlan(), policyWith({ plan: true }));
    expect(result.acknowledgements.map((a) => a.id)).toEqual(["plan", "clear", "monitor", "investigation", "block"]);
    expect(result.reasons.map((r) => r.id)).toEqual(["monitor-followup-open"]);
    expect(result.verdict).toBe("followup-open");
  });
});
