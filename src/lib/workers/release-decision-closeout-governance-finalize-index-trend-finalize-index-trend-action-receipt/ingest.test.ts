import { describe, expect, it } from "vitest";
import {
  blockPlan,
  clearPlan,
  invalidPlan,
  invalidPlanFromTampered,
  investigatePlan,
  monitorPlan,
  notAPlan,
  strictWatchBlockPlan,
  tamperPlanTopLevel,
  tamperPlanVerdict,
} from "./fixtures";
import { ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan } from "./ingest";

describe("finalize-index-trend-finalize-index-trend-action-receipt ingest — usable plans re-derive", () => {
  it("recognizes each closeable plan class and re-derives its decision", () => {
    const cases: Array<[() => unknown, string, "clear" | "monitor" | "investigate" | "block"]> = [
      [clearPlan, "clear", "clear"],
      [monitorPlan, "monitor", "monitor"],
      [investigatePlan, "investigate", "investigate"],
      [blockPlan, "block-release", "block"],
    ];
    for (const [build, planVerdict, planClass] of cases) {
      const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(build());
      expect(ingested.recognized, planVerdict).toBe(true);
      expect(ingested.usable, planVerdict).toBe(true);
      expect(ingested.claimedVerdict).toBe(planVerdict);
      expect(ingested.facts?.planClass).toBe(planClass);
      expect(ingested.facts?.planVerdict).toBe(planVerdict);
    }
  }, 15_000);

  it("a clear plan surfaces its trusted source trend verdict + latest index posture", () => {
    const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(clearPlan());
    expect(ingested.facts?.sourceTrendVerdict).toBe("stable");
    expect(ingested.facts?.sourceLatestIndex).toBe("indexed");
    expect(ingested.facts?.planStrictWatch).toBe(false);
    expect(ingested.facts?.planRequireClean).toBe(false);
  });

  it("a plan whose OWN verdict is `invalid` is a usable plan of the BLOCK class (the release stays held)", () => {
    for (const build of [invalidPlan, invalidPlanFromTampered]) {
      const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(build());
      expect(ingested.usable, build.name).toBe(true);
      expect(ingested.claimedVerdict).toBe("invalid");
      expect(ingested.facts?.planClass).toBe("block");
      expect(ingested.facts?.planVerdict).toBe("invalid");
      // The plan's own source trend was not usable, so there is no trusted source trend verdict / latest to surface.
      expect(ingested.facts?.sourceTrendVerdict).toBeNull();
      expect(ingested.facts?.sourceLatestIndex).toBeNull();
    }
  });

  it("re-derives a --strict-watch-escalated plan (its recorded strict-escalation position re-derives)", () => {
    const strictPlan = strictWatchBlockPlan();
    expect(strictPlan.verdict).toBe("block-release"); // --strict-watch escalated the watch monitor
    const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(strictPlan);
    expect(ingested.usable).toBe(true);
    expect(ingested.facts?.planClass).toBe("block");
    expect(ingested.facts?.planStrictWatch).toBe(true);
    // The escalated block-release plan is still a usable trend under the hood → its trend verdict surfaces.
    expect(ingested.facts?.sourceTrendVerdict).toBe("watch");
  });

  it("counts the plan's blocking / advisory actions from the RE-DERIVED checklist", () => {
    const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(blockPlan());
    expect(ingested.facts?.blockingActions).toBeGreaterThan(0);
    expect((ingested.facts?.blockingActions ?? 0) + (ingested.facts?.advisoryActions ?? 0)).toBeGreaterThan(0);
  });
});

describe("finalize-index-trend-finalize-index-trend-action-receipt ingest — unrecognized / tampered", () => {
  it("a wrong-schema decoy is unrecognized (⇒ unreadable)", () => {
    const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(notAPlan());
    expect(ingested.recognized).toBe(false);
    expect(ingested.usable).toBe(false);
    expect(ingested.claimedVerdict).toBeNull();
    expect(ingested.facts).toBeNull();
  });

  it("a non-object / null / array input is unrecognized", () => {
    for (const bad of [null, 42, "x", [], true]) {
      expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(bad).recognized).toBe(false);
    }
  });

  it("a hand-flipped verdict (both headline + rollup) does not re-derive ⇒ tampered", () => {
    const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(tamperPlanVerdict(clearPlan(), "block-release"));
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.claimedVerdict).toBe("block-release"); // the untrusted claim is surfaced
    expect(ingested.facts).toBeNull();
  });

  it("a headline flipped away from its own rollup is caught by internal consistency ⇒ tampered", () => {
    const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(tamperPlanTopLevel(clearPlan(), "monitor"));
    expect(ingested.usable).toBe(false);
    // The recorded rollup verdict is still `clear`, so that is the surfaced claim.
    expect(ingested.claimedVerdict).toBe("clear");
  });

  it("a flipped exit code (headline + rollup) does not re-derive ⇒ tampered", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      exitCode: number;
      actionPlan: { exitCode: number };
    };
    clone.exitCode = 4;
    clone.actionPlan.exitCode = 4;
    expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(clone).usable).toBe(false);
  });

  it("a smuggled source-trend verdict (with the source marked non-usable) is inconsistent ⇒ tampered", () => {
    // invalidPlanFromTampered has trend source.state=tampered + sourceTrendVerdict=null; smuggle a verdict in.
    const clone = JSON.parse(JSON.stringify(invalidPlanFromTampered())) as Record<string, unknown> & {
      sourceTrendVerdict: string | null;
    };
    clone.sourceTrendVerdict = "stable";
    expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(clone).usable).toBe(false);
  });

  it("a flipped source trend verdict makes the plan verdict no longer re-derive ⇒ tampered", () => {
    // clearPlan's trend is usable `stable`; changing it to `watch` would make the plan `monitor`, not clear.
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      sourceTrendVerdict: string;
    };
    clone.sourceTrendVerdict = "watch";
    expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(clone).usable).toBe(false);
  });

  it("a source.claimedVerdict disagreeing with the trusted sourceTrendVerdict is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      source: { claimedVerdict: string };
    };
    clone.source.claimedVerdict = "watch"; // trusted sourceTrendVerdict is still stable
    expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(clone).usable).toBe(false);
  });

  it("a policy strictWatch / requireClean disagreeing with the recorded rollup is a tamper", () => {
    const sw = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      policy: { strictWatch: boolean; requireClean: boolean };
    };
    sw.policy.strictWatch = true; // the rollup recorded strictWatch=false
    expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(sw).usable).toBe(false);

    const rc = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      policy: { strictWatch: boolean; requireClean: boolean };
    };
    rc.policy.requireClean = true; // the rollup recorded requireClean=false
    expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(rc).usable).toBe(false);
  });

  it("a missing actionPlan rollup block is a tamper (corrupt), never usable", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown>;
    delete clone.actionPlan;
    const ingested = ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(clone);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
  });

  it("an off-enum recorded reason id corrupts the rollup ⇒ tampered", () => {
    const clone = JSON.parse(JSON.stringify(monitorPlan())) as Record<string, unknown> & {
      actionPlan: { reasons: unknown[] };
    };
    clone.actionPlan.reasons = [...clone.actionPlan.reasons, "not-a-real-reason"];
    expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(clone).usable).toBe(false);
  });

  it("a smuggled latest-index posture on a non-usable trend is inconsistent ⇒ tampered", () => {
    const clone = JSON.parse(JSON.stringify(invalidPlanFromTampered())) as Record<string, unknown> & {
      sourceLatestIndex: string | null;
    };
    clone.sourceLatestIndex = "indexed"; // must be null when the trend is not usable
    expect(ingestFinalizeIndexTrendFinalizeIndexTrendActionPlan(clone).usable).toBe(false);
  });
});
