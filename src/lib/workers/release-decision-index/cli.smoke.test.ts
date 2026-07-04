// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-index` CLI: it spawns the actual binary (via
 * tsx), which reads committed content-free decision-record fixtures and composes the ledger index — the tier the
 * in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The fixtures are
 * self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-index";
const PR = `${D}/decision-proceed.json`;
const FU = `${D}/decision-proceed-with-followup.json`;
const HD = `${D}/decision-hold.json`;
const INS = `${D}/decision-insufficient.json`;
const RJ = `${D}/decision-reject.json`;
const INV = `${D}/decision-invalid.json`;
const TAMP = `${D}/decision-tampered.json`;
const NOT = `${D}/not-a-decision.json`;

function runCli(args: string[], input?: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["-s", "worker:release-decision-index", ...args], {
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

describe("worker:release-decision-index CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/release decision ledger index/i);
  }, SPAWN_TIMEOUT_MS);

  it("an unknown flag / no record supplied / stdin+file is a usage error (exit 1)", () => {
    expect(runCli(["--nope"]).status).toBe(1);
    expect(runCli([]).status).toBe(1);
    expect(runCli(["--stdin", "--file=x"]).status).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("a clean batch of proceed records → stable (exit 0)", () => {
    const r = runCli([`--file=${PR}`, `--file=${PR}`, `--file=${PR}`, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schema).toBe("pdfxyz.release-decision-index/1");
    expect(parsed.index.verdict).toBe("stable");
    expect(parsed.ledger.recordsUsable).toBe(3);
    expect(parsed.ledger.decisionCounts.proceed).toBe(3);
  }, SPAWN_TIMEOUT_MS);

  it("a proceed-with-followup or hold record → watch (exit 3)", () => {
    expect(runCli([`--file=${PR}`, `--file=${FU}`, "--json"]).status).toBe(3);
    expect(runCli([`--file=${PR}`, `--file=${HD}`]).status).toBe(3);
  }, SPAWN_TIMEOUT_MS);

  it("an insufficient decision → insufficient (exit 2)", () => {
    const r = runCli([`--file=${PR}`, `--file=${INS}`, "--json"]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).index.verdict).toBe("insufficient");
  }, SPAWN_TIMEOUT_MS);

  it("a reject or an invalid decision → blocked (exit 4)", () => {
    const r = runCli([`--file=${PR}`, `--file=${RJ}`, "--json"]);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).index.reasons).toContain("decision-rejected");
    const inv = runCli([`--file=${PR}`, `--file=${INV}`, "--json"]);
    expect(inv.status).toBe(4);
    expect(JSON.parse(inv.stdout).index.reasons).toContain("decision-invalid");
  }, SPAWN_TIMEOUT_MS);

  it("a tampered record, or an unreadable decoy → invalid (exit 4), never a fabricated stable", () => {
    const t = runCli([`--file=${PR}`, `--file=${TAMP}`, "--json"]);
    expect(t.status).toBe(4);
    expect(JSON.parse(t.stdout).index.reasons).toContain("record-tampered");
    const n = runCli([`--file=${PR}`, `--file=${NOT}`, "--json"]);
    expect(n.status).toBe(4);
    expect(JSON.parse(n.stdout).ledger.recordsUnreadable).toBe(1);
  }, SPAWN_TIMEOUT_MS);

  it("--strict escalates a followup batch to blocked (exit 4); a clean batch is untouched (exit 0)", () => {
    expect(runCli([`--file=${PR}`, `--file=${FU}`, "--strict"]).status).toBe(4);
    expect(runCli([`--file=${PR}`, `--file=${PR}`, "--strict"]).status).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it("reads a JSON array of records from stdin (--stdin)", () => {
    const arr = JSON.stringify([JSON.parse(readFileSync(PR, "utf8")), JSON.parse(readFileSync(RJ, "utf8"))]);
    const r = runCli(["--stdin", "--json"], arr);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout).index.verdict).toBe("blocked");
  }, SPAWN_TIMEOUT_MS);

  it("reads an NDJSON stream of records from stdin (--stdin)", () => {
    const nd = [readFileSync(PR, "utf8"), readFileSync(PR, "utf8")]
      .map((s) => JSON.stringify(JSON.parse(s)))
      .join("\n");
    const r = runCli(["--stdin", "--json"], nd);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).ledger.recordsUsable).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  it("writes to --output without printing to stdout", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-decision-index-"));
    const out = join(dir, "index.json");
    try {
      const r = runCli([`--file=${PR}`, `--output=${out}`]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("");
      expect(JSON.parse(readFileSync(out, "utf8")).index.verdict).toBe("stable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  it("never leaks the fixture path or filename into the result", () => {
    // Use the clean proceed batch (no reasons fire), so no fixture stem can appear as a legitimate reason id.
    const r = runCli([`--file=${PR}`, `--file=${PR}`, "--text"]);
    expect(r.stdout).not.toContain("docs/examples");
    expect(r.stdout).not.toContain(".json");
    expect(r.stdout).not.toContain("decision-proceed");
  }, SPAWN_TIMEOUT_MS);
});
