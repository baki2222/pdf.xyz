import { describe, expect, it } from "vitest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_COHERENT_REASON,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CONTRADICTION_REASON,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICT_SUMMARY,
} from "./types";

describe("finalize-index-trend-finalize types — bounded vocabularies", () => {
  it("pins the schema id", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SCHEMA).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1",
    );
  });

  it("has exactly the five bounded verdicts and a distinct exit code each", () => {
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS]).toEqual([
      "finalized",
      "finalize-open",
      "finalize-incomplete",
      "finalize-blocked",
      "finalize-invalid",
    ]);
    const E = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT;
    const map = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_EXIT_FOR_VERDICT;
    expect(map.finalized).toBe(E.FINALIZED);
    expect(map["finalize-open"]).toBe(E.OPEN);
    expect(map["finalize-incomplete"]).toBe(E.INCOMPLETE);
    expect(map["finalize-blocked"]).toBe(E.BLOCKED);
    expect(map["finalize-invalid"]).toBe(E.INVALID);
    expect([E.FINALIZED, E.USAGE, E.INCOMPLETE, E.OPEN, E.BLOCKED, E.INVALID]).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it("has the four source-chain kinds ordered shallow → deep", () => {
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS]).toEqual([
      "plan",
      "trend",
      "index",
      "finalization",
    ]);
  });

  it("every reason id has an authored severity + non-empty detail", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_IDS) {
      const d = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_REASON_DETAIL[id];
      expect(d, id).toBeDefined();
      expect(d.detail.length, id).toBeGreaterThan(0);
      expect(["informational", "open", "incomplete", "blocking", "invalid"]).toContain(d.severity);
    }
  });

  it("maps each record kind to its own contradiction + coherent reason", () => {
    for (const kind of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_RECORD_KINDS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_CONTRADICTION_REASON[kind]).toBe(
        `${kind}-contradiction`,
      );
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_COHERENT_REASON[kind]).toBe(
        `${kind}-coherent`,
      );
    }
  });

  it("every verdict + next-action id has authored prose", () => {
    for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICT_SUMMARY[v].length).toBeGreaterThan(0);
    }
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_IDS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_NEXT_ACTION_DETAIL[id].length).toBeGreaterThan(0);
    }
  });
});
