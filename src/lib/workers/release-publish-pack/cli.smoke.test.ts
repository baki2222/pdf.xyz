// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-publish-pack` CLI: it spawns the actual binary (via
 * tsx), which reads committed content-free document fixtures and composes the handoff pack — the tier the
 * in-process tests cannot cover (real spawn, real filesystem, real stdin). The fixtures are self-consistent +
 * content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { readFileSync } from "node:fs";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-publish-pack";
const G_HEALTHY = `${D}/governance-healthy.json`;
const G_WATCH = `${D}/governance-watch.json`;
const G_INCOMPLETE = `${D}/governance-incomplete.json`;
const G_BLOCKED = `${D}/governance-blocked.json`;
const G_TAMPERED = `${D}/governance-tampered.json`;
const A_ARCHIVABLE = `${D}/archive-archivable.json`;
const DR_VERIFIED = `${D}/restore-drill-verified.json`;
const DR_FAILED = `${D}/restore-drill-failed.json`;
const R_HOLD_FAIL = `${D}/report-hold-fail.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(
      ["-s", "worker:release-publish-pack", ...args],
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

describe("worker:release-publish-pack CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release evidence publish \/ handoff pack/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no document supplied is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--governance=-", "--archive=-"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a healthy governance (with clean sources) → publishable (exit 0), share-safe",
    () => {
      const r = runCli([
        `--governance=${G_HEALTHY}`,
        `--archive=${A_ARCHIVABLE}`,
        `--restore-drill=${DR_VERIFIED}`,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-publish-pack/1");
      expect(parsed.pack.verdict).toBe("publishable");
      expect(parsed.disclosure.classification).toBe("share-safe");
      expect(parsed.coverage.sourcesUsable).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a watch governance → review (exit 3)",
    () => {
      const r = runCli([`--governance=${G_WATCH}`, "--json"]);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).pack.verdict).toBe("review");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an incomplete governance → incomplete (exit 2)",
    () => {
      const r = runCli([`--governance=${G_INCOMPLETE}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).pack.verdict).toBe("incomplete");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a missing governance (archive only) → incomplete (exit 2), never a fabricated share-safe pack",
    () => {
      const r = runCli([`--archive=${A_ARCHIVABLE}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).pack.reasons).toContain("governance-missing");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked governance → blocked (exit 4)",
    () => {
      const r = runCli([`--governance=${G_BLOCKED}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).pack.reasons).toContain("governance-blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered governance fails closed (exit 4)",
    () => {
      const r = runCli([`--governance=${G_TAMPERED}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).pack.reasons).toContain(
        "governance-tampered",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a failed restore drill blocks even a healthy governance (exit 4)",
    () => {
      const r = runCli([
        `--governance=${G_HEALTHY}`,
        `--restore-drill=${DR_FAILED}`,
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).pack.reasons).toContain("restore-failed");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a hold-fail latest report blocks even a healthy governance (exit 4)",
    () => {
      const r = runCli([
        `--governance=${G_HEALTHY}`,
        `--report=${R_HOLD_FAIL}`,
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).pack.reasons).toContain("report-hold-fail");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--require-restore-drill makes a missing drill incomplete (exit 2)",
    () => {
      expect(runCli([`--governance=${G_HEALTHY}`]).status).toBe(0);
      expect(
        runCli([`--governance=${G_HEALTHY}`, "--require-restore-drill"]).status,
      ).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict escalates a review to blocked (exit 4)",
    () => {
      expect(runCli([`--governance=${G_WATCH}`]).status).toBe(3);
      expect(runCli([`--governance=${G_WATCH}`, "--strict"]).status).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a document from stdin (`--governance=-`)",
    () => {
      const governance = readFileSync(G_HEALTHY, "utf8");
      const r = runCli(["--governance=-", "--json"], governance);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).pack.verdict).toBe("publishable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      // Fixture stems can collide with reason ids (e.g. `archive-watch`), so assert on the DIR + `.json` extension.
      const r = runCli([
        `--governance=${G_HEALTHY}`,
        `--archive=${A_ARCHIVABLE}`,
        "--text",
      ]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("governance-healthy");
      expect(r.stdout).not.toContain("archive-archivable");
    },
    SPAWN_TIMEOUT_MS,
  );
});
