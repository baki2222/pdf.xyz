import { describe, expect, it } from "vitest";
import { renderReleaseDecisionIndex } from "./render";
import {
  followupDecision,
  makeIndex,
  notADecision,
  proceedDecision,
  rejectDecision,
} from "./fixtures";

describe("renderReleaseDecisionIndex — json", () => {
  it("round-trips to the stable result shape", () => {
    const result = makeIndex([proceedDecision(), followupDecision()]);
    const parsed = JSON.parse(renderReleaseDecisionIndex(result, "json"));
    expect(parsed.schema).toBe("pdfxyz.release-decision-index/1");
    expect(parsed.index.verdict).toBe("watch");
    expect(parsed.ledger.decisionCounts.proceed).toBe(1);
    expect(parsed.receipt.category).toBe("worker-release-decision-index");
  });

  it("honors pretty=false (single line)", () => {
    const out = renderReleaseDecisionIndex(makeIndex([proceedDecision()]), "json", false);
    expect(out.trimEnd().split("\n")).toHaveLength(1);
  });
});

describe("renderReleaseDecisionIndex — text", () => {
  it("prints the verdict, ledger, decision histogram, sequence, next actions, and caveats", () => {
    const out = renderReleaseDecisionIndex(makeIndex([proceedDecision(), rejectDecision()]), "text");
    expect(out).toMatch(/release decision ledger index/i);
    expect(out).toMatch(/INDEX: BLOCKED \(exit 4\)/);
    expect(out).toMatch(/by decision: proceed=1/);
    expect(out).toMatch(/by cross-check:/);
    expect(out).toMatch(/SEQUENCE \(oldest → newest\)/);
    expect(out).toMatch(/NEXT ACTIONS/);
    expect(out).toMatch(/NOT a legal audit log/i);
  });

  it("notes when the batch has no considered records", () => {
    const out = renderReleaseDecisionIndex(makeIndex([]), "text");
    expect(out).toMatch(/\(no records considered\)/);
  });

  it("shows an unreadable record in the sequence without echoing its content", () => {
    const out = renderReleaseDecisionIndex(makeIndex([proceedDecision(), notADecision()]), "text");
    expect(out).toMatch(/state=unreadable/);
    expect(out).not.toContain("something-else");
  });
});
