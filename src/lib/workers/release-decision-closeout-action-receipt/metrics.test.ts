import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutActionReceipt,
  resetReleaseDecisionCloseoutActionReceiptSink,
  setReleaseDecisionCloseoutActionReceiptSink,
} from "./metrics";
import { releaseDecisionCloseoutActionReceiptMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-action-receipt metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICTS) {
      expect(releaseDecisionCloseoutActionReceiptMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_action_receipt_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_ACTION_RECEIPT_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutActionReceiptMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutActionReceipt("completed")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutActionReceiptSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutActionReceipt("blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("blocked");
    resetReleaseDecisionCloseoutActionReceiptSink();
    recordReleaseDecisionCloseoutActionReceipt("incomplete");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
