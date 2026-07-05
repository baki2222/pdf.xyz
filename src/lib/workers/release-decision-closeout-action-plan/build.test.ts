import { describe, expect, it } from "vitest";
import { buildCloseoutActionPlanResult } from "./build";
import { NOW, defaultPolicy, ingestTrendObj, notATrend, tamperedTrend, watchTrend } from "./fixtures";
import { stableTrend } from "./fixtures";

function build(obj: unknown, strictWatch = false) {
  return buildCloseoutActionPlanResult(NOW, ingestTrendObj(obj), defaultPolicy({ strictWatch }));
}

describe("buildCloseoutActionPlanResult — full result assembly", () => {
  it("stamps its OWN time + schema + pinned upstream trend schema", () => {
    const r = build(stableTrend());
    expect(r.schema).toBe("pdfxyz.release-decision-closeout-action-plan/1");
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata.trendSchema).toBe("pdfxyz.release-decision-closeout-index-trend/1");
    expect(r.metadata.policyId).toBe("pdfxyz-worker-release-decision-closeout-action-plan");
  });

  it("surfaces the trusted source facets for a usable trend", () => {
    const r = build(watchTrend()); // indexed -> open
    expect(r.sourceTrendVerdict).toBe("trend-watch");
    expect(r.sourceLatestIndex).toBe("index-open");
    expect(r.sourceArcDirection).toBe("degrading");
    expect(r.sourceTrendClass).toBe("watch-present");
    expect(r.source.state).toBe("usable");
    expect(r.source.claimedVerdict).toBe("trend-watch");
    expect(r.verdict).toBe("monitor");
  });

  it("nulls the trusted facets for an unreadable trend but keeps the block-release verdict", () => {
    const r = build(notATrend());
    expect(r.verdict).toBe("block-release");
    expect(r.sourceTrendVerdict).toBeNull();
    expect(r.sourceTrendClass).toBeNull();
    expect(r.sourceArcDirection).toBeNull();
    expect(r.sourceLatestIndex).toBeNull();
    expect(r.source.state).toBe("unreadable");
    expect(r.source.claimedVerdict).toBeNull();
  });

  it("for a tampered trend surfaces the untrusted CLAIM in source but nulls the trusted facets", () => {
    const r = build(tamperedTrend());
    expect(r.verdict).toBe("block-release");
    expect(r.source.state).toBe("tampered");
    expect(r.source.claimedVerdict).toBe("trend-blocked"); // untrusted claim
    expect(r.sourceTrendVerdict).toBeNull(); // no trusted verdict surfaced
    expect(r.sourceLatestIndex).toBeNull();
  });

  it("mirrors the rollup exit code onto the top-level result + carries guidance + caveats", () => {
    const r = build(stableTrend());
    expect(r.exitCode).toBe(r.closeoutActionPlan.exitCode);
    expect(r.exitCode).toBe(0);
    expect(r.guidance.length).toBeGreaterThan(0);
    expect(r.caveats.length).toBeGreaterThan(0);
  });

  it("is deterministic: same trend + stamp + policy → byte-identical result", () => {
    expect(JSON.stringify(build(watchTrend()))).toBe(JSON.stringify(build(watchTrend())));
  });

  it("--strict-watch turns a monitor into a block-release, but never a stable into anything but clear", () => {
    expect(build(watchTrend(), true).verdict).toBe("block-release");
    expect(build(stableTrend(), true).verdict).toBe("clear");
  });
});
