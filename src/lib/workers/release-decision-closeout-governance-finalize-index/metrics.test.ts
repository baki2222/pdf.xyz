import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutGovernanceFinalizeIndex,
  resetReleaseDecisionCloseoutGovernanceFinalizeIndexSink,
  setReleaseDecisionCloseoutGovernanceFinalizeIndexSink,
} from "./metrics";
import { releaseDecisionCloseoutGovernanceFinalizeIndexMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-governance-finalize-index metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS) {
      expect(releaseDecisionCloseoutGovernanceFinalizeIndexMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_governance_finalize_index_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutGovernanceFinalizeIndexMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutGovernanceFinalizeIndex("indexed")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutGovernanceFinalizeIndexSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutGovernanceFinalizeIndex("index-invalid");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("index-invalid");
    resetReleaseDecisionCloseoutGovernanceFinalizeIndexSink();
    recordReleaseDecisionCloseoutGovernanceFinalizeIndex("index-incomplete");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
