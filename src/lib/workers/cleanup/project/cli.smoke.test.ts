// @vitest-environment node
/**
 * The automated form of the `worker:cleanup-project` checks in `scripts/worker-smoke.sh`: it
 * spawns the REAL CLI (the `run.test.ts` suite exercises `runProject` in-process; this proves the
 * shipped `tsx scripts/worker-cleanup-project.ts` binary behaves), asserts the documented
 * exit-code ladder + content-free output, and — the load-bearing compatibility proof — pipes the
 * projected document straight into the REAL Phase 42 `worker:cleanup-check` and
 * `worker:artifact-cleanup` binaries and asserts they ingest it. Node env; generous spawn timeout.
 */
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { describe, expect, it } from "vitest";

const SPAWN_TIMEOUT_MS = 90_000;
const FIX = "docs/examples/cleanup-project";

/** Env with the storage/queue/mode vars blanked, so a spawn can never inherit a real backend. */
const CLEAN_ENV = {
  ...process.env,
  PDFXYZ_STORAGE_PROVIDER: "",
  PDFXYZ_QUEUE_PROVIDER: "",
  PDFXYZ_WORKER_MODE: "",
};

interface RunResult {
  status: number;
  stdout: string;
}

/** Spawn a `pnpm -s <script>` worker CLI, capturing status + stdout (never throwing on non-zero). */
function runScript(script: string, args: string[], input?: string): RunResult {
  try {
    const stdout = runWorkerCliSync(["-s", script, ...args], {
      cwd: process.cwd(),
      env: CLEAN_ENV,
      ...(input !== undefined ? { input } : {}),
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
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

const project = (args: string[], input?: string): RunResult =>
  runScript("worker:cleanup-project", args, input);

describe("worker:cleanup-project CLI", () => {
  it(
    "--help prints usage and exits 0",
    () => {
      const r = project(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/offline projector/i);
      expect(r.stdout).toMatch(/Exit codes:/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "maps each example fixture to its documented exit code",
    () => {
      expect(
        project([
          `--target=inventory`,
          `--file=${FIX}/raw-inventory-projected.json`,
        ]).status,
      ).toBe(0);
      expect(
        project([
          `--target=evidence`,
          `--file=${FIX}/raw-evidence-projected.json`,
        ]).status,
      ).toBe(0);
      expect(
        project([
          `--target=inventory`,
          `--file=${FIX}/raw-unsafe-tombstoned.json`,
        ]).status,
      ).toBe(4);
      expect(
        project([
          `--target=inventory`,
          `--file=${FIX}/raw-insufficient-listing.json`,
        ]).status,
      ).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "emits a stable, self-describing document for a fixture",
    () => {
      const r = project([
        `--target=inventory`,
        `--file=${FIX}/raw-inventory-projected.json`,
      ]);
      expect(r.status).toBe(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.tool).toBe("worker-cleanup-project");
      expect(doc.schema).toBe("pdfxyz.cleanup-projection/1");
      expect(doc.target).toBe("inventory");
      expect(Array.isArray(doc.records)).toBe(true);
      expect(doc.receipt.category).toBe("cleanup-projection");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a raw export from stdin",
    () => {
      const input = JSON.stringify({ objects: [{ presence: "absent" }] });
      const r = project(
        ["--target=evidence", "--stdin", "--source=generic"],
        input,
      );
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).objects).toEqual([{ presence: "absent" }]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "treats bad usage as an input error (exit 1)",
    () => {
      expect(project(["--not-a-flag", "--stdin"]).status).toBe(1); // unknown flag
      expect(
        project(["--target=evidence", "--stdin", "--file=x.json"]).status,
      ).toBe(1); // conflict
      expect(project(["--stdin"]).status).toBe(1); // no target
      expect(project(["--target=evidence"]).status).toBe(1); // no input
      expect(project(["--target=evidence", "--stdin", "--apply"]).status).toBe(
        1,
      ); // never deletes
      expect(
        project(["--target=evidence", "--stdin"], "{ not json").status,
      ).toBe(1); // malformed
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "rejects an oversized export (exit 1) before projecting it",
    () => {
      const huge = JSON.stringify({
        objects: [
          { presence: "absent", pad: "x".repeat(4 * 1024 * 1024 + 64) },
        ],
      });
      const r = project(
        ["--target=evidence", "--stdin", "--source=generic"],
        huge,
      );
      expect(r.status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "leaks nothing from a hostile raw export piped on stdin",
    () => {
      const hostile = JSON.stringify({
        objects: [
          {
            httpStatusCode: 200,
            expiresAtMs: 4102444800000,
            manifest: "valid",
            kind: "pdf",
            Key: "artifacts/ACME-Q3-SECRET.pdf",
            Bucket: "prod-user-uploads",
            signedUrl:
              "https://prod.s3.amazonaws.com/x?X-Amz-Signature=deadbeefcafe",
            Metadata: {
              "original-filename": "Bank Statement.pdf",
              "ocr-text": "Account 1234 balance",
              "env-secret": "AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE",
            },
          },
        ],
      });
      const r = project(
        ["--target=inventory", "--stdin", "--source=aws-s3"],
        hostile,
      );
      expect(r.status).toBe(0);
      const out = r.stdout.toLowerCase();
      for (const needle of [
        "acme",
        "secret",
        "prod-user-uploads",
        "amazonaws",
        "deadbeef",
        "bank statement",
        "akia",
        "://",
        ".pdf",
      ]) {
        expect(out, `leaked ${needle}`).not.toContain(needle);
      }
      // It still projected the object into a bounded inventory record.
      expect(JSON.parse(r.stdout).records[0]).toMatchObject({
        manifest: "valid",
        kind: "pdf",
      });
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("worker:cleanup-project → Phase 42 tools (end-to-end pipe compatibility)", () => {
  it(
    "an evidence projection is ingested by worker:cleanup-check",
    () => {
      const projected = project([
        `--target=evidence`,
        `--file=${FIX}/raw-evidence-projected.json`,
      ]);
      expect(projected.status).toBe(0);
      const check = runScript(
        "worker:cleanup-check",
        ["--stdin"],
        projected.stdout,
      );
      // Not a usage error (1) — the verifier accepted the projected evidence and reached a verdict.
      expect(check.status).not.toBe(1);
      const parsed = JSON.parse(check.stdout);
      expect(parsed.schema).toBe("pdfxyz.cleanup-check/1");
      expect(typeof parsed.verdict).toBe("string");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an inventory projection is ingested by worker:artifact-cleanup (clean fixture → ok, exit 0)",
    () => {
      const projected = project([
        `--target=inventory`,
        `--file=${FIX}/raw-inventory-projected.json`,
      ]);
      expect(projected.status).toBe(0);
      const sweep = runScript(
        "worker:artifact-cleanup",
        ["--stdin", "--json"],
        projected.stdout,
      );
      expect(sweep.status).toBe(0);
      const parsed = JSON.parse(sweep.stdout);
      expect(parsed.tool).toBe("worker-artifact-cleanup");
      expect(parsed.report.verdict).toBe("ok");
    },
    SPAWN_TIMEOUT_MS,
  );
});
