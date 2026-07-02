// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createWorkerMetricsCollector,
  deriveEngineCapabilityMetrics,
  evaluateSlos,
  processorLatencyMetric,
  processorMetric,
  queueAgeMetric,
  queueDepthMetric,
  renderPrometheus,
  runMetric,
  sanitizeMetric,
  storageMetric,
} from "./index";

describe("worker observability metrics", () => {
  it("collects bounded worker metrics and renders deterministic Prometheus output", () => {
    const collector = createWorkerMetricsCollector();
    collector.record(runMetric("once", "drained"));
    collector.record(processorMetric("ocr", "completed"));
    collector.record(processorMetric("ocr", "completed"));
    collector.record(processorLatencyMetric("ocr", 1_234));
    collector.record(storageMetric("read", "missing"));

    const snapshot = collector.snapshot();
    expect(snapshot.series.map((s) => s.metric)).toEqual([
      "worker_processor_latency_seconds",
      "worker_processor_total",
      "worker_run_total",
      "worker_storage_ops_total",
    ]);
    expect(
      snapshot.series.find((s) => s.metric === "worker_processor_total")?.value,
    ).toBe(2);

    const rendered = renderPrometheus(snapshot);
    expect(rendered).toContain(
      'worker_processor_total{outcome="completed",processor="ocr"} 2',
    );
    expect(rendered).not.toMatch(/\/tmp|s3:\/\/|https?:\/\/|SECRET|filename|object-key/i);
  });

  it("drops off-schema or content-bearing metric labels at the sanitization boundary", () => {
    expect(
      sanitizeMetric({
        metric: "worker_processor_total",
        kind: "counter",
        value: 1,
        labels: {
          processor: "ocr /tmp/pdfxyz SECRET",
          outcome: "completed",
        },
      }),
    ).toBeNull();

    expect(
      sanitizeMetric({
        metric: "worker_engine_capability",
        kind: "gauge",
        value: 1,
        labels: {
          capability: "ocr",
          available: "true",
          path: "/usr/bin/ocrmypdf",
        },
      }),
    ).toBeNull();
  });

  it("evaluates SLOs honestly: no data is unknown and bucketed data stays coarse", () => {
    const empty = evaluateSlos({ series: [] });
    expect(empty.worst).toBe("ok");
    expect(empty.slos.find((s) => s.id === "job_success_rate")?.status).toBe(
      "unknown",
    );

    const collector = createWorkerMetricsCollector();
    collector.record(processorMetric("ocr", "completed"));
    collector.record(processorLatencyMetric("ocr", 1_234));
    collector.record(queueDepthMetric(77));
    collector.record(queueAgeMetric(90_000));
    for (const sample of deriveEngineCapabilityMetrics({
      compressionDeep: false,
      ocrReady: false,
      scannerActive: false,
    })) {
      collector.record(sample);
    }

    const report = evaluateSlos(collector.snapshot());
    expect(report.slos.find((s) => s.id === "job_success_rate_ocr")?.status).toBe(
      "ok",
    );
    expect(report.slos.find((s) => s.id === "processor_latency_p95")?.observed).toBe(
      "≤2.5s",
    );
    expect(report.slos.find((s) => s.id === "queue_depth")?.observed).toBe("51-200");
    expect(JSON.stringify(report)).not.toMatch(/\/tmp|s3:\/\/|https?:\/\/|SECRET/i);
  });
});
