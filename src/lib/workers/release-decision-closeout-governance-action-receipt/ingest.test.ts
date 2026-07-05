import { describe, expect, it } from "vitest";
import {
  blockedPlan,
  clearPlan,
  investigatePlan,
  monitorPlan,
  notAPlan,
  rejectInputPlan,
  strictWatchBlockedPlan,
  tamperPlanTopLevel,
  tamperPlanVerdict,
} from "./fixtures";
import { ingestGovernancePlan } from "./ingest";

describe("release-decision-closeout-governance-action-receipt ingest — usable plans re-derive", () => {
  it("recognizes each plan class and re-derives its decision", () => {
    const cases: Array<[() => unknown, string, "clear" | "investigate" | "monitor" | "block"]> = [
      [clearPlan, "clear", "clear"],
      [investigatePlan, "investigate", "investigate"],
      [monitorPlan, "monitor", "monitor"],
      [blockedPlan, "block-release", "block"],
    ];
    for (const [build, planVerdict, planClass] of cases) {
      const ingested = ingestGovernancePlan(build());
      expect(ingested.recognized, planVerdict).toBe(true);
      expect(ingested.usable, planVerdict).toBe(true);
      expect(ingested.claimedVerdict).toBe(planVerdict);
      expect(ingested.facts?.planClass).toBe(planClass);
      expect(ingested.facts?.planVerdict).toBe(planVerdict);
    }
  });

  it("a clear plan surfaces its trusted source trend verdict + latest index posture", () => {
    const ingested = ingestGovernancePlan(clearPlan());
    expect(ingested.facts?.sourceTrendVerdict).toBe("trend-stable");
    expect(ingested.facts?.sourceLatestIndex).toBe("indexed");
    expect(ingested.facts?.planStrictWatch).toBe(false);
  });

  it("a plan built over an UNTRUSTWORTHY trend is itself a usable block-class plan", () => {
    const ingested = ingestGovernancePlan(rejectInputPlan());
    expect(ingested.usable).toBe(true);
    expect(ingested.claimedVerdict).toBe("block-release");
    expect(ingested.facts?.planClass).toBe("block");
    // The plan's own source trend was tampered, so there is no trusted source trend verdict / latest index to surface.
    expect(ingested.facts?.sourceTrendVerdict).toBeNull();
    expect(ingested.facts?.sourceLatestIndex).toBeNull();
  });

  it("re-derives a --strict-watch-escalated plan (its recorded strict-escalation position re-derives)", () => {
    const strictPlan = strictWatchBlockedPlan();
    expect(strictPlan.verdict).toBe("block-release"); // --strict-watch escalated the watch monitor
    const ingested = ingestGovernancePlan(strictPlan);
    expect(ingested.usable).toBe(true);
    expect(ingested.facts?.planClass).toBe("block");
    expect(ingested.facts?.planStrictWatch).toBe(true);
    // The escalated block-release plan is still a usable trend under the hood → its trend verdict surfaces.
    expect(ingested.facts?.sourceTrendVerdict).toBe("trend-watch");
  });

  it("counts the plan's blocking / advisory actions from the RE-DERIVED checklist", () => {
    const ingested = ingestGovernancePlan(blockedPlan());
    expect(ingested.facts?.blockingActions).toBeGreaterThan(0);
    expect((ingested.facts?.blockingActions ?? 0) + (ingested.facts?.advisoryActions ?? 0)).toBeGreaterThan(0);
  });
});

describe("release-decision-closeout-governance-action-receipt ingest — unrecognized / tampered", () => {
  it("a wrong-schema decoy is unrecognized (⇒ unreadable)", () => {
    const ingested = ingestGovernancePlan(notAPlan());
    expect(ingested.recognized).toBe(false);
    expect(ingested.usable).toBe(false);
    expect(ingested.claimedVerdict).toBeNull();
    expect(ingested.facts).toBeNull();
  });

  it("a non-object / null / array input is unrecognized", () => {
    for (const bad of [null, 42, "x", [], true]) {
      expect(ingestGovernancePlan(bad).recognized).toBe(false);
    }
  });

  it("a hand-flipped verdict (both headline + rollup) does not re-derive ⇒ tampered", () => {
    const ingested = ingestGovernancePlan(tamperPlanVerdict(clearPlan(), "block-release"));
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.claimedVerdict).toBe("block-release"); // the untrusted claim is surfaced
    expect(ingested.facts).toBeNull();
  });

  it("a headline flipped away from its own rollup is caught by internal consistency ⇒ tampered", () => {
    const ingested = ingestGovernancePlan(tamperPlanTopLevel(clearPlan(), "monitor"));
    expect(ingested.usable).toBe(false);
    // The recorded rollup verdict is still `clear`, so that is the surfaced claim.
    expect(ingested.claimedVerdict).toBe("clear");
  });

  it("a flipped exit code (headline + rollup) does not re-derive ⇒ tampered", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      exitCode: number;
      governanceActionPlan: { exitCode: number };
    };
    clone.exitCode = 4;
    clone.governanceActionPlan.exitCode = 4;
    expect(ingestGovernancePlan(clone).usable).toBe(false);
  });

  it("a smuggled source-trend verdict (with the source marked non-usable) is inconsistent ⇒ tampered", () => {
    // rejectInputPlan has trend source.state=tampered + sourceTrendVerdict=null; smuggle a verdict in.
    const clone = JSON.parse(JSON.stringify(rejectInputPlan())) as Record<string, unknown> & {
      sourceTrendVerdict: string | null;
    };
    clone.sourceTrendVerdict = "trend-stable";
    expect(ingestGovernancePlan(clone).usable).toBe(false);
  });

  it("a flipped source trend verdict makes the plan verdict no longer re-derive ⇒ tampered", () => {
    // clearPlan's trend is usable `trend-stable`; changing it to `trend-watch` would make the plan `monitor`, not clear.
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      sourceTrendVerdict: string;
    };
    clone.sourceTrendVerdict = "trend-watch";
    expect(ingestGovernancePlan(clone).usable).toBe(false);
  });

  it("a source.claimedVerdict disagreeing with the trusted sourceTrendVerdict is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      source: { claimedVerdict: string };
    };
    clone.source.claimedVerdict = "trend-watch"; // trusted sourceTrendVerdict is still trend-stable
    expect(ingestGovernancePlan(clone).usable).toBe(false);
  });

  it("a policy strictWatch disagreeing with the recorded rollup strictWatch is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      policy: { strictWatch: boolean };
    };
    clone.policy.strictWatch = true; // the rollup recorded strictWatch=false
    expect(ingestGovernancePlan(clone).usable).toBe(false);
  });

  it("a missing governanceActionPlan rollup block is a tamper (corrupt), never usable", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown>;
    delete clone.governanceActionPlan;
    const ingested = ingestGovernancePlan(clone);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
  });

  it("an off-enum recorded reason id corrupts the rollup ⇒ tampered", () => {
    const clone = JSON.parse(JSON.stringify(monitorPlan())) as Record<string, unknown> & {
      governanceActionPlan: { reasons: unknown[] };
    };
    clone.governanceActionPlan.reasons = [...clone.governanceActionPlan.reasons, "not-a-real-reason"];
    expect(ingestGovernancePlan(clone).usable).toBe(false);
  });

  it("a smuggled latest-index posture on a non-usable trend is inconsistent ⇒ tampered", () => {
    const clone = JSON.parse(JSON.stringify(rejectInputPlan())) as Record<string, unknown> & {
      sourceLatestIndex: string | null;
    };
    clone.sourceLatestIndex = "indexed"; // must be null when the trend is not usable
    expect(ingestGovernancePlan(clone).usable).toBe(false);
  });
});
