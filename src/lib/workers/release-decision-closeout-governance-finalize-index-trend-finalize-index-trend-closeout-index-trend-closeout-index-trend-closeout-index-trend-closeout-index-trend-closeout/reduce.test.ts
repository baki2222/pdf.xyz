import { describe, expect, it } from "vitest";
import {
  blockedReceipt,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  contradictoryTrend,
  defaultPolicy,
  incompleteReceipt,
  invalidReceipt,
  makeCloseout,
  notAPlan,
  notAReceipt,
  openReceipt,
  policyWith,
  tamperedPlan,
  tamperedReceipt,
} from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind } from "./types";

// Base receipts are expensive (each rebuilds a real multi-phase chain); memoize at module scope.
const completed = completedReceipt();
const incomplete = incompleteReceipt();
const open = openReceipt();
const blocked = blockedReceipt();

/** The verdict + exit + fired reason ids of a closeout over the given receipt + inputs + policy. */
function closeout(
  receipt: unknown,
  inputs = {},
  policy = defaultPolicy(),
): { verdict: string; exit: number; reasons: string[] } {
  const r = makeCloseout(receipt, inputs, policy);
  return { verdict: r.verdict, exit: r.exitCode, reasons: [...r.coverage.reasons] };
}

/** The signal a related record of `kind` resolved to. */
function signalOf(
  receipt: unknown,
  inputs = {},
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutRecordKind = "plan",
): string {
  const rec = makeCloseout(receipt, inputs).related.find((x) => x.kind === kind)!;
  return rec.signal;
}

describe("computeCloseout — the primary receipt's own verdict drives the closeout", () => {
  it("a completed receipt alone is closed (exit 0)", () => {
    const c = closeout(completed);
    expect(c).toMatchObject({ verdict: "closed", exit: 0 });
    expect(c.reasons).toEqual(["receipt-completed"]);
  });

  it("an incomplete receipt is incomplete (exit 2)", () => {
    expect(closeout(incomplete)).toMatchObject({
      verdict: "incomplete",
      exit: 2,
      reasons: ["receipt-incomplete"],
    });
  });

  it("a followup-open receipt is open (exit 3)", () => {
    expect(closeout(open)).toMatchObject({
      verdict: "open",
      exit: 3,
      reasons: ["receipt-followup-open"],
    });
  });

  it("a blocked receipt is blocked (exit 4)", () => {
    expect(closeout(blocked)).toMatchObject({
      verdict: "blocked",
      exit: 4,
      reasons: ["receipt-blocked"],
    });
  });

  it("a receipt whose own verdict is invalid is an invalid closeout (exit 4)", () => {
    const c = closeout(invalidReceipt());
    expect(c).toMatchObject({ verdict: "invalid", exit: 4 });
    expect(c.reasons).toContain("receipt-invalid");
  });

  it("a tampered receipt is invalid (exit 4), fail closed", () => {
    const c = closeout(tamperedReceipt());
    expect(c).toMatchObject({ verdict: "invalid", exit: 4 });
    expect(c.reasons).toContain("receipt-tampered");
  });

  it("an unreadable receipt is invalid (exit 4) — nothing trustworthy to close out", () => {
    const c = closeout(notAReceipt());
    expect(c).toMatchObject({ verdict: "invalid", exit: 4 });
    expect(c.reasons).toContain("receipt-unreadable");
  });
});

describe("computeCloseout — plan / trend cross-checks fail closed as INVALID", () => {
  it("a coherent plan keeps a completed receipt closed", () => {
    const c = closeout(completed, { plan: coherentPlan() });
    expect(c).toMatchObject({ verdict: "closed", exit: 0 });
    expect(c.reasons).toContain("plan-coherent");
    expect(signalOf(completed, { plan: coherentPlan() }, "plan")).toBe("coherent");
  });

  it("a contradictory plan makes a completed receipt invalid (exit 4)", () => {
    const c = closeout(completed, { plan: contradictoryPlan() });
    expect(c).toMatchObject({ verdict: "invalid", exit: 4 });
    expect(c.reasons).toContain("plan-contradiction");
    expect(signalOf(completed, { plan: contradictoryPlan() }, "plan")).toBe("contradictory");
  });

  it("a coherent trend keeps it closed; a contradictory trend makes it invalid", () => {
    expect(closeout(completed, { trend: coherentTrend() })).toMatchObject({ verdict: "closed", exit: 0 });
    const bad = closeout(completed, { trend: contradictoryTrend() });
    expect(bad).toMatchObject({ verdict: "invalid", exit: 4 });
    expect(bad.reasons).toContain("trend-contradiction");
  });

  it("a tampered related record is invalid (exit 4) — an untrustworthy chain", () => {
    const c = closeout(completed, { plan: tamperedPlan() });
    expect(c).toMatchObject({ verdict: "invalid", exit: 4 });
    expect(c.reasons).toContain("related-tampered");
    expect(signalOf(completed, { plan: tamperedPlan() }, "plan")).toBe("none");
  });

  it("a supplied-but-unreadable related record fails closed as invalid (exit 4)", () => {
    const c = closeout(completed, { plan: notAPlan() });
    expect(c).toMatchObject({ verdict: "invalid", exit: 4 });
    expect(c.reasons).toContain("related-unreadable");
  });
});

describe("computeCloseout — require flags, strict-open, precedence", () => {
  it("a required-but-absent record is incomplete (exit 2)", () => {
    const c = closeout(completed, {}, policyWith({ plan: true }));
    expect(c).toMatchObject({ verdict: "incomplete", exit: 2 });
    expect(c.reasons).toContain("required-record-missing");
  });

  it("a required record that IS supplied and coherent stays closed", () => {
    const c = closeout(completed, { plan: coherentPlan() }, policyWith({ plan: true }));
    expect(c).toMatchObject({ verdict: "closed", exit: 0 });
  });

  it("--strict-open escalates an open closeout to blocked (exit 4); leaves closed / incomplete alone", () => {
    const escalated = closeout(open, {}, policyWith({}, true));
    expect(escalated).toMatchObject({ verdict: "blocked", exit: 4 });
    expect(escalated.reasons).toContain("strict-open-escalation");
    expect(closeout(completed, {}, policyWith({}, true)).verdict).toBe("closed");
    expect(closeout(incomplete, {}, policyWith({}, true)).verdict).toBe("incomplete");
  });

  it("severity precedence: an invalid related record dominates a blocked receipt (invalid)", () => {
    const c = closeout(blocked, { plan: tamperedPlan() });
    expect(c).toMatchObject({ verdict: "invalid", exit: 4 });
    expect(c.reasons).toEqual(expect.arrayContaining(["receipt-blocked", "related-tampered"]));
  });

  it("a contradiction dominates a completed receipt + coherent trend (invalid)", () => {
    expect(closeout(completed, { plan: contradictoryPlan(), trend: coherentTrend() }).verdict).toBe("invalid");
  });
});

describe("computeCloseout — rollup coverage counts + checklist order", () => {
  it("counts supplied / coherent / contradictory related records", () => {
    const r = makeCloseout(completed, {
      plan: contradictoryPlan(),
      trend: coherentTrend(),
    });
    expect(r.coverage.relatedSupplied).toBe(2);
    expect(r.coverage.relatedCoherent).toBe(1); // trend
    expect(r.coverage.relatedContradictory).toBe(1); // plan
    expect(r.coverage.relatedBlocking).toBe(0);
    expect(r.coverage.requiredMissing).toEqual([]);
  });

  it("counts a tampered / unreadable supplied related record as blocking (state-based)", () => {
    const r = makeCloseout(completed, { plan: tamperedPlan() });
    expect(r.coverage.relatedBlocking).toBe(1);
    expect(makeCloseout(completed, { trend: notAPlan() }).coverage.relatedBlocking).toBe(1);
  });

  it("emits the related checklist in canonical kind order regardless of what was supplied", () => {
    const r = makeCloseout(completed, { trend: coherentTrend() });
    expect(r.related.map((x) => x.kind)).toEqual(["plan", "trend"]);
    expect(r.related[0]).toMatchObject({ kind: "plan", state: "absent", signal: "none" });
    expect(r.related[1]).toMatchObject({ kind: "trend", state: "usable", signal: "coherent" });
  });

  it("surfaces the receipt's own verdict + plan class in the coverage rollup", () => {
    const r = makeCloseout(completed);
    expect(r.coverage.receiptState).toBe("usable");
    expect(r.coverage.receiptVerdict).toBe("completed");
    expect(r.coverage.planClass).toBe("clear");
    expect(r.coverage.closed).toBe(true);
  });
});
