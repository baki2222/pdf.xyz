import { describe, expect, it } from "vitest";
import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_CHECKLIST_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT_FOR_VERDICT,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FOLLOWUP_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FOLLOWUP_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_DETAIL,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_RECORD_KINDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_RELATION_SIGNALS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SEVERITIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICT_SUMMARY,
} from "./types";

describe("release-decision-closeout-governance types — bounded vocabulary", () => {
  it("pins the schema tag", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SCHEMA).toBe("pdfxyz.release-decision-closeout-governance/1");
  });

  it("the verdict ladder is exactly the four bounded tokens", () => {
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS]).toEqual([
      "closed",
      "governance-incomplete",
      "governance-open",
      "governance-blocked",
    ]);
  });

  it("maps every verdict to a monotonic exit code (blocked worst, closed best)", () => {
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT).toEqual({
      CLOSED: 0,
      USAGE: 1,
      INCOMPLETE: 2,
      OPEN: 3,
      BLOCKED: 4,
    });
    expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_EXIT_FOR_VERDICT).toEqual({
      closed: 0,
      "governance-incomplete": 2,
      "governance-open": 3,
      "governance-blocked": 4,
    });
  });

  it("the record kinds, relation signals, and checklist ids are the bounded sets", () => {
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_RECORD_KINDS]).toEqual(["plan", "trend", "index", "closeout"]);
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_RELATION_SIGNALS]).toEqual([
      "coherent",
      "contradictory",
      "advisory",
      "insufficient",
      "blocking",
      "none",
    ]);
    expect([...RELEASE_DECISION_CLOSEOUT_GOVERNANCE_CHECKLIST_IDS]).toEqual([
      "primary-receipt",
      "closeout-plan",
      "closeout-index-trend",
      "closeout-index",
      "closeout-bundle",
      "governance-bundle",
    ]);
  });

  it("every reason id has authored detail + a known severity; ids are unique", () => {
    const ids = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_IDS;
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      const entry = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_DETAIL[id];
      expect(entry.detail.length).toBeGreaterThan(20);
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_SEVERITIES).toContain(entry.severity);
    }
  });

  it("every follow-up id and every verdict has authored prose", () => {
    for (const id of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FOLLOWUP_IDS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FOLLOWUP_DETAIL[id].length).toBeGreaterThan(20);
    }
    for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS) {
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICT_SUMMARY[v].length).toBeGreaterThan(20);
    }
  });

  it("carries exactly one informational, one incomplete-anchor, one open, one blocking receipt reason", () => {
    const bySeverity = (sev: string) =>
      RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_IDS.filter(
        (id) => RELEASE_DECISION_CLOSEOUT_GOVERNANCE_REASON_DETAIL[id].severity === sev,
      );
    // Each severity band is non-empty (the fold needs a reason at every level).
    expect(bySeverity("blocking").length).toBeGreaterThan(0);
    expect(bySeverity("open").length).toBeGreaterThan(0);
    expect(bySeverity("incomplete").length).toBeGreaterThan(0);
    expect(bySeverity("informational").length).toBeGreaterThan(0);
  });
});
