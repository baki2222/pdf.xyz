import { describe, expect, it } from "vitest";
import { buildTrendReceipt } from "./receipt";
import { computeTrendRollup, reduceTrend } from "./reduce";
import { blockedIndex, defaultPolicy, indexedIndex, ingestIndexesFrom, NOW, openIndex } from "./fixtures";
import { RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DISCLOSURE } from "./types";

/** Build a receipt over a history under the default policy. */
function receiptFor(objs: unknown[]) {
  const { summary } = reduceTrend(ingestIndexesFrom(objs), defaultPolicy().maxIndexes);
  const { rollup } = computeTrendRollup(summary, defaultPolicy());
  return buildTrendReceipt(NOW, summary, rollup);
}

describe("buildTrendReceipt — flattened, content-free audit receipt", () => {
  it("flattens the verdict + bounded counts + latest + direction + class + disclosure", () => {
    const r = receiptFor([indexedIndex(), openIndex()]);
    expect(r.category).toBe("worker-release-decision-closeout-index-trend");
    expect(r.at).toBe(NOW);
    expect(r.verdict).toBe("trend-watch");
    expect(r.exitCode).toBe(3);
    expect(r.indexesSupplied).toBe(2);
    expect(r.indexesUsable).toBe(2);
    expect(r.latest).toBe("index-open");
    expect(r.direction).toBe("degrading");
    expect(r.trendClass).toBe("watch-present");
    expect(r.disclosure).toBe(RELEASE_DECISION_CLOSEOUT_INDEX_TREND_DISCLOSURE);
    expect(r.indexVerdictCounts).toEqual({
      indexed: 1,
      "index-incomplete": 0,
      "index-open": 1,
      "index-blocked": 0,
    });
  });

  it("carries only bounded/enum/number/string fields (no nested objects beyond the counts map)", () => {
    const r = receiptFor([blockedIndex()]);
    for (const [key, value] of Object.entries(r)) {
      if (key === "indexVerdictCounts") continue;
      expect(["string", "number", "boolean", "object"]).toContain(typeof value);
      if (typeof value === "object") expect(value).toBeNull(); // only `latest` may be null
    }
  });
});
