import { describe, expect, it } from "vitest";
import {
  INDEX_VERDICT_RANK,
  INDEX_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CHECKLIST_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICT_SUMMARY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS,
} from "./types";

describe("governance-index-trend vocabulary — closed + internally consistent", () => {
  it("the verdict→exit map covers every verdict and matches the ladder", () => {
    for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT_FOR_VERDICT[v]).toBeTypeOf("number");
    }
    const E = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT;
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_EXIT_FOR_VERDICT).toEqual({
      "trend-stable": E.STABLE,
      "trend-incomplete": E.INCOMPLETE,
      "trend-watch": E.WATCH,
      "trend-blocked": E.BLOCKED,
    });
    // Monotonic in badness; incomplete (2) sorts BELOW the watch band (3).
    expect(E.STABLE).toBeLessThan(E.INCOMPLETE);
    expect(E.INCOMPLETE).toBeLessThan(E.WATCH);
    expect(E.WATCH).toBeLessThan(E.BLOCKED);
  });

  it("every verdict has an authored one-line summary", () => {
    for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICT_SUMMARY[v].length).toBeGreaterThan(20);
    }
  });

  it("every reason id has a severity + detail; every checklist id has a detail", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS) {
      const d = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_DETAIL[id];
      expect(["informational", "incomplete", "watch", "blocking"]).toContain(d.severity);
      expect(d.detail.length).toBeGreaterThan(20);
    }
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CHECKLIST_IDS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_CHECKLIST_DETAIL[id].length).toBeGreaterThan(20);
    }
  });

  it("each upstream index verdict maps to a severity and a monotonic rank", () => {
    for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS) {
      expect(INDEX_VERDICT_SEVERITY[v]).toBeTypeOf("string");
      expect(INDEX_VERDICT_RANK[v]).toBeTypeOf("number");
    }
    // `indexed` is the cleanest (rank 0, informational); `index-blocked` the worst (blocking).
    expect(INDEX_VERDICT_RANK.indexed).toBe(0);
    expect(INDEX_VERDICT_SEVERITY.indexed).toBe("informational");
    expect(INDEX_VERDICT_SEVERITY["index-blocked"]).toBe("blocking");
    expect(INDEX_VERDICT_RANK["index-blocked"]).toBeGreaterThan(INDEX_VERDICT_RANK["index-open"]);
    expect(INDEX_VERDICT_RANK["index-open"]).toBeGreaterThan(INDEX_VERDICT_RANK["index-incomplete"]);
  });

  it("reason ids are grouped so the four severities are represented", () => {
    const severities = new Set(
      RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_IDS.map(
        (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_REASON_DETAIL[id].severity,
      ),
    );
    expect([...severities].sort()).toEqual(["blocking", "incomplete", "informational", "watch"]);
  });
});
