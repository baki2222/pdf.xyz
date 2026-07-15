import { describe, expect, it } from "vitest";
import { buildCloseoutIndexTrendActionPlanResult } from "./build";
import {
  NOW,
  defaultPolicy,
  degradingTrend,
  ingestTrendObj,
  notATrend,
  stableTrend,
  tamperedTrend,
} from "./fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy } from "./types";

function build(
  obj: unknown,
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy> = {},
) {
  return buildCloseoutIndexTrendActionPlanResult(NOW, ingestTrendObj(obj), defaultPolicy(over));
}

describe("buildCloseoutIndexTrendActionPlanResult — full result assembly", () => {
  it("stamps its OWN time + schema + pinned upstream trend schema", () => {
    const r = build(stableTrend());
    expect(r.schema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1");
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata.trendSchema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1");
    expect(r.metadata.policyId).toBe(
      "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-plan",
    );
  }, 15_000);

  it("surfaces the trusted source facets for a usable (degrading) trend", () => {
    const r = build(degradingTrend()); // indexed -> open
    expect(r.sourceTrendVerdict).toBe("degrading");
    expect(r.sourceLatestIndex).toBe("open");
    expect(r.sourceArcDirection).toBe("degrading");
    expect(r.sourceTrendClass).toBe("regressing");
    expect(r.source.state).toBe("usable");
    expect(r.source.claimedVerdict).toBe("degrading");
    expect(r.verdict).toBe("monitor");
    expect(r.urgency).toBe("high");
  });

  it("nulls the trusted facets for an unreadable trend but keeps the invalid verdict", () => {
    const r = build(notATrend());
    expect(r.verdict).toBe("invalid");
    expect(r.sourceTrendVerdict).toBeNull();
    expect(r.sourceTrendClass).toBeNull();
    expect(r.sourceArcDirection).toBeNull();
    expect(r.sourceLatestIndex).toBeNull();
    expect(r.source.state).toBe("unreadable");
    expect(r.source.claimedVerdict).toBeNull();
  });

  it("for a tampered trend surfaces the untrusted CLAIM in source but nulls the trusted facets", () => {
    const r = build(tamperedTrend());
    expect(r.verdict).toBe("invalid");
    expect(r.source.state).toBe("tampered");
    expect(r.source.claimedVerdict).toBe("blocked"); // untrusted claim
    expect(r.sourceTrendVerdict).toBeNull(); // no trusted verdict surfaced
    expect(r.sourceLatestIndex).toBeNull();
  });

  it("mirrors the rollup exit code onto the top-level result + carries guidance + caveats", () => {
    const r = build(stableTrend());
    expect(r.exitCode).toBe(r.actionPlan.exitCode);
    expect(r.exitCode).toBe(0);
    expect(r.guidance.length).toBeGreaterThan(0);
    expect(r.caveats.length).toBeGreaterThan(0);
  });

  it("keeps `nextActions` a compact id view of the `plan` checklist + records the max-actions accounting", () => {
    const r = build(degradingTrend());
    expect(r.nextActions).toEqual(r.plan.map((i) => i.id));
    expect(r.plan.every((i) => typeof i.label === "string" && i.label.length > 0)).toBe(true);
    expect(r.plan[r.plan.length - 1]!.id).toBe("keep-action-plan");
    expect(r.maxActions).toBe(8);
    expect(r.actionsConsidered).toBe(r.plan.length + r.actionsDropped);
    expect(r.actionsDropped).toBe(0); // default cap is generous
  });

  it("--max-actions caps the emitted checklist and surfaces the dropped count (never silent)", () => {
    const r = build(degradingTrend(), { maxActions: 1 });
    expect(r.plan).toHaveLength(1);
    expect(r.maxActions).toBe(1);
    expect(r.actionsDropped).toBeGreaterThan(0);
    expect(r.receipt.actionsEmitted).toBe(1);
    expect(r.receipt.actionsDropped).toBe(r.actionsDropped);
  });

  it("is deterministic: same trend + stamp + policy → byte-identical result", () => {
    expect(JSON.stringify(build(degradingTrend()))).toBe(JSON.stringify(build(degradingTrend())));
  });

  it("--strict turns a monitor / investigate into a block-release, but leaves a stable clear", () => {
    expect(build(degradingTrend(), { strict: true }).verdict).toBe("block-release");
    expect(build(stableTrend(), { strict: true }).verdict).toBe("clear");
  });
});
