// @vitest-environment node
/**
 * The proof cache through the REAL CLI (`scripts/worker-daemon.ts`), the way
 * the container uses it: the run-mode daemon proves and writes the cache in
 * the OS temp directory, and the HEALTHCHECK's `--dry-run-status` reads it
 * there. `./proved-capabilities.test.ts` covers each unit; this covers the
 * composed path — the script must actually route through them, in the same
 * directory, under the same key, on both sides.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { PROOF_CACHE_FILE } from "./proved-capabilities";

const SPAWN_TIMEOUT_MS = 180_000;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "pdfxyz-cli-proofs-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run the daemon with the temp dir pointed at `dir`; return code + the proofs line. */
function runDaemon(args: string[]): {
  code: number;
  proofs: Record<string, unknown> | undefined;
} {
  let stdout = "";
  let code = 0;
  try {
    stdout = runWorkerCliSync(["-s", "worker:daemon", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PDFXYZ_STORAGE_PROVIDER: "",
        PDFXYZ_QUEUE_PROVIDER: "",
        PDFXYZ_WORKER_MODE: "",
        PDFXYZ_WORKER_HEARTBEAT: "",
        TMPDIR: dir,
        TEMP: dir,
        TMP: dir,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: SPAWN_TIMEOUT_MS - 10_000,
    });
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    if (typeof e.status !== "number") throw err;
    code = e.status;
    stdout = e.stdout ?? "";
  }
  const proofs = stdout
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .find((l) => l.event === "heartbeat_proofs");
  return { code, proofs };
}

describe("the HEALTHCHECK reads what the daemon proved, through the real CLI", () => {
  it(
    "cold: --dry-run-status proves nothing and says so",
    () => {
      const r = runDaemon(["--dry-run-status"]);
      expect(r.code).toBe(2);
      expect(r.proofs).toMatchObject({ source: "none" });
      expect(existsSync(path.join(dir, PROOF_CACHE_FILE))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a run mode proves and writes the cache in the temp directory",
    () => {
      const r = runDaemon(["--once"]);
      expect(r.code).toBe(2);
      expect(r.proofs).toMatchObject({ source: "proved", cacheWritten: true });
      expect(existsSync(path.join(dir, PROOF_CACHE_FILE))).toBe(true);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "warm: --dry-run-status then publishes from the cache",
    () => {
      const r = runDaemon(["--dry-run-status"]);
      expect(r.code).toBe(2);
      expect(r.proofs).toMatchObject({ source: "cache" });
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a corrupt cache reads as cold, and the probe still exits on its readiness",
    () => {
      writeFileSync(path.join(dir, PROOF_CACHE_FILE), "{ not json");
      const r = runDaemon(["--dry-run-status"]);
      expect(r.code).toBe(2);
      expect(r.proofs).toMatchObject({ source: "none" });
    },
    SPAWN_TIMEOUT_MS,
  );
});
