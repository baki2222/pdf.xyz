import { describe, expect, it } from "vitest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_LABEL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  planClassForVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanVerdict,
} from "./types";

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt types — bounded vocabulary", () => {
  it("pins the schema tag + verdict / plan-class / ack sets", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_SCHEMA).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt/1",
    );
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS]).toEqual([
      "completed",
      "incomplete",
      "followup-open",
      "blocked",
      "invalid",
    ]);
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES]).toEqual([
      "clear",
      "monitor",
      "investigate",
      "block",
    ]);
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS]).toEqual([
      "plan",
      "clear",
      "monitor",
      "investigation",
      "block",
    ]);
  });

  it("maps completed=0 / usage=1 / incomplete=2 / followup-open=3, and blocked=invalid=4", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_EXIT).toEqual({
      COMPLETED: 0,
      USAGE: 1,
      INCOMPLETE: 2,
      FOLLOWUP_OPEN: 3,
      BLOCKED: 4,
      INVALID: 4,
    });
  });

  it("folds every plan verdict into a coarse plan class (block-release AND invalid ⇒ block)", () => {
    const map: Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanVerdict, string> = {
      clear: "clear",
      monitor: "monitor",
      investigate: "investigate",
      "block-release": "block",
      invalid: "block",
    };
    for (const [verdict, cls] of Object.entries(map)) {
      expect(planClassForVerdict(verdict as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendActionPlanVerdict)).toBe(
        cls,
      );
    }
  });

  it("requires plan + the class ack for every class", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS.clear).toEqual([
      "plan",
      "clear",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS.monitor).toEqual([
      "plan",
      "monitor",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS.investigate).toEqual([
      "plan",
      "investigation",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS.block).toEqual([
      "plan",
      "block",
    ]);
    for (const cls of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES) {
      for (const ack of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REQUIRED_ACKS[cls]) {
        expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_ACK_IDS).toContain(ack);
      }
    }
  });

  it("pairs each class with its distinct class ack; plan is the shared review ack, never a class ack", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK.clear).toBe("clear");
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK.monitor).toBe("monitor");
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK.investigate).toBe(
      "investigation",
    );
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACK.block).toBe("block");
    // Every class has exactly one class ack (clear included); `plan` is the shared review ack, never a class ack.
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS]).toEqual([
      "clear",
      "monitor",
      "investigation",
      "block",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_CLASS_ACKS).not.toContain("plan");
  });

  it("authors a severity + detail for every reason id and nothing else", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_IDS) {
      const d = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL[id];
      expect(d.detail.length).toBeGreaterThan(0);
      expect(["informational", "incomplete", "open", "blocking", "invalid"]).toContain(d.severity);
    }
    expect(Object.keys(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL).sort()).toEqual(
      [...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_IDS].sort(),
    );
  });

  it("classifies the reasons: unreadable / tampered are INVALID; block-not-acknowledged / mismatch are BLOCKING; block-acknowledged is INFORMATIONAL; monitor / investigation open are OPEN", () => {
    const detail = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_REASON_DETAIL;
    expect(detail["plan-unreadable"].severity).toBe("invalid");
    expect(detail["plan-tampered"].severity).toBe("invalid");
    expect(detail["block-not-acknowledged"].severity).toBe("blocking");
    expect(detail["acknowledgement-mismatch"].severity).toBe("blocking");
    expect(detail["strict-open-escalation"].severity).toBe("blocking");
    expect(detail["block-acknowledged"].severity).toBe("informational");
    expect(detail["block-acknowledgement-incomplete"].severity).toBe("incomplete");
    expect(detail["monitor-followup-open"].severity).toBe("open");
    expect(detail["investigation-open"].severity).toBe("open");
  });

  it("authors a label for every next-action id and nothing else", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_LABEL[id].length).toBeGreaterThan(0);
    }
    expect(Object.keys(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_LABEL).sort()).toEqual(
      [...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_NEXT_ACTION_IDS].sort(),
    );
  });
});
