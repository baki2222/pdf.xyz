// @vitest-environment node
/**
 * Unit proofs for the release-report metrics sink (Phase 52): it emits ONE bounded, content-free
 * `worker_release_report_total` sample per report, defaults to a no-op, and every sample it can emit sanitizes
 * (round-trips through the shared schema validator).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { recordReleaseReport, resetReleaseReportSink, setReleaseReportSink } from "./metrics";
import { RELEASE_REPORT_RECOMMENDATIONS } from "./types";
import { sanitizeMetric, type WorkerMetricSample } from "../observability/metrics";

afterEach(() => resetReleaseReportSink());

describe("release-report metrics", () => {
  it("emits one bounded sample per recommendation into the configured sink", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseReportSink((s) => seen.push(s));
    recordReleaseReport("hold-fail");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      metric: "worker_release_report_total",
      kind: "counter",
      labels: { recommendation: "hold-fail" },
      value: 1,
    });
  });

  it("every recommendation produces a sample that sanitizes (schema-conformant, content-free)", () => {
    const seen: WorkerMetricSample[] = [];
    setReleaseReportSink((s) => seen.push(s));
    for (const rec of RELEASE_REPORT_RECOMMENDATIONS) recordReleaseReport(rec);
    expect(seen).toHaveLength(RELEASE_REPORT_RECOMMENDATIONS.length);
    for (const sample of seen) {
      const clean = sanitizeMetric(sample);
      expect(clean, JSON.stringify(sample)).not.toBeNull();
      expect(clean!.labels.recommendation).toBe(sample.labels.recommendation);
    }
  });

  it("defaults to a no-op sink (nothing thrown when unset)", () => {
    resetReleaseReportSink();
    expect(() => recordReleaseReport("promote-ready")).not.toThrow();
  });

  it("a throwing sink is the caller's concern (the record helper does not swallow)", () => {
    setReleaseReportSink(() => {
      throw new Error("sink boom");
    });
    // The runner swallows sink errors; the bare record helper forwards them (documented behavior).
    expect(() => recordReleaseReport("promote-ready")).toThrow();
    resetReleaseReportSink();
    const spy = vi.fn();
    setReleaseReportSink(spy);
    recordReleaseReport("needs-evidence");
    expect(spy).toHaveBeenCalledOnce();
  });
});
