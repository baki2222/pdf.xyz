import { describe, expect, it } from "vitest";
import {
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_ACK_IDS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACK,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACKS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REQUIRED_ACKS,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICTS,
  planClassForVerdict,
  type ReleaseDecisionCloseoutActionPlanVerdict,
} from "./types";

describe("release-decision-closeout-action-receipt types — bounded vocabulary", () => {
  it("pins the schema tag + verdict / plan-class / ack sets", () => {
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_SCHEMA).toBe(
      "pdfxyz.release-decision-closeout-action-receipt/1",
    );
    expect([...RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICTS]).toEqual([
      "completed",
      "incomplete",
      "followup-open",
      "blocked",
    ]);
    expect([...RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_PLAN_CLASSES]).toEqual([
      "clear",
      "investigate",
      "monitor",
      "block",
    ]);
    expect([...RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_ACK_IDS]).toEqual([
      "plan",
      "executed",
      "monitor",
      "investigation",
      "block",
    ]);
  });

  it("maps each verdict to a monotonic exit code", () => {
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_EXIT).toEqual({
      COMPLETED: 0,
      USAGE: 1,
      INCOMPLETE: 2,
      FOLLOWUP_OPEN: 3,
      BLOCKED: 4,
    });
  });

  it("folds every plan verdict into a coarse plan class", () => {
    const map: Record<ReleaseDecisionCloseoutActionPlanVerdict, string> = {
      clear: "clear",
      investigate: "investigate",
      monitor: "monitor",
      "block-release": "block",
    };
    for (const [verdict, cls] of Object.entries(map)) {
      expect(planClassForVerdict(verdict as ReleaseDecisionCloseoutActionPlanVerdict)).toBe(cls);
    }
  });

  it("requires plan for every class + the class ack + executed for non-clear classes", () => {
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REQUIRED_ACKS.clear).toEqual(["plan"]);
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REQUIRED_ACKS.investigate).toEqual([
      "plan",
      "executed",
      "investigation",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REQUIRED_ACKS.monitor).toEqual([
      "plan",
      "executed",
      "monitor",
    ]);
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REQUIRED_ACKS.block).toEqual([
      "plan",
      "executed",
      "block",
    ]);
    // Every required ack is a real ack id.
    for (const cls of RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_PLAN_CLASSES) {
      for (const ack of RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REQUIRED_ACKS[cls]) {
        expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_ACK_IDS).toContain(ack);
      }
    }
  });

  it("pairs each non-clear class with its distinct class ack (clear has none)", () => {
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACK.clear).toBeNull();
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACK.investigate).toBe("investigation");
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACK.monitor).toBe("monitor");
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACK.block).toBe("block");
    // executed is a shared checklist ack, NOT a class ack (so it is never a contradiction).
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_CLASS_ACKS).not.toContain("executed");
  });

  it("authors a severity + detail for every reason id and nothing else", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_IDS) {
      const d = RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL[id];
      expect(d.detail.length).toBeGreaterThan(0);
      expect(["informational", "incomplete", "open", "blocking"]).toContain(d.severity);
    }
    expect(Object.keys(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL).sort()).toEqual(
      [...RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_IDS].sort(),
    );
  });

  it("classifies the unreadable + tampered plan reasons as BLOCKING (Phase 68 fails closed)", () => {
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL["plan-unreadable"].severity).toBe(
      "blocking",
    );
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL["plan-tampered"].severity).toBe(
      "blocking",
    );
    // investigate coverage gap is incomplete (exit 2), while a monitor follow-up is open (exit 3).
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL["investigation-incomplete"].severity).toBe(
      "incomplete",
    );
    expect(RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_REASON_DETAIL["monitor-followup-open"].severity).toBe(
      "open",
    );
  });
});
