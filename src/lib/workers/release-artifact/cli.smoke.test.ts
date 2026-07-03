// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-artifact` CLI: it spawns the actual binary
 * (via tsx), which gathers real git facts, ingests a committed gate fixture, computes a real
 * `node:crypto` sha256 digest, writes an artifact, and re-verifies it — the tier the in-process tests
 * cannot cover (real spawn, real hash, real filesystem).
 *
 * It uses committed gate fixtures + `--no-vcs` so the exit code is deterministic regardless of the
 * working tree's dirtiness, and it never runs the full internal gate (which is exercised by the
 * committed CI example workflow), so the suite stays fast.
 */

import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const PASS_FIXTURE = "docs/examples/release-artifact/release-gate-pass.json";
const FAIL_FIXTURE = "docs/examples/release-artifact/release-gate-fail.json";

const scratch = mkdtempSync(join(tmpdir(), "ra-smoke-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function runCli(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["-s", "worker:release-artifact", ...args], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; signal?: string | null; stdout?: string };
    if (typeof e.status === "number") return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // killed by a signal / spawn failure — surface it
  }
}

describe("worker:release-artifact CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/release evidence artifact/i);
  }, SPAWN_TIMEOUT_MS);

  it("an unknown flag / invalid label is a usage error (exit 1)", () => {
    expect(runCli(["--nope"]).status).toBe(1);
    expect(runCli(["--label=has space"]).status).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("archives a passing gate (--no-vcs) → pass with a real sha256 digest", () => {
    const r = runCli(["--release-gate=" + PASS_FIXTURE, "--no-vcs", "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schema).toBe("pdfxyz.release-artifact/1");
    expect(parsed.body.rollup.verdict).toBe("pass");
    expect(parsed.body.gate.source).toBe("supplied");
    expect(parsed.integrity.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.receipt.digest).toBe(parsed.integrity.digest);
  }, SPAWN_TIMEOUT_MS);

  it("archives a failing gate (--no-vcs) → fail (exit 4)", () => {
    const r = runCli(["--release-gate=" + FAIL_FIXTURE, "--no-vcs", "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).body.rollup.verdict).toBe("fail");
  }, SPAWN_TIMEOUT_MS);

  it("generate → verify roundtrip: a written artifact re-verifies as intact (exit 0)", () => {
    const out = join(scratch, "release.json");
    expect(runCli(["--release-gate=" + PASS_FIXTURE, "--no-vcs", "--output=" + out, "--json"]).status).toBe(0);
    const verify = runCli(["--verify=" + out, "--text"]);
    expect(verify.status).toBe(0);
    expect(verify.stdout).toMatch(/VERIFIED/);
  }, SPAWN_TIMEOUT_MS);

  it("--verify detects a tampered body as a digest mismatch (exit 4)", () => {
    const out = join(scratch, "tamper.json");
    runCli(["--release-gate=" + PASS_FIXTURE, "--no-vcs", "--output=" + out, "--json"]);
    const tampered = readFileSync(out, "utf8").replace('"schemaVersion": 1', '"schemaVersion": 2');
    writeFileSync(out, tampered, "utf8");
    expect(runCli(["--verify=" + out]).status).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("never leaks the gate fixture path or filename into the artifact", () => {
    const r = runCli(["--release-gate=" + PASS_FIXTURE, "--no-vcs", "--text"]);
    expect(r.stdout).not.toContain("docs/examples");
    expect(r.stdout).not.toContain("release-gate-pass");
    expect(r.stdout).not.toContain(".json");
  }, SPAWN_TIMEOUT_MS);
});
