import { describe, expect, it } from "vitest";
import { buildActionPlanResult } from "../release-decision-action-plan/build";
import { defaultPolicy as planPolicy, trendFor } from "../release-decision-action-plan/fixtures";
import { ingestTrend } from "../release-decision-action-plan/ingest";
import {
  benignMonitorPlan,
  blockedPlan,
  clearPlan,
  investigatePlan,
  notAPlan,
  tamperPlanTopLevel,
  tamperPlanVerdict,
  untrustedTrendPlan,
  watchMonitorPlan,
} from "./fixtures";
import { ingestPlan } from "./ingest";

describe("release-decision-action-receipt ingest — usable plans re-derive", () => {
  it("recognizes each plan class and re-derives its decision", () => {
    const cases: Array<[() => unknown, string, "clear" | "monitor" | "investigate" | "block"]> = [
      [clearPlan, "clear", "clear"],
      [benignMonitorPlan, "monitor", "monitor"],
      [watchMonitorPlan, "monitor", "monitor"],
      [investigatePlan, "investigate", "investigate"],
      [blockedPlan, "block-release", "block"],
    ];
    for (const [build, planVerdict, planClass] of cases) {
      const ingested = ingestPlan(build());
      expect(ingested.recognized, planVerdict).toBe(true);
      expect(ingested.usable, planVerdict).toBe(true);
      expect(ingested.claimedVerdict).toBe(planVerdict);
      expect(ingested.facts?.planClass).toBe(planClass);
      expect(ingested.facts?.planVerdict).toBe(planVerdict);
    }
  });

  it("a benign monitor plan surfaces benignMonitor + a usable source trend verdict", () => {
    const ingested = ingestPlan(benignMonitorPlan());
    expect(ingested.facts?.benignMonitor).toBe(true);
    expect(ingested.facts?.sourceTrendVerdict).toBe("improving");
  });

  it("a plan built over an UNTRUSTWORTHY trend is itself a usable block-class plan (verdict invalid)", () => {
    const ingested = ingestPlan(untrustedTrendPlan());
    expect(ingested.usable).toBe(true);
    expect(ingested.claimedVerdict).toBe("invalid");
    expect(ingested.facts?.planClass).toBe("block");
    // The plan's own source trend was tampered, so there is no trusted source trend verdict to surface.
    expect(ingested.facts?.sourceTrendVerdict).toBeNull();
  });

  it("re-derives a --strict-escalated plan (its recorded strict-escalation position re-derives)", () => {
    const strictPlan = buildActionPlanResult(
      "2026-07-04T00:00:00.000Z",
      ingestTrend(trendFor("watch")),
      planPolicy({ strict: true }),
    );
    expect(strictPlan.verdict).toBe("block-release"); // --strict escalated the watch monitor
    const ingested = ingestPlan(strictPlan);
    expect(ingested.usable).toBe(true);
    expect(ingested.facts?.planClass).toBe("block");
  });

  it("counts the plan's blocking / advisory actions from the RE-DERIVED checklist", () => {
    const ingested = ingestPlan(blockedPlan());
    expect(ingested.facts?.blockingActions).toBeGreaterThan(0);
    expect((ingested.facts?.blockingActions ?? 0) + (ingested.facts?.advisoryActions ?? 0)).toBeGreaterThan(0);
  });
});

describe("release-decision-action-receipt ingest — unrecognized / tampered", () => {
  it("a wrong-schema decoy is unrecognized (⇒ unreadable)", () => {
    const ingested = ingestPlan(notAPlan());
    expect(ingested.recognized).toBe(false);
    expect(ingested.usable).toBe(false);
    expect(ingested.claimedVerdict).toBeNull();
    expect(ingested.facts).toBeNull();
  });

  it("a non-object / null / array input is unrecognized", () => {
    for (const bad of [null, 42, "x", [], true]) {
      expect(ingestPlan(bad).recognized).toBe(false);
    }
  });

  it("a hand-flipped verdict (both headline + rollup) does not re-derive ⇒ tampered", () => {
    const ingested = ingestPlan(tamperPlanVerdict(clearPlan(), "block-release"));
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
    expect(ingested.claimedVerdict).toBe("block-release"); // the untrusted claim is surfaced
    expect(ingested.facts).toBeNull();
  });

  it("a headline flipped away from its own rollup is caught by internal consistency ⇒ tampered", () => {
    const ingested = ingestPlan(tamperPlanTopLevel(clearPlan(), "monitor"));
    expect(ingested.usable).toBe(false);
    // The recorded rollup verdict is still `clear`, so that is the surfaced claim.
    expect(ingested.claimedVerdict).toBe("clear");
  });

  it("a flipped exit code (headline + rollup) does not re-derive ⇒ tampered", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      exitCode: number;
      plan: { exitCode: number };
    };
    clone.exitCode = 4;
    clone.plan.exitCode = 4;
    expect(ingestPlan(clone).usable).toBe(false);
  });

  it("a smuggled source-trend verdict (with the source marked non-usable) is inconsistent ⇒ tampered", () => {
    // untrustedTrendPlan has trend source.state=tampered + sourceTrendVerdict=null; smuggle a verdict in.
    const clone = JSON.parse(JSON.stringify(untrustedTrendPlan())) as Record<string, unknown> & {
      sourceTrendVerdict: string | null;
    };
    clone.sourceTrendVerdict = "stable";
    expect(ingestPlan(clone).usable).toBe(false);
  });

  it("a flipped source trend verdict makes the plan verdict no longer re-derive ⇒ tampered", () => {
    // clearPlan's trend is usable `stable`; changing it to `watch` would make the plan `monitor`, not `clear`.
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      sourceTrendVerdict: string;
    };
    clone.sourceTrendVerdict = "watch";
    expect(ingestPlan(clone).usable).toBe(false);
  });

  it("a policy strict disagreeing with the recorded rollup strict is a tamper", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown> & {
      policy: { strict: boolean };
    };
    clone.policy.strict = true; // the rollup recorded strict=false
    expect(ingestPlan(clone).usable).toBe(false);
  });

  it("a missing plan rollup block is a tamper (corrupt), never usable", () => {
    const clone = JSON.parse(JSON.stringify(clearPlan())) as Record<string, unknown>;
    delete clone.plan;
    const ingested = ingestPlan(clone);
    expect(ingested.recognized).toBe(true);
    expect(ingested.usable).toBe(false);
  });

  it("an off-enum recorded reason id corrupts the rollup ⇒ tampered", () => {
    const clone = JSON.parse(JSON.stringify(watchMonitorPlan())) as Record<string, unknown> & {
      plan: { reasons: unknown[] };
    };
    clone.plan.reasons = [...clone.plan.reasons, "not-a-real-reason"];
    expect(ingestPlan(clone).usable).toBe(false);
  });
});
