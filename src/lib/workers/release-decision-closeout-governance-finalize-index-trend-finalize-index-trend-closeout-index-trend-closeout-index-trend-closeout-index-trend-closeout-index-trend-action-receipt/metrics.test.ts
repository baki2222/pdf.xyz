import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt,
  resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptSink,
  setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptSink,
} from "./metrics";
import {
  releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptMetric,
  sanitizeMetric,
} from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-action-receipt metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS) {
      expect(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_governance_finalize_index_trend_finalize_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_trend_closeout_index_trend_action_receipt_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_ACTION_RECEIPT_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt("completed")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt("blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("blocked");
    resetReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptSink();
    recordReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceipt("invalid");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
