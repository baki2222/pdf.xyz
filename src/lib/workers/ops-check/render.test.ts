// @vitest-environment node
/**
 * Renderer proofs (Phase 31). All three formats derive from one content-free result, so
 * these pin: JSON is stable + parseable, Prometheus emits scrapeable gauges with only
 * bounded-enum labels (never free text), text is a short summary, and a usage error
 * renders in every format. The result is content-free by construction, so the renderers
 * cannot introduce a leak.
 */
import { describe, expect, it } from "vitest";
import {
  OPS_CHECK_SCHEMA,
  renderOpsCheck,
  renderOpsCheckJson,
  renderOpsCheckPrometheus,
  renderOpsCheckText,
  type OpsCheckResult,
  type OpsCheckUsageError,
} from "./render";
import { OPS_CHECK_EXIT } from "../observability/alerts";
import {
  createWorkerMetricsCollector,
  type WorkerMetricsSnapshot,
} from "../observability/collector";
import { engineCapabilityMetric } from "../observability/metrics";

function makeResult(over: Partial<OpsCheckResult> = {}): OpsCheckResult {
  return {
    schema: OPS_CHECK_SCHEMA,
    generatedAt: "2026-07-03T00:00:00.000Z",
    source: "runtime",
    ok: true,
    severity: "ok",
    exitCode: OPS_CHECK_EXIT.OK,
    action: "none",
    actionDetail: "no action required",
    summary: "OK — everything observable here is healthy. Next action: none.",
    liveness: {
      state: "observed",
      severity: "ok",
      reason: "liveness-observed",
      action: "monitor",
      detail: "a worker is observably running",
      source: "queue-broker",
      lastSeen: "under-30s",
    },
    snapshot: {
      vantage: "web",
      health: "ok",
      drainable: true,
      daemonObserved: true,
      subsystems: [
        { id: "storage", health: "ok" },
        { id: "malware-scan", health: "warn" },
      ],
      proofs: { compressionDeep: "available", ocr: "unavailable" },
      cleanupEvidence: {
        state: "disabled",
        reason: "no_report_configured",
        provider: "unknown",
        freshness: "unknown",
      },
      rateLimit: { code: "disabled", enforced: false, distributed: false },
      aiSpend: { code: "unknown", enforced: false, probe: "unknown" },
      lastLoop: null,
    },
    slo: null,
    alerts: [],
    ...over,
  };
}

const usageError: OpsCheckUsageError = {
  schema: OPS_CHECK_SCHEMA,
  generatedAt: "2026-07-03T00:00:00.000Z",
  source: "stdin",
  ok: false,
  error: "usage",
  exitCode: OPS_CHECK_EXIT.USAGE,
  issues: ["invalid-json"],
  detail: "the input could not be validated",
};

function metricsSnapshot(): WorkerMetricsSnapshot {
  const c = createWorkerMetricsCollector();
  c.record(engineCapabilityMetric("compression_deep", true));
  return c.snapshot();
}

describe("renderOpsCheckJson", () => {
  it("produces stable, parseable JSON with a trailing newline", () => {
    const out = renderOpsCheckJson(makeResult());
    expect(out.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.schema).toBe("pdfxyz.ops-check/1");
    expect(parsed.severity).toBe("ok");
  });

  it("renders a usage error object", () => {
    const parsed = JSON.parse(renderOpsCheckJson(usageError));
    expect(parsed.error).toBe("usage");
    expect(parsed.exitCode).toBe(OPS_CHECK_EXIT.USAGE);
  });
});

describe("renderOpsCheckPrometheus", () => {
  it("emits a scrapeable severity gauge and an info gauge with bounded labels", () => {
    const out = renderOpsCheckPrometheus(makeResult({ severity: "warn" }));
    expect(out).toMatch(/^pdfxyz_ops_check_severity 1$/m); // warn → code 1
    expect(out).toMatch(/pdfxyz_ops_check_info\{[^}]*severity="warn"[^}]*\} 1/);
    expect(out).toMatch(/pdfxyz_ops_check_daemon_observed 1/);
    expect(out).toMatch(
      /pdfxyz_ops_check_subsystem\{subsystem="malware-scan",health="warn"\} 1/,
    );
  });

  it("maps each severity to its distinct scrape code", () => {
    const code = (s: OpsCheckResult["severity"]) =>
      renderOpsCheckPrometheus(makeResult({ severity: s })).match(
        /pdfxyz_ops_check_severity (\d)/,
      )?.[1];
    expect(code("ok")).toBe("0");
    expect(code("warn")).toBe("1");
    expect(code("critical")).toBe("2");
    expect(code("unknown")).toBe("3");
  });

  it("appends the reused metric-series exposition when a series is present", () => {
    const out = renderOpsCheckPrometheus(makeResult(), metricsSnapshot());
    expect(out).toContain("worker_engine_capability");
  });

  it("keeps every label value a bounded enum (no free text)", () => {
    const out = renderOpsCheckPrometheus(makeResult({ severity: "critical" }));
    // Extract every label value and confirm none contains whitespace/quotes/paths.
    const labelValues = [...out.matchAll(/([a-z_]+)="([^"]*)"/g)].map(
      (m) => m[2],
    );
    expect(labelValues.length).toBeGreaterThan(0);
    for (const v of labelValues) {
      expect(v).toMatch(/^[a-z0-9_-]+$/); // bounded enum shape only
    }
  });

  it("renders a usage error as an error gauge", () => {
    expect(renderOpsCheckPrometheus(usageError)).toContain(
      'pdfxyz_ops_check_error{kind="usage"} 1',
    );
  });
});

describe("renderOpsCheckText", () => {
  it("renders the summary and any alerts", () => {
    const out = renderOpsCheckText(
      makeResult({
        severity: "warn",
        summary:
          "WARNING — a recommended fix is outstanding. Next action: fix-scanner.",
        alerts: [
          {
            source: "malware-scan",
            severity: "warn",
            reason: "scanner-unavailable",
            action: "fix-scanner",
            detail: "fix the scanner",
          },
        ],
      }),
    );
    expect(out).toContain("WARNING");
    expect(out).toContain("malware-scan");
    expect(out).toContain("scanner-unavailable");
  });

  it("renders a usage error line", () => {
    expect(renderOpsCheckText(usageError)).toContain("usage error");
  });
});

describe("renderOpsCheck dispatch", () => {
  it("routes to the requested format", () => {
    expect(() =>
      JSON.parse(renderOpsCheck(makeResult(), "json")),
    ).not.toThrow();
    expect(renderOpsCheck(makeResult(), "prometheus")).toContain(
      "pdfxyz_ops_check_severity",
    );
    expect(renderOpsCheck(makeResult(), "text")).toContain("OK");
  });
});

describe("cleanup evidence rendering (Phase 44)", () => {
  const withCleanup = (
    ce: OpsCheckResult["snapshot"]["cleanupEvidence"],
  ): OpsCheckResult =>
    makeResult({
      snapshot: {
        vantage: "web",
        health: "ok",
        drainable: true,
        daemonObserved: true,
        subsystems: [{ id: "cleanup-evidence", health: "warn" }],
        proofs: { compressionDeep: "unknown", ocr: "unknown" },
        cleanupEvidence: ce,
        rateLimit: { code: "disabled", enforced: false, distributed: false },
        aiSpend: { code: "unknown", enforced: false, probe: "unknown" },
        lastLoop: null,
      },
    });

  it("JSON carries the bounded cleanup evidence digest", () => {
    const ce = {
      state: "warning",
      reason: "cleanup_drift",
      provider: "remote-configured",
      freshness: "fresh",
    } as const;
    const parsed = JSON.parse(renderOpsCheckJson(withCleanup(ce)));
    expect(parsed.snapshot.cleanupEvidence).toEqual(ce);
  });

  it("Prometheus emits a bounded pdfxyz_ops_check_cleanup_evidence gauge", () => {
    const out = renderOpsCheckPrometheus(
      withCleanup({
        state: "stale",
        reason: "report_stale",
        provider: "unknown",
        freshness: "stale",
      }),
    );
    expect(out).toContain(
      'pdfxyz_ops_check_cleanup_evidence{state="stale",reason="report_stale",provider="unknown",freshness="stale"} 1',
    );
  });

  it("text summarizes the cleanup evidence state", () => {
    const out = renderOpsCheckText(
      withCleanup({
        state: "critical",
        reason: "cleanup_breach",
        provider: "unknown",
        freshness: "fresh",
      }),
    );
    expect(out).toContain("cleanup evidence: critical (cleanup_breach, fresh)");
  });
});
