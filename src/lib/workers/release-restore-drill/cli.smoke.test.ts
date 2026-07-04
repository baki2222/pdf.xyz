// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-restore-drill` CLI: it spawns the actual binary (via
 * tsx), which reads committed content-free fixtures, hashes them with real `node:crypto`, and runs the restore
 * drill — the tier the in-process tests cannot cover (real spawn, real filesystem, real stdin, real digests). The
 * fixtures are self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-restore-drill";
const P_ARCHIVABLE = `${D}/archive-archivable.json`;
const P_WATCH = `${D}/archive-watch.json`;
const P_BLOCKED = `${D}/archive-blocked.json`;
const P_INCOMPLETE = `${D}/archive-incomplete.json`;
const P_TAMPERED = `${D}/archive-tampered.json`;
const R_GOV = `${D}/governance-healthy.json`;
const R_TREND = `${D}/trend-stable.json`;
const R_TREND_WARN = `${D}/trend-warning.json`;
const R_REPORT = `${D}/report-promote-ready.json`;
const R_AUDIT = `${D}/audit-pass.json`;
const R_BUNDLE = `${D}/bundle-pass.json`;

function runCli(args: string[], input?: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["-s", "worker:release-restore-drill", ...args], {
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
    throw err;
  }
}

describe("worker:release-restore-drill CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/release evidence restore drill/i);
  }, SPAWN_TIMEOUT_MS);

  it("no --archive / an unknown flag / two stdin inputs is a usage error (exit 1)", () => {
    expect(runCli([]).status).toBe(1);
    expect(runCli(["--archive=a", "--nope"]).status).toBe(1);
    expect(runCli(["--archive=-", "--governance=-"]).status).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("a clean archivable pack + full restore → verified (exit 0), and records a sha256 anchor digest", () => {
    const r = runCli([
      `--archive=${P_ARCHIVABLE}`,
      `--governance=${R_GOV}`,
      `--trend=${R_TREND}`,
      `--report=${R_REPORT}`,
      `--audit=${R_AUDIT}`,
      `--bundle=${R_BUNDLE}`,
      "--json",
    ]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schema).toBe("pdfxyz.release-restore-drill/1");
    expect(parsed.drill.verdict).toBe("restore-verified");
    expect(parsed.coverage.recordsMatched).toBe(5);
    expect(parsed.digests.algorithm).toBe("sha256");
    expect(parsed.digests.archive).toMatch(/^[0-9a-f]{64}$/);
  }, SPAWN_TIMEOUT_MS);

  it("archive-only over an archivable pack → verified (exit 0)", () => {
    expect(runCli([`--archive=${P_ARCHIVABLE}`, "--archive-only"]).status).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it("a usable pack with nothing restored → incomplete (exit 2), never a fabricated verified", () => {
    const r = runCli([`--archive=${P_ARCHIVABLE}`, "--json"]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).drill.reasons).toContain("restore-not-exercised");
  }, SPAWN_TIMEOUT_MS);

  it("restoring a different record than was archived → failed (exit 4, restore-mismatch)", () => {
    const r = runCli([`--archive=${P_ARCHIVABLE}`, `--trend=${R_TREND_WARN}`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).drill.reasons).toContain("restore-mismatch");
  }, SPAWN_TIMEOUT_MS);

  it("a tampered pack fails closed (exit 4, archive-tampered)", () => {
    const r = runCli([`--archive=${P_TAMPERED}`, "--archive-only", "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).drill.reasons).toContain("archive-tampered");
  }, SPAWN_TIMEOUT_MS);

  it("the pack's own posture surfaces: watch → drift (3), blocked → failed (4), incomplete → incomplete (2)", () => {
    expect(runCli([`--archive=${P_WATCH}`, "--archive-only"]).status).toBe(3);
    expect(runCli([`--archive=${P_BLOCKED}`, "--archive-only"]).status).toBe(4);
    expect(runCli([`--archive=${P_INCOMPLETE}`, "--archive-only"]).status).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  it("--strict-drift escalates a watch pack to failed (exit 4)", () => {
    expect(runCli([`--archive=${P_WATCH}`, "--archive-only"]).status).toBe(3);
    expect(runCli([`--archive=${P_WATCH}`, "--archive-only", "--strict-drift"]).status).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("reads the pack from stdin (`--archive=-`)", () => {
    const pack = readFileSync(P_ARCHIVABLE, "utf8");
    const r = runCli(["--archive=-", "--archive-only", "--json"], pack);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).drill.verdict).toBe("restore-verified");
  }, SPAWN_TIMEOUT_MS);

  it("never leaks the fixture path or filename into the result", () => {
    const r = runCli([`--archive=${P_ARCHIVABLE}`, `--trend=${R_TREND}`, "--text"]);
    expect(r.stdout).not.toContain("docs/examples");
    expect(r.stdout).not.toContain("archive-archivable");
    expect(r.stdout).not.toContain("trend-stable");
    expect(r.stdout).not.toContain(".json");
  }, SPAWN_TIMEOUT_MS);
});
