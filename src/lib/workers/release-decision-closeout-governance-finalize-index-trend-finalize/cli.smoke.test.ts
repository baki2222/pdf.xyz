// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize`
 * CLI: it spawns the actual binary (via tsx), which reads committed content-free receipt + source-chain fixtures and
 * finalizes the follow-up loop — the tier the in-process tests cannot cover (real spawn, real filesystem, real stdin, real
 * output file). The fixtures are self-consistent + content-free, so the exit code is deterministic regardless of the wall
 * clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize";
const COMPLETED = `${D}/receipt-completed.json`;
const INCOMPLETE = `${D}/receipt-incomplete.json`;
const BLOCKED = `${D}/receipt-blocked.json`;
const INVALID = `${D}/receipt-invalid.json`;
const ADVISORY = `${D}/receipt-advisory.json`;
const TAMPERED = `${D}/receipt-tampered.json`;
const NOT = `${D}/not-a-receipt.json`;
const PLAN = `${D}/plan-coherent.json`;
const PLAN_BAD = `${D}/plan-contradictory.json`;
const TREND = `${D}/trend-coherent.json`;
const TREND_ADV = `${D}/trend-advisory.json`;
const INDEX = `${D}/index-coherent.json`;
const FIN = `${D}/finalization-coherent.json`;

function runCli(args: string[], input?: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(
      "pnpm",
      ["-s", "worker:release-decision-closeout-governance-finalize-index-trend-finalize", ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        ...(input !== undefined ? { input } : {}),
      },
    );
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; signal?: string | null; stdout?: string };
    if (typeof e.status === "number") return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // killed by a signal / spawn failure — surface it
  }
}

describe("worker:release-decision-closeout-governance-finalize-index-trend-finalize CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/finalize index trend FINALIZATION record/i);
  }, SPAWN_TIMEOUT_MS);

  it("an unknown flag / no receipt supplied / stdin+receipt is a usage error (exit 1)", () => {
    expect(runCli(["--nope"]).status).toBe(1);
    expect(runCli([]).status).toBe(1);
    expect(runCli(["--stdin", "--receipt=x"]).status).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("a completed receipt → finalized (exit 0), alone and with every coherent source", () => {
    const alone = runCli([`--receipt=${COMPLETED}`, "--json"]);
    expect(alone.status).toBe(0);
    const parsed = JSON.parse(alone.stdout);
    expect(parsed.schema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1");
    expect(parsed.verdict).toBe("finalized");

    const full = runCli([
      `--file=${COMPLETED}`,
      `--plan=${PLAN}`,
      `--trend=${TREND}`,
      `--index=${INDEX}`,
      `--finalization=${FIN}`,
      "--json",
    ]);
    expect(full.status).toBe(0);
    expect(JSON.parse(full.stdout).coverage.coherentRecords).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("an incomplete receipt → finalize-incomplete (exit 2); require-* missing is also incomplete", () => {
    expect(runCli([`--receipt=${INCOMPLETE}`, "--json"]).status).toBe(2);
    expect(runCli([`--receipt=${COMPLETED}`, "--require-index", "--json"]).status).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  it("a blocked / invalid-verdict receipt → finalize-blocked (exit 4)", () => {
    const b = runCli([`--receipt=${BLOCKED}`, "--json"]);
    expect(b.status).toBe(4);
    expect(JSON.parse(b.stdout).verdict).toBe("finalize-blocked");
    expect(runCli([`--receipt=${INVALID}`, "--json"]).status).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("a tampered receipt or a non-receipt decoy → finalize-invalid (exit 4)", () => {
    const t = runCli([`--receipt=${TAMPERED}`, "--json"]);
    expect(t.status).toBe(4);
    expect(JSON.parse(t.stdout).verdict).toBe("finalize-invalid");
    expect(JSON.parse(t.stdout).source.state).toBe("tampered");

    const n = runCli([`--receipt=${NOT}`, "--json"]);
    expect(n.status).toBe(4);
    expect(JSON.parse(n.stdout).source.state).toBe("unreadable");
  }, SPAWN_TIMEOUT_MS);

  it("an advisory chain → finalize-open (exit 3); --strict-open escalates it to blocked (exit 4)", () => {
    const open = runCli([`--receipt=${ADVISORY}`, `--trend=${TREND_ADV}`, "--json"]);
    expect(open.status).toBe(3);
    expect(JSON.parse(open.stdout).verdict).toBe("finalize-open");
    expect(runCli([`--receipt=${ADVISORY}`, `--trend=${TREND_ADV}`, "--strict-open", "--json"]).status).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("a contradictory source → finalize-blocked (exit 4)", () => {
    const r = runCli([`--receipt=${COMPLETED}`, `--plan=${PLAN_BAD}`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).finalize.reasons).toContain("plan-contradiction");
  }, SPAWN_TIMEOUT_MS);

  it("reads the primary receipt from stdin (--stdin)", () => {
    const r = runCli(["--stdin", "--json"], readFileSync(BLOCKED, "utf8"));
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).verdict).toBe("finalize-blocked");
  }, SPAWN_TIMEOUT_MS);

  it("writes to --output without printing to stdout", () => {
    const dir = mkdtempSync(join(tmpdir(), "finalize-index-trend-finalize-"));
    const out = join(dir, "finalize.json");
    try {
      const r = runCli([`--receipt=${COMPLETED}`, `--output=${out}`]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("");
      expect(JSON.parse(readFileSync(out, "utf8")).verdict).toBe("finalized");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  it("never leaks the fixture path or filename into the result", () => {
    // Use fixture stems that are NOT bounded reason ids (`receipt-completed` / `plan-coherent` ARE reason ids and
    // legitimately appear in the REASONS section, so must not be used for a leak assertion).
    const r = runCli([`--receipt=${ADVISORY}`, `--trend=${TREND_ADV}`, "--text"]);
    expect(r.stdout).not.toContain("docs/examples");
    expect(r.stdout).not.toContain(".json");
    expect(r.stdout).not.toContain("receipt-advisory");
    expect(r.stdout).not.toContain("trend-advisory");
  }, SPAWN_TIMEOUT_MS);
});
