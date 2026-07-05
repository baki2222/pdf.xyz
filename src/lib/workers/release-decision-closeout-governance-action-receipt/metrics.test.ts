import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutGovernanceActionReceipt,
  resetReleaseDecisionCloseoutGovernanceActionReceiptSink,
  setReleaseDecisionCloseoutGovernanceActionReceiptSink,
} from "./metrics";
import { releaseDecisionCloseoutGovernanceActionReceiptMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-governance-action-receipt metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS) {
      expect(releaseDecisionCloseoutGovernanceActionReceiptMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_governance_action_receipt_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_ACTION_RECEIPT_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutGovernanceActionReceiptMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutGovernanceActionReceipt("completed")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutGovernanceActionReceiptSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernanceActionReceipt("blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("blocked");
    resetReleaseDecisionCloseoutGovernanceActionReceiptSink();
    recordReleaseDecisionCloseoutGovernanceActionReceipt("incomplete");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
