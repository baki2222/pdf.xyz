import { describe, expect, it } from "vitest";
import { buildCloseoutIndexReceipt } from "./receipt";
import { computeCloseoutIndexRollup, reduceIndex } from "./reduce";
import { blockedCloseout, closedCloseout, ingestCloseoutFrom, notACloseout, NOW } from "./fixtures";
import { DEFAULT_MAX_CLOSEOUTS } from "./types";

function receiptOf(objs: readonly unknown[]) {
  const { coverage, distribution } = reduceIndex(ingestCloseoutFrom(objs), DEFAULT_MAX_CLOSEOUTS);
  const { rollup } = computeCloseoutIndexRollup(coverage, distribution, {
    maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
    maxOpen: 0,
    maxIncomplete: 0,
    strictOpen: false,
  });
  return buildCloseoutIndexReceipt(NOW, coverage, distribution, rollup);
}

describe("buildCloseoutIndexReceipt — content-free audit line", () => {
  it("flattens the verdict, counts, latest, class, and disclosure", () => {
    const r = receiptOf([closedCloseout(), closedCloseout()]);
    expect(r.category).toBe(
      "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index",
    );
    expect(r.policyId).toBe(
      "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index",
    );
    expect(r.at).toBe(NOW);
    expect(r.verdict).toBe("all-closed");
    expect(r.exitCode).toBe(0);
    expect(r.closeoutsUsable).toBe(2);
    expect(r.verdictCounts.closed).toBe(2);
    expect(r.latest).toBe("closed");
    expect(r.trendClass).toBe("all-closed");
    expect(r.disclosure).toMatch(/NOT a legal/i);
  });

  it("records the untrustworthy / blocked counts and the invalid verdict for a broken history", () => {
    const r = receiptOf([blockedCloseout(), notACloseout()]);
    expect(r.verdict).toBe("invalid");
    expect(r.exitCode).toBe(4);
    expect(r.closeoutsUnreadable).toBe(1);
    expect(r.closeoutsUsable).toBe(1);
  });

  it("carries only bounded scalar fields (no nested objects, arrays, or long strings beyond the disclosure)", () => {
    const r = receiptOf([closedCloseout()]) as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(r)) {
      if (k === "verdictCounts") {
        expect(typeof v).toBe("object");
        continue;
      }
      expect(["string", "number"]).toContain(typeof v);
    }
  });
});
