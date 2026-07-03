import { afterEach, describe, expect, it } from "vitest";
import { recordOpsBundle, resetOpsBundleSink, setOpsBundleSink, severityForOutcome } from "./metrics";
import { buildOpsBundle, buildUsageError } from "./build";
import { NOT_CONFIGURED_PIPELINE } from "./ingest";
import { sanitizeMetric, type WorkerMetricSample } from "../observability/metrics";
import { OPS_BUNDLE_SEVERITIES } from "./types";
import type { IngestedOperations } from "./ingest";

function ingested(severity: IngestedOperations["operations"]["severity"]): IngestedOperations {
  return {
    operations: {
      source: "ops-check",
      severity,
      health: "ok",
      vantage: "worker",
      drainable: true,
      daemonObserved: true,
      action: "none",
      actionDetail: "",
      liveness: { state: "observed", source: "self", lastSeen: null, severity: "ok", reason: "liveness-observed", action: "none" },
      subsystems: [],
      proofs: { compressionDeep: "unknown", ocr: "unknown" },
      alerts: [],
      summary: "",
    },
    slo: null,
    cleanupEvidence: { source: "ops-check", state: "disabled", reason: "no_report_configured", provider: "unknown", freshness: "unknown", detail: "" },
    lifecycle: { source: "ops-check", verification: "unknown", readiness: "unknown", verdict: "unknown", drift: false, detail: "" },
  };
}

afterEach(() => resetOpsBundleSink());

describe("recordOpsBundle", () => {
  it("emits one bounded, schema-conformant sample per generation", () => {
    const captured: WorkerMetricSample[] = [];
    setOpsBundleSink((s) => captured.push(s));
    recordOpsBundle("critical");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ metric: "worker_ops_bundle_total", kind: "counter", labels: { severity: "critical" }, value: 1 });
    // The shared metric sanitizer must accept every severity label unchanged.
    for (const sev of OPS_BUNDLE_SEVERITIES) {
      expect(sanitizeMetric({ metric: "worker_ops_bundle_total", kind: "counter", labels: { severity: sev }, value: 1 })).not.toBeNull();
    }
  });

  it("defaults to a no-op sink (nothing collected until opted in)", () => {
    // No sink set after reset ⇒ recording must not throw.
    expect(() => recordOpsBundle("ok")).not.toThrow();
  });
});

describe("severityForOutcome", () => {
  it("is the rollup severity for a bundle and `usage` for a usage error", () => {
    expect(severityForOutcome(buildOpsBundle("t", ingested("warn"), NOT_CONFIGURED_PIPELINE))).toBe("warn");
    expect(severityForOutcome(buildUsageError("t", ["ops-check-input-malformed"]))).toBe("usage");
  });
});
