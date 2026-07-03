// @vitest-environment node
/**
 * End-to-end exit-code + output contract for the ops-check CLI (`pnpm worker:ops-check`,
 * i.e. `scripts/worker-ops-check.ts`).
 *
 * The parser, alert policy, ingest, and renderers are unit-tested elsewhere; this spawns
 * the REAL CLI in a deliberately unconfigured environment (and with synthetic snapshots
 * on stdin/file) and pins the codes a cron job / uptime monitor / CI gate depends on:
 *
 *   0  OK        — a healthy synthetic snapshot
 *   1  usage     — a bad flag, or unreadable/malformed input
 *   4  CRITICAL  — no queue/storage here (a worker cannot run), or a blocked snapshot
 *
 * It is the automated form of the healthcheck smoke and proves the CLI evaluates
 * honestly rather than fabricating health — and never leaks an ingested string.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { OPS_CHECK_EXIT } from "../observability/alerts";

interface CliResult {
  status: number;
  stdout: string;
}

/** Run the real CLI with providers forced empty so no-config assertions are deterministic. */
function runCli(
  args: string[],
  opts: { input?: string; env?: Record<string, string> } = {},
): CliResult {
  try {
    const stdout = execFileSync("pnpm", ["-s", "worker:ops-check", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PDFXYZ_STORAGE_PROVIDER: "",
        PDFXYZ_QUEUE_PROVIDER: "",
        PDFXYZ_WORKER_MODE: "",
        PDFXYZ_WORKER_HEARTBEAT: "",
        ...opts.env,
      },
      ...(opts.input !== undefined ? { input: opts.input } : {}),
      encoding: "utf8",
      timeout: 90_000,
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; signal?: string | null; stdout?: string };
    if (typeof e.status === "number") return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // killed by a signal or never spawned — surface loudly
  }
}

const SPAWN_TIMEOUT_MS = 120_000;

const HEALTHY = JSON.stringify({
  health: "ok",
  recommendedAction: "none",
  daemon: { state: "observed", source: "queue-broker", lastSeen: "under-30s" },
  subsystems: [
    { id: "storage", health: "ok" },
    { id: "queue", health: "ok" },
  ],
  drainable: true,
});

const BLOCKED = JSON.stringify({
  health: "blocked",
  recommendedAction: "configure-providers",
  daemon: { state: "disabled" },
  subsystems: [{ id: "drainability", health: "blocked" }],
});

const SECRET = "s3://leaky-bucket/customer-tax-return.pdf?sig=deadbeef";

const tmp = mkdtempSync(join(tmpdir(), "ops-check-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("worker ops-check CLI — exit codes + output", () => {
  it(
    "exits 0 for --help and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(OPS_CHECK_EXIT.OK);
      expect(r.stdout).toMatch(/operations healthcheck/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits CRITICAL for --runtime with no queue/storage (a worker cannot run here)",
    () => {
      const r = runCli(["--runtime"]);
      expect(r.status).toBe(OPS_CHECK_EXIT.CRITICAL);
      expect(JSON.parse(r.stdout).severity).toBe("critical");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits CRITICAL for --web with no queue/storage",
    () => {
      expect(runCli(["--web"]).status).toBe(OPS_CHECK_EXIT.CRITICAL);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits OK for a healthy synthetic snapshot on stdin",
    () => {
      const r = runCli(["--stdin"], { input: HEALTHY });
      expect(r.status).toBe(OPS_CHECK_EXIT.OK);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.severity).toBe("ok");
      expect(parsed.schema).toBe("pdfxyz.ops-check/1");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits CRITICAL for a blocked synthetic snapshot on stdin",
    () => {
      expect(runCli(["--stdin"], { input: BLOCKED }).status).toBe(OPS_CHECK_EXIT.CRITICAL);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits usage (1) for malformed stdin input — never fabricates health",
    () => {
      expect(runCli(["--stdin"], { input: "{not json" }).status).toBe(OPS_CHECK_EXIT.USAGE);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits usage (1) for an unknown flag",
    () => {
      expect(runCli(["--definitely-not-a-flag"]).status).toBe(OPS_CHECK_EXIT.USAGE);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits usage (1) for conflicting sources",
    () => {
      expect(runCli(["--web", "--stdin"]).status).toBe(OPS_CHECK_EXIT.USAGE);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a snapshot from --file and renders Prometheus gauges",
    () => {
      const path = join(tmp, "snap.json");
      writeFileSync(path, HEALTHY);
      const r = runCli(["--file", path, "--prometheus"]);
      expect(r.status).toBe(OPS_CHECK_EXIT.OK);
      expect(r.stdout).toMatch(/pdfxyz_ops_check_severity 0/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never echoes a content-bearing string from an ingested snapshot",
    () => {
      const poisoned = JSON.stringify({
        health: "warn",
        recommendedAction: "reconcile-lifecycle-drift",
        detail: SECRET,
        recommendedActionDetail: SECRET,
        daemon: { state: "stale", source: "queue-broker", detail: SECRET },
        subsystems: [{ id: "lifecycle-verification", health: "warn", detail: SECRET }],
        lifecycleVerification: { verdict: "drift", health: "warn", detail: SECRET },
      });
      const r = runCli(["--stdin"], { input: poisoned });
      // A warn/critical verdict (degraded), but crucially no leak of the ingested strings.
      expect([OPS_CHECK_EXIT.WARN, OPS_CHECK_EXIT.CRITICAL]).toContain(r.status);
      expect(r.stdout).not.toContain(SECRET);
    },
    SPAWN_TIMEOUT_MS,
  );
});
