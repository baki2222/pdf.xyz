// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-index` CLI: it spawns the actual binary
 * (via tsx), which reads committed artifact fixtures, recomputes each `node:crypto` sha256 digest, and
 * builds a manifest — the tier the in-process tests cannot cover (real spawn, real hash, real
 * filesystem + stdin). It uses count-based retention (not age) so the exit code is deterministic
 * regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-index";
const PASS = `${D}/artifact-pass-recent.json`;
const WARN = `${D}/artifact-warn-dirty.json`;
const TAMPERED = `${D}/artifact-tampered.json`;

function runCli(args: string[], input?: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["-s", "worker:release-index", ...args], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      ...(input !== undefined ? { input } : {}),
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; signal?: string | null; stdout?: string };
    if (typeof e.status === "number") return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // killed by a signal / spawn failure — surface it
  }
}

describe("worker:release-index CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/release evidence index/i);
  }, SPAWN_TIMEOUT_MS);

  it("an unknown flag / non-numeric bound is a usage error (exit 1)", () => {
    expect(runCli(["--nope"]).status).toBe(1);
    expect(runCli(["--max-artifacts=abc", `--artifact=${PASS}`]).status).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("indexes a passing artifact → ok with the full manifest shape (exit 0)", () => {
    const r = runCli([`--artifact=${PASS}`, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schema).toBe("pdfxyz.release-index/1");
    expect(parsed.rollup.verdict).toBe("ok");
    expect(parsed.retention.indexedArtifacts).toBe(1);
    expect(parsed.artifacts[0].digestStatus).toBe("verified");
    expect(parsed.receipt.verifiedArtifacts).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("catches a tampered artifact → invalid (exit 4)", () => {
    const r = runCli([`--artifact=${PASS}`, `--artifact=${TAMPERED}`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).rollup.verdict).toBe("invalid");
  }, SPAWN_TIMEOUT_MS);

  it("count-based retention drift → warn (exit 3)", () => {
    const r = runCli([`--artifact=${PASS}`, `--artifact=${WARN}`, "--max-artifacts=1", "--json"]);
    expect(r.status).toBe(3);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.rollup.verdict).toBe("warn");
    expect(parsed.retention.overCount).toBe(true);
  }, SPAWN_TIMEOUT_MS);

  it("an empty archive on stdin → unknown (exit 2)", () => {
    const r = runCli(["--json"], "[]\n");
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).rollup.verdict).toBe("unknown");
  }, SPAWN_TIMEOUT_MS);

  it("indexes a JSON array on stdin", () => {
    const arr = JSON.stringify([
      JSON.parse(execFileSync("cat", [PASS], { encoding: "utf8" })),
    ]);
    const r = runCli(["--json"], arr);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).retention.indexedArtifacts).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("never leaks the fixture path or filename into the manifest", () => {
    const r = runCli([`--artifact=${PASS}`, "--text"]);
    expect(r.stdout).not.toContain("docs/examples");
    expect(r.stdout).not.toContain("artifact-pass-recent");
    expect(r.stdout).not.toContain(".json");
  }, SPAWN_TIMEOUT_MS);
});
