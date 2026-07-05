import { describe, expect, it } from "vitest";
import { ingestCloseoutTrend } from "./ingest";
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
import { RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS } from "../release-decision-closeout-index-trend/types";

describe("ingestCloseoutTrend — usable trends re-derive their own verdict", () => {
  it("marks a real trend of each verdict recognized + usable, surfacing trusted facts", () => {
    for (const v of RELEASE_DECISION_CLOSEOUT_INDEX_TREND_VERDICTS) {
      const ingested = ingestCloseoutTrend(trendFor(v));
      expect(ingested.recognized, `${v} recognized`).toBe(true);
      expect(ingested.usable, `${v} usable`).toBe(true);
      expect(ingested.verdict).toBe(v);
      expect(ingested.facts?.verdict).toBe(v);
    }
  });

  it("surfaces the latest index verdict + arc direction for a usable trend", () => {
    const stable = ingestCloseoutTrend(stableTrend());
    expect(stable.facts?.latest).toBe("indexed");
    expect(stable.facts?.stable).toBe(true);

    const watch = ingestCloseoutTrend(watchTrend()); // indexed -> open
    expect(watch.facts?.latest).toBe("index-open");
    expect(watch.facts?.direction).toBe("degrading");

    const blocked = ingestCloseoutTrend(blockedTrend()); // indexed -> blocked
    expect(blocked.facts?.latest).toBe("index-blocked");

    const incomplete = ingestCloseoutTrend(incompleteTrend());
    expect(incomplete.facts?.latest).toBe("index-incomplete");
  });
});

describe("ingestCloseoutTrend — fails closed on untrusted input", () => {
  it("an unrecognized document is not recognized (no facts)", () => {
    const ingested = ingestCloseoutTrend(notATrend());
    expect(ingested).toEqual({ recognized: false, usable: false, verdict: null, facts: null });
  });

  it("a non-object / null is unrecognized", () => {
    expect(ingestCloseoutTrend(null).recognized).toBe(false);
    expect(ingestCloseoutTrend(42).recognized).toBe(false);
    expect(ingestCloseoutTrend([stableTrend()]).recognized).toBe(false);
  });

  it("a flipped recorded verdict is a CHECK-B tamper (recognized, not usable, claim surfaced)", () => {
    const tampered = tamperTrendVerdict(stableTrend(), "trend-blocked");
    const ingested = ingestCloseoutTrend(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.verdict).toBe("trend-blocked"); // the untrusted CLAIM
    expect(ingested.facts).toBeNull();
  });

  it("an inflated closeout sum is a CHECK-A tamper (summary disagrees with the sequence)", () => {
    const tampered = tamperTrendSummary(stableTrend()); // totalCloseouts += 5 (rollup still re-derives)
    const ingested = ingestCloseoutTrend(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.verdict).toBe("trend-stable"); // the claimed verdict still re-derives; check A caught the lie
  });

  it("a smuggled inconsistent policy.strictWatch is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
      policy: { strictWatch: boolean };
    };
    clone.policy.strictWatch = true; // disagrees with the recorded rollup.strictWatch=false
    expect(ingestCloseoutTrend(clone).usable).toBe(false);
  });

  it("a missing rollup / summary / points block is a tamper", () => {
    for (const drop of ["closeoutIndexTrend", "summary", "points"]) {
      const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown>;
      delete clone[drop];
      expect(ingestCloseoutTrend(clone).usable, `dropping ${drop}`).toBe(false);
    }
  });

  it("an off-enum reason in the recorded rollup is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
      closeoutIndexTrend: { reasons: string[] };
    };
    clone.closeoutIndexTrend.reasons = ["not-a-real-reason"];
    expect(ingestCloseoutTrend(clone).usable).toBe(false);
  });
});
