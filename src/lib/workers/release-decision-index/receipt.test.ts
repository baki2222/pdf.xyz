import { describe, expect, it } from "vitest";
import { buildIndexReceipt } from "./receipt";
import { reduceIndex } from "./reduce";
import { computeIndexRollup } from "./rollup";
import {
  defaultPolicy,
  followupDecision,
  ingestRecordsFrom,
  NOW,
  proceedDecision,
  rejectDecision,
} from "./fixtures";

function receiptFor(objs: readonly unknown[]) {
  const { ledger } = reduceIndex(ingestRecordsFrom(objs), 100);
  const { rollup } = computeIndexRollup(ledger, defaultPolicy());
  return buildIndexReceipt(NOW, ledger, rollup);
}

describe("buildIndexReceipt — content-free flattened summary", () => {
  it("carries the verdict, record counts, decision counts, and trend class only", () => {
    const r = receiptFor([proceedDecision(), followupDecision(), rejectDecision()]);
    expect(r).toMatchObject({
      category: "worker-release-decision-index",
      policyId: "pdfxyz-worker-release-decision-index",
      at: NOW,
      verdict: "blocked",
      exitCode: 4,
      recordsSupplied: 3,
      recordsUsable: 3,
      trendClass: "rejection-present",
    });
    expect(r.decisionCounts.proceed).toBe(1);
    expect(r.decisionCounts.reject).toBe(1);
  });

  it("has only bounded, JSON-scalar fields (no nested prose / locator)", () => {
    const r = receiptFor([proceedDecision()]);
    for (const [k, v] of Object.entries(r)) {
      if (k === "decisionCounts") {
        expect(typeof v).toBe("object");
        continue;
      }
      expect(["string", "number"], k).toContain(typeof v);
    }
  });
});
