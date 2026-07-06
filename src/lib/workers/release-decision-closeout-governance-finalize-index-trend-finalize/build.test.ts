import { describe, expect, it } from "vitest";
import { buildNextActionIds } from "./build";
import {
  blockedReceipt,
  coherentPlan,
  completedReceipt,
  incompleteReceipt,
  makeFinalize,
  notAReceipt,
  NOW,
} from "./fixtures";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA,
} from "./types";

describe("finalize-index-trend-finalize build — result assembly", () => {
  it("assembles a stable, content-free result over a completed receipt", () => {
    const r = makeFinalize(completedReceipt(), { plan: coherentPlan() });
    expect(r.schema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata.policyId).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_POLICY_ID);
    expect(r.metadata.receiptSchema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA);
    expect(r.metadata.finalizationSchema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_SCHEMA);
    // Mirrors the rollup at the top level.
    expect(r.verdict).toBe(r.finalize.verdict);
    expect(r.exitCode).toBe(r.finalize.exitCode);
    // The related checklist is always the four kinds in canonical order.
    expect(r.related.map((x) => x.kind)).toEqual(["plan", "trend", "index", "finalization"]);
    expect(r.receipt.category).toBe("worker-release-decision-closeout-governance-finalize-index-trend-finalize");
  });

  it("is deterministic — same inputs produce a byte-identical result", () => {
    const a = JSON.stringify(makeFinalize(completedReceipt(), { plan: coherentPlan() }));
    const b = JSON.stringify(makeFinalize(completedReceipt(), { plan: coherentPlan() }));
    expect(a).toBe(b);
  });

  it("nextActionIds mirror the nextActions and always end with keep-finalize-record", () => {
    const r = makeFinalize(completedReceipt());
    expect(r.nextActionIds).toEqual(r.nextActions.map((a) => a.id));
    expect(r.nextActionIds.at(-1)).toBe("keep-finalize-record");
    expect(r.nextActionIds).toContain("continue-governance-cadence"); // a clean finalized loop
  });

  it("derives the recovery next-actions from the fired reasons", () => {
    expect(buildNextActionIds(["receipt-unreadable"])).toEqual(["recover-trusted-receipt", "keep-finalize-record"]);
    expect(buildNextActionIds(["related-tampered"])).toEqual(["recover-tampered-source", "keep-finalize-record"]);
    expect(buildNextActionIds(["plan-contradiction"])).toEqual([
      "reconcile-contradictory-source",
      "keep-finalize-record",
    ]);
    expect(buildNextActionIds(["required-record-missing"])).toEqual(["supply-required-record", "keep-finalize-record"]);
    expect(makeFinalize(notAReceipt()).nextActionIds).toContain("recover-trusted-receipt");
    expect(makeFinalize(blockedReceipt()).nextActionIds).toContain("investigate-blocked-loop");
    expect(makeFinalize(incompleteReceipt()).nextActionIds).toContain("complete-finalization-evidence");
  });
});
