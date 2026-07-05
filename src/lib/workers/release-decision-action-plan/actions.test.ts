import { describe, expect, it } from "vitest";
import { buildActions } from "./actions";
import {
  RELEASE_DECISION_ACTION_PLAN_ACTION_IDS,
  type ReleaseDecisionActionPlanActionId,
} from "./types";

/** The set of action ids emitted for a set of fired reasons under `maxActions`. */
function ids(fired: Parameters<typeof buildActions>[0], maxActions = 8): ReleaseDecisionActionPlanActionId[] {
  return buildActions(fired, maxActions).items.map((i) => i.id);
}

describe("release-decision-action-plan actions — ordered, deduped, capped checklist", () => {
  it("a clean stable plan (no reasons) is continue + keep", () => {
    expect(ids([])).toEqual(["continue-decision-cadence", "keep-action-plan"]);
  });

  it("every checklist ends with keep-action-plan (the disclosure step)", () => {
    for (const fired of [[], ["trend-watch"], ["trend-blocked"], ["trend-unreadable"]] as const) {
      const list = ids([...fired]);
      expect(list[list.length - 1]).toBe("keep-action-plan");
    }
  });

  it("folds the block-release actions for a blocked trend", () => {
    expect(ids(["trend-blocked"])).toEqual([
      "reconcile-blocked-window",
      "hold-promotion",
      "re-summarize-after-fix",
      "keep-action-plan",
    ]);
  });

  it("recovers the flagged window for an invalid trend, and rejects the input for a tampered one", () => {
    expect(ids(["trend-invalid"])[0]).toBe("restore-flagged-window");
    expect(ids(["trend-tampered"])[0]).toBe("reject-and-recover-trend");
    expect(ids(["trend-unreadable"])[0]).toBe("reject-and-recover-trend");
  });

  it("emits items in canonical order regardless of the fired-reason order (deduped union)", () => {
    const list = ids(["trend-watch", "strict-escalation"]);
    const canonicalRank = (id: ReleaseDecisionActionPlanActionId) =>
      RELEASE_DECISION_ACTION_PLAN_ACTION_IDS.indexOf(id);
    for (let i = 1; i < list.length; i++) {
      expect(canonicalRank(list[i]!)).toBeGreaterThan(canonicalRank(list[i - 1]!));
    }
    // The strict escalation folds hold-promotion + re-summarize on top of the watch action, deduped.
    expect(new Set(list)).toEqual(
      new Set(["track-watch-followups", "hold-promotion", "re-summarize-after-fix", "keep-action-plan"]),
    );
  });

  it("keeps the highest-priority N under the --max-actions cap and surfaces the drop count", () => {
    const built = buildActions(["trend-blocked"], 2);
    expect(built.items.map((i) => i.id)).toEqual(["reconcile-blocked-window", "hold-promotion"]);
    expect(built.considered).toBe(4);
    expect(built.dropped).toBe(2);
  });

  it("does not drop anything when the cap exceeds the candidate count", () => {
    const built = buildActions(["trend-watch"], 8);
    expect(built.dropped).toBe(0);
    expect(built.considered).toBe(built.items.length);
  });

  it("carries bounded urgency / expectation / blocking on each item, never free text", () => {
    for (const item of buildActions(["trend-blocked"], 8).items) {
      expect(RELEASE_DECISION_ACTION_PLAN_ACTION_IDS).toContain(item.id);
      expect(["none", "low", "medium", "high", "critical"]).toContain(item.urgency);
      expect(["must-complete-before-release", "recommended", "informational"]).toContain(item.expectation);
      expect(item.blocking).toBe(item.expectation === "must-complete-before-release");
      expect(typeof item.label).toBe("string");
    }
  });
});
