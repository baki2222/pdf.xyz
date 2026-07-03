// @vitest-environment node
/**
 * The automated form of the `worker:cleanup-pipeline` checks: it spawns the REAL CLI (the
 * `run.test.ts` suite exercises `runPipeline` in-process over fake stages; this proves the shipped
 * `tsx scripts/worker-cleanup-pipeline.ts` binary behaves), asserts the documented exit-code ladder
 * + content-free output over the committed fixtures, and — the load-bearing no-leak proof — pipes a
 * HOSTILE raw export through the whole composite and asserts nothing survives. A closing block
 * re-runs the standalone Phase 42/43 CLIs to prove the shared observability edits did not regress
 * them. Node env; generous spawn timeout (the pipeline spawns one process that composes three
 * in-process runners).
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SPAWN_TIMEOUT_MS = 90_000;
const FIX = "docs/examples/cleanup-project";
const NOW = "1751500800000"; // fixed clock → deterministic output

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
    const stdout = execFileSync("pnpm", ["-s", script, ...args], {
      cwd: process.cwd(),
      env: CLEAN_ENV,
      ...(input !== undefined ? { input } : {}),
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; signal?: string | null; stdout?: string };
    if (typeof e.status === "number") return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // killed by a signal or never spawned — surface loudly
  }
}

const pipeline = (args: string[], input?: string): RunResult =>
  runScript("worker:cleanup-pipeline", args, input);

describe("worker:cleanup-pipeline CLI", () => {
  it(
    "--help prints usage + the exit-code ladder and exits 0",
    () => {
      const r = pipeline(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/cleanup evidence pipeline/i);
      expect(r.stdout).toMatch(/Exit codes/);
      expect(r.stdout).toMatch(/deletes NOTHING/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "maps each committed fixture to its documented composite exit code",
    () => {
      // A present-but-tombstoned object is the dominant unsafe signal → breach (4), regardless of
      // whether storage is wired here.
      expect(pipeline([`--file=${FIX}/raw-unsafe-tombstoned.json`, `--now=${NOW}`]).status).toBe(4);
      // With no storage backend configured (CLEAN_ENV), absence cannot be proven and the sweep is
      // clean → the honest "not enough evidence / not-configured" band (2), never a false 0.
      for (const f of ["raw-inventory-projected", "raw-evidence-projected", "raw-insufficient-listing"]) {
        expect(pipeline([`--file=${FIX}/${f}.json`, `--now=${NOW}`]).status, f).toBe(2);
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "emits a stable, self-describing document with an embedded receipt",
    () => {
      const r = pipeline([`--file=${FIX}/raw-unsafe-tombstoned.json`, `--now=${NOW}`]);
      const doc = JSON.parse(r.stdout);
      expect(doc.tool).toBe("worker-cleanup-pipeline");
      expect(doc.schema).toBe("pdfxyz.cleanup-pipeline/1");
      expect(doc.dryRun).toBe(true);
      expect(doc.severity).toBe("breach");
      expect(doc.exitCode).toBe(4);
      expect(Array.isArray(doc.arms)).toBe(true);
      expect(doc.arms.map((a: { arm: string }) => a.arm)).toEqual(["verify", "sweep"]);
      expect(doc.receipt.category).toBe("cleanup-pipeline");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "is deterministic for a fixed clock",
    () => {
      const a = pipeline([`--file=${FIX}/raw-inventory-projected.json`, `--now=${NOW}`]);
      const b = pipeline([`--file=${FIX}/raw-inventory-projected.json`, `--now=${NOW}`]);
      expect(a.stdout).toBe(b.stdout);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "fails closed on misuse (bad flag, apply/delete, malformed, oversized) → exit 1",
    () => {
      expect(pipeline(["--not-a-flag", "--stdin"]).status).toBe(1);
      expect(pipeline(["--stdin", "--file=x.json"]).status).toBe(1); // conflict
      expect(pipeline([]).status).toBe(1); // no input
      expect(pipeline(["--stdin", "--apply"]).status).toBe(1); // never deletes
      expect(pipeline(["--stdin", "--delete"]).status).toBe(1);
      expect(pipeline(["--stdin"], "{ not json").status).toBe(1); // malformed export
      const huge = JSON.stringify({ objects: [{ presence: "absent", pad: "x".repeat(4 * 1024 * 1024 + 64) }] });
      expect(pipeline(["--stdin"], huge).status).toBe(1); // oversized
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "renders a content-free text summary",
    () => {
      const r = pipeline([`--file=${FIX}/raw-unsafe-tombstoned.json`, `--now=${NOW}`, "--text"]);
      expect(r.status).toBe(4);
      expect(r.stdout).toMatch(/cleanup pipeline \(dry-run, read-only\)/);
      expect(r.stdout).toMatch(/severity\s+breach/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "leaks nothing from a hostile raw export piped through the whole composite",
    () => {
      const hostile = JSON.stringify({
        objects: [
          {
            httpStatusCode: 200,
            expiresAtMs: 4102444800000,
            manifest: "valid",
            kind: "pdf",
            deleted: true, // force a present-tombstoned unsafe signal so both arms actually run
            Key: "artifacts/ACME-Q3-SECRET.pdf",
            Bucket: "prod-user-uploads",
            signedUrl: "https://prod.s3.amazonaws.com/x?X-Amz-Signature=deadbeefcafe",
            region: "us-east-1",
            Metadata: {
              "original-filename": "Bank Statement.pdf",
              "ocr-text": "Account 1234 balance",
              "env-secret": "AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE",
            },
          },
        ],
      });
      const r = pipeline(["--stdin", "--source=aws-s3", `--now=${NOW}`], hostile);
      // Reached a documented verdict without a crash.
      expect([0, 2, 3, 4]).toContain(r.status);
      const out = r.stdout.toLowerCase();
      for (const needle of ["acme", "secret", "prod-user-uploads", "amazonaws", "deadbeef", "us-east-1", "bank statement", "akia", "://", ".pdf", "account 1234"]) {
        expect(out, `leaked ${needle}`).not.toContain(needle);
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("Phase 42/43 CLIs still behave (regression over the shared observability edits)", () => {
  it(
    "worker:cleanup-project still projects a fixture unchanged",
    () => {
      const r = runScript("worker:cleanup-project", [`--target=inventory`, `--file=${FIX}/raw-inventory-projected.json`]);
      expect(r.status).toBe(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.tool).toBe("worker-cleanup-project");
      expect(doc.schema).toBe("pdfxyz.cleanup-projection/1");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "worker:artifact-cleanup still ingests a projected inventory (clean → ok/0)",
    () => {
      const projected = runScript("worker:cleanup-project", [`--target=inventory`, `--file=${FIX}/raw-inventory-projected.json`]);
      const sweep = runScript("worker:artifact-cleanup", ["--stdin", "--json"], projected.stdout);
      expect(sweep.status).toBe(0);
      expect(JSON.parse(sweep.stdout).report.verdict).toBe("ok");
    },
    SPAWN_TIMEOUT_MS,
  );
});
