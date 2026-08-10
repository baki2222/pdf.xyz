/**
 * The no-leak proof for the operations evidence bundle (Phase 45).
 *
 * The bundle's honesty contract is "no-leak by reconstruction": it validates every field against a
 * bounded enum and re-authors all prose from app-owned maps, so a hand-crafted summary carrying a
 * filename, object key, bucket, URL, endpoint, or secret in ANY string field can never reach the
 * output. These tests poison every prose/string field of an ops-check result AND a pipeline summary
 * and prove the rendered bundle (JSON + text) — and the structured outcome — never echo them, while
 * still resolving the correct posture.
 */

import { describe, expect, it } from "vitest";
import { runOpsBundle, type OpsBundleProvider } from "./run";
import { isOpsBundleUsageError } from "./types";
import type { OpsBundleArgs } from "./args";

const NOW = "2026-07-03T00:00:00.000Z";

/** A dense payload of every locator/content shape the bundle must never echo. */
const SECRET =
  "s3://leaky-bucket/customer-tax-return.pdf?sig=deadbeef AKIAIOSFODNN7EXAMPLE https://acct.r2.cloudflarestorage.com/obj token=h_abc123 192.168.0.1";

/** Substrings that must never appear in any bundle output. */
const FORBIDDEN = [
  "leaky-bucket",
  "customer-tax-return",
  ".pdf",
  "AKIA",
  "cloudflarestorage",
  "deadbeef",
  "192.168.0.1",
  "s3://",
  "https://",
  "token=",
  "SECRET-",
];

/** A valid `pdfxyz.ops-check/1` result with SECRET injected into every string field. */
function poisonedOpsCheck(): string {
  return JSON.stringify({
    schema: "pdfxyz.ops-check/1",
    generatedAt: `SECRET-${SECRET}`,
    source: `SECRET-${SECRET}`,
    ok: false,
    severity: "critical",
    exitCode: 4,
    action: "configure-storage",
    actionDetail: `SECRET-${SECRET}`,
    summary: `SECRET-${SECRET}`,
    liveness: {
      state: "stale",
      source: "queue-broker",
      lastSeen: "over-10m",
      severity: "warn",
      reason: "liveness-stale",
      action: "investigate-worker-liveness",
      detail: `SECRET-${SECRET}`,
    },
    snapshot: {
      vantage: "worker",
      health: "blocked",
      drainable: false,
      daemonObserved: true, // forged — must be recomputed to false (liveness is stale)
      detail: `SECRET-${SECRET}`,
      recommendedActionDetail: `SECRET-${SECRET}`,
      subsystems: [
        {
          id: "storage",
          label: `SECRET-${SECRET}`,
          health: "warn",
          detail: `SECRET-${SECRET}`,
        },
        {
          id: "lifecycle-verification",
          label: `SECRET-${SECRET}`,
          health: "blocked",
          detail: `SECRET-${SECRET}`,
        },
      ],
      proofs: { compressionDeep: "available", ocr: "unavailable" },
      cleanupEvidence: {
        state: "critical",
        reason: "cleanup_breach",
        provider: "remote-configured",
        freshness: "fresh",
        detail: `SECRET-${SECRET}`,
      },
      lastLoop: null,
    },
    slo: {
      worst: "breach",
      evaluated: 5,
      total: 6,
      issues: [
        {
          id: "queue_age",
          status: "breach",
          observed: `SECRET-${SECRET}`,
          threshold: `SECRET-${SECRET}`,
        },
      ],
    },
    alerts: [
      {
        source: "storage",
        severity: "warn",
        reason: "storage-unconfigured",
        action: "configure-storage",
        detail: `SECRET-${SECRET}`,
        observed: `SECRET-${SECRET}`,
        threshold: `SECRET-${SECRET}`,
      },
      {
        source: "lifecycle-verification",
        severity: "critical",
        reason: "lifecycle-drift",
        action: "reconcile-lifecycle-drift",
        detail: `SECRET-${SECRET}`,
      },
    ],
  });
}

/** A valid `pdfxyz.cleanup-pipeline/1` summary with SECRET injected into every non-enum field. */
function poisonedPipeline(): string {
  return JSON.stringify({
    tool: `SECRET-${SECRET}`,
    schema: "pdfxyz.cleanup-pipeline/1",
    dryRun: true,
    generatedAt: `SECRET-${SECRET}`,
    severity: "breach",
    exitCode: 4,
    arms: [
      {
        arm: "verify",
        code: 4,
        severity: "breach",
        projected: false,
        note: `SECRET-${SECRET}`,
      },
    ],
    receipt: {
      category: `SECRET-${SECRET}`,
      at: `SECRET-${SECRET}`,
      policyId: `SECRET-${SECRET}`,
    },
  });
}

function provider(over: Partial<OpsBundleProvider> = {}): OpsBundleProvider {
  return {
    readOpsCheck: async () => poisonedOpsCheck(),
    readPipeline: async () => poisonedPipeline(),
    now: () => NOW,
    ...over,
  };
}

const ARGS: OpsBundleArgs = {
  opsCheckSource: "stdin",
  pipelinePath: "pipe.json",
  format: "json",
  pretty: true,
};

describe("ops-bundle no-leak by reconstruction", () => {
  it("never echoes a poisoned field in JSON output while still resolving critical", async () => {
    const run = await runOpsBundle(ARGS, provider());
    expect(run.exitCode).toBe(4);
    for (const bad of FORBIDDEN) expect(run.output).not.toContain(bad);
    expect(JSON.stringify(run.outcome)).not.toContain("SECRET-");
  });

  it("never echoes a poisoned field in text output", async () => {
    const run = await runOpsBundle({ ...ARGS, format: "text" }, provider());
    for (const bad of FORBIDDEN) expect(run.output).not.toContain(bad);
    expect(run.output).not.toContain("SECRET-");
  });

  it("recomputes daemonObserved from liveness even under a forged input flag", async () => {
    const run = await runOpsBundle(ARGS, provider());
    if (!isOpsBundleUsageError(run.outcome)) {
      expect(run.outcome.sections.operations.daemonObserved).toBe(false);
    }
  });

  it("re-stamps generatedAt from the clock seam, never the poisoned input", async () => {
    const run = await runOpsBundle(ARGS, provider());
    if (!isOpsBundleUsageError(run.outcome))
      expect(run.outcome.generatedAt).toBe(NOW);
  });

  it("drops a poisoned optional pipeline that is unreadable, and never echoes it", async () => {
    const run = await runOpsBundle(
      ARGS,
      provider({
        readPipeline: async () =>
          `{"schema":"pdfxyz.cleanup-pipeline/1","severity":"SECRET-${SECRET}"}`,
      }),
    );
    for (const bad of FORBIDDEN) expect(run.output).not.toContain(bad);
    if (!isOpsBundleUsageError(run.outcome))
      expect(run.outcome.sections.pipeline.source).toBe("unreadable");
  });

  it("never echoes the offending input in a usage error", async () => {
    const run = await runOpsBundle(
      ARGS,
      provider({
        readOpsCheck: async () =>
          `{"schema":"pdfxyz.ops-check/1","severity":"SECRET-${SECRET}"}`,
      }),
    );
    expect(isOpsBundleUsageError(run.outcome)).toBe(true);
    for (const bad of FORBIDDEN) expect(run.output).not.toContain(bad);
  });
});
