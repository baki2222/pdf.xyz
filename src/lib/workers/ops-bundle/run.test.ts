import { afterEach, describe, expect, it } from "vitest";
import { runOpsBundle, type OpsBundleProvider } from "./run";
import { resetOpsBundleSink, setOpsBundleSink } from "./metrics";
import { isOpsBundleUsageError } from "./types";
import type { OpsBundleArgs } from "./args";
import type { WorkerMetricSample } from "../observability/metrics";

const NOW = "2026-07-03T00:00:00.000Z";

function healthyResult(): string {
  return JSON.stringify({
    schema: "pdfxyz.ops-check/1",
    severity: "ok",
    action: "none",
    liveness: {
      state: "observed",
      source: "self",
      lastSeen: "under-30s",
      severity: "ok",
      reason: "liveness-observed",
      action: "none",
    },
    snapshot: {
      vantage: "worker",
      health: "ok",
      drainable: true,
      daemonObserved: true,
      subsystems: [],
      proofs: { compressionDeep: "available", ocr: "available" },
      cleanupEvidence: {
        state: "disabled",
        reason: "no_report_configured",
        provider: "unknown",
        freshness: "unknown",
      },
      lastLoop: null,
    },
    slo: null,
    alerts: [],
  });
}

function provider(over: Partial<OpsBundleProvider> = {}): OpsBundleProvider {
  return {
    readOpsCheck: async () => healthyResult(),
    readPipeline: async () =>
      JSON.stringify({
        schema: "pdfxyz.cleanup-pipeline/1",
        severity: "ok",
        arms: [],
      }),
    now: () => NOW,
    ...over,
  };
}

const ARGS: OpsBundleArgs = {
  opsCheckSource: "stdin",
  format: "json",
  pretty: true,
};

afterEach(() => resetOpsBundleSink());

describe("runOpsBundle", () => {
  it("builds a bundle and returns the rollup exit code", async () => {
    const run = await runOpsBundle(ARGS, provider());
    expect(isOpsBundleUsageError(run.outcome)).toBe(false);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.output).schema).toBe("pdfxyz.ops-bundle/1");
  });

  it("composes an optional pipeline breach into the rollup", async () => {
    const run = await runOpsBundle(
      { ...ARGS, pipelinePath: "pipe.json" },
      provider({
        readPipeline: async () =>
          JSON.stringify({
            schema: "pdfxyz.cleanup-pipeline/1",
            severity: "breach",
            arms: [{ arm: "verify", severity: "breach", projected: false }],
          }),
      }),
    );
    expect(run.exitCode).toBe(4);
  });

  it("is a usage error (exit 1) when the required input cannot be read", async () => {
    const run = await runOpsBundle(
      ARGS,
      provider({
        readOpsCheck: async () => {
          throw new Error("nope");
        },
      }),
    );
    expect(run.exitCode).toBe(1);
    expect(isOpsBundleUsageError(run.outcome)).toBe(true);
    if (isOpsBundleUsageError(run.outcome))
      expect(run.outcome.issues).toEqual(["ops-check-input-unreadable"]);
  });

  it("is a usage error when the required input is malformed", async () => {
    const run = await runOpsBundle(
      ARGS,
      provider({ readOpsCheck: async () => "{not json" }),
    );
    expect(run.exitCode).toBe(1);
    if (isOpsBundleUsageError(run.outcome))
      expect(run.outcome.issues).toEqual(["ops-check-input-malformed"]);
  });

  it("surfaces an unreadable OPTIONAL pipeline honestly without failing the bundle", async () => {
    const run = await runOpsBundle(
      { ...ARGS, pipelinePath: "pipe.json" },
      provider({
        readPipeline: async () => {
          throw new Error("io");
        },
      }),
    );
    expect(isOpsBundleUsageError(run.outcome)).toBe(false);
    if (!isOpsBundleUsageError(run.outcome)) {
      expect(run.outcome.sections.pipeline.source).toBe("unreadable");
      expect(run.outcome.rollup.severity).toBe("unknown"); // healthy ops + unreadable pipeline
    }
  });

  it("records exactly one bounded metric per run (including usage)", async () => {
    const captured: WorkerMetricSample[] = [];
    setOpsBundleSink((s) => captured.push(s));
    await runOpsBundle(ARGS, provider());
    await runOpsBundle(ARGS, provider({ readOpsCheck: async () => "{bad" }));
    expect(captured.map((s) => s.labels.severity)).toEqual(["ok", "usage"]);
  });
});
