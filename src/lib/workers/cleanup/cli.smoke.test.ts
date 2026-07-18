// @vitest-environment node
/**
 * End-to-end exit-code + output contract for the cleanup-check CLI (`pnpm worker:cleanup-check`,
 * i.e. `scripts/worker-cleanup-check.ts`).
 *
 * The parser, verifier, ingest, and renderers are unit-tested elsewhere; this spawns the REAL
 * CLI — in a deliberately unconfigured environment for the honest default, and with a synthetic
 * S3 config + evidence on stdin/file for the verified/drift paths — and pins the codes an
 * operator monitor / cron / CI gate depends on:
 *
 *   0  verified — every should-be-gone artifact is confirmed absent
 *   1  usage    — a bad flag, or unreadable/malformed input
 *   2  unknown  — not-configured, no evidence, or an unavailable probe
 *   3  drift    — an object is still present past its retention window + grace
 *
 * It proves the CLI evaluates honestly (never fabricates a deletion) and never leaks an ingested
 * string.
 */
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { OPS_CHECK_EXIT } from "../observability/alerts";

interface CliResult {
  status: number;
  stdout: string;
}

/** The env that makes the provider resolve to `remote-configured` (a valid synthetic S3 config). */
const S3_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "pdfxyz-store",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-fixture-redacted-value",
};

/** The env that makes the provider resolve to `not-configured`. */
const EMPTY_ENV = {
  PDFXYZ_STORAGE_PROVIDER: "",
  PDFXYZ_S3_ENDPOINT: "",
  PDFXYZ_S3_REGION: "",
  PDFXYZ_S3_BUCKET: "",
  PDFXYZ_S3_ACCESS_KEY_ID: "",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "",
};

function runCli(
  args: string[],
  opts: { input?: string; env?: Record<string, string> } = {},
): CliResult {
  try {
    const stdout = runWorkerCliSync(["-s", "worker:cleanup-check", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...EMPTY_ENV, ...opts.env },
      ...(opts.input !== undefined ? { input: opts.input } : {}),
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 90_000,
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
    throw err; // killed by a signal or never spawned — surface loudly
  }
}

const SPAWN_TIMEOUT_MS = 120_000;

/** All should-be-gone objects confirmed absent → verified. */
const HEALTHY = JSON.stringify([
  { presence: "absent", activeDelete: true },
  { presence: "absent" },
]);

/** A long-expired object still present → drift (far past any grace). */
const DRIFT = JSON.stringify([
  { presence: "present", expiresAtMs: 1_000_000_000_000, deleted: false },
]);

/** A recently-expired object still present → retrieval-denied → unknown. */
const PENDING = JSON.stringify([
  { presence: "present", expiresAtMs: Date.now() - 3_600_000, deleted: false },
]);

const HOSTILE_CONTENT_MARKER =
  "hostile-storage-locator-customer-document-redacted";

const tmp = mkdtempSync(join(tmpdir(), "cleanup-check-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("worker cleanup-check CLI — exit codes + output", () => {
  it(
    "exits 0 for --help and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(OPS_CHECK_EXIT.OK);
      expect(r.stdout).toMatch(/cleanup verifier/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits UNKNOWN (2) with a not-configured verdict when no storage is wired",
    () => {
      const r = runCli([], { env: EMPTY_ENV });
      expect(r.status).toBe(OPS_CHECK_EXIT.UNKNOWN);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.verdict).toBe("not-configured");
      expect(parsed.schema).toBe("pdfxyz.cleanup-check/1");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits UNKNOWN (2) with an unknown verdict when configured but given no evidence",
    () => {
      const r = runCli([], { env: S3_ENV });
      expect(r.status).toBe(OPS_CHECK_EXIT.UNKNOWN);
      expect(JSON.parse(r.stdout).verdict).toBe("unknown");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits 0 (verified) for a healthy absent-after-cleanup document on stdin",
    () => {
      const r = runCli(["--stdin"], { env: S3_ENV, input: HEALTHY });
      expect(r.status).toBe(OPS_CHECK_EXIT.OK);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.verdict).toBe("verified");
      expect(parsed.reaped).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits WARN (3) with a drift verdict for a long-expired-but-present object",
    () => {
      const r = runCli(["--stdin"], { env: S3_ENV, input: DRIFT });
      expect(r.status).toBe(OPS_CHECK_EXIT.WARN);
      expect(JSON.parse(r.stdout).verdict).toBe("drift");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits UNKNOWN (2) for a recently-expired present object (denial working, reap pending)",
    () => {
      const r = runCli(["--stdin"], { env: S3_ENV, input: PENDING });
      expect(r.status).toBe(OPS_CHECK_EXIT.UNKNOWN);
      expect(JSON.parse(r.stdout).verdict).toBe("unknown");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "does NOT fabricate a verdict when storage is unconfigured, even with healthy evidence",
    () => {
      // The honest short-circuit: an unconfigured deployment has nothing to verify.
      const r = runCli(["--stdin"], { env: EMPTY_ENV, input: HEALTHY });
      expect(r.status).toBe(OPS_CHECK_EXIT.UNKNOWN);
      expect(JSON.parse(r.stdout).verdict).toBe("not-configured");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits usage (1) for malformed stdin input — never fabricates a verdict",
    () => {
      expect(
        runCli(["--stdin"], { env: S3_ENV, input: "{not json" }).status,
      ).toBe(OPS_CHECK_EXIT.USAGE);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "exits usage (1) for an unknown flag",
    () => {
      expect(runCli(["--definitely-not-a-flag"]).status).toBe(
        OPS_CHECK_EXIT.USAGE,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a document from --file and renders Prometheus gauges",
    () => {
      const path = join(tmp, "evidence.json");
      writeFileSync(path, HEALTHY);
      const r = runCli(["--file", path, "--prometheus"], { env: S3_ENV });
      expect(r.status).toBe(OPS_CHECK_EXIT.OK);
      expect(r.stdout).toMatch(/pdfxyz_cleanup_check_verdict 0/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never echoes a content-bearing string from an ingested document",
    () => {
      const poisoned = JSON.stringify({
        bucket: HOSTILE_CONTENT_MARKER,
        objects: [
          {
            presence: "present",
            expiresAtMs: 1_000_000_000_000,
            objectKey: HOSTILE_CONTENT_MARKER,
            signedUrl: HOSTILE_CONTENT_MARKER,
          },
        ],
      });
      const r = runCli(["--stdin"], { env: S3_ENV, input: poisoned });
      // A drift verdict, but crucially no leak of the ingested strings.
      expect(r.status).toBe(OPS_CHECK_EXIT.WARN);
      expect(r.stdout).not.toContain(HOSTILE_CONTENT_MARKER);
    },
    SPAWN_TIMEOUT_MS,
  );
});
