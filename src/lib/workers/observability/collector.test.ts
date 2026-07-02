// @vitest-environment node
/**
 * Aggregation semantics, query helpers, and provider-neutral export for the metrics
 * collector: counters/histograms accumulate, gauges are last-writer-wins, off-schema
 * samples are dropped at the boundary, and the Prometheus export renders the latency
 * histogram in canonical cumulative `_bucket` + `_count` form.
 */
import { describe, expect, it } from "vitest";
import {
  createWorkerMetricsCollector,
  gaugeValue,
  latencyBuckets,
  renderPrometheus,
  seriesFor,
  sumSeries,
} from "./collector";
import {
  jobTerminalMetric,
  lifecycleDriftMetric,
  processorLatencyMetric,
  processorMetric,
  retryMetric,
  scanMetric,
} from "./metrics";

describe("collector aggregation", () => {
  it("accumulates counters and histogram observations", () => {
    const c = createWorkerMetricsCollector();
    c.record(retryMetric());
    c.record(retryMetric());
    c.record(retryMetric());
    expect(sumSeries(c.snapshot(), "worker_retry_total")).toBe(3);
  });

  it("treats gauges (same label set) as last-writer-wins, not additive", () => {
    const c = createWorkerMetricsCollector();
    c.record(lifecycleDriftMetric(2));
    c.record(lifecycleDriftMetric(5));
    expect(gaugeValue(c.snapshot(), "worker_lifecycle_drift_rules")).toBe(5);
  });

  it("keeps distinct label sets as independent series", () => {
    const c = createWorkerMetricsCollector();
    c.record(processorMetric("compress", "completed"));
    c.record(processorMetric("compress", "failed"));
    c.record(processorMetric("ocr", "completed"));
    const snap = c.snapshot();
    expect(sumSeries(snap, "worker_processor_total")).toBe(3);
    expect(sumSeries(snap, "worker_processor_total", { processor: "compress" })).toBe(2);
    expect(sumSeries(snap, "worker_processor_total", { processor: "ocr", outcome: "completed" })).toBe(1);
    expect(seriesFor(snap, "worker_processor_total").length).toBe(3);
  });

  it("drops an off-schema sample at the sink boundary (never aggregated)", () => {
    const c = createWorkerMetricsCollector();
    // A hand-built content-bearing sample bypasses the typed builders.
    c.sink({
      metric: "worker_scan_total",
      kind: "counter",
      labels: { verdict: "clean", scanned: "/tmp/leak.pdf" },
      value: 1,
    });
    c.record(scanMetric("clean", true));
    expect(sumSeries(c.snapshot(), "worker_scan_total")).toBe(1);
  });

  it("produces a deterministic, sorted snapshot", () => {
    const a = createWorkerMetricsCollector();
    const b = createWorkerMetricsCollector();
    a.record(retryMetric());
    a.record(jobTerminalMetric("completed"));
    b.record(jobTerminalMetric("completed"));
    b.record(retryMetric());
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("reset clears all state", () => {
    const c = createWorkerMetricsCollector();
    c.record(retryMetric());
    c.reset();
    expect(c.snapshot().series).toEqual([]);
  });
});

describe("latencyBuckets", () => {
  it("returns per-le counts in bound order, optionally scoped to a processor", () => {
    const c = createWorkerMetricsCollector();
    c.record(processorLatencyMetric("compress", 50)); // le 0.1
    c.record(processorLatencyMetric("compress", 2_000)); // le 2.5
    c.record(processorLatencyMetric("ocr", 6_000)); // le 10
    const all = latencyBuckets(c.snapshot());
    expect(all.find((b) => b.le === "0.1")?.count).toBe(1);
    expect(all.find((b) => b.le === "2.5")?.count).toBe(1);
    expect(all.find((b) => b.le === "10")?.count).toBe(1);
    const compress = latencyBuckets(c.snapshot(), "compress");
    expect(compress.find((b) => b.le === "10")?.count).toBe(0);
    expect(compress.reduce((n, b) => n + b.count, 0)).toBe(2);
  });
});

describe("renderPrometheus", () => {
  it("emits canonical cumulative _bucket + _count for the latency histogram", () => {
    const c = createWorkerMetricsCollector();
    c.record(processorLatencyMetric("compress", 50)); // 0.05s → le 0.1
    c.record(processorLatencyMetric("compress", 2_000)); // 2s → le 2.5
    const text = renderPrometheus(c.snapshot());
    // Cumulative: le 0.1 holds the 50ms observation; by le 2.5 both are counted.
    expect(text).toContain('worker_processor_latency_seconds_bucket{le="0.1",processor="compress"} 1');
    expect(text).toContain('worker_processor_latency_seconds_bucket{le="1",processor="compress"} 1');
    expect(text).toContain('worker_processor_latency_seconds_bucket{le="2.5",processor="compress"} 2');
    expect(text).toContain('worker_processor_latency_seconds_bucket{le="+Inf",processor="compress"} 2');
    expect(text).toContain('worker_processor_latency_seconds_count{processor="compress"} 2');
  });

  it("emits flat lines for counters/gauges and stays content-free + deterministic", () => {
    const c = createWorkerMetricsCollector();
    c.record(processorMetric("ocr", "completed"));
    c.record(processorMetric("ocr", "completed"));
    const text = renderPrometheus(c.snapshot());
    expect(text).toContain('worker_processor_total{outcome="completed",processor="ocr"} 2');
    expect(text).not.toMatch(/\/tmp|s3:\/\/|https?:\/\/|secret|filename/i);
    expect(renderPrometheus(c.snapshot())).toBe(text); // deterministic
  });
});
