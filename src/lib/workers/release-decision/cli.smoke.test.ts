// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision` CLI: it spawns the actual binary (via tsx), which
 * reads committed content-free publish-pack + acknowledgement fixtures and records the decision — the tier the
 * in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The fixtures are
 * self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-record";
const PUBLISHABLE = `${D}/publish-pack-publishable.json`;
const REVIEW = `${D}/publish-pack-review.json`;
const INCOMPLETE = `${D}/publish-pack-incomplete.json`;
const BLOCKED = `${D}/publish-pack-blocked.json`;
const TAMPERED_PACK = `${D}/publish-pack-tampered.json`;
const NOT_A_PACK = `${D}/not-a-publish-pack.json`;
const ACK_ACCEPTED = `${D}/ack-accepted.json`;
const ACK_NOTES = `${D}/ack-accepted-with-notes.json`;
const ACK_DEFERRED = `${D}/ack-deferred.json`;
const ACK_REJECTED = `${D}/ack-rejected.json`;
const ACK_REVIEW = `${D}/ack-accepted-review.json`;
const ACK_BLOCKED = `${D}/ack-accepted-blocked.json`;
const ACK_INCOMPLETE = `${D}/ack-accepted-incomplete.json`;
const ACK_TAMPERED = `${D}/ack-tampered.json`;
const NOT_AN_ACK = `${D}/not-an-ack.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(
      "pnpm",
      ["-s", "worker:release-decision", ...args],
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

const pair = (pack: string, ack: string, ...rest: string[]): string[] => [
  `--publish-pack=${pack}`,
  `--ack=${ack}`,
  ...rest,
];

describe("worker:release-decision CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release decision record ledger/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / a missing document / two stdin inputs is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([`--publish-pack=${PUBLISHABLE}`]).status).toBe(1); // no ack
      expect(runCli([`--ack=${ACK_ACCEPTED}`]).status).toBe(1); // no pack
      expect(runCli(["--publish-pack=-", "--ack=-"]).status).toBe(1); // two stdin
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a publishable pack + a clean accepted ack → proceed (exit 0), cross-check match",
    () => {
      const r = runCli(pair(PUBLISHABLE, ACK_ACCEPTED, "--json"));
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-decision/1");
      expect(parsed.decision.decision).toBe("proceed");
      expect(parsed.crossCheck.status).toBe("match");
      expect(parsed.publishPack.verdict).toBe("publishable");
      expect(parsed.acknowledgement.decision).toBe("accepted");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "accepted-with-notes → proceed-with-followup (exit 3); a review pack → hold (exit 3)",
    () => {
      expect(runCli(pair(PUBLISHABLE, ACK_NOTES)).status).toBe(3);
      expect(runCli(pair(REVIEW, ACK_REVIEW)).status).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a deferred ack, or an incomplete pack → insufficient (exit 2)",
    () => {
      expect(runCli(pair(PUBLISHABLE, ACK_DEFERRED)).status).toBe(2);
      expect(runCli(pair(INCOMPLETE, ACK_INCOMPLETE)).status).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a rejected ack, or a blocked pack → reject (exit 4)",
    () => {
      expect(runCli(pair(PUBLISHABLE, ACK_REJECTED)).status).toBe(4);
      const r = runCli(pair(BLOCKED, ACK_BLOCKED, "--json"));
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).decision.reasons).toContain("pack-blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered pack / ack, or a non-document → invalid (exit 4), never a vacuous pass",
    () => {
      expect(runCli(pair(TAMPERED_PACK, ACK_ACCEPTED)).status).toBe(4);
      const t = runCli(pair(PUBLISHABLE, ACK_TAMPERED, "--json"));
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).decision.reasons).toContain("ack-tampered");
      expect(runCli(pair(NOT_A_PACK, ACK_ACCEPTED)).status).toBe(4);
      expect(runCli(pair(PUBLISHABLE, NOT_AN_ACK)).status).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an acknowledgement of a DIFFERENT pack → invalid via cross-check mismatch (exit 4)",
    () => {
      const r = runCli(pair(PUBLISHABLE, ACK_REVIEW, "--json"));
      expect(r.status).toBe(4);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.decision.decision).toBe("invalid");
      expect(parsed.crossCheck.status).toBe("mismatch");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict escalates a follow-up to reject (exit 4); a clean proceed is untouched (exit 0)",
    () => {
      expect(runCli(pair(PUBLISHABLE, ACK_ACCEPTED, "--strict")).status).toBe(
        0,
      );
      expect(runCli(pair(PUBLISHABLE, ACK_NOTES, "--strict")).status).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads the acknowledgement from stdin (`--ack=-`)",
    () => {
      const ack = readFileSync(ACK_ACCEPTED, "utf8");
      const r = runCli(
        [`--publish-pack=${PUBLISHABLE}`, "--ack=-", "--json"],
        ack,
      );
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).decision.decision).toBe("proceed");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads the publish pack from stdin (`--publish-pack=-`)",
    () => {
      const pack = readFileSync(PUBLISHABLE, "utf8");
      const r = runCli(
        [`--publish-pack=-`, `--ack=${ACK_ACCEPTED}`, "--json"],
        pack,
      );
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).decision.decision).toBe("proceed");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "release-decision-"));
      const out = join(dir, "decision.json");
      try {
        const r = runCli(pair(PUBLISHABLE, ACK_ACCEPTED, `--output=${out}`));
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(JSON.parse(readFileSync(out, "utf8")).decision.decision).toBe(
          "proceed",
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
      // Use the clean proceed pair (no reasons fire), so the full fixture stems can't appear as a legitimate reason id.
      const r = runCli(pair(PUBLISHABLE, ACK_ACCEPTED, "--text"));
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("publish-pack-publishable");
      expect(r.stdout).not.toContain("ack-accepted");
    },
    SPAWN_TIMEOUT_MS,
  );
});
