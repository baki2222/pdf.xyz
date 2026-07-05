import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseoutIndex,
  resetReleaseDecisionCloseoutIndexSink,
  setReleaseDecisionCloseoutIndexSink,
} from "./metrics";
import { releaseDecisionCloseoutIndexMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout-index metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS) {
      expect(releaseDecisionCloseoutIndexMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_index_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutIndexMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseoutIndex("indexed")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutIndexSink((s) => seen.push(s));
    recordReleaseDecisionCloseoutIndex("index-blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("index-blocked");
    resetReleaseDecisionCloseoutIndexSink();
    recordReleaseDecisionCloseoutIndex("index-incomplete");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
