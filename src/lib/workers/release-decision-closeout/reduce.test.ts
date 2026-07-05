import { describe, expect, it } from "vitest";
import {
  blockedReceipt,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  contradictoryTrend,
  decisionFor,
  defaultPolicy,
  incompleteReceipt,
  makeCloseout,
  notADecision,
  notAPlan,
  notAReceipt,
  openReceipt,
  policyWith,
  tamperedPlan,
  tamperedReceipt,
  tamperedWindow,
  windowFor,
} from "./fixtures";
import type { ReleaseDecisionCloseoutRecordKind } from "./types";

/** The verdict + exit + fired reason ids of a closeout over the given receipt + inputs + policy. */
function closeout(
  receipt: unknown,
  inputs = {},
  policy = defaultPolicy(),
): { verdict: string; exit: number; reasons: string[] } {
  const r = makeCloseout(receipt, inputs, policy);
  return { verdict: r.verdict, exit: r.exitCode, reasons: [...r.closeout.reasons] };
}

/** The signal a related record of `kind` resolved to. */
function signalOf(receipt: unknown, inputs = {}, kind: ReleaseDecisionCloseoutRecordKind = "plan"): string {
  const rec = makeCloseout(receipt, inputs).related.find((x) => x.kind === kind)!;
  return rec.signal;
}

describe("computeCloseout — primary receipt drives the verdict", () => {
  it("a completed receipt alone is closed (exit 0)", () => {
    const c = closeout(completedReceipt());
    expect(c).toMatchObject({ verdict: "closed", exit: 0 });
    expect(c.reasons).toEqual(["receipt-completed"]);
  });

  it("an incomplete receipt is closeout-incomplete (exit 2)", () => {
    expect(closeout(incompleteReceipt())).toMatchObject({
      verdict: "closeout-incomplete",
      exit: 2,
      reasons: ["receipt-incomplete"],
    });
  });

  it("a followup-open receipt is closeout-open (exit 3)", () => {
    expect(closeout(openReceipt())).toMatchObject({
      verdict: "closeout-open",
      exit: 3,
      reasons: ["receipt-followup-open"],
    });
  });

  it("a blocked receipt is closeout-blocked (exit 4)", () => {
    expect(closeout(blockedReceipt())).toMatchObject({
      verdict: "closeout-blocked",
      exit: 4,
      reasons: ["receipt-blocked"],
    });
  });

  it("a tampered receipt is closeout-blocked (exit 4), fail closed", () => {
    const c = closeout(tamperedReceipt());
    expect(c).toMatchObject({ verdict: "closeout-blocked", exit: 4 });
    expect(c.reasons).toContain("receipt-tampered");
  });

  it("an unreadable receipt is closeout-incomplete (exit 2) — nothing to close out", () => {
    const c = closeout(notAReceipt());
    expect(c).toMatchObject({ verdict: "closeout-incomplete", exit: 2 });
    expect(c.reasons).toContain("receipt-unreadable");
  });
});

describe("computeCloseout — plan / trend cross-checks", () => {
  it("a coherent plan keeps a completed receipt closed", () => {
    const c = closeout(completedReceipt(), { plan: coherentPlan() });
    expect(c).toMatchObject({ verdict: "closed", exit: 0 });
    expect(c.reasons).toContain("plan-coherent");
    expect(signalOf(completedReceipt(), { plan: coherentPlan() }, "plan")).toBe("coherent");
  });

  it("a contradictory plan blocks a completed receipt (exit 4)", () => {
    const c = closeout(completedReceipt(), { plan: contradictoryPlan() });
    expect(c).toMatchObject({ verdict: "closeout-blocked", exit: 4 });
    expect(c.reasons).toContain("plan-contradiction");
    expect(signalOf(completedReceipt(), { plan: contradictoryPlan() }, "plan")).toBe("contradictory");
  });

  it("a coherent trend keeps a completed receipt closed; a contradictory trend blocks it", () => {
    expect(closeout(completedReceipt(), { trend: coherentTrend() })).toMatchObject({ verdict: "closed", exit: 0 });
    const bad = closeout(completedReceipt(), { trend: contradictoryTrend() });
    expect(bad).toMatchObject({ verdict: "closeout-blocked", exit: 4 });
    expect(bad.reasons).toContain("trend-contradiction");
  });

  it("a tampered related record is closeout-blocked (exit 4)", () => {
    const c = closeout(completedReceipt(), { plan: tamperedPlan() });
    expect(c).toMatchObject({ verdict: "closeout-blocked", exit: 4 });
    expect(c.reasons).toContain("related-tampered");
    expect(signalOf(completedReceipt(), { plan: tamperedPlan() }, "plan")).toBe("none");
  });

  it("an optional supplied-but-unreadable record is closeout-incomplete (exit 2)", () => {
    const c = closeout(completedReceipt(), { plan: notAPlan() });
    expect(c).toMatchObject({ verdict: "closeout-incomplete", exit: 2 });
    expect(c.reasons).toContain("related-unreadable");
  });
});

describe("computeCloseout — decision / index source-chain postures", () => {
  it("decision postures fold: proceed→closed, followup→open, reject→blocked, insufficient→incomplete", () => {
    expect(closeout(completedReceipt(), { decision: decisionFor("proceed") }).verdict).toBe("closed");
    expect(closeout(completedReceipt(), { decision: decisionFor("proceed-with-followup") }).verdict).toBe(
      "closeout-open",
    );
    expect(closeout(completedReceipt(), { decision: decisionFor("hold") }).verdict).toBe("closeout-open");
    expect(closeout(completedReceipt(), { decision: decisionFor("reject") }).verdict).toBe("closeout-blocked");
    expect(closeout(completedReceipt(), { decision: decisionFor("invalid") }).verdict).toBe("closeout-blocked");
    expect(closeout(completedReceipt(), { decision: decisionFor("insufficient") }).verdict).toBe(
      "closeout-incomplete",
    );
  });

  it("index postures fold: stable→closed, watch→open, blocked→blocked, insufficient→incomplete", () => {
    expect(closeout(completedReceipt(), { index: windowFor("stable") }).verdict).toBe("closed");
    expect(closeout(completedReceipt(), { index: windowFor("watch") }).verdict).toBe("closeout-open");
    expect(closeout(completedReceipt(), { index: windowFor("blocked") }).verdict).toBe("closeout-blocked");
    expect(closeout(completedReceipt(), { index: windowFor("insufficient") }).verdict).toBe("closeout-incomplete");
  });

  it("a blocking source chain fires source-chain-blocked", () => {
    const c = closeout(completedReceipt(), { decision: decisionFor("reject") });
    expect(c.reasons).toContain("source-chain-blocked");
  });

  it("a clean source-chain record fires source-chain-coherent (informational)", () => {
    const c = closeout(completedReceipt(), { decision: decisionFor("proceed") });
    expect(c.reasons).toContain("source-chain-coherent");
    expect(c.verdict).toBe("closed");
  });
});

describe("computeCloseout — require flags, strict-open, precedence", () => {
  it("a required-but-absent record is closeout-incomplete (exit 2)", () => {
    const c = closeout(completedReceipt(), {}, policyWith({ plan: true }));
    expect(c).toMatchObject({ verdict: "closeout-incomplete", exit: 2 });
    expect(c.reasons).toContain("required-record-missing");
  });

  it("a required-but-unreadable record is required-record-missing (not related-unreadable)", () => {
    const c = closeout(completedReceipt(), { index: notADecision() }, policyWith({ index: true }));
    expect(c.reasons).toContain("required-record-missing");
    expect(c.reasons).not.toContain("related-unreadable");
  });

  it("a required record that IS supplied and coherent stays closed", () => {
    const c = closeout(completedReceipt(), { plan: coherentPlan() }, policyWith({ plan: true }));
    expect(c).toMatchObject({ verdict: "closed", exit: 0 });
  });

  it("--strict-open escalates an open closeout to blocked (exit 4); leaves closed/incomplete alone", () => {
    const escalated = closeout(openReceipt(), {}, policyWith({}, true));
    expect(escalated).toMatchObject({ verdict: "closeout-blocked", exit: 4 });
    expect(escalated.reasons).toContain("strict-open-escalation");
    expect(closeout(completedReceipt(), {}, policyWith({}, true)).verdict).toBe("closed");
    expect(closeout(incompleteReceipt(), {}, policyWith({}, true)).verdict).toBe("closeout-incomplete");
  });

  it("--strict-open escalates an advisory source-chain record too", () => {
    const c = closeout(completedReceipt(), { index: windowFor("watch") }, policyWith({}, true));
    expect(c).toMatchObject({ verdict: "closeout-blocked", exit: 4 });
    expect(c.reasons).toContain("strict-open-escalation");
  });

  it("severity precedence: a blocked receipt dominates an advisory index (still blocked)", () => {
    const c = closeout(blockedReceipt(), { index: windowFor("watch") });
    expect(c).toMatchObject({ verdict: "closeout-blocked", exit: 4 });
  });

  it("a contradiction dominates a completed receipt + coherent decision (still blocked)", () => {
    const c = closeout(completedReceipt(), { plan: contradictoryPlan(), decision: decisionFor("proceed") });
    expect(c.verdict).toBe("closeout-blocked");
  });
});

describe("computeCloseout — rollup coverage counts + checklist order", () => {
  it("counts supplied / coherent / contradictory / blocking related records", () => {
    const r = makeCloseout(completedReceipt(), {
      plan: coherentPlan(),
      trend: coherentTrend(),
      decision: decisionFor("reject"),
      index: tamperedWindow(),
    });
    expect(r.closeout.relatedSupplied).toBe(4);
    expect(r.closeout.relatedCoherent).toBe(2); // plan + trend
    expect(r.closeout.relatedContradictory).toBe(0);
    expect(r.closeout.relatedBlocking).toBe(2); // decision reject (blocking) + tampered index
    expect(r.closeout.requiredMissing).toEqual([]);
  });

  it("emits the related checklist in canonical kind order regardless of what was supplied", () => {
    const r = makeCloseout(completedReceipt(), { index: windowFor("stable") });
    expect(r.related.map((x) => x.kind)).toEqual(["plan", "trend", "decision", "index"]);
    expect(r.related[0]).toMatchObject({ kind: "plan", state: "absent", signal: "none" });
    expect(r.related[3]).toMatchObject({ kind: "index", state: "usable", signal: "coherent" });
  });

  it("surfaces the receipt's own verdict + plan class in the rollup", () => {
    const r = makeCloseout(completedReceipt());
    expect(r.closeout.receiptState).toBe("usable");
    expect(r.closeout.receiptVerdict).toBe("completed");
    expect(r.closeout.planClass).toBe("clear");
    expect(r.closeout.closed).toBe(true);
  });
});
