// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-ack` CLI: it spawns the actual binary (via tsx), which reads
 * committed content-free publish-pack fixtures and records the acknowledgement — the tier the in-process tests cannot
 * cover (real spawn, real filesystem, real stdin, real output file). The fixtures are self-consistent + content-free,
 * so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-handoff-ack";
const PUBLISHABLE = `${D}/publish-pack-publishable.json`;
const REVIEW = `${D}/publish-pack-review.json`;
const INCOMPLETE = `${D}/publish-pack-incomplete.json`;
const BLOCKED = `${D}/publish-pack-blocked.json`;
const TAMPERED = `${D}/publish-pack-tampered.json`;
const NOT_A_PACK = `${D}/not-a-publish-pack.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(["-s", "worker:release-ack", ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      ...(input !== undefined ? { input } : {}),
    });
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

describe("worker:release-ack CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(
        /release evidence handoff acknowledgement receipt/i,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no pack / no decision is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([`--publish-pack=${PUBLISHABLE}`]).status).toBe(1); // no decision
      expect(runCli(["--decision=accepted"]).status).toBe(1); // no pack
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "accepted over a publishable pack → acknowledged (exit 0), share-safe source",
    () => {
      const r = runCli([
        `--publish-pack=${PUBLISHABLE}`,
        "--decision=accepted",
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-ack/1");
      expect(parsed.ack.verdict).toBe("acknowledged");
      expect(parsed.source.packVerdict).toBe("publishable");
      expect(parsed.source.disclosure).toBe("share-safe");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "accepted-with-notes → acknowledged-with-followup (exit 3)",
    () => {
      const r = runCli([
        `--publish-pack=${PUBLISHABLE}`,
        "--decision=accepted-with-notes",
      ]);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).ack.verdict).toBe(
        "acknowledged-with-followup",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "accepted over a review pack → acknowledged-with-followup (exit 3)",
    () => {
      expect(
        runCli([`--publish-pack=${REVIEW}`, "--decision=accepted"]).status,
      ).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "accepted over an incomplete pack, or a deferred decision → deferred (exit 2)",
    () => {
      expect(
        runCli([`--publish-pack=${INCOMPLETE}`, "--decision=accepted"]).status,
      ).toBe(2);
      expect(
        runCli([`--publish-pack=${PUBLISHABLE}`, "--decision=deferred"]).status,
      ).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "rejected / needs-changes, or a blocked pack → rejected (exit 4)",
    () => {
      expect(
        runCli([`--publish-pack=${PUBLISHABLE}`, "--decision=rejected"]).status,
      ).toBe(4);
      expect(
        runCli([`--publish-pack=${PUBLISHABLE}`, "--decision=needs-changes"])
          .status,
      ).toBe(4);
      const r = runCli([
        `--publish-pack=${BLOCKED}`,
        "--decision=accepted",
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).ack.reasons).toContain("pack-blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered pack / a non-pack → invalid (exit 4), never a vacuous pass",
    () => {
      const t = runCli([
        `--publish-pack=${TAMPERED}`,
        "--decision=accepted",
        "--json",
      ]);
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).ack.reasons).toContain("pack-tampered");
      const n = runCli([
        `--publish-pack=${NOT_A_PACK}`,
        "--decision=accepted",
        "--json",
      ]);
      expect(n.status).toBe(4);
      expect(JSON.parse(n.stdout).ack.reasons).toContain("pack-unreadable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict escalates a follow-up over a review pack to rejected (exit 4)",
    () => {
      expect(
        runCli([`--publish-pack=${REVIEW}`, "--decision=accepted"]).status,
      ).toBe(3);
      expect(
        runCli([`--publish-pack=${REVIEW}`, "--decision=accepted", "--strict"])
          .status,
      ).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads the pack from stdin (`--publish-pack=-`)",
    () => {
      const pack = readFileSync(PUBLISHABLE, "utf8");
      const r = runCli(
        ["--publish-pack=-", "--decision=accepted", "--json"],
        pack,
      );
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).ack.verdict).toBe("acknowledged");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "release-ack-"));
      const out = join(dir, "ack.json");
      try {
        const r = runCli([
          `--publish-pack=${PUBLISHABLE}`,
          "--decision=accepted",
          `--output=${out}`,
        ]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(JSON.parse(readFileSync(out, "utf8")).ack.verdict).toBe(
          "acknowledged",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      // Fixture stems embed reason-id substrings (e.g. `pack-review`), so assert on the DIR + `.json` extension + the
      // full `publish-pack-*` stems (which are NOT reason ids), never a bare reason-id fragment.
      const r = runCli([
        `--publish-pack=${REVIEW}`,
        "--decision=accepted",
        "--text",
      ]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("publish-pack-review");
      expect(r.stdout).not.toContain("publish-pack-publishable");
    },
    SPAWN_TIMEOUT_MS,
  );
});
