// @vitest-environment node
/**
 * A document qpdf refuses is refused ONCE, and the user is told why.
 *
 * Until 2026-09-27 qpdf's exit 2 — a user password it was not given, or damage
 * too deep to rebuild — was the same untyped throw as a timeout. The engine's
 * bare `catch {}` made both `failed`, the processor made `failed` a retryable
 * `internal_error`, and the executor did what retryable means: ran qpdf three
 * times on identical bytes with 2 s and 8 s of backoff, counted a dead letter,
 * and handed the user "could not process this file".
 *
 * Each layer passing its own test proves nothing about that path, so this runs
 * the chain whole: the REAL native runner (only `exec` and `fs` are stubbed,
 * answering the way execFile / fs.promises do), the real engine, the real
 * processor, and the real executor over the local-dev queue. Every tool the
 * processor owns is asked, read from the processor itself.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import type { ClaimableQueue } from "../queue/claim";
import { createProcessorRegistry } from ".";
import { createLocalDevExecutorStorage } from "../executor/local-dev-storage";
import { createWorkerExecutor } from "../executor/executor";
import type { WorkerMetricSample } from "../observability/metrics";
import {
  nativePdfStructureDeps,
  type QpdfStructureExec,
  type QpdfStructureExecResult,
  type QpdfStructureFs,
} from "../pdf-structure/native";
import { createPdfStructureProcessor } from "./pdf-structure";

function pdf(pad = 40): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

/** qpdf as execFile reports it: `main` for the rewrite, `probe` for the probe. */
function qpdf(main: QpdfStructureExecResult, probe?: QpdfStructureExecResult) {
  const calls: string[][] = [];
  const exec: QpdfStructureExec = async (_command, args) => {
    calls.push([...args]);
    if (args[0] === "--requires-password") {
      if (!probe) throw new Error("the probe was not expected to run");
      return probe;
    }
    return main;
  };
  const fs: QpdfStructureFs = {
    mkdtemp: async (prefix) => `${prefix}dir`,
    writeFile: async () => {},
    readFile: async () => pdf(64),
    rm: async () => {},
  };
  const rewrites = () =>
    calls.filter((a) => a[0] !== "--requires-password").length;
  return {
    deps: nativePdfStructureDeps({}, { resolveOnPath: () => true, exec, fs }),
    rewrites,
  };
}

const LOCKED = () =>
  qpdf({ code: 2, timedOut: false }, { code: 0, timedOut: false });
const RUBBLE = () =>
  qpdf({ code: 2, timedOut: false }, { code: 2, timedOut: false });
const TIMEOUT = () => qpdf({ code: -1, timedOut: true });

const TOOLS = createPdfStructureProcessor(TIMEOUT().deps).tools;

describe("pdf-structure processor — a refusal is final and named", () => {
  it("HEALTH: the processor owns both structure tools", () => {
    expect([...TOOLS].sort()).toEqual(["optimize-web", "repair-pdf"]);
  });

  for (const tool of TOOLS) {
    const run = (deps: ReturnType<typeof qpdf>["deps"]) =>
      createPdfStructureProcessor(deps).process({
        tool,
        options: {},
        inputs: [
          {
            fileId: "f_1234567890",
            filename: "statement.pdf",
            contentType: "application/pdf",
            bytes: pdf(),
          },
        ],
      });

    it(`${tool}: a password-protected PDF is final and sent to Unlock PDF`, async () => {
      const result = await run(LOCKED().deps);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
        retryable: false,
      });
      expect(result.error.message).toMatch(/password-protected.*Unlock PDF/);
    });

    it(`${tool}: a file qpdf cannot rebuild is final`, async () => {
      const result = await run(RUBBLE().deps);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        code: OFFICE_EXPORT_ERROR_CODES.unreadable,
        retryable: false,
      });
      expect(result.error.message).not.toMatch(/qpdf|password/i);
    });

    it(`${tool}: POSITIVE CONTROL — a timeout stays retryable`, async () => {
      const result = await run(TIMEOUT().deps);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        code: "internal_error",
        retryable: true,
      });
    });
  }
});

describe("pdf-structure through the executor — qpdf runs once, not three times", () => {
  let clock: number;
  let store: DevWorkerStore;
  let queue: ClaimableQueue;

  beforeEach(() => {
    clock = 100_000;
    store = new DevWorkerStore(() => clock);
    queue = createLocalDevQueue({ store, now: () => clock });
  });

  async function submit(tool: string, jobId: string) {
    const slot = store.reserveSlot({
      sessionId: "sess_test00000",
      filename: "statement.pdf",
      contentType: "application/pdf",
      declaredBytes: pdf().byteLength,
    });
    store.putBytes(slot.fileId, pdf());
    const job: Job = {
      jobId,
      tool,
      capability: "secure-worker",
      status: "queued",
      progress: 0,
      createdAt: new Date(clock).toISOString(),
      updatedAt: new Date(clock).toISOString(),
      expiresAt: new Date(clock + 60 * 60_000).toISOString(),
      retention: DEFAULT_RETENTION,
    };
    await queue.submit({ job, inputs: [slot.fileId], options: {} });
  }

  function executor(deps: ReturnType<typeof qpdf>["deps"]) {
    const metrics: WorkerMetricSample[] = [];
    const exec = createWorkerExecutor({
      queue,
      storage: createLocalDevExecutorStorage({ store, now: () => clock }),
      registry: createProcessorRegistry({ pdfStructure: deps }),
      leaseMs: 1_000,
      metrics: (m) => metrics.push(m),
    });
    return { exec, metrics };
  }

  for (const tool of TOOLS) {
    it(`${tool}: a locked PDF fails at attempt 1 — no requeue, no dead letter`, async () => {
      const q = LOCKED();
      const { exec, metrics } = executor(q.deps);
      await submit(tool, "job_locked0000");

      const first = await exec.runOnce();

      expect(first).toMatchObject({ outcome: "failed", attempt: 1 });
      expect(q.rewrites()).toBe(1);
      const names = metrics.map((m) => m.metric);
      expect(names).not.toContain("worker_retry_total");
      expect(names).not.toContain("worker_dead_letter_total");
      // What the job record — and so GET /api/jobs/:id — carries.
      expect(store.getJob("job_locked0000")?.error).toMatchObject({
        code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
        retryable: false,
      });
    });

    it(`${tool}: POSITIVE CONTROL — a timeout is still requeued`, async () => {
      const q = TIMEOUT();
      const { exec, metrics } = executor(q.deps);
      await submit(tool, "job_timeout000");

      const first = await exec.runOnce();

      expect(first.outcome).toBe("requeued");
      expect(metrics.map((m) => m.metric)).toContain("worker_retry_total");
    });
  }
});
