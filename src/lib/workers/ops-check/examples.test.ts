// @vitest-environment node
/**
 * Static proof for the committed operator-healthcheck examples under
 * `docs/examples/observability/healthcheck/`. Each fixture is run through the REAL CLI
 * orchestrator ({@link runOpsCheck}) exactly as a monitor would (ingest a supplied
 * snapshot, evaluate, render, exit), and pinned to the documented severity + exit code.
 * It also proves the honesty contract: the fixtures are content-free, and a secret
 * injected into an ingested snapshot's prose can never reach the CLI's output. Offline:
 * it reads committed files only and never resolves a runtime, a broker, or a binary.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOpsCheck, type OpsCheckProvider } from "./run";
import { isUsageError, type OpsCheckResult } from "./render";
import type { AlertSeverity } from "../observability/alerts";

const DIR = join(process.cwd(), "docs", "examples", "observability", "healthcheck");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");

/** A provider that feeds fixed ingest text; `collectLive` is never used by these tests. */
function fixtureProvider(text: string): OpsCheckProvider {
  return {
    collectLive() {
      return Promise.reject(new Error("collectLive is not used for ingest fixtures"));
    },
    readInput() {
      return Promise.resolve(text);
    },
    now: () => "2026-07-03T00:00:00.000Z",
  };
}

/** The documented severity + exit code for each committed fixture. */
const CASES: Array<{ file: string; severity: AlertSeverity; exitCode: number }> = [
  { file: "healthy.json", severity: "ok", exitCode: 0 },
  { file: "stale-heartbeat.json", severity: "warn", exitCode: 3 },
  { file: "lifecycle-drift.json", severity: "critical", exitCode: 4 },
  { file: "scanner-unavailable-spike.json", severity: "critical", exitCode: 4 },
  { file: "no-config-development.json", severity: "unknown", exitCode: 2 },
];

describe("healthcheck examples evaluate to the documented severity + exit code", () => {
  for (const c of CASES) {
    it(`${c.file} → ${c.severity} (exit ${c.exitCode})`, async () => {
      const run = await runOpsCheck(
        { source: "file", filePath: c.file, format: "json" },
        fixtureProvider(read(c.file)),
      );
      expect(isUsageError(run.outcome)).toBe(false);
      const result = run.outcome as OpsCheckResult;
      expect(result.severity).toBe(c.severity);
      expect(result.exitCode).toBe(c.exitCode);
      // The rendered exit code and the structured one always agree.
      expect(run.exitCode).toBe(c.exitCode);
      // `ok` is exactly severity === "ok".
      expect(result.ok).toBe(c.severity === "ok");
    });
  }

  it("covers every committed fixture (no silent gap)", () => {
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const covered = CASES.map((c) => c.file).sort();
    expect(onDisk).toEqual(covered);
  });
});

const FORBIDDEN = [
  "amazonaws",
  "akia",
  "://",
  "secret",
  "us-east-1",
  ".upstash.io",
  ".r2.cloudflarestorage",
  "password",
  "bearer ",
  "/tmp/",
];

describe("healthcheck examples are content-free", () => {
  it("no fixture leaks an endpoint, bucket, credential, path, or scheme", () => {
    for (const c of CASES) {
      const text = read(c.file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${c.file} must not leak ${leak}`).not.toContain(leak);
      }
    }
  });

  it("every fixture is valid JSON", () => {
    for (const c of CASES) {
      expect(() => JSON.parse(read(c.file)), c.file).not.toThrow();
    }
  });

  it("no rendered CLI output for any fixture leaks a forbidden token", async () => {
    for (const c of CASES) {
      const run = await runOpsCheck(
        { source: "stdin", format: "json" },
        fixtureProvider(read(c.file)),
      );
      const out = run.output.toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(out, `${c.file} output must not leak ${leak}`).not.toContain(leak);
      }
    }
  });
});

describe("no-leak: an ingested snapshot's prose is re-authored, never echoed", () => {
  const SECRET = "s3://leaky-bucket/secret-invoice.pdf?sig=deadbeefcafef00d";

  it("a secret injected into every ingested string field never reaches the output", async () => {
    const base = JSON.parse(read("lifecycle-drift.json")) as {
      operations: Record<string, unknown> & {
        daemon: Record<string, unknown>;
        subsystems: Array<Record<string, unknown>>;
        lifecycleVerification: Record<string, unknown>;
        proofs: Record<string, unknown>;
      };
    };
    // Poison every non-enum prose field the snapshot carries. The load-bearing enums
    // (health, recommendedAction, daemon.state, subsystem id/health) stay valid, so the
    // snapshot still evaluates — proving the secret is dropped on the SUCCESS path, not
    // merely rejected as malformed.
    const ops = base.operations;
    ops.detail = SECRET;
    ops.recommendedActionDetail = SECRET;
    ops.daemon.detail = SECRET;
    ops.lifecycleVerification.detail = SECRET;
    for (const s of ops.subsystems) {
      s.label = SECRET;
      s.detail = SECRET;
    }

    const run = await runOpsCheck(
      { source: "stdin", format: "json" },
      fixtureProvider(JSON.stringify(base)),
    );

    expect(run.output).not.toContain(SECRET);
    expect(JSON.stringify(run.outcome)).not.toContain(SECRET);
    // …and it still produced the correct, authored verdict.
    const result = run.outcome as OpsCheckResult;
    expect(result.severity).toBe("critical");
    expect(result.exitCode).toBe(4);
  });

  it("a bad-flag / unreadable input is a usage error (exit 1), never a crash or a leak", async () => {
    const run = await runOpsCheck(
      { source: "stdin", format: "json" },
      fixtureProvider(`{ not valid json ${SECRET}`),
    );
    expect(isUsageError(run.outcome)).toBe(true);
    expect(run.exitCode).toBe(1);
    expect(run.output).not.toContain(SECRET);
  });
});
