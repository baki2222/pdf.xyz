// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-closeout` CLI: it spawns the actual binary (via tsx),
 * which reads committed content-free record fixtures and composes the closeout — the tier the in-process tests cannot
 * cover (real spawn, real filesystem, real stdin, real output file). The fixtures are self-consistent + content-free, so
 * the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-closeout";
const COMPLETED = `${D}/receipt-completed.json`;
const OPEN = `${D}/receipt-followup-open.json`;
const INCOMPLETE = `${D}/receipt-incomplete.json`;
const BLOCKED = `${D}/receipt-blocked.json`;
const TAMPERED = `${D}/receipt-tampered.json`;
const NOT = `${D}/not-a-receipt.json`;

function runCli(args: string[], input?: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["-s", "worker:release-decision-closeout", ...args], {
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

describe("worker:release-decision-closeout CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/release decision closeout bundle/i);
  }, SPAWN_TIMEOUT_MS);

  it("an unknown flag / no receipt supplied / stdin+receipt is a usage error (exit 1)", () => {
    expect(runCli(["--nope"]).status).toBe(1);
    expect(runCli([]).status).toBe(1);
    expect(runCli(["--stdin", "--receipt=x"]).status).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("a completed receipt alone is closed (exit 0)", () => {
    const done = runCli([`--receipt=${COMPLETED}`, "--json"]);
    expect(done.status).toBe(0);
    const parsed = JSON.parse(done.stdout);
    expect(parsed.schema).toBe("pdfxyz.release-decision-closeout/1");
    expect(parsed.verdict).toBe("closed");
    expect(parsed.planClass).toBe("clear");
  }, SPAWN_TIMEOUT_MS);

  it("the primary receipt's own state drives the baseline (open/incomplete/blocked)", () => {
    expect(runCli([`--file=${OPEN}`]).status).toBe(3);
    expect(runCli([`--receipt=${INCOMPLETE}`]).status).toBe(2);
    expect(runCli([`--receipt=${BLOCKED}`]).status).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("a tampered receipt fails closed (exit 4); a non-receipt decoy is incomplete (exit 2)", () => {
    const t = runCli([`--receipt=${TAMPERED}`, "--json"]);
    expect(t.status).toBe(4);
    expect(JSON.parse(t.stdout).source.state).toBe("tampered");

    const n = runCli([`--receipt=${NOT}`, "--json"]);
    expect(n.status).toBe(2);
    expect(JSON.parse(n.stdout).source.state).toBe("unreadable");
  }, SPAWN_TIMEOUT_MS);

  it("a coherent plan keeps it closed; a contradictory plan fails closed (exit 4)", () => {
    expect(runCli([`--receipt=${COMPLETED}`, `--plan=${D}/plan-coherent.json`]).status).toBe(0);
    const bad = runCli([`--receipt=${COMPLETED}`, `--plan=${D}/plan-contradictory.json`, "--json"]);
    expect(bad.status).toBe(4);
    expect(JSON.parse(bad.stdout).closeout.reasons).toContain("plan-contradiction");
  }, SPAWN_TIMEOUT_MS);

  it("an advisory decision-index record opens the closeout (exit 3); a blocking one blocks it (exit 4)", () => {
    expect(runCli([`--receipt=${COMPLETED}`, `--index=${D}/index-advisory.json`]).status).toBe(3);
    expect(runCli([`--receipt=${COMPLETED}`, `--decision=${D}/decision-reject.json`]).status).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("a tampered related record fails closed (exit 4, related-tampered)", () => {
    const r = runCli([`--receipt=${COMPLETED}`, `--plan=${D}/plan-tampered.json`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).closeout.reasons).toContain("related-tampered");
  }, SPAWN_TIMEOUT_MS);

  it("--require-plan without a plan is incomplete (exit 2)", () => {
    expect(runCli([`--receipt=${COMPLETED}`, "--require-plan"]).status).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  it("--strict-open escalates an open closeout to blocked (exit 4); a closed one is untouched", () => {
    expect(runCli([`--receipt=${OPEN}`, "--strict-open"]).status).toBe(4);
    expect(runCli([`--receipt=${COMPLETED}`, "--strict-open"]).status).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it("reads the primary receipt from stdin (--stdin)", () => {
    const r = runCli(["--stdin", "--json"], readFileSync(BLOCKED, "utf8"));
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).verdict).toBe("closeout-blocked");
  }, SPAWN_TIMEOUT_MS);

  it("writes to --output without printing to stdout", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-decision-closeout-"));
    const out = join(dir, "closeout.json");
    try {
      const r = runCli([`--receipt=${COMPLETED}`, `--output=${out}`]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("");
      expect(JSON.parse(readFileSync(out, "utf8")).verdict).toBe("closed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  it("never leaks the fixture path or filename into the result", () => {
    // NB: the fixture stems (`receipt-completed`, `plan-coherent`, …) collide with bounded reason ids, which the render
    // legitimately emits — so assert on the true path markers (the directory + the extension), not the stem.
    const r = runCli([`--receipt=${COMPLETED}`, "--text"]);
    expect(r.stdout).not.toContain("docs/examples");
    expect(r.stdout).not.toContain(".json");
    expect(r.stdout).not.toContain("release-decision-closeout/receipt");
  }, SPAWN_TIMEOUT_MS);
});
