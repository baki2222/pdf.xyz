import { describe, expect, it } from "vitest";
import { ingestCloseoutIndexTrend } from "./ingest";
import {
  blockedTrend,
  degradingTrend,
  improvingTrend,
  insufficientTrend,
  invalidHistoryTrend,
  notATrend,
  stableTrend,
  tamperTrendSummary,
  tamperTrendVerdict,
  trendFor,
  watchTrend,
} from "./fixtures";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/types";

describe("ingestCloseoutIndexTrend — usable trends re-derive their own verdict", () => {
  // Building all seven real trends drives the whole evidence chain (~1s each); allow generously for the first pass.
  it("marks a real trend of each verdict recognized + usable, surfacing trusted facts", () => {
    for (const v of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_VERDICTS) {
      const ingested = ingestCloseoutIndexTrend(trendFor(v));
      expect(ingested.recognized, `${v} recognized`).toBe(true);
      expect(ingested.usable, `${v} usable`).toBe(true);
      expect(ingested.verdict).toBe(v);
      expect(ingested.facts?.verdict).toBe(v);
    }
  }, 30_000);

  it("surfaces the latest closeout-index verdict + arc direction + clean flag for a usable trend", () => {
    const stable = ingestCloseoutIndexTrend(stableTrend());
    expect(stable.facts?.latest).toBe("indexed");
    expect(stable.facts?.clean).toBe(true);
    expect(stable.facts?.direction).toBe("stable");

    const improving = ingestCloseoutIndexTrend(improvingTrend()); // open -> indexed
    expect(improving.facts?.latest).toBe("indexed");
    expect(improving.facts?.direction).toBe("improving");
    expect(improving.facts?.clean).toBe(true);

    const degrading = ingestCloseoutIndexTrend(degradingTrend()); // indexed -> open
    expect(degrading.facts?.latest).toBe("index-open");
    expect(degrading.facts?.direction).toBe("degrading");
    expect(degrading.facts?.clean).toBe(false);

    const watch = ingestCloseoutIndexTrend(watchTrend()); // indexed -> open -> indexed
    expect(watch.facts?.latest).toBe("indexed");

    const blocked = ingestCloseoutIndexTrend(blockedTrend()); // indexed -> blocked
    expect(blocked.facts?.latest).toBe("index-blocked");

    const insufficient = ingestCloseoutIndexTrend(insufficientTrend());
    expect(insufficient.facts?.latest).toBe("index-incomplete");

    const invalid = ingestCloseoutIndexTrend(invalidHistoryTrend()); // indexed + tampered window
    expect(invalid.facts?.verdict).toBe("invalid");
    expect(invalid.facts?.indexesUsable).toBe(1); // only the indexed window is usable
  });
});

describe("ingestCloseoutIndexTrend — fails closed on untrusted input", () => {
  it("an unrecognized document is not recognized (no facts)", () => {
    const ingested = ingestCloseoutIndexTrend(notATrend());
    expect(ingested).toEqual({ recognized: false, usable: false, verdict: null, facts: null });
  });

  it("a non-object / null / array is unrecognized", () => {
    expect(ingestCloseoutIndexTrend(null).recognized).toBe(false);
    expect(ingestCloseoutIndexTrend(42).recognized).toBe(false);
    expect(ingestCloseoutIndexTrend([stableTrend()]).recognized).toBe(false);
  });

  it("a flipped recorded top-level verdict is a CHECK-B tamper (recognized, not usable, claim surfaced)", () => {
    const tampered = tamperTrendVerdict(stableTrend(), "blocked");
    const ingested = ingestCloseoutIndexTrend(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.verdict).toBe("blocked"); // the untrusted CLAIM
    expect(ingested.facts).toBeNull();
  });

  it("a mismatched recorded exit code (verdict left intact) is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & { exitCode: number };
    clone.exitCode = 4; // stable is exit 0; the mismatch is a tamper
    expect(ingestCloseoutIndexTrend(clone).usable).toBe(false);
  });

  it("an inflated closeout sum is a CHECK-A tamper (summary disagrees with the sequence)", () => {
    const tampered = tamperTrendSummary(stableTrend()); // totalConsidered += 5 (rollup still re-derives)
    const ingested = ingestCloseoutIndexTrend(tampered);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.verdict).toBe("stable"); // the claimed verdict still re-derives; check A caught the lie
  });

  it("a smuggled policy that would change a --strict-watch escalation is a tamper", () => {
    // degradingTrend has an open latest; flipping policy.strictWatch to true would re-derive `blocked`, not `degrading`.
    const clone = JSON.parse(JSON.stringify(degradingTrend())) as Record<string, unknown> & {
      policy: { strictWatch: boolean };
    };
    clone.policy.strictWatch = true;
    expect(ingestCloseoutIndexTrend(clone).usable).toBe(false);
  });

  it("a missing coverage / windowDistribution / trend / points / reasons block is a tamper", () => {
    for (const drop of ["coverage", "windowDistribution", "closeoutDistribution", "trend", "points", "reasons"]) {
      const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown>;
      delete clone[drop];
      expect(ingestCloseoutIndexTrend(clone).usable, `dropping ${drop}`).toBe(false);
    }
  });

  it("an off-enum reason id in the recorded reasons is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
      reasons: { id: string; severity: string }[];
    };
    clone.reasons = [{ id: "not-a-real-reason", severity: "informational" }];
    expect(ingestCloseoutIndexTrend(clone).usable).toBe(false);
  });

  it("a recorded reason carrying the wrong severity is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(stableTrend())) as Record<string, unknown> & {
      reasons: { id: string; severity: string }[];
    };
    // A stable trend's reasons are all authored `informational`; a smuggled `blocking` severity disagrees with authored.
    if (clone.reasons[0]) clone.reasons[0].severity = "blocking";
    expect(ingestCloseoutIndexTrend(clone).usable).toBe(false);
  });
});
