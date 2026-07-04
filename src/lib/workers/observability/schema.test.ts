// @vitest-environment node
/**
 * Deep schema, label-bounds, bucketing, and no-leakage proofs for the worker metric
 * schema — the exhaustive counterpart to the light integration pass in
 * `./metrics.test.ts`. The load-bearing guarantee: every sample a builder can produce
 * is on the {@link METRIC_SCHEMA} allowlist and carries only bounded enum / coarse
 * bucket labels — never a filename, key, secret, or high-cardinality id — and the
 * sanitizer rejects anything off-schema.
 */
import { describe, expect, it } from "vitest";
import { redactText } from "@/lib/telemetry/redact";
import {
  BOOL_LABELS,
  ENGINE_CAPABILITIES,
  FAILURE_CLASSES,
  LATENCY_LE_LABELS,
  LATENCY_LE_SECONDS,
  METRIC_NAMES,
  METRIC_SCHEMA,
  PROCESSOR_KINDS,
  QUEUE_AGE_BUCKETS,
  QUEUE_DEPTH_BUCKETS,
  artifactCleanupMetric,
  artifactDeliveryMetric,
  artifactExpiryMetric,
  artifactManifestMetric,
  artifactRetrievalMetric,
  claimMetric,
  cleanupEvidencePostureMetric,
  cleanupPipelineMetric,
  cleanupProjectionMetric,
  deadLetterMetric,
  engineCapabilityMetric,
  failureClassForCode,
  isKnownMetricName,
  jobTerminalMetric,
  latencyLeLabel,
  lifecycleDriftMetric,
  lifecycleVerificationMetric,
  opsBundleMetric,
  processorKindForId,
  processorLatencyMetric,
  processorMetric,
  queueAgeBucket,
  queueAgeMetric,
  queueDepthBucket,
  queueDepthMetric,
  readinessMetric,
  releasePolicyMetric,
  releaseReportMetric,
  redeliveryMetric,
  retryMetric,
  runMetric,
  sanitizeMetric,
  scanMetric,
  soundnessMetric,
  storageMetric,
  tickMetric,
  type WorkerMetricSample,
} from "./metrics";

/** A representative sample from every builder — the full emit surface. */
const SAMPLES: WorkerMetricSample[] = [
  runMetric("loop", "drained"),
  tickMetric("drain", "completed"),
  claimMetric("claimed"),
  redeliveryMetric(),
  deadLetterMetric(),
  retryMetric(),
  processorMetric("compress", "completed"),
  processorMetric("ocr", "failed"),
  processorLatencyMetric("compress", 1234),
  scanMetric("infected", true),
  scanMetric("skipped", false),
  soundnessMetric("sound", "ok"),
  soundnessMetric("unsound", "malformed_pdf"),
  soundnessMetric("unsound", "size_mismatch"),
  soundnessMetric("skipped", "not_checked"),
  artifactManifestMetric("valid", "ok", "pdf", "compress"),
  artifactManifestMetric("invalid", "empty_artifact", "text-sidecar", "ocr"),
  artifactManifestMetric("invalid", "no_artifacts", "unknown", "compress"),
  artifactRetrievalMetric("served", "ok", "pdf", "local-dev"),
  artifactRetrievalMetric("served", "ok", "pdf", "remote-configured"),
  artifactRetrievalMetric("denied", "expired", "unknown", "remote-configured"),
  artifactRetrievalMetric("denied", "storage_error", "unknown", "remote-configured"),
  artifactRetrievalMetric("denied", "invalid_manifest", "unknown", "not-configured"),
  artifactDeliveryMetric("delivered", "ok", "pdf", "local-dev"),
  artifactDeliveryMetric("delivered", "ok", "text-sidecar", "remote-configured"),
  artifactDeliveryMetric("denied", "size_mismatch", "unknown", "remote-configured"),
  artifactDeliveryMetric("denied", "oversize", "archive", "remote-configured"),
  artifactDeliveryMetric("denied", "stream_error", "unknown", "not-configured"),
  artifactExpiryMetric("live", "remote-configured"),
  artifactExpiryMetric("expired", "remote-configured"),
  artifactExpiryMetric("deleted", "remote-configured"),
  artifactExpiryMetric("unknown", "remote-configured"),
  artifactCleanupMetric("ok", "ok"),
  artifactCleanupMetric("expired-but-present", "drift", 3),
  artifactCleanupMetric("deleted-but-present", "breach"),
  artifactCleanupMetric("missing-manifest", "unknown", 2),
  artifactCleanupMetric("invalid-record", "breach"),
  cleanupProjectionMetric("evidence", "projected"),
  cleanupProjectionMetric("evidence", "insufficient"),
  cleanupProjectionMetric("inventory", "unsafe"),
  cleanupPipelineMetric("verify", "ok"),
  cleanupPipelineMetric("verify", "drift"),
  cleanupPipelineMetric("sweep", "breach"),
  cleanupPipelineMetric("sweep", "usage"),
  cleanupEvidencePostureMetric("healthy", "cleanup_verified", "remote-configured"),
  cleanupEvidencePostureMetric("stale", "report_stale", "unknown"),
  cleanupEvidencePostureMetric("warning", "cleanup_drift", "remote-configured"),
  cleanupEvidencePostureMetric("critical", "cleanup_breach", "unknown"),
  cleanupEvidencePostureMetric("invalid", "report_malformed", "unknown"),
  cleanupEvidencePostureMetric("disabled", "no_report_configured", "unknown"),
  opsBundleMetric("ok"),
  opsBundleMetric("usage"),
  opsBundleMetric("unknown"),
  opsBundleMetric("warn"),
  opsBundleMetric("critical"),
  releasePolicyMetric("pass"),
  releasePolicyMetric("warn"),
  releasePolicyMetric("unknown"),
  releasePolicyMetric("fail"),
  releaseReportMetric("promote-ready"),
  releaseReportMetric("hold-warning"),
  releaseReportMetric("needs-evidence"),
  releaseReportMetric("hold-fail"),
  storageMetric("read", "missing"),
  queueDepthMetric(42),
  queueAgeMetric(90_000),
  readinessMetric("queue", "ready"),
  readinessMetric("ocr", "not-implemented"),
  engineCapabilityMetric("compression_deep", false),
  lifecycleVerificationMetric("drift"),
  lifecycleDriftMetric(2),
  jobTerminalMetric("failed", "blocked"),
];

describe("METRIC_SCHEMA is the single source of truth", () => {
  it("has an entry for every metric name and no orphans", () => {
    expect(Object.keys(METRIC_SCHEMA).sort()).toEqual([...METRIC_NAMES].sort());
  });

  it("isKnownMetricName gates the allowlist", () => {
    for (const name of METRIC_NAMES) expect(isKnownMetricName(name)).toBe(true);
    expect(isKnownMetricName("worker_secret_total")).toBe(false);
    expect(isKnownMetricName(123)).toBe(false);
  });

  it("every schema label value survives redaction (is a pristine enum)", () => {
    for (const schema of Object.values(METRIC_SCHEMA)) {
      for (const values of Object.values(schema.labels)) {
        for (const v of values) expect(redactText(v)).toBe(v);
      }
    }
  });
});

describe("builders produce schema-conformant, content-free samples", () => {
  it("every builder sample sanitizes (round-trips) and matches its schema kind", () => {
    for (const sample of SAMPLES) {
      const clean = sanitizeMetric(sample);
      expect(clean, JSON.stringify(sample)).not.toBeNull();
      expect(clean!.kind).toBe(METRIC_SCHEMA[sample.metric].kind);
      for (const [k, v] of Object.entries(clean!.labels)) {
        const allowed = METRIC_SCHEMA[sample.metric].labels[k];
        expect(allowed, `${sample.metric}.${k}`).toBeDefined();
        expect(allowed).toContain(v);
      }
    }
  });

  it("no serialized sample carries a forbidden substring (content-free)", () => {
    const forbidden = [
      "amazonaws",
      "akia",
      "://",
      "secret",
      "us-east-1",
      ".pdf",
      ".upstash.io",
      "/tmp",
      "bearer ",
      "password",
    ];
    for (const sample of SAMPLES) {
      const text = JSON.stringify(sample).toLowerCase();
      for (const bad of forbidden) {
        expect(text, `${sample.metric} leaked ${bad}`).not.toContain(bad);
      }
    }
  });
});

describe("sanitizeMetric rejects off-schema / content-bearing samples", () => {
  it("rejects an unknown metric name", () => {
    expect(
      sanitizeMetric({ metric: "worker_secret_total" as never, kind: "counter", labels: {}, value: 1 }),
    ).toBeNull();
  });

  it("rejects a kind that disagrees with the schema", () => {
    expect(
      sanitizeMetric({ metric: "worker_run_total", kind: "gauge", labels: { mode: "loop", reason: "drained" }, value: 1 }),
    ).toBeNull();
  });

  it("rejects an out-of-enum label value (a smuggled filename)", () => {
    expect(
      sanitizeMetric({ metric: "worker_scan_total", kind: "counter", labels: { verdict: "clean", scanned: "statement.pdf" }, value: 1 }),
    ).toBeNull();
  });

  it("rejects an extra or a missing label key", () => {
    expect(
      sanitizeMetric({ metric: "worker_claim_total", kind: "counter", labels: { result: "claimed", extra: "x" }, value: 1 }),
    ).toBeNull();
    expect(
      sanitizeMetric({ metric: "worker_claim_total", kind: "counter", labels: {}, value: 1 }),
    ).toBeNull();
  });

  it("rejects a non-finite value or an over-long label", () => {
    expect(
      sanitizeMetric({ metric: "worker_retry_total", kind: "counter", labels: {}, value: Number.NaN }),
    ).toBeNull();
    expect(
      sanitizeMetric({ metric: "worker_run_total", kind: "counter", labels: { mode: "loop", reason: "x".repeat(100) }, value: 1 }),
    ).toBeNull();
  });
});

describe("latency le bucketing", () => {
  it("labels stay index-aligned with the numeric bounds", () => {
    LATENCY_LE_SECONDS.forEach((s, i) => expect(LATENCY_LE_LABELS[i]).toBe(String(s)));
    expect(LATENCY_LE_LABELS[LATENCY_LE_LABELS.length - 1]).toBe("+Inf");
    expect(LATENCY_LE_LABELS.length).toBe(LATENCY_LE_SECONDS.length + 1);
  });

  it("maps a raw latency to the smallest bound it does not exceed", () => {
    expect(latencyLeLabel(0)).toBe("0.1");
    expect(latencyLeLabel(100)).toBe("0.1");
    expect(latencyLeLabel(101)).toBe("0.25");
    expect(latencyLeLabel(250)).toBe("0.25");
    expect(latencyLeLabel(5_000)).toBe("5");
    expect(latencyLeLabel(30_000)).toBe("30");
    expect(latencyLeLabel(120_000)).toBe("120");
    expect(latencyLeLabel(120_001)).toBe("+Inf");
  });

  it("routes an unmeasurable latency to +Inf (conservative, never fast)", () => {
    expect(latencyLeLabel(Number.NaN)).toBe("+Inf");
    expect(latencyLeLabel(-1)).toBe("+Inf");
    expect(latencyLeLabel(Number.POSITIVE_INFINITY)).toBe("+Inf");
  });
});

describe("queue depth / age bucketing", () => {
  it("buckets depth by coarse tiers", () => {
    expect(queueDepthBucket(0)).toBe("0");
    expect(queueDepthBucket(10)).toBe("1-10");
    expect(queueDepthBucket(11)).toBe("11-50");
    expect(queueDepthBucket(200)).toBe("51-200");
    expect(queueDepthBucket(1000)).toBe("201-1000");
    expect(queueDepthBucket(1001)).toBe("1000+");
    expect(queueDepthBucket(-1)).toBe("unknown");
    expect(queueDepthBucket(Number.NaN)).toBe("unknown");
    for (const d of [0, 5, 25, 100, 500, 5000]) {
      expect(QUEUE_DEPTH_BUCKETS).toContain(queueDepthBucket(d));
    }
  });

  it("buckets age by human time tiers", () => {
    expect(queueAgeBucket(0)).toBe("<5s");
    expect(queueAgeBucket(4_999)).toBe("<5s");
    expect(queueAgeBucket(5_000)).toBe("5-30s");
    expect(queueAgeBucket(120_000)).toBe("2-10m");
    expect(queueAgeBucket(3_600_000)).toBe("60m+");
    expect(queueAgeBucket(-1)).toBe("unknown");
    for (const ms of [0, 6_000, 90_000, 300_000, 7_200_000]) {
      expect(QUEUE_AGE_BUCKETS).toContain(queueAgeBucket(ms));
    }
  });
});

describe("bounded classifiers fold unknowns into a closed label space", () => {
  it("failureClassForCode maps known codes and folds the rest", () => {
    expect(failureClassForCode("malware_detected")).toBe("blocked");
    expect(failureClassForCode("scan_invalid")).toBe("blocked");
    expect(failureClassForCode("scan_unavailable")).toBe("scan_unavailable");
    expect(failureClassForCode("not_found")).toBe("input_missing");
    expect(failureClassForCode("not_implemented")).toBe("unsupported");
    expect(failureClassForCode("processing_error")).toBe("processing_error");
    expect(failureClassForCode("some_new_code")).toBe("other");
    expect(failureClassForCode(undefined)).toBe("none");
    for (const code of ["malware_detected", "x", undefined]) {
      expect(FAILURE_CLASSES).toContain(failureClassForCode(code));
    }
  });

  it("processorKindForId maps compression/ocr and folds the rest", () => {
    expect(processorKindForId("compression")).toBe("compress");
    expect(processorKindForId("ocr")).toBe("ocr");
    expect(processorKindForId("something")).toBe("other");
    expect(processorKindForId(undefined)).toBe("other");
    for (const id of ["compression", "ocr", "future"]) {
      expect(PROCESSOR_KINDS).toContain(processorKindForId(id));
    }
  });

  it("lifecycleDriftMetric coerces a bad count to a safe integer", () => {
    expect(lifecycleDriftMetric(3).value).toBe(3);
    expect(lifecycleDriftMetric(-1).value).toBe(0);
    expect(lifecycleDriftMetric(Number.NaN).value).toBe(0);
    expect(lifecycleDriftMetric(2.9).value).toBe(2);
  });
});

describe("label vocabularies are non-empty and stringly bounded", () => {
  it("exports closed enum arrays", () => {
    for (const arr of [PROCESSOR_KINDS, ENGINE_CAPABILITIES, BOOL_LABELS, FAILURE_CLASSES]) {
      expect(arr.length).toBeGreaterThan(0);
      for (const v of arr) expect(typeof v).toBe("string");
    }
  });
});
