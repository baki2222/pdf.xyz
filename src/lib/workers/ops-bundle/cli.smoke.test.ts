// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:ops-bundle` CLI: it spawns the actual binary
 * (via tsx) and pins the documented exit-code ladder and the no-leak guarantee on live process
 * output — the tier the in-process tests cannot cover.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPS_BUNDLE_EXIT } from "./types";

const FIXTURES = join(process.cwd(), "docs", "examples", "ops-bundle");
const SPAWN_TIMEOUT_MS = 120_000;

/** A clean env so nothing about the host machine perturbs a deterministic run. */
const ENV = {
  ...process.env,
  PDFXYZ_STORAGE_PROVIDER: "",
  PDFXYZ_QUEUE_PROVIDER: "",
  PDFXYZ_WORKER_MODE: "",
  PDFXYZ_WORKER_HEARTBEAT: "",
};

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(["-s", "worker:ops-bundle", ...args], {
      cwd: process.cwd(),
      env: ENV,
      ...(input !== undefined ? { input } : {}),
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
    throw err; // killed by a signal / spawn failure — surface it
  }
}

const HEALTHY = readFixture("ops-check-healthy.json");
const CRITICAL = readFixture("ops-check-critical.json");
const SECRET = "s3://leaky-bucket/customer-tax-return.pdf?sig=deadbeef";

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("worker:ops-bundle CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(OPS_BUNDLE_EXIT.OK);
      expect(r.stdout).toMatch(/operations evidence bundle/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a healthy ops-check result on stdin exits 0",
    () => {
      const r = runCli(["--json"], HEALTHY);
      expect(r.status).toBe(OPS_BUNDLE_EXIT.OK);
      expect(JSON.parse(r.stdout).schema).toBe("pdfxyz.ops-bundle/1");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a critical ops-check result on stdin exits 4",
    () => {
      const r = runCli(["--json"], CRITICAL);
      expect(r.status).toBe(OPS_BUNDLE_EXIT.CRITICAL);
      expect(JSON.parse(r.stdout).rollup.severity).toBe("critical");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "composes a healthy result with a breach pipeline file to exit 4",
    () => {
      const r = runCli([
        "--ops-check=" + join(FIXTURES, "ops-check-healthy.json"),
        "--pipeline=" + join(FIXTURES, "pipeline-breach.json"),
        "--json",
      ]);
      expect(r.status).toBe(OPS_BUNDLE_EXIT.CRITICAL);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "malformed stdin is a usage error (exit 1)",
    () => {
      const r = runCli(["--json"], "{not json");
      expect(r.status).toBe(OPS_BUNDLE_EXIT.USAGE);
      expect(JSON.parse(r.stdout).error).toBe("usage");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag and conflicting sources are usage errors (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(OPS_BUNDLE_EXIT.USAGE);
      expect(runCli(["--stdin", "--ops-check=x"]).status).toBe(
        OPS_BUNDLE_EXIT.USAGE,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes --output without echoing the destination path into bundle content",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "pdfxyz-ops-bundle-"));
      try {
        const out = join(dir, "customer-secret-output-path.json");
        const r = runCli([
          "--operations-file=" + join(FIXTURES, "ops-check-healthy.json"),
          "--output=" + out,
          "--pretty",
        ]);
        expect(r.status).toBe(OPS_BUNDLE_EXIT.OK);
        expect(r.stdout).toBe("");
        const written = readFileSync(out, "utf8");
        expect(JSON.parse(written).schema).toBe("pdfxyz.ops-bundle/1");
        expect(written).not.toContain("customer-secret-output-path");
        expect(written).not.toContain(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks a poisoned locator from stdin to stdout",
    () => {
      const poisoned = JSON.stringify({
        schema: "pdfxyz.ops-check/1",
        severity: "critical",
        action: "configure-storage",
        liveness: {
          state: "stale",
          source: "queue-broker",
          lastSeen: "over-10m",
          severity: "warn",
          reason: "liveness-stale",
          action: "investigate-worker-liveness",
          detail: SECRET,
        },
        snapshot: {
          vantage: "worker",
          health: "blocked",
          drainable: false,
          daemonObserved: true,
          detail: SECRET,
          subsystems: [
            { id: "storage", label: SECRET, health: "warn", detail: SECRET },
          ],
          proofs: { compressionDeep: "unknown", ocr: "unknown" },
          cleanupEvidence: {
            state: "critical",
            reason: "cleanup_breach",
            provider: "remote-configured",
            freshness: "fresh",
            detail: SECRET,
          },
          lastLoop: null,
        },
        slo: null,
        alerts: [
          {
            source: "storage",
            severity: "warn",
            reason: "storage-unconfigured",
            action: "configure-storage",
            detail: SECRET,
          },
        ],
      });
      const r = runCli(["--text"], poisoned);
      expect([OPS_BUNDLE_EXIT.WARN, OPS_BUNDLE_EXIT.CRITICAL]).toContain(
        r.status,
      );
      expect(r.stdout).not.toContain(SECRET);
      expect(r.stdout).not.toContain("leaky-bucket");
      expect(r.stdout).not.toContain(".pdf");
    },
    SPAWN_TIMEOUT_MS,
  );
});
