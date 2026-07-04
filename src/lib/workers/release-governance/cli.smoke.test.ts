// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-governance` CLI: it spawns the actual binary (via
 * tsx), which reads committed content-free document fixtures and composes the governance bundle — the tier the
 * in-process tests cannot cover (real spawn, real filesystem, real stdin). The fixtures are self-consistent +
 * content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-governance";
const T_STABLE = `${D}/trend-stable.json`;
const T_WARNING = `${D}/trend-warning.json`;
const T_UNKNOWN = `${D}/trend-unknown.json`;
const T_FAILING = `${D}/trend-failing.json`;
const T_TAMPERED = `${D}/trend-tampered.json`;
const R_READY = `${D}/report-promote-ready.json`;
const R_HOLD_FAIL = `${D}/report-hold-fail.json`;
const A_PASS = `${D}/audit-pass.json`;
const A_FAIL = `${D}/audit-fail.json`;

function runCli(args: string[], input?: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["-s", "worker:release-governance", ...args], {
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

describe("worker:release-governance CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/release evidence governance bundle/i);
  }, SPAWN_TIMEOUT_MS);

  it("an unknown flag / no document supplied is a usage error (exit 1)", () => {
    expect(runCli(["--nope"]).status).toBe(1);
    expect(runCli([]).status).toBe(1);
    expect(runCli(["--trend=-", "--report=-"]).status).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("a stable trend (with clean latest) → healthy (exit 0)", () => {
    const r = runCli([`--trend=${T_STABLE}`, `--report=${R_READY}`, `--audit=${A_PASS}`, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schema).toBe("pdfxyz.release-governance/1");
    expect(parsed.governance.verdict).toBe("healthy");
    expect(parsed.coverage.sourcesUsable).toBe(3);
  }, SPAWN_TIMEOUT_MS);

  it("a warning trend → watch (exit 3)", () => {
    const r = runCli([`--trend=${T_WARNING}`, "--json"]);
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout).governance.verdict).toBe("watch");
  }, SPAWN_TIMEOUT_MS);

  it("an unknown trend → incomplete (exit 2)", () => {
    const r = runCli([`--trend=${T_UNKNOWN}`, "--json"]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).governance.verdict).toBe("incomplete");
  }, SPAWN_TIMEOUT_MS);

  it("a missing trend (report only) → incomplete (exit 2), never a fabricated healthy", () => {
    const r = runCli([`--report=${R_READY}`, "--json"]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).governance.reasons).toContain("trend-missing");
  }, SPAWN_TIMEOUT_MS);

  it("a failing trend → blocked (exit 4)", () => {
    const r = runCli([`--trend=${T_FAILING}`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).governance.reasons).toContain("trend-failing");
  }, SPAWN_TIMEOUT_MS);

  it("a tampered trend fails closed (exit 4)", () => {
    const r = runCli([`--trend=${T_TAMPERED}`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).governance.reasons).toContain("trend-tampered");
  }, SPAWN_TIMEOUT_MS);

  it("a hold-fail latest report blocks even a stable trend (exit 4)", () => {
    const r = runCli([`--trend=${T_STABLE}`, `--report=${R_HOLD_FAIL}`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).governance.reasons).toContain("report-hold-fail");
  }, SPAWN_TIMEOUT_MS);

  it("a blocking latest audit regression blocks even a stable trend (exit 4)", () => {
    const r = runCli([`--trend=${T_STABLE}`, `--audit=${A_FAIL}`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).governance.reasons).toContain("audit-regressed");
  }, SPAWN_TIMEOUT_MS);

  it("--require-audit makes a missing audit incomplete (exit 2)", () => {
    expect(runCli([`--trend=${T_STABLE}`]).status).toBe(0);
    expect(runCli([`--trend=${T_STABLE}`, "--require-audit"]).status).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  it("--strict-watch escalates a watch to blocked (exit 4)", () => {
    expect(runCli([`--trend=${T_WARNING}`]).status).toBe(3);
    expect(runCli([`--trend=${T_WARNING}`, "--strict-watch"]).status).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("reads a document from stdin (`--trend=-`)", () => {
    const trend = readFileSync(T_STABLE, "utf8");
    const r = runCli(["--trend=-", "--json"], trend);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).governance.verdict).toBe("healthy");
  }, SPAWN_TIMEOUT_MS);

  it("never leaks the fixture path or filename into the result", () => {
    // Use non-reason-colliding stems: `report-hold-fail` is (correctly) a reason id, so pick clean names.
    const r = runCli([`--trend=${T_STABLE}`, `--report=${R_READY}`, `--audit=${A_PASS}`, "--text"]);
    expect(r.stdout).not.toContain("docs/examples");
    expect(r.stdout).not.toContain("report-promote-ready");
    expect(r.stdout).not.toContain("trend-stable");
    expect(r.stdout).not.toContain(".json");
  }, SPAWN_TIMEOUT_MS);
});
