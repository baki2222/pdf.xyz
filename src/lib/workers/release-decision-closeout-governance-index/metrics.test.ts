import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutGovernanceIndex,
  resetReleaseDecisionCloseoutGovernanceIndexSink,
  setReleaseDecisionCloseoutGovernanceIndexSink,
} from "./metrics";
import { releaseDecisionCloseoutGovernanceIndexMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-governance-index metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS) {
      expect(releaseDecisionCloseoutGovernanceIndexMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_governance_index_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutGovernanceIndexMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutGovernanceIndex("indexed")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutGovernanceIndexSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernanceIndex("index-blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("index-blocked");
    resetReleaseDecisionCloseoutGovernanceIndexSink();
    recordReleaseDecisionCloseoutGovernanceIndex("index-incomplete");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
