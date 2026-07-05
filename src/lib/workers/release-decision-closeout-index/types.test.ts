import { describe, expect, it } from "vitest";
import {
  RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_DETAIL,
  RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_EXIT,
  RELEASE_DECISION_CLOSEOUT_INDEX_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_INDEX_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_INDEX_VERDICT_SUMMARY,
  releaseDecisionCloseoutIndexExitCode,
} from "./types";
import { makeIndex, closedCloseout } from "./fixtures";

describe("closeout-index vocabulary invariants", () => {
  it("verdict → exit is the documented ladder", () => {
    expect(RELEASE_DECISION_CLOSEOUT_INDEX_EXIT_FOR_VERDICT).toEqual({
      indexed: RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.INDEXED,
      "index-incomplete": RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.INCOMPLETE,
      "index-open": RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.OPEN,
      "index-blocked": RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.BLOCKED,
    });
    expect([
      RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.INDEXED,
      RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.USAGE,
      RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.INCOMPLETE,
      RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.OPEN,
      RELEASE_DECISION_CLOSEOUT_INDEX_EXIT.BLOCKED,
    ]).toEqual([0, 1, 2, 3, 4]);
  });

  it("every verdict has an authored summary", () => {
    for (const v of RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS) {
      expect(RELEASE_DECISION_CLOSEOUT_INDEX_VERDICT_SUMMARY[v]).toBeTruthy();
    }
  });

  it("every reason id has an authored severity + detail", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS) {
      const d = RELEASE_DECISION_CLOSEOUT_INDEX_REASON_DETAIL[id];
      expect(d.detail.length).toBeGreaterThan(20);
      expect(["informational", "incomplete", "open", "blocking"]).toContain(d.severity);
    }
  });

  it("every checklist id has an authored detail", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_IDS) {
      expect(RELEASE_DECISION_CLOSEOUT_INDEX_CHECKLIST_DETAIL[id].length).toBeGreaterThan(20);
    }
  });

  it("releaseDecisionCloseoutIndexExitCode reads the rollup exit", () => {
    expect(releaseDecisionCloseoutIndexExitCode(makeIndex([closedCloseout()]))).toBe(0);
  });
});
