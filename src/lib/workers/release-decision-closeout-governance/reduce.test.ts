import { describe, expect, it } from "vitest";
import { tamperedPlan } from "../release-decision-closeout-action-receipt/fixtures";
import {
  blockedCloseout,
  blockedIndex,
  blockedReceipt,
  coherentCloseout,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  contradictoryTrend,
  followupOpenReceipt,
  incompleteReceipt,
  makeGovernance,
  notAReceipt,
  openCloseout,
  openIndex,
  tamperedReceipt,
} from "./fixtures";
import type { GovernanceObjects } from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceVerdict } from "./types";

/** Drive the real bundle over a set of record objects + policy and return its verdict + exit code. */
function govern(
  objs: GovernanceObjects,
  policy: Parameters<typeof makeGovernance>[1] = {},
): { verdict: ReleaseDecisionCloseoutGovernanceVerdict; exitCode: number } {
  const r = makeGovernance(objs, policy);
  return { verdict: r.verdict, exitCode: r.exitCode };
}

describe("release-decision-closeout-governance reduce — primary receipt drives the base verdict", () => {
  it("a completed receipt alone is CLOSED (exit 0)", () => {
    expect(govern({ receipt: completedReceipt() })).toEqual({ verdict: "closed", exitCode: 0 });
  });

  it("an incomplete receipt is GOVERNANCE-INCOMPLETE (exit 2)", () => {
    expect(govern({ receipt: incompleteReceipt() })).toEqual({
      verdict: "governance-incomplete",
      exitCode: 2,
    });
  });

  it("a followup-open receipt is GOVERNANCE-OPEN (exit 3)", () => {
    expect(govern({ receipt: followupOpenReceipt() })).toEqual({
      verdict: "governance-open",
      exitCode: 3,
    });
  });

  it("a blocked receipt is GOVERNANCE-BLOCKED (exit 4)", () => {
    expect(govern({ receipt: blockedReceipt() })).toEqual({ verdict: "governance-blocked", exitCode: 4 });
  });

  it("a tampered receipt is GOVERNANCE-BLOCKED (exit 4); an unreadable receipt is GOVERNANCE-INCOMPLETE (exit 2)", () => {
    expect(govern({ receipt: tamperedReceipt() })).toEqual({ verdict: "governance-blocked", exitCode: 4 });
    expect(govern({ receipt: notAReceipt() })).toEqual({ verdict: "governance-incomplete", exitCode: 2 });
  });
});

describe("release-decision-closeout-governance reduce — related records escalate the chain", () => {
  it("a completed receipt + a coherent full chain stays CLOSED (exit 0)", () => {
    const result = makeGovernance({
      receipt: completedReceipt(),
      plan: coherentPlan(),
      trend: coherentTrend(),
      index: coherentIndex(),
      closeout: coherentCloseout(),
    });
    expect(result.verdict).toBe("closed");
    expect(result.coverage.relatedCoherent).toBe(4);
    expect(result.coverage.relatedContradictory).toBe(0);
    // Every related record is coherent.
    for (const r of result.related) expect(r.signal).toBe("coherent");
  });

  it("a supplied plan that disagrees with the receipt is a contradiction ⇒ GOVERNANCE-BLOCKED", () => {
    const r = makeGovernance({ receipt: completedReceipt(), plan: contradictoryPlan() });
    expect(r.verdict).toBe("governance-blocked");
    expect(r.governance.reasons).toContain("plan-contradiction");
    expect(r.related.find((x) => x.kind === "plan")?.signal).toBe("contradictory");
  });

  it("a supplied trend that disagrees with the receipt is a contradiction ⇒ GOVERNANCE-BLOCKED", () => {
    const r = makeGovernance({ receipt: completedReceipt(), trend: contradictoryTrend() });
    expect(r.verdict).toBe("governance-blocked");
    expect(r.governance.reasons).toContain("trend-contradiction");
  });

  it("a blocked source-chain record (index / closeout) ⇒ GOVERNANCE-BLOCKED", () => {
    expect(govern({ receipt: completedReceipt(), index: blockedIndex() }).verdict).toBe("governance-blocked");
    expect(govern({ receipt: completedReceipt(), closeout: blockedCloseout() }).verdict).toBe(
      "governance-blocked",
    );
  });

  it("an advisory source-chain record (index-open / closeout-open) ⇒ GOVERNANCE-OPEN", () => {
    expect(govern({ receipt: completedReceipt(), index: openIndex() })).toEqual({
      verdict: "governance-open",
      exitCode: 3,
    });
    expect(govern({ receipt: completedReceipt(), closeout: openCloseout() })).toEqual({
      verdict: "governance-open",
      exitCode: 3,
    });
  });

  it("a tampered related record ⇒ GOVERNANCE-BLOCKED", () => {
    // A hand-flipped plan (the P68 fixtures' tampered plan) is recognized-but-inconsistent → related-tampered.
    const r = makeGovernance({ receipt: completedReceipt(), plan: tamperedPlan() });
    expect(r.verdict).toBe("governance-blocked");
    expect(r.governance.reasons).toContain("related-tampered");
  });
});

describe("release-decision-closeout-governance reduce — require flags + strict-open", () => {
  it("--require-<kind> for an absent record ⇒ GOVERNANCE-INCOMPLETE", () => {
    expect(govern({ receipt: completedReceipt() }, { require: reqOnly("plan") })).toEqual({
      verdict: "governance-incomplete",
      exitCode: 2,
    });
    expect(govern({ receipt: completedReceipt() }, { require: reqOnly("closeout") }).verdict).toBe(
      "governance-incomplete",
    );
  });

  it("--require-<kind> is satisfied by a coherent supplied record (stays CLOSED)", () => {
    expect(
      govern({ receipt: completedReceipt(), plan: coherentPlan() }, { require: reqOnly("plan") }),
    ).toEqual({ verdict: "closed", exitCode: 0 });
  });

  it("--strict-open escalates an open governance to BLOCKED (exit 4); leaves a closed chain untouched", () => {
    expect(govern({ receipt: followupOpenReceipt() }, { strictOpen: true })).toEqual({
      verdict: "governance-blocked",
      exitCode: 4,
    });
    expect(govern({ receipt: completedReceipt() }, { strictOpen: true })).toEqual({
      verdict: "closed",
      exitCode: 0,
    });
    // The escalation is recorded honestly.
    const escalated = makeGovernance({ receipt: followupOpenReceipt() }, { strictOpen: true });
    expect(escalated.governance.strictOpenEscalated).toBe(true);
    expect(escalated.governance.strictOpenEscalatedFrom).toBe("governance-open");
    expect(escalated.governance.reasons).toContain("strict-open-escalation");
  });
});

/** Build a require-map with only `kind` set true. */
function reqOnly(kind: "plan" | "trend" | "index" | "closeout"): Record<string, boolean> {
  return { plan: false, trend: false, index: false, closeout: false, [kind]: true };
}
