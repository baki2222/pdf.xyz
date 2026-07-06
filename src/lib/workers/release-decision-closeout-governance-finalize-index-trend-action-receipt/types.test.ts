import { describe, expect, it } from "vitest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_LABEL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  planClassForVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict,
} from "./types";

describe("finalize-index-trend-action-receipt types — bounded vocabulary", () => {
  it("pins the schema tag + verdict / plan-class / ack sets", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_SCHEMA).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1",
    );
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS]).toEqual([
      "completed",
      "incomplete",
      "blocked",
      "invalid",
    ]);
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES]).toEqual([
      "clear",
      "monitor",
      "investigate",
      "block",
    ]);
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS]).toEqual([
      "plan",
      "executed",
      "monitor",
      "investigation",
      "block",
      "clear",
    ]);
  });

  it("maps completed=0 / usage=1 / incomplete=2, and blocked=invalid=4", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_EXIT).toEqual({
      COMPLETED: 0,
      USAGE: 1,
      INCOMPLETE: 2,
      BLOCKED: 4,
      INVALID: 4,
    });
  });

  it("folds every plan verdict into a coarse plan class (invalid ⇒ null)", () => {
    const map: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict, string | null> = {
      clear: "clear",
      monitor: "monitor",
      investigate: "investigate",
      "block-release": "block",
      invalid: null,
    };
    for (const [verdict, cls] of Object.entries(map)) {
      expect(planClassForVerdict(verdict as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionPlanVerdict)).toBe(
        cls,
      );
    }
  });

  it("requires plan for every class + the class ack + executed for non-clear classes", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS.clear).toEqual([
      "plan",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS.monitor).toEqual([
      "plan",
      "executed",
      "monitor",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS.investigate).toEqual([
      "plan",
      "executed",
      "investigation",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS.block).toEqual([
      "plan",
      "executed",
      "block",
    ]);
    for (const cls of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES) {
      for (const ack of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS[cls]) {
        expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_ACK_IDS).toContain(ack);
      }
    }
  });

  it("pairs each class with its distinct class ack (clear's is optional); executed is not a class ack", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK.clear).toBe("clear");
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK.monitor).toBe("monitor");
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK.investigate).toBe(
      "investigation",
    );
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK.block).toBe("block");
    // executed / plan are shared checklist acks, NOT class acks (so they are never a contradiction).
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS).not.toContain("executed");
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS).not.toContain("plan");
  });

  it("authors a severity + detail for every reason id and nothing else", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS) {
      const d = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id];
      expect(d.detail.length).toBeGreaterThan(0);
      expect(["informational", "incomplete", "blocking", "invalid"]).toContain(d.severity);
    }
    expect(Object.keys(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL).sort()).toEqual(
      [...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_IDS].sort(),
    );
  });

  it("classifies the fail-closed reasons: unreadable / tampered / plan-invalid are INVALID; block-* are BLOCKING", () => {
    const detail = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL;
    expect(detail["plan-unreadable"].severity).toBe("invalid");
    expect(detail["plan-tampered"].severity).toBe("invalid");
    expect(detail["plan-invalid"].severity).toBe("invalid");
    expect(detail["block-not-acknowledged"].severity).toBe("blocking");
    expect(detail["block-acknowledged"].severity).toBe("blocking");
    expect(detail["acknowledgement-mismatch"].severity).toBe("blocking");
    // monitor / investigation coverage gaps are incomplete (exit 2), never open (Phase 78 has no followup-open).
    expect(detail["monitor-incomplete"].severity).toBe("incomplete");
    expect(detail["investigation-incomplete"].severity).toBe("incomplete");
  });

  it("authors a label for every next-action id and nothing else", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_LABEL[id].length).toBeGreaterThan(0);
    }
    expect(Object.keys(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_LABEL).sort()).toEqual(
      [...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS].sort(),
    );
  });
});
