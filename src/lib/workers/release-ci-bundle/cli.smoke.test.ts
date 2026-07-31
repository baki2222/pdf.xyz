// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-ci-bundle` CLI: it spawns the actual binary
 * (via tsx), which reads committed stage fixtures (re-hashing the artifact via `node:crypto`) and
 * composes the bundle — the tier the in-process tests cannot cover (real spawn, real hash, real
 * filesystem). It uses the coherent chain + the deliberately-incoherent policy fixture so the exit code
 * is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-ci-bundle";
const GATE = `${D}/gate-pass.json`;
const ARTIFACT = `${D}/artifact-pass.json`;
const INDEX = `${D}/index-pass.json`;
const POLICY = `${D}/policy-pass.json`;
const POLICY_MISMATCH = `${D}/policy-mismatch.json`;

function runCli(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(["-s", "worker:release-ci-bundle", ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
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

describe("worker:release-ci-bundle CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release evidence CI bundle/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no stage supplied is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--json"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a coherent full chain → pass (exit 0), all six links ok",
    () => {
      const r = runCli([
        `--release-gate=${GATE}`,
        `--release-artifact=${ARTIFACT}`,
        `--release-index=${INDEX}`,
        `--release-policy=${POLICY}`,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-ci-bundle/1");
      expect(parsed.rollup.verdict).toBe("pass");
      expect(parsed.rollup.chainComplete).toBe(true);
      expect(
        parsed.consistency.every((c: { status: string }) => c.status === "ok"),
      ).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a cross-stage inconsistency → fail (exit 4)",
    () => {
      const r = runCli([
        `--release-index=${INDEX}`,
        `--release-policy=${POLICY_MISMATCH}`,
        "--json",
      ]);
      expect(r.status).toBe(4);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.rollup.verdict).toBe("fail");
      expect(parsed.rollup.drivers).toContain("chain-inconsistent");
      expect(
        parsed.consistency.map((c: { id: string; status: string }) => c.status),
      ).toContain("mismatch");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a decision-less chain (gate only) → unknown (exit 2)",
    () => {
      const r = runCli([`--release-gate=${GATE}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).rollup.drivers).toContain("incomplete-chain");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unreadable supplied stage → unknown (exit 2), never a fabricated pass",
    () => {
      const r = runCli([`--release-policy=${GATE}`, "--json"]); // a gate report is not a policy result
      expect(r.status).toBe(2);
      expect(
        JSON.parse(r.stdout).stages.find(
          (s: { stage: string }) => s.stage === "policy",
        ).source,
      ).toBe("unreadable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      const r = runCli([
        `--release-index=${INDEX}`,
        `--release-policy=${POLICY}`,
        "--text",
      ]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain("index-pass");
      expect(r.stdout).not.toContain(".json");
    },
    SPAWN_TIMEOUT_MS,
  );
});
