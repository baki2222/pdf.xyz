import { describe, expect, it } from "vitest";
import { ingestGovernanceTrend } from "./ingest";
import {
  blockedTrend,
  incompleteTrend,
  notATrend,
  stableTrend,
  tamperTrendSummary,
  tamperTrendVerdict,
  trendFor,
  watchTrend,
} from "./fixtures";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS } from "../release-decision-closeout-governance-index-trend/types";

describe("ingestGovernanceTrend — usable trends re-derive their own verdict", () => {
  it("marks a real trend of each verdict recognized + usable, surfacing trusted facts", () => {
    for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_TREND_VERDICTS) {
      const ingested = ingestGovernanceTrend(trendFor(v));
      expect(ingested.recognized, `${v} recognized`).toBe(true);
      expect(ingested.usable, `${v} usable`).toBe(true);
      expect(ingested.verdict).toBe(v);
      expect(ingested.facts?.verdict).toBe(v);
    }
  });

  it("surfaces the latest governance-index verdict + arc direction for a usable trend", () => {
    const stable = ingestGovernanceTrend(stableTrend());
    expect(stable.facts?.latest).toBe("indexed");
    expect(stable.facts?.stable).toBe(true);

    const watch = ingestGovernanceTrend(watchTrend()); // indexed -> open
    expect(watch.facts?.latest).toBe("index-open");
    expect(watch.facts?.direction).toBe("degrading");

    const blocked = ingestGovernanceTrend(blockedTrend()); // indexed -> blocked
    expect(blocked.facts?.latest).toBe("index-blocked");

    const incomplete = ingestGovernanceTrend(incompleteTrend());
    expect(incomplete.facts?.latest).toBe("index-incomplete");
  });
});

describe("ingestGovernanceTrend — fails closed on untrusted input", () => {
  it("an unrecognized document is not recognized (no facts)", () => {
    const ingested = ingestGovernanceTrend(notATrend());
    expect(ingested).toEqual({ recognized: false, usable: false, verdict: null, facts: null });
  });

  it("a non-object / null is unrecognized", () => {
    expect(ingestGovernanceTrend(null).recognized).toBe(false);
    expect(ingestGovernanceTrend(42).recognized).toBe(false);
    expect(ingestGovernanceTrend([stableTrend()]).recognized).toBe(false);
  });

  it("a flipped recorded verdict is a CHECK-B tamper (recognized, not usable, claim surfaced)", () => {
    const tampered = tamperTrendVerdict(stableTrend(), "trend-blocked");
    const ingested = ingestGovernanceTrend(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.verdict).toBe("trend-blocked"); // the untrusted CLAIM
    expect(ingested.facts).toBeNull();
  });

  it("an inflated governance sum is a CHECK-A tamper (summary disagrees with the sequence)", () => {
    const tampered = tamperTrendSummary(stableTrend()); // totalGovernance += 5 (rollup still re-derives)
    const ingested = ingestGovernanceTrend(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.verdict).toBe("trend-stable"); // the claimed verdict still re-derives; check A caught the lie
  });

  it("a smuggled inconsistent policy.strictWatch is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
      policy: { strictWatch: boolean };
    };
    clone.policy.strictWatch = true; // disagrees with the recorded rollup.strictWatch=false
    expect(ingestGovernanceTrend(clone).usable).toBe(false);
  });

  it("a missing rollup / summary / points block is a tamper", () => {
    for (const drop of ["governanceIndexTrend", "summary", "points"]) {
      const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown>;
      delete clone[drop];
      expect(ingestGovernanceTrend(clone).usable, `dropping ${drop}`).toBe(false);
    }
  });

  it("an off-enum reason in the recorded rollup is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
      governanceIndexTrend: { reasons: string[] };
    };
    clone.governanceIndexTrend.reasons = ["not-a-real-reason"];
    expect(ingestGovernanceTrend(clone).usable).toBe(false);
  });
});
