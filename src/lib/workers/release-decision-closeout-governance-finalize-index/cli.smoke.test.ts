// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-closeout-governance-finalize-index` CLI: it spawns
 * the actual binary (via tsx), which reads committed content-free finalization-bundle fixtures and composes the finalize
 * index — the tier the in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The
 * fixtures are self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execPnpmSync } from "@/tests/exec-pnpm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-closeout-governance-finalize-index";
const FIN = `${D}/finalize-finalized.json`;
const COH = `${D}/finalize-finalized-coherent.json`;
const OPEN = `${D}/finalize-open.json`;
const INC = `${D}/finalize-incomplete.json`;
const BLK = `${D}/finalize-blocked.json`;
const TAMP = `${D}/finalize-tampered.json`;
const NOT = `${D}/not-a-finalize.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execPnpmSync(
      [
        "-s",
        "worker:release-decision-closeout-governance-finalize-index",
        ...args,
      ],
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

describe("worker:release-decision-closeout-governance-finalize-index CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(
        /release decision closeout governance finalize index/i,
      );
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
    "a coherent all-finalized history → indexed (exit 0)",
    () => {
      const r = runCli([
        `--file=${FIN}`,
        `--file=${COH}`,
        `--file=${FIN}`,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index/1",
      );
      expect(parsed.finalizeIndex.verdict).toBe("indexed");
      expect(parsed.coverage.finalizationsUsable).toBe(3);
      expect(parsed.distribution.verdictCounts.finalized).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a latest-open history → index-open (exit 3)",
    () => {
      expect(runCli([`--file=${FIN}`, `--file=${OPEN}`, "--json"]).status).toBe(
        3,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a latest-incomplete history → index-incomplete (exit 2)",
    () => {
      const r = runCli([`--file=${FIN}`, `--file=${INC}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).finalizeIndex.verdict).toBe(
        "index-incomplete",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked history → index-blocked (exit 4)",
    () => {
      const r = runCli([`--file=${FIN}`, `--file=${BLK}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).finalizeIndex.reasons).toContain(
        "latest-blocked",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered OR unreadable bundle → index-invalid (exit 4), never a fabricated indexed",
    () => {
      const t = runCli([`--file=${FIN}`, `--file=${TAMP}`, "--json"]);
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).finalizeIndex.verdict).toBe("index-invalid");
      expect(JSON.parse(t.stdout).finalizeIndex.reasons).toContain(
        "finalization-tampered",
      );
      expect(JSON.parse(t.stdout).coverage.finalizationsTampered).toBe(1);

      const n = runCli([`--file=${NOT}`, "--json"]);
      expect(n.status).toBe(4);
      expect(JSON.parse(n.stdout).finalizeIndex.verdict).toBe("index-invalid");
      expect(JSON.parse(n.stdout).finalizeIndex.reasons).toContain(
        "finalization-unreadable",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--max-finalizations drops older bundles and surfaces the count",
    () => {
      const r = runCli([
        `--file=${OPEN}`,
        `--file=${INC}`,
        `--file=${FIN}`,
        "--max-finalizations=1",
        "--json",
      ]);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.coverage.finalizationsSupplied).toBe(3);
      expect(parsed.coverage.finalizationsConsidered).toBe(1);
      expect(parsed.coverage.truncated).toBe(true);
      expect(parsed.coverage.droppedOldest).toBe(2);
      expect(parsed.finalizeIndex.verdict).toBe("indexed"); // only the newest (finalized) is considered
      expect(r.status).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--require-latest-finalized fails a non-finalized latest to index-incomplete (exit 2)",
    () => {
      const r = runCli([
        `--file=${OPEN}`,
        `--file=${FIN}`,
        "--max-open=1",
        "--require-latest-finalized",
        "--json",
      ]);
      // Without the flag this tolerated-older-open history with a finalized latest would be indexed; the latest IS
      // finalized here, so require-latest passes → indexed.
      expect(r.status).toBe(0);
      const inc = runCli([
        `--file=${FIN}`,
        `--file=${INC}`,
        "--require-latest-finalized",
        "--json",
      ]);
      expect(inc.status).toBe(2);
      expect(JSON.parse(inc.stdout).finalizeIndex.reasons).toContain(
        "latest-not-finalized",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict-open escalates an open history to blocked (exit 4); a clean history is untouched (exit 0)",
    () => {
      expect(
        runCli([`--file=${FIN}`, `--file=${OPEN}`, "--strict-open"]).status,
      ).toBe(4);
      expect(
        runCli([`--file=${FIN}`, `--file=${FIN}`, "--strict-open"]).status,
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a JSON array of bundles from stdin (--stdin)",
    () => {
      const arr = JSON.stringify([
        JSON.parse(readFileSync(FIN, "utf8")),
        JSON.parse(readFileSync(BLK, "utf8")),
      ]);
      const r = runCli(["--stdin", "--json"], arr);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).finalizeIndex.verdict).toBe("index-blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads an NDJSON stream from stdin (--stdin)",
    () => {
      // NDJSON = one compact JSON value per line (the committed fixtures are pretty-printed, so compact them first).
      const compact = (f: string): string =>
        JSON.stringify(JSON.parse(readFileSync(f, "utf8")));
      const nd = `${compact(FIN)}\n${compact(OPEN)}\n`;
      const r = runCli(["--stdin", "--json"], nd);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).finalizeIndex.verdict).toBe("index-open");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an empty stdin array → index-incomplete (exit 2), never a vacuous indexed",
    () => {
      const r = runCli(["--stdin", "--json"], "[]");
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).finalizeIndex.reasons).toContain(
        "no-finalizations",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "release-decision-closeout-governance-finalize-index-"),
      );
      const out = join(dir, "index.json");
      try {
        const r = runCli([`--file=${FIN}`, `--output=${out}`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(
          JSON.parse(readFileSync(out, "utf8")).finalizeIndex.verdict,
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
      const r = runCli([`--file=${FIN}`, `--file=${COH}`, "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("finalize-finalized");
    },
    SPAWN_TIMEOUT_MS,
  );
});
