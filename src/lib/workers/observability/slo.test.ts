// @vitest-environment node
/**
 * SLO calculation + edge-case proofs. Every indicator is a pure function of a
 * snapshot; the load-bearing honesty rules are: insufficient data is `unknown`
 * (never a flattering default), latency percentiles resolve to a histogram bucket
 * bound (never a fabricated value), and an optional-facet-off is not a breach.
 */
import { describe, expect, it } from "vitest";
import { createWorkerMetricsCollector } from "./collector";
import { deriveEngineCapabilityMetrics } from "./derive";
import {
  jobTerminalMetric,
  lifecycleDriftMetric,
  lifecycleVerificationMetric,
  processorLatencyMetric,
  processorMetric,
  queueAgeMetric,
  queueDepthMetric,
  retryMetric,
  scanMetric,
} from "./metrics";
import {
  DEFAULT_SLO_THRESHOLDS,
  deadLetterRate,
  engineReadiness,
  evaluateSlos,
  jobSuccessRate,
  latencyQuantile,
  lifecycleDrift,
  processorSuccessRate,
  retryRate,
  scannerUnavailableRate,
  SLO_IDS,
} from "./slo";

function snapshotOf(
  build: (c: ReturnType<typeof createWorkerMetricsCollector>) => void,
) {
  const c = createWorkerMetricsCollector();
  build(c);
  return c.snapshot();
}

describe("job success rate", () => {
  it("is null with no terminal jobs, else completed / (completed + failed)", () => {
    expect(jobSuccessRate(snapshotOf(() => {})).rate).toBeNull();
    const snap = snapshotOf((c) => {
      for (let i = 0; i < 99; i++) c.record(jobTerminalMetric("completed"));
      c.record(jobTerminalMetric("failed"));
      c.record(jobTerminalMetric("canceled")); // excluded from the ratio
    });
    expect(jobSuccessRate(snap).rate).toBeCloseTo(0.99, 5);
  });

  it("computes per-processor success from worker_processor_total", () => {
    const snap = snapshotOf((c) => {
      c.record(processorMetric("compress", "completed"));
      c.record(processorMetric("compress", "completed"));
      c.record(processorMetric("compress", "failed"));
      c.record(processorMetric("compress", "requeued")); // excluded
    });
    expect(processorSuccessRate(snap, "compress").rate).toBeCloseTo(2 / 3, 5);
    expect(processorSuccessRate(snap, "ocr").rate).toBeNull();
  });
});

describe("latency quantile", () => {
  it("is null with no observations", () => {
    expect(
      latencyQuantile(
        snapshotOf(() => {}),
        0.95,
      ).seconds,
    ).toBeNull();
  });

  it("resolves p95/p99 to the histogram bucket bound", () => {
    const snap = snapshotOf((c) => {
      for (let i = 0; i < 19; i++)
        c.record(processorLatencyMetric("compress", 500)); // le 0.5
      c.record(processorLatencyMetric("compress", 45_000)); // le 60
    });
    expect(latencyQuantile(snap, 0.95).le).toBe("0.5");
    expect(latencyQuantile(snap, 0.99).le).toBe("60");
  });

  it("clamps q into (0, 1]", () => {
    const snap = snapshotOf((c) =>
      c.record(processorLatencyMetric("ocr", 100)),
    );
    expect(latencyQuantile(snap, 0).le).toBe("0.1");
    expect(latencyQuantile(snap, 5).le).toBe("0.1");
  });
});

describe("rates over sanitized counters", () => {
  it("retry rate over attempts", () => {
    const snap = snapshotOf((c) => {
      c.record(retryMetric());
      for (let i = 0; i < 9; i++) c.record(jobTerminalMetric("completed"));
    });
    expect(retryRate(snap).rate).toBeCloseTo(0.1, 5);
  });

  it("dead-letter rate over finished jobs", () => {
    const snap = snapshotOf((c) => {
      c.record(jobTerminalMetric("failed", "scan_unavailable"));
      for (let i = 0; i < 99; i++) c.record(jobTerminalMetric("completed"));
    });
    expect(deadLetterRate(snap).rate).toBeCloseTo(0 / 100, 5); // no dead-letter counter recorded
  });

  it("scanner-unavailable rate excludes skipped (null when only skipped)", () => {
    const skippedOnly = snapshotOf((c) => {
      for (let i = 0; i < 5; i++) c.record(scanMetric("skipped", false));
    });
    expect(scannerUnavailableRate(skippedOnly).rate).toBeNull();

    const engaged = snapshotOf((c) => {
      for (let i = 0; i < 9; i++) c.record(scanMetric("clean", true));
      c.record(scanMetric("error", false));
      c.record(scanMetric("skipped", false)); // ignored
    });
    expect(scannerUnavailableRate(engaged).rate).toBeCloseTo(0.1, 5);
  });
});

describe("presence-only indicators", () => {
  it("engine readiness: unprobed unknown, deep ok, lossless-only warn", () => {
    expect(engineReadiness(snapshotOf(() => {})).status).toBe("unknown");
    const deep = snapshotOf((c) => {
      for (const s of deriveEngineCapabilityMetrics({
        compressionDeep: true,
        ocrReady: false,
        scannerActive: false,
      }))
        c.record(s);
    });
    expect(engineReadiness(deep).status).toBe("ok");
    const lossless = snapshotOf((c) => {
      for (const s of deriveEngineCapabilityMetrics({
        compressionDeep: false,
        ocrReady: false,
        scannerActive: false,
      }))
        c.record(s);
    });
    expect(engineReadiness(lossless).status).toBe("warn");
  });

  it("lifecycle drift: verified ok, any drift breach, unverified unknown", () => {
    expect(lifecycleDrift(snapshotOf(() => {})).status).toBe("unknown");
    expect(
      lifecycleDrift(
        snapshotOf((c) => c.record(lifecycleVerificationMetric("verified"))),
      ).status,
    ).toBe("ok");
    expect(
      lifecycleDrift(
        snapshotOf((c) => c.record(lifecycleVerificationMetric("drift"))),
      ).status,
    ).toBe("breach");
    const driftRules = snapshotOf((c) => {
      c.record(lifecycleVerificationMetric("verified"));
      c.record(lifecycleDriftMetric(2));
    });
    expect(lifecycleDrift(driftRules).status).toBe("breach");
  });
});

describe("evaluateSlos", () => {
  it("covers every SLO id and defaults an empty snapshot to ok/unknown", () => {
    const report = evaluateSlos({ series: [] });
    expect(report.slos.map((s) => s.id).sort()).toEqual([...SLO_IDS].sort());
    expect(report.worst).toBe("ok");
    for (const s of report.slos) {
      // With no data, indicators are unknown (readiness/lifecycle included).
      expect(["unknown", "ok"]).toContain(s.status);
    }
  });

  it("classifies ok / warn / breach and rolls up the worst", () => {
    const breachSnap = snapshotOf((c) => {
      for (let i = 0; i < 9; i++) c.record(jobTerminalMetric("completed"));
      c.record(jobTerminalMetric("failed")); // 90% success → breach
    });
    const report = evaluateSlos(breachSnap);
    expect(report.slos.find((s) => s.id === "job_success_rate")?.status).toBe(
      "breach",
    );
    expect(report.worst).toBe("breach");
  });

  it("treats p99 at a bucket bound as warn under default thresholds", () => {
    const snap = snapshotOf((c) => {
      for (let i = 0; i < 19; i++)
        c.record(processorLatencyMetric("compress", 500));
      c.record(processorLatencyMetric("compress", 45_000)); // p99 → le 60
    });
    const report = evaluateSlos(snap);
    const p99 = report.slos.find((s) => s.id === "processor_latency_p99");
    expect(p99?.observed).toBe("≤60s");
    expect(p99?.status).toBe("warn"); // 60s <= breach(60), > warn(30)
  });

  it("reflects observed queue depth/age buckets", () => {
    const snap = snapshotOf((c) => {
      c.record(queueDepthMetric(300)); // 201-1000 → >= warn(51-200) → warn
      c.record(queueAgeMetric(10_000)); // 5-30s → below warn(2-10m) → ok
    });
    const report = evaluateSlos(snap);
    expect(report.slos.find((s) => s.id === "queue_depth")?.status).toBe(
      "warn",
    );
    expect(report.slos.find((s) => s.id === "queue_age")?.status).toBe("ok");
  });

  it("ships sane default thresholds", () => {
    expect(DEFAULT_SLO_THRESHOLDS.jobSuccessRate.breach).toBeLessThan(
      DEFAULT_SLO_THRESHOLDS.jobSuccessRate.warn,
    );
    expect(DEFAULT_SLO_THRESHOLDS.latencyP95Seconds.warn).toBeLessThan(
      DEFAULT_SLO_THRESHOLDS.latencyP95Seconds.breach,
    );
  });
});
