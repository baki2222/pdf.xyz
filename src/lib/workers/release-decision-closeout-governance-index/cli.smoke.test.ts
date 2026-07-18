// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-closeout-governance-index` CLI: it spawns the actual
 * binary (via tsx), which reads committed content-free governance-bundle fixtures and composes the governance index —
 * the tier the in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The fixtures
 * are self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-closeout-governance-index";
const CLOSED = `${D}/governance-closed.json`;
const COH = `${D}/governance-closed-coherent.json`;
const OPEN = `${D}/governance-open.json`;
const INC = `${D}/governance-incomplete.json`;
const BLK = `${D}/governance-blocked.json`;
const TAMP = `${D}/governance-tampered.json`;
const NOT = `${D}/not-a-governance.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(
      ["-s", "worker:release-decision-closeout-governance-index", ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        ...(input !== undefined ? { input } : {}),
      },
    );
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

describe("worker:release-decision-closeout-governance-index CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release decision closeout governance index/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no bundle supplied / stdin+file is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--stdin", "--file=x"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a coherent all-closed history → indexed (exit 0)",
    () => {
      const r = runCli([
        `--file=${CLOSED}`,
        `--file=${COH}`,
        `--file=${CLOSED}`,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance-index/1",
      );
      expect(parsed.governanceIndex.verdict).toBe("indexed");
      expect(parsed.ledger.governanceUsable).toBe(3);
      expect(parsed.ledger.verdictCounts.closed).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a latest-open history → index-open (exit 3)",
    () => {
      expect(
        runCli([`--file=${CLOSED}`, `--file=${OPEN}`, "--json"]).status,
      ).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a latest-incomplete history, or an all-unreadable window → index-incomplete (exit 2)",
    () => {
      const r = runCli([`--file=${CLOSED}`, `--file=${INC}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).governanceIndex.verdict).toBe(
        "index-incomplete",
      );
      const n = runCli([`--file=${NOT}`, "--json"]);
      expect(n.status).toBe(2);
      expect(JSON.parse(n.stdout).governanceIndex.reasons).toContain(
        "no-governance",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a latest-blocked history → index-blocked (exit 4)",
    () => {
      const r = runCli([`--file=${CLOSED}`, `--file=${BLK}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).governanceIndex.reasons).toContain(
        "latest-blocked",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered bundle → index-blocked (exit 4), never a fabricated indexed",
    () => {
      const t = runCli([`--file=${CLOSED}`, `--file=${TAMP}`, "--json"]);
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).governanceIndex.reasons).toContain(
        "governance-tampered",
      );
      expect(JSON.parse(t.stdout).ledger.governanceTampered).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict-open escalates an open history to blocked (exit 4); a clean history is untouched (exit 0)",
    () => {
      expect(
        runCli([`--file=${CLOSED}`, `--file=${OPEN}`, "--strict-open"]).status,
      ).toBe(4);
      expect(
        runCli([`--file=${CLOSED}`, `--file=${CLOSED}`, "--strict-open"])
          .status,
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a JSON array of bundles from stdin (--stdin)",
    () => {
      const arr = JSON.stringify([
        JSON.parse(readFileSync(CLOSED, "utf8")),
        JSON.parse(readFileSync(BLK, "utf8")),
      ]);
      const r = runCli(["--stdin", "--json"], arr);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).governanceIndex.verdict).toBe(
        "index-blocked",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an empty stdin array → index-incomplete (exit 2), never a vacuous indexed",
    () => {
      const r = runCli(["--stdin", "--json"], "[]");
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).governanceIndex.reasons).toContain(
        "no-governance",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "release-decision-closeout-governance-index-"),
      );
      const out = join(dir, "index.json");
      try {
        const r = runCli([`--file=${CLOSED}`, `--output=${out}`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(
          JSON.parse(readFileSync(out, "utf8")).governanceIndex.verdict,
        ).toBe("indexed");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      const r = runCli([`--file=${CLOSED}`, `--file=${COH}`, "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("governance-closed");
    },
    SPAWN_TIMEOUT_MS,
  );
});
