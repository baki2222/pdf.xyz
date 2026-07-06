import { describe, expect, it } from "vitest";
import { completedReceipt, coherentPlan, coherentTrend, makeFinalize, notAReceipt } from "./fixtures";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_DISCLOSURE } from "./types";

describe("finalize-index-trend-finalize receipt — flattened content-free summary", () => {
  it("carries the verdict, coverage counts, the run stamp, and the disclosure", () => {
    const r = makeFinalize(completedReceipt(), { plan: coherentPlan(), trend: coherentTrend() });
    const rc = r.receipt;
    expect(rc.verdict).toBe(r.verdict);
    expect(rc.exitCode).toBe(r.exitCode);
    expect(rc.receiptState).toBe("usable");
    expect(rc.receiptVerdict).toBe("completed");
    expect(rc.relatedSupplied).toBe(2);
    expect(rc.relatedCoherent).toBe(2);
    expect(rc.relatedContradictory).toBe(0);
    expect(rc.disclosure).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_DISCLOSURE);
    expect(rc.at).toBe(r.generatedAt);
  });

  it("surfaces the untrusted claimed verdict for an unreadable receipt (null)", () => {
    const r = makeFinalize(notAReceipt());
    expect(r.receipt.receiptState).toBe("unreadable");
    expect(r.receipt.receiptVerdict).toBeNull();
    expect(r.receipt.invalid).toBeGreaterThan(0);
  });
});
