import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionIndex,
  resetReleaseDecisionIndexSink,
  setReleaseDecisionIndexSink,
} from "./metrics";
import { releaseDecisionIndexMetric } from "../observability/metrics";
import { sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_INDEX_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-index metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_INDEX_VERDICTS) {
      const sample = releaseDecisionIndexMetric(verdict);
      expect(sample).toEqual({
        metric: "worker_release_decision_index_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_INDEX_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionIndexMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionIndex("stable")).not.toThrow(); // default no-op
    setReleaseDecisionIndexSink((s) => seen.push(s));
    recordReleaseDecisionIndex("blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("blocked");
    resetReleaseDecisionIndexSink();
    recordReleaseDecisionIndex("invalid");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
