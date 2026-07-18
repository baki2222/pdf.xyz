// @vitest-environment node
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { describe, expect, it } from "vitest";

/**
 * The automated form of the `worker:artifact-cleanup` checks in `scripts/worker-smoke.sh`:
 * it spawns the REAL CLI and asserts the documented exit-code ladder + content-free output.
 * Node env; each `it` gets a generous per-test spawn timeout.
 */
const SPAWN_TIMEOUT_MS = 90_000;
const FIX = "docs/examples/artifacts/cleanup";

interface RunResult {
  status: number;
  stdout: string;
}

function runCli(args: string[], opts: { input?: string } = {}): RunResult {
  try {
    const stdout = runWorkerCliSync(["-s", "worker:artifact-cleanup", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PDFXYZ_STORAGE_PROVIDER: "",
        PDFXYZ_QUEUE_PROVIDER: "",
        PDFXYZ_WORKER_MODE: "",
      },
      ...(opts.input !== undefined ? { input: opts.input } : {}),
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as {
      status?: number | null;
      signal?: string | null;
      stdout?: string;
    };
    if (typeof e.status === "number")
      return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // killed by a signal or never spawned — surface loudly
  }
}

describe("worker:artifact-cleanup CLI", () => {
  it(
    "--help prints usage and exits 0",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/cleanup verifier \(dry-run sweeper\)/i);
      expect(r.stdout).toMatch(/Exit codes:/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "maps each fixture to its documented exit code",
    () => {
      expect(runCli([`--file=${FIX}/inventory-clean.json`]).status).toBe(0);
      expect(runCli([`--file=${FIX}/inventory-unknown.json`]).status).toBe(2);
      expect(runCli([`--file=${FIX}/inventory-drift.json`]).status).toBe(3);
      expect(runCli([`--file=${FIX}/inventory-breach.json`]).status).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "emits stable JSON for a fixture",
    () => {
      const r = runCli([
        `--file=${FIX}/inventory-drift.json`,
        "--json",
        "--plan",
      ]);
      expect(r.status).toBe(3);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.tool).toBe("worker-artifact-cleanup");
      expect(parsed.dryRun).toBe(true);
      expect(parsed.report.verdict).toBe("drift");
      expect(Array.isArray(parsed.report.plan)).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads an inventory from stdin",
    () => {
      const input = JSON.stringify({
        artifacts: [
          {
            lifecycle: "live",
            manifest: "valid",
            provider: "remote-configured",
            kind: "pdf",
          },
        ],
      });
      const r = runCli(["--stdin", "--text"], { input });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/verdict\s+ok \(exit 0\)/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "treats bad usage as an input error (exit 1)",
    () => {
      expect(runCli(["--not-a-flag"]).status).toBe(1); // unknown flag
      expect(runCli(["--stdin", "--file=x.json"]).status).toBe(1); // conflicting inputs
      expect(runCli(["--json"]).status).toBe(1); // no input
      expect(runCli(["--stdin", "--apply"]).status).toBe(1); // never deletes
      expect(runCli(["--stdin"], { input: "{ not json" }).status).toBe(1); // malformed inventory
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "leaks nothing from a hostile inventory piped on stdin",
    () => {
      const hostile = JSON.stringify({
        artifacts: [
          {
            objectKey: "artifacts/ACME-Q3-SECRET.pdf",
            bucket: "prod-user-uploads",
            signedUrl:
              "https://prod.s3.amazonaws.com/x?X-Amz-Signature=deadbeefcafe",
            filename: "Bank Statement.pdf",
            ocrText: "Account 1234 balance",
            env: "AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE",
            expiresAtMs: 1000,
            manifest: "valid",
            provider: "remote-configured",
          },
        ],
      });
      const r = runCli(
        ["--stdin", "--json", "--plan", "--breakdown", "--metrics"],
        { input: hostile },
      );
      const out = r.stdout.toLowerCase();
      for (const needle of [
        "acme",
        "secret",
        "prod-user-uploads",
        "amazonaws",
        "deadbeef",
        "bank statement",
        "akia",
        "://",
        ".pdf",
      ]) {
        expect(out).not.toContain(needle);
      }
      // It still classified the (expired) object.
      expect(
        JSON.parse(r.stdout).report.categories["expired-but-present"],
      ).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );
});
