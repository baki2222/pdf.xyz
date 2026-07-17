// @vitest-environment node
/**
 * End-to-end exit-code contract for the worker daemon CLI (`pnpm worker:daemon`,
 * i.e. `scripts/worker-daemon.ts`).
 *
 * The parser and runtime are unit-tested elsewhere; this spawns the REAL CLI in a
 * deliberately unconfigured environment and pins the exit codes an operator's
 * deploy smoke and the container HEALTHCHECK depend on:
 *
 *   0  usage / readiness reported                (`--help`)
 *   2  not configured to run — honest refusal    (`--dry-run-status`, `--once`, `--drain`)
 *   1  usage error                               (bad flag, conflicting modes)
 *
 * It never invokes the bare default (loop) mode — that runs forever; every mode
 * exercised here exits immediately when no queue/storage is configured. This is
 * the automated form of `scripts/worker-smoke.sh` and proves the daemon fails
 * honestly rather than fabricating work.
 */
import { execPnpmSync } from "@/tests/exec-pnpm";
import { describe, expect, it } from "vitest";

/**
 * Run `pnpm worker:daemon <args>` with the provider selectors forced empty (so
 * the no-config assertions are deterministic regardless of the ambient env) and
 * return the process exit code. Output is discarded; a spawn failure re-throws so
 * the test surfaces it loudly rather than masquerading as a wrong exit code.
 */
function runDaemon(args: string[], env: Record<string, string> = {}): number {
  try {
    execPnpmSync(["-s", "worker:daemon", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PDFXYZ_STORAGE_PROVIDER: "",
        PDFXYZ_QUEUE_PROVIDER: "",
        PDFXYZ_WORKER_MODE: "",
        ...env,
      },
      stdio: "ignore",
      timeout: 60_000,
    });
    return 0;
  } catch (err) {
    const status = (err as { status?: number | null; signal?: string | null })
      .status;
    if (typeof status === "number") return status;
    // No numeric status → the child was killed by a signal or never spawned.
    throw err;
  }
}

const SPAWN_TIMEOUT_MS = 90_000;

describe("worker daemon CLI — honest no-config exit codes", () => {
  it(
    "exits 0 for --help",
    () => {
      expect(runDaemon(["--help"])).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 2 (not configured) for --dry-run-status with no queue/storage",
    () => {
      expect(runDaemon(["--dry-run-status"])).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 2 for --once instead of fabricating a job",
    () => {
      expect(runDaemon(["--once"])).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 2 for --drain instead of fabricating work",
    () => {
      expect(runDaemon(["--drain"])).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 1 (usage error) for an unknown flag",
    () => {
      expect(runDaemon(["--definitely-not-a-flag"])).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 1 for conflicting modes",
    () => {
      expect(runDaemon(["--once", "--drain"])).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 0 for --check in a default no-config development environment",
    () => {
      expect(runDaemon(["--check"])).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 4 for --check when strict production guardrails are armed",
    () => {
      expect(runDaemon(["--check"], { PDFXYZ_WORKER_STRICT: "true" })).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 0 for offline lifecycle policy generation",
    () => {
      expect(
        runDaemon([
          "--lifecycle-policy",
          "--provider=aws-s3",
          "--key-prefix=pdfxyz",
          "--versioned",
        ]),
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 1 for a malformed option value",
    () => {
      expect(runDaemon(["--drain", "--max-ticks=0"])).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  // ─── --lifecycle-verify: offline verification against a committed observed doc ───
  // These run the REAL CLI against the content-free example documents an operator
  // would export from their bucket, pinning the ok/not-configured/invalid contract.
  const VERIFIED = "docs/examples/lifecycle/observed-verified.aws-s3.json";
  const DRIFTED = "docs/examples/lifecycle/observed-drift-weaker.aws-s3.json";

  it(
    "exits 2 (unknown) for --lifecycle-verify with no observed document",
    () => {
      expect(
        runDaemon(["--lifecycle-verify", "--provider=aws-s3", "--versioned"]),
      ).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 0 when the observed config matches the generated backstop",
    () => {
      expect(
        runDaemon([
          "--lifecycle-verify",
          "--provider=aws-s3",
          "--versioned",
          `--observed=${VERIFIED}`,
        ]),
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 4 (invalid) when the observed config drifts from the backstop",
    () => {
      expect(
        runDaemon([
          "--lifecycle-verify",
          "--provider=aws-s3",
          "--versioned",
          `--observed=${DRIFTED}`,
        ]),
      ).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 4 (invalid) when the observed document cannot be read",
    () => {
      expect(
        runDaemon([
          "--lifecycle-verify",
          "--provider=aws-s3",
          "--observed=/this/path/does/not/exist.json",
        ]),
      ).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );
});
