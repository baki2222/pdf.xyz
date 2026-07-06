import { describe, expect, it } from "vitest";
import {
  blockedReceipt,
  blockedWindow,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  contradictoryTrend,
  defaultPolicy,
  incompleteReceipt,
  incompleteWindow,
  invalidReceipt,
  makeCloseout,
  notAPlan,
  notAReceipt,
  openReceipt,
  openWindow,
  policyWith,
  tamperedPlan,
  tamperedReceipt,
} from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutRecordKind } from "./types";

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
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutRecordKind = "plan",
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

describe("computeCloseout — plan / trend cross-checks", () => {
  it("a coherent plan keeps a completed receipt closed", () => {
    const c = closeout(completed, { plan: coherentPlan() });
    expect(c).toMatchObject({ verdict: "closed", exit: 0 });
    expect(c.reasons).toContain("plan-coherent");
    expect(signalOf(completed, { plan: coherentPlan() }, "plan")).toBe("coherent");
  });

  it("a contradictory plan blocks a completed receipt (exit 4)", () => {
    const c = closeout(completed, { plan: contradictoryPlan() });
    expect(c).toMatchObject({ verdict: "blocked", exit: 4 });
    expect(c.reasons).toContain("plan-contradiction");
    expect(signalOf(completed, { plan: contradictoryPlan() }, "plan")).toBe("contradictory");
  });

  it("a coherent trend keeps it closed; a contradictory trend blocks it", () => {
    expect(closeout(completed, { trend: coherentTrend() })).toMatchObject({ verdict: "closed", exit: 0 });
    const bad = closeout(completed, { trend: contradictoryTrend() });
    expect(bad).toMatchObject({ verdict: "blocked", exit: 4 });
    expect(bad.reasons).toContain("trend-contradiction");
  });

  it("a tampered related record is blocked (exit 4)", () => {
    const c = closeout(completed, { plan: tamperedPlan() });
    expect(c).toMatchObject({ verdict: "blocked", exit: 4 });
    expect(c.reasons).toContain("related-tampered");
    expect(signalOf(completed, { plan: tamperedPlan() }, "plan")).toBe("none");
  });

  it("a supplied-but-unreadable related record fails closed as blocked (exit 4)", () => {
    const c = closeout(completed, { plan: notAPlan() });
    expect(c).toMatchObject({ verdict: "blocked", exit: 4 });
    expect(c.reasons).toContain("related-unreadable");
  });
});

describe("computeCloseout — finalization-index source-chain postures", () => {
  it("index postures fold: indexed→closed, index-open→open, index-incomplete→incomplete, index-blocked→blocked", () => {
    expect(closeout(completed, { index: coherentIndex() }).verdict).toBe("closed");
    expect(closeout(completed, { index: openWindow() }).verdict).toBe("open");
    expect(closeout(completed, { index: incompleteWindow() }).verdict).toBe("incomplete");
    expect(closeout(completed, { index: blockedWindow() }).verdict).toBe("blocked");
  });

  it("a blocking source chain fires source-chain-blocked", () => {
    expect(closeout(completed, { index: blockedWindow() }).reasons).toContain("source-chain-blocked");
  });

  it("a clean source-chain record fires source-chain-coherent (informational)", () => {
    const c = closeout(completed, { index: coherentIndex() });
    expect(c.reasons).toContain("source-chain-coherent");
    expect(c.verdict).toBe("closed");
  });

  it("an advisory index fires source-chain-advisory; an insufficient one fires source-chain-insufficient", () => {
    expect(closeout(completed, { index: openWindow() }).reasons).toContain("source-chain-advisory");
    expect(closeout(completed, { index: incompleteWindow() }).reasons).toContain("source-chain-insufficient");
    expect(signalOf(completed, { index: openWindow() }, "index")).toBe("advisory");
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

  it("--strict-open escalates an advisory source-chain record too", () => {
    const c = closeout(completed, { index: openWindow() }, policyWith({}, true));
    expect(c).toMatchObject({ verdict: "blocked", exit: 4 });
    expect(c.reasons).toContain("strict-open-escalation");
  });

  it("severity precedence: a blocked receipt dominates an advisory index (still blocked)", () => {
    expect(closeout(blocked, { index: openWindow() })).toMatchObject({ verdict: "blocked", exit: 4 });
  });

  it("a contradiction dominates a completed receipt + coherent index (still blocked)", () => {
    expect(closeout(completed, { plan: contradictoryPlan(), index: coherentIndex() }).verdict).toBe("blocked");
  });
});

describe("computeCloseout — rollup coverage counts + checklist order", () => {
  it("counts supplied / coherent / contradictory / blocking related records", () => {
    const r = makeCloseout(completed, {
      plan: contradictoryPlan(),
      trend: coherentTrend(),
      index: blockedWindow(),
    });
    expect(r.coverage.relatedSupplied).toBe(3);
    expect(r.coverage.relatedCoherent).toBe(1); // trend
    expect(r.coverage.relatedContradictory).toBe(1); // plan
    expect(r.coverage.relatedBlocking).toBe(1); // blocked index
    expect(r.coverage.requiredMissing).toEqual([]);
  });

  it("emits the related checklist in canonical kind order regardless of what was supplied", () => {
    const r = makeCloseout(completed, { index: coherentIndex() });
    expect(r.related.map((x) => x.kind)).toEqual(["plan", "trend", "index"]);
    expect(r.related[0]).toMatchObject({ kind: "plan", state: "absent", signal: "none" });
    expect(r.related[2]).toMatchObject({ kind: "index", state: "usable", signal: "coherent" });
  });

  it("surfaces the receipt's own verdict + plan class in the coverage rollup", () => {
    const r = makeCloseout(completed);
    expect(r.coverage.receiptState).toBe("usable");
    expect(r.coverage.receiptVerdict).toBe("completed");
    expect(r.coverage.planClass).toBe("clear");
    expect(r.coverage.closed).toBe(true);
  });
});
