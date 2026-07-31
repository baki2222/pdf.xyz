// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-policy` CLI: it spawns the actual binary
 * (via tsx), which reads committed release-index fixtures (and, in `--artifact` mode, real
 * release-artifact fixtures it re-hashes via `node:crypto`) and evaluates the policy — the tier the
 * in-process tests cannot cover (real spawn, real hash, real filesystem + stdin). It uses count/verdict
 * policy (not age) so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { runWorkerCliSync } from "@/tests/run-worker-cli";

const SPAWN_TIMEOUT_MS = 60_000;
const P = "docs/examples/release-policy";
const A = "docs/examples/release-index";
const CLEAN = `${P}/index-clean.json`;
const MIXED = `${P}/index-mixed.json`;
const DRIFT = `${P}/index-drift.json`;
const EMPTY = `${P}/index-empty.json`;
const TAMPERED = `${P}/index-tampered.json`;
const INCONSISTENT = `${P}/index-inconsistent.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(["-s", "worker:release-policy", ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      ...(input !== undefined ? { input } : {}),
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

describe("worker:release-policy CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release evidence policy/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / bad bucket / both inputs is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(
        runCli([`--index=${CLEAN}`, "--max-age-bucket=future"]).status,
      ).toBe(1);
      expect(
        runCli([
          `--index=${CLEAN}`,
          `--artifact=${A}/artifact-pass-recent.json`,
        ]).status,
      ).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a clean archive under a satisfied policy → pass (exit 0)",
    () => {
      const r = runCli([
        `--index=${CLEAN}`,
        "--require-clean",
        "--min-artifacts=3",
        "--max-fail=0",
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-policy/1");
      expect(parsed.rollup.verdict).toBe("pass");
      expect(parsed.effectiveVerdict).toBe("ok");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocking violation → fail (exit 4)",
    () => {
      const r = runCli([`--index=${MIXED}`, "--max-fail=0", "--json"]);
      expect(r.status).toBe(4);
      expect(
        JSON.parse(r.stdout).violations.map((v: { id: string }) => v.id),
      ).toContain("too-many-fail");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a warning-only violation → warn (exit 3)",
    () => {
      const r = runCli([
        `--index=${DRIFT}`,
        "--forbid-over-retention",
        "--json",
      ]);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).rollup.verdict).toBe("warn");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an empty archive → unknown (exit 2)",
    () => {
      const r = runCli([`--index=${EMPTY}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).rollup.verdict).toBe("unknown");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered index → fail (exit 4) even with no assertions",
    () => {
      expect(runCli([`--index=${TAMPERED}`, "--json"]).status).toBe(4);
      const r = runCli([`--index=${INCONSISTENT}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).indexUsable).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a release-index on stdin",
    () => {
      const idx = execFileSync("cat", [CLEAN], { encoding: "utf8" });
      const r = runCli(["--require-clean", "--json"], idx);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).source).toBe("index");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--artifact mode re-hashes real artifacts and evaluates policy (exit 0)",
    () => {
      const r = runCli([
        `--artifact=${A}/artifact-pass-recent.json`,
        `--artifact=${A}/artifact-pass-old.json`,
        "--require-clean",
        "--min-artifacts=2",
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.source).toBe("artifacts");
      expect(parsed.facts.indexedArtifacts).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--artifact mode catches a tampered artifact by re-hashing → fail (exit 4)",
    () => {
      const r = runCli([
        `--artifact=${A}/artifact-pass-recent.json`,
        `--artifact=${A}/artifact-tampered.json`,
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).facts.integrityFailures).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      const r = runCli([`--index=${CLEAN}`, "--require-clean", "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain("index-clean");
      expect(r.stdout).not.toContain(".json");
    },
    SPAWN_TIMEOUT_MS,
  );
});
