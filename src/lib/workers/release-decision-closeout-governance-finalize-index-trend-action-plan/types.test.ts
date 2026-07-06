import { describe, expect, it } from "vitest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_EXPECTATIONS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SEVERITIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS,
} from "./types";

describe("release-decision-closeout-governance-finalize-index-trend-action-plan types — bounded vocabulary", () => {
  it("pins the schema tag", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SCHEMA).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-plan/1",
    );
  });

  it("has exactly the five documented verdicts", () => {
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_VERDICTS]).toEqual([
      "clear",
      "monitor",
      "investigate",
      "block-release",
      "invalid",
    ]);
  });

  it("has exactly the four documented urgencies", () => {
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES]).toEqual([
      "routine",
      "soon",
      "high",
      "immediate",
    ]);
  });

  it("maps each verdict to the documented exit code (0/2/3/4, invalid shares 4)", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_EXIT_FOR_VERDICT).toEqual({
      clear: 0,
      investigate: 2,
      monitor: 3,
      "block-release": 4,
      invalid: 4,
    });
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_EXIT.USAGE).toBe(1);
  });

  it("every reason id has an authored detail + severity, and vice versa", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_IDS) {
      const d = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_DETAIL[id];
      expect(d, `reason ${id} needs detail`).toBeDefined();
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_SEVERITIES).toContain(d.severity);
      expect(d.detail.length).toBeGreaterThan(20);
    }
    expect(
      Object.keys(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_DETAIL).sort(),
    ).toEqual([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_IDS].sort());
  });

  it("every action id has an authored label + bounded urgency + expectation, and vice versa", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_IDS) {
      const d = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_DETAIL[id];
      expect(d, `action ${id} needs detail`).toBeDefined();
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_URGENCIES).toContain(d.urgency);
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_EXPECTATIONS).toContain(
        d.expectation,
      );
      expect(d.label.length).toBeGreaterThan(20);
    }
    expect(
      Object.keys(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_DETAIL).sort(),
    ).toEqual([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_ACTION_IDS].sort());
  });

  it("orders reason ids by descending severity (invalid first, informational last)", () => {
    const rank: Record<string, number> = { invalid: 0, blocking: 1, insufficient: 2, advisory: 3, informational: 4 };
    const seq = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_IDS.map(
      (id) => rank[RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_PLAN_REASON_DETAIL[id].severity],
    );
    expect(seq).toEqual([...seq].sort((a, b) => a! - b!));
  });
});
