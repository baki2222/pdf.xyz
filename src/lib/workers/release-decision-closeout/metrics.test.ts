import { describe, expect, it } from "vitest";
import {
  recordReleaseDecisionCloseout,
  resetReleaseDecisionCloseoutSink,
  setReleaseDecisionCloseoutSink,
} from "./metrics";
import { releaseDecisionCloseoutMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_DECISION_CLOSEOUT_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

describe("release-decision-closeout metric — content-free + bounded", () => {
  it("builds the bounded counter sample for every verdict", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_VERDICTS) {
      expect(releaseDecisionCloseoutMetric(verdict)).toEqual({
        metric: "worker_release_decision_closeout_total",
        kind: "counter",
        labels: { verdict },
        value: 1,
      });
    }
  });

  it("every verdict token is redaction-stable (survives sanitizeMetric untouched)", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_VERDICTS) {
      const clean = sanitizeMetric(releaseDecisionCloseoutMetric(verdict));
      expect(clean, `verdict ${verdict} dropped`).not.toBeNull();
      expect(clean!.labels.verdict).toBe(verdict);
    }
  });

  it("the sink defaults to a no-op and forwards to a set collector, then resets", () => {
    const seen: WorkerMetricSample[] = [];
    expect(() => recordReleaseDecisionCloseout("closed")).not.toThrow(); // default no-op
    setReleaseDecisionCloseoutSink((s) => seen.push(s));
    recordReleaseDecisionCloseout("closeout-blocked");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.labels.verdict).toBe("closeout-blocked");
    resetReleaseDecisionCloseoutSink();
    recordReleaseDecisionCloseout("closeout-incomplete");
    expect(seen).toHaveLength(1); // no longer forwarded
  });
});
