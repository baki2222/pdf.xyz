import { describe, expect, it } from "vitest";
import { buildFinalizeIndexReceipt } from "./receipt";
import { reduceIndex } from "./reduce";
import { computeFinalizeIndexRollup } from "./reduce";
import { blockedFinalize, finalizedFinalize, ingestFinalizeFrom, notAFinalize, NOW } from "./fixtures";
import { DEFAULT_MAX_FINALIZATIONS } from "./types";

function receiptOf(objs: readonly unknown[]) {
  const { coverage, distribution } = reduceIndex(ingestFinalizeFrom(objs), DEFAULT_MAX_FINALIZATIONS);
  const { rollup } = computeFinalizeIndexRollup(coverage, distribution, {
    maxFinalizations: DEFAULT_MAX_FINALIZATIONS,
    maxOpen: 0,
    maxIncomplete: 0,
    requireLatestFinalized: false,
    strictOpen: false,
  });
  return buildFinalizeIndexReceipt(NOW, coverage, distribution, rollup);
}

describe("buildFinalizeIndexReceipt — content-free audit line", () => {
  it("flattens the verdict, counts, latest, class, and disclosure", () => {
    const r = receiptOf([finalizedFinalize(), finalizedFinalize()]);
    expect(r.category).toBe("worker-release-decision-closeout-governance-finalize-index-trend-finalize-index");
    expect(r.policyId).toBe("pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index");
    expect(r.at).toBe(NOW);
    expect(r.verdict).toBe("indexed");
    expect(r.exitCode).toBe(0);
    expect(r.finalizationsUsable).toBe(2);
    expect(r.verdictCounts.finalized).toBe(2);
    expect(r.latest).toBe("finalized");
    expect(r.trendClass).toBe("all-finalized");
    expect(r.disclosure).toMatch(/NOT a legal/i);
  });

  it("records the untrustworthy / blocked counts and the invalid verdict for a broken history", () => {
    const r = receiptOf([blockedFinalize(), notAFinalize()]);
    expect(r.verdict).toBe("index-invalid");
    expect(r.exitCode).toBe(4);
    expect(r.finalizationsUnreadable).toBe(1);
    expect(r.finalizationsUsable).toBe(1);
  });

  it("carries only bounded scalar fields (no nested objects, arrays, or long strings beyond the disclosure)", () => {
    const r = receiptOf([finalizedFinalize()]) as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(r)) {
      if (k === "verdictCounts") {
        expect(typeof v).toBe("object");
        continue;
      }
      expect(["string", "number"]).toContain(typeof v);
    }
  });
});
