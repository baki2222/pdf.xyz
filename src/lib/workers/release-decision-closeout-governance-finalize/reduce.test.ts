import { describe, expect, it } from "vitest";
import { tamperedPlan } from "../release-decision-closeout-governance-action-receipt/fixtures";
import {
  blockedGovernance,
  blockedIndex,
  blockedReceipt,
  coherentGovernance,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  contradictoryTrend,
  followupOpenReceipt,
  incompleteReceipt,
  makeGovernanceFinalize,
  notAReceipt,
  openGovernance,
  openIndex,
  tamperedReceipt,
} from "./fixtures";
import type { GovernanceFinalizeObjects } from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeVerdict } from "./types";

/** Drive the real bundle over a set of record objects + policy and return its verdict + exit code. */
function finalize(
  objs: GovernanceFinalizeObjects,
  policy: Parameters<typeof makeGovernanceFinalize>[1] = {},
): { verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict; exitCode: number } {
  const r = makeGovernanceFinalize(objs, policy);
  return { verdict: r.verdict, exitCode: r.exitCode };
}

describe("release-decision-closeout-governance-finalize reduce — primary receipt drives the base verdict", () => {
  it("a completed receipt alone is FINALIZED (exit 0)", () => {
    expect(finalize({ receipt: completedReceipt() })).toEqual({ verdict: "finalized", exitCode: 0 });
  });

  it("an incomplete receipt is FINALIZE-INCOMPLETE (exit 2)", () => {
    expect(finalize({ receipt: incompleteReceipt() })).toEqual({
      verdict: "finalize-incomplete",
      exitCode: 2,
    });
  });

  it("a followup-open receipt is FINALIZE-OPEN (exit 3)", () => {
    expect(finalize({ receipt: followupOpenReceipt() })).toEqual({
      verdict: "finalize-open",
      exitCode: 3,
    });
  });

  it("a blocked receipt is FINALIZE-BLOCKED (exit 4)", () => {
    expect(finalize({ receipt: blockedReceipt() })).toEqual({ verdict: "finalize-blocked", exitCode: 4 });
  });

  it("a tampered receipt is FINALIZE-BLOCKED (exit 4); an unreadable receipt is FINALIZE-INCOMPLETE (exit 2)", () => {
    expect(finalize({ receipt: tamperedReceipt() })).toEqual({ verdict: "finalize-blocked", exitCode: 4 });
    expect(finalize({ receipt: notAReceipt() })).toEqual({ verdict: "finalize-incomplete", exitCode: 2 });
  });
});

describe("release-decision-closeout-governance-finalize reduce — related records escalate the chain", () => {
  it("a completed receipt + a coherent full chain stays FINALIZED (exit 0)", () => {
    const result = makeGovernanceFinalize({
      receipt: completedReceipt(),
      plan: coherentPlan(),
      trend: coherentTrend(),
      index: coherentIndex(),
      governance: coherentGovernance(),
    });
    expect(result.verdict).toBe("finalized");
    expect(result.coverage.relatedCoherent).toBe(4);
    expect(result.coverage.relatedContradictory).toBe(0);
    // Every related record is coherent.
    for (const r of result.related) expect(r.signal).toBe("coherent");
  });

  it("a supplied plan that disagrees with the receipt is a contradiction ⇒ FINALIZE-BLOCKED", () => {
    const r = makeGovernanceFinalize({ receipt: completedReceipt(), plan: contradictoryPlan() });
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.governanceFinalize.reasons).toContain("plan-contradiction");
    expect(r.related.find((x) => x.kind === "plan")?.signal).toBe("contradictory");
  });

  it("a supplied trend that disagrees with the receipt is a contradiction ⇒ FINALIZE-BLOCKED", () => {
    const r = makeGovernanceFinalize({ receipt: completedReceipt(), trend: contradictoryTrend() });
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.governanceFinalize.reasons).toContain("trend-contradiction");
  });

  it("a blocked source-chain record (index / governance) ⇒ FINALIZE-BLOCKED", () => {
    expect(finalize({ receipt: completedReceipt(), index: blockedIndex() }).verdict).toBe("finalize-blocked");
    expect(finalize({ receipt: completedReceipt(), governance: blockedGovernance() }).verdict).toBe(
      "finalize-blocked",
    );
  });

  it("an advisory source-chain record (index-open / governance-open) ⇒ FINALIZE-OPEN", () => {
    expect(finalize({ receipt: completedReceipt(), index: openIndex() })).toEqual({
      verdict: "finalize-open",
      exitCode: 3,
    });
    expect(finalize({ receipt: completedReceipt(), governance: openGovernance() })).toEqual({
      verdict: "finalize-open",
      exitCode: 3,
    });
  });

  it("a tampered related record ⇒ FINALIZE-BLOCKED", () => {
    // A hand-flipped plan (the P73 fixtures' tampered plan) is recognized-but-inconsistent → related-tampered.
    const r = makeGovernanceFinalize({ receipt: completedReceipt(), plan: tamperedPlan() });
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.governanceFinalize.reasons).toContain("related-tampered");
  });
});

describe("release-decision-closeout-governance-finalize reduce — require flags + strict-open", () => {
  it("--require-<kind> for an absent record ⇒ FINALIZE-INCOMPLETE", () => {
    expect(finalize({ receipt: completedReceipt() }, { require: reqOnly("plan") })).toEqual({
      verdict: "finalize-incomplete",
      exitCode: 2,
    });
    expect(finalize({ receipt: completedReceipt() }, { require: reqOnly("governance") }).verdict).toBe(
      "finalize-incomplete",
    );
  });

  it("--require-<kind> is satisfied by a coherent supplied record (stays FINALIZED)", () => {
    expect(
      finalize({ receipt: completedReceipt(), plan: coherentPlan() }, { require: reqOnly("plan") }),
    ).toEqual({ verdict: "finalized", exitCode: 0 });
  });

  it("--strict-open escalates an open finalization to BLOCKED (exit 4); leaves a finalized chain untouched", () => {
    expect(finalize({ receipt: followupOpenReceipt() }, { strictOpen: true })).toEqual({
      verdict: "finalize-blocked",
      exitCode: 4,
    });
    expect(finalize({ receipt: completedReceipt() }, { strictOpen: true })).toEqual({
      verdict: "finalized",
      exitCode: 0,
    });
    // The escalation is recorded honestly.
    const escalated = makeGovernanceFinalize({ receipt: followupOpenReceipt() }, { strictOpen: true });
    expect(escalated.governanceFinalize.strictOpenEscalated).toBe(true);
    expect(escalated.governanceFinalize.strictOpenEscalatedFrom).toBe("finalize-open");
    expect(escalated.governanceFinalize.reasons).toContain("strict-open-escalation");
  });
});

/** Build a require-map with only `kind` set true. */
function reqOnly(kind: "plan" | "trend" | "index" | "governance"): Record<string, boolean> {
  return { plan: false, trend: false, index: false, governance: false, [kind]: true };
}
