// @vitest-environment node
/**
 * Runner orchestration proofs (Phase 31). The runner is the whole CLI behavior over
 * injected seams, so these pin: each source path (runtime / web / stdin / file), the
 * exit-code policy end to end, ingest failures degrading to a usage error (never a
 * throw, never an echo), and the format dispatch — all with a fake provider, no
 * runtime/broker/filesystem.
 */
import { describe, expect, it, vi } from "vitest";
import { runOpsCheck, type OpsCheckProvider } from "./run";
import type { CollectedOperations } from "./collect";
import { normalizeOperationsSnapshot } from "./ingest";
import { isUsageError, type OpsCheckResult } from "./render";
import { OPS_CHECK_EXIT } from "../observability/alerts";
import {
  createWorkerMetricsCollector,
  type WorkerMetricsSnapshot,
} from "../observability/collector";
import { engineCapabilityMetric } from "../observability/metrics";

const NOW = "2026-07-03T00:00:00.000Z";

const HEALTHY = {
  version: 1,
  vantage: "web",
  mode: "remote-configured",
  drainable: true,
  daemon: { state: "observed", source: "queue-broker", lastSeen: "under-30s", mode: "loop" },
  health: "ok",
  recommendedAction: "none",
  subsystems: [
    { id: "storage", health: "ok" },
    { id: "queue", health: "ok" },
  ],
  proofs: { compressionDeep: "available", ocr: "unavailable" },
  lifecycleVerification: { verdict: "verified", health: "ok" },
  lastLoop: null,
};

const BLOCKED = {
  ...HEALTHY,
  drainable: false,
  daemon: { state: "disabled", source: "none" },
  health: "blocked",
  recommendedAction: "configure-providers",
  subsystems: [
    { id: "drainability", health: "blocked" },
    { id: "storage", health: "warn" },
    { id: "queue", health: "warn" },
  ],
};

function snapshotOf(obj: unknown) {
  const r = normalizeOperationsSnapshot(obj);
  if (!r.ok) throw new Error(`fixture invalid: ${r.issues.join(",")}`);
  return r.snapshot;
}

function metricsSnapshot(): WorkerMetricsSnapshot {
  const c = createWorkerMetricsCollector();
  c.record(engineCapabilityMetric("compression_deep", true));
  return c.snapshot();
}

function provider(over: Partial<OpsCheckProvider> = {}): OpsCheckProvider {
  return {
    collectLive: async (): Promise<CollectedOperations> => ({
      snapshot: snapshotOf(HEALTHY),
      slo: null,
      metrics: null,
    }),
    readInput: async () => JSON.stringify(HEALTHY),
    now: () => NOW,
    ...over,
  };
}

function asResult(outcome: unknown): OpsCheckResult {
  if (isUsageError(outcome as never)) throw new Error("expected a result, got usage error");
  return outcome as OpsCheckResult;
}

describe("runOpsCheck — live sources", () => {
  it("evaluates a healthy runtime snapshot to OK", async () => {
    const run = await runOpsCheck({ source: "runtime", format: "json" }, provider());
    expect(run.exitCode).toBe(OPS_CHECK_EXIT.OK);
    const result = asResult(run.outcome);
    expect(result.ok).toBe(true);
    expect(result.severity).toBe("ok");
    expect(result.source).toBe("runtime");
    expect(result.generatedAt).toBe(NOW);
    expect(JSON.parse(run.output).schema).toBe("pdfxyz.ops-check/1");
  });

  it("evaluates a not-drainable snapshot to CRITICAL", async () => {
    const run = await runOpsCheck(
      { source: "runtime", format: "json" },
      provider({
        collectLive: async () => ({ snapshot: snapshotOf(BLOCKED), slo: null, metrics: null }),
      }),
    );
    expect(run.exitCode).toBe(OPS_CHECK_EXIT.CRITICAL);
    expect(asResult(run.outcome).severity).toBe("critical");
  });

  it("routes the --web source to the web collector", async () => {
    const collectLive = vi.fn(async () => ({
      snapshot: snapshotOf(HEALTHY),
      slo: null,
      metrics: null,
    }));
    await runOpsCheck({ source: "web", format: "json" }, provider({ collectLive }));
    expect(collectLive).toHaveBeenCalledWith("web");
  });
});

describe("runOpsCheck — ingest sources", () => {
  it("parses a piped stdin snapshot", async () => {
    const run = await runOpsCheck(
      { source: "stdin", format: "json" },
      provider({ readInput: async () => JSON.stringify(HEALTHY) }),
    );
    expect(run.exitCode).toBe(OPS_CHECK_EXIT.OK);
    expect(asResult(run.outcome).source).toBe("stdin");
  });

  it("computes SLOs from an ingested metrics series", async () => {
    const envelope = JSON.stringify({
      operations: HEALTHY,
      metrics: { series: [engineCapabilityMetric("compression_deep", true)] },
    });
    const run = await runOpsCheck(
      { source: "stdin", format: "json" },
      provider({ readInput: async () => envelope }),
    );
    const result = asResult(run.outcome);
    expect(result.slo).not.toBeNull();
    expect(result.slo?.total).toBeGreaterThan(0);
  });

  it("degrades invalid JSON to a usage error (exit 1), never a throw", async () => {
    const run = await runOpsCheck(
      { source: "stdin", format: "json" },
      provider({ readInput: async () => "{not json" }),
    );
    expect(run.exitCode).toBe(OPS_CHECK_EXIT.USAGE);
    expect(isUsageError(run.outcome)).toBe(true);
    if (isUsageError(run.outcome)) expect(run.outcome.issues).toContain("invalid-json");
  });

  it("degrades an unreadable file to a usage error", async () => {
    const run = await runOpsCheck(
      { source: "file", filePath: "/nope.json", format: "json" },
      provider({
        readInput: async () => {
          throw new Error("ENOENT");
        },
      }),
    );
    expect(run.exitCode).toBe(OPS_CHECK_EXIT.USAGE);
    if (isUsageError(run.outcome)) expect(run.outcome.issues).toContain("input-unreadable");
  });

  it("degrades a structurally-invalid snapshot to a usage error", async () => {
    const run = await runOpsCheck(
      { source: "stdin", format: "json" },
      provider({ readInput: async () => JSON.stringify({ nonsense: true }) }),
    );
    expect(run.exitCode).toBe(OPS_CHECK_EXIT.USAGE);
    expect(isUsageError(run.outcome)).toBe(true);
  });
});

describe("runOpsCheck — format dispatch", () => {
  it("renders JSON by default", async () => {
    const run = await runOpsCheck({ source: "runtime", format: "json" }, provider());
    expect(() => JSON.parse(run.output)).not.toThrow();
  });

  it("renders Prometheus gauges, reusing the metric-series renderer when present", async () => {
    const run = await runOpsCheck(
      { source: "runtime", format: "prometheus" },
      provider({
        collectLive: async () => ({
          snapshot: snapshotOf(HEALTHY),
          slo: null,
          metrics: metricsSnapshot(),
        }),
      }),
    );
    expect(run.output).toMatch(/pdfxyz_ops_check_severity \d/);
    expect(run.output).toContain("worker_engine_capability"); // reused renderPrometheus
  });

  it("renders a short text summary", async () => {
    const run = await runOpsCheck({ source: "runtime", format: "text" }, provider());
    expect(run.output).toMatch(/OK|WARNING|CRITICAL|UNKNOWN/);
  });

  it("renders a usage error in the requested format", async () => {
    const run = await runOpsCheck(
      { source: "stdin", format: "prometheus" },
      provider({ readInput: async () => "boom" }),
    );
    expect(run.output).toContain("pdfxyz_ops_check_error");
  });
});
