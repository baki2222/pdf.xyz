import { afterEach, describe, expect, it } from "vitest";
import { recordReleasePolicy, resetReleasePolicySink, setReleasePolicySink } from "./metrics";
import { releasePolicyMetric, sanitizeMetric } from "../observability/metrics";
import { RELEASE_POLICY_VERDICTS } from "./types";
import type { WorkerMetricSample } from "../observability/metrics";

afterEach(() => resetReleasePolicySink());

describe("release-policy metrics", () => {
  it("defaults to a no-op sink (records nothing until wired)", () => {
    expect(() => recordReleasePolicy("pass")).not.toThrow();
  });

  it("forwards one bounded sample per verdict to the wired sink", () => {
    const seen: WorkerMetricSample[] = [];
    setReleasePolicySink((s) => seen.push(s));
    for (const v of RELEASE_POLICY_VERDICTS) recordReleasePolicy(v);
    expect(seen.map((s) => s.labels.verdict)).toEqual([...RELEASE_POLICY_VERDICTS]);
    for (const s of seen) expect(s.metric).toBe("worker_release_policy_total");
  });

  it("every verdict produces a schema-conformant, content-free sample", () => {
    for (const v of RELEASE_POLICY_VERDICTS) {
      const sample = releasePolicyMetric(v);
      const clean = sanitizeMetric(sample);
      expect(clean, v).not.toBeNull();
      expect(clean!.labels).toEqual({ verdict: v });
      expect(clean!.value).toBe(1);
      expect(clean!.kind).toBe("counter");
    }
  });

  it("resetReleasePolicySink restores the no-op default", () => {
    const seen: WorkerMetricSample[] = [];
    setReleasePolicySink((s) => seen.push(s));
    resetReleasePolicySink();
    recordReleasePolicy("warn");
    expect(seen).toHaveLength(0);
  });
});
