// @vitest-environment node
/**
 * The runtime-emit proof: the executor and daemon emit the EXPECTED content-free
 * metrics for the success, terminal-failure, infected, scan-unavailable/retry, and
 * dead-letter paths — using the real local-dev queue/store/storage and injected
 * scanners/clock, with NO Docker/Redis/S3/ClamAV/OCR. It also asserts the emitted
 * snapshot never carries a filename, key, or byte from the jobs it processed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import type { ClaimableQueue } from "../queue/claim";
import { createProcessorRegistry } from "../processor";
import { createLocalDevExecutorStorage } from "../executor/local-dev-storage";
import { createWorkerExecutor } from "../executor/executor";
import type { ExecutorStorage, ExecutorTick } from "../executor/types";
import { scanError, scanInfected, type MalwareScanner } from "../scanner";
import { createWorkerDaemon } from "../daemon/daemon";
import {
  createWorkerMetricsCollector,
  seriesFor,
  sumSeries,
  type WorkerMetricsCollector,
} from "./collector";

const LEASE_MS = 1_000;
const noEngines = { tools: { ghostscript: false, qpdf: false, mutool: false } };

async function makePdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  return doc.save();
}

function queuedJob(jobId: string, tool: string, createdAtMs: number): Job {
  return {
    jobId,
    tool,
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + 3_600_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

/** A scanner whose verdict is fixed, so the scan-gate paths are deterministic. */
function fixedScanner(verdict: "infected" | "error"): MalwareScanner {
  return {
    scan: async () => (verdict === "infected" ? scanInfected() : scanError()),
    capability: () => ({ active: true, provider: "fake", detail: "test scanner" }),
  };
}

describe("executor metric emission", () => {
  let clock: number;
  let store: DevWorkerStore;
  let queue: ClaimableQueue;
  let storage: ExecutorStorage;
  let metrics: WorkerMetricsCollector;
  // A metrics-only clock that advances 250ms per read → a deterministic 250ms latency.
  let nowMs: number;

  beforeEach(() => {
    clock = 100_000;
    store = new DevWorkerStore(() => clock);
    queue = createLocalDevQueue({ store, now: () => clock });
    storage = createLocalDevExecutorStorage({ store, now: () => clock });
    metrics = createWorkerMetricsCollector();
    nowMs = 0;
  });

  const now = () => {
    nowMs += 250;
    return nowMs;
  };

  async function seedInput(bytes: Uint8Array, filename = "Bank Statement.pdf") {
    const slot = store.reserveSlot({
      sessionId: "sess_test00000",
      filename,
      contentType: "application/pdf",
      declaredBytes: bytes.byteLength,
    });
    store.putBytes(slot.fileId, bytes);
    return slot.fileId;
  }

  function executor(scanner?: MalwareScanner) {
    return createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({ compression: noEngines }),
      leaseMs: LEASE_MS,
      metrics: metrics.sink,
      now,
      ...(scanner ? { scanner } : {}),
    });
  }

  it("success path: completed + processor + latency + terminal metrics", async () => {
    const fileId = await seedInput(await makePdf(5));
    await queue.submit({
      job: queuedJob("job_ok00000000", "compress-pdf", clock),
      inputs: [fileId],
      options: { profile: "lossless" },
    });
    const [tick] = await executor().drain();
    expect(tick?.outcome).toBe("completed");

    const snap = metrics.snapshot();
    expect(sumSeries(snap, "worker_job_terminal_total", { outcome: "completed" })).toBe(1);
    expect(sumSeries(snap, "worker_processor_total", { processor: "compress", outcome: "completed" })).toBe(1);
    expect(sumSeries(snap, "worker_processor_latency_seconds", { processor: "compress" })).toBe(1);
    // 250ms elapsed between the two clock reads → the 0.25s bucket.
    expect(seriesFor(snap, "worker_processor_latency_seconds")[0]!.labels.le).toBe("0.25");
  });

  it("terminal failure path: deep-without-engine → processor + terminal failed", async () => {
    const fileId = await seedInput(await makePdf());
    await queue.submit({
      job: queuedJob("job_deep000000", "compress-pdf", clock),
      inputs: [fileId],
      options: { profile: "deep" },
    });
    await executor().drain();

    const snap = metrics.snapshot();
    expect(sumSeries(snap, "worker_processor_total", { processor: "compress", outcome: "failed" })).toBe(1);
    expect(sumSeries(snap, "worker_job_terminal_total", { outcome: "failed", failure_class: "unsupported" })).toBe(1);
  });

  it("infected path: scan blocked before processing, no processor metric", async () => {
    const fileId = await seedInput(await makePdf());
    await queue.submit({
      job: queuedJob("job_inf0000000", "compress-pdf", clock),
      inputs: [fileId],
      options: { profile: "lossless" },
    });
    await executor(fixedScanner("infected")).drain();

    const snap = metrics.snapshot();
    expect(sumSeries(snap, "worker_scan_total", { verdict: "infected", scanned: "true" })).toBe(1);
    expect(sumSeries(snap, "worker_job_terminal_total", { outcome: "failed", failure_class: "blocked" })).toBe(1);
    // The processor never ran, so there is no processor metric.
    expect(sumSeries(snap, "worker_processor_total")).toBe(0);
  });

  it("scan-unavailable path: retries then a dead letter, with redeliveries", async () => {
    const fileId = await seedInput(await makePdf());
    await queue.submit({
      job: queuedJob("job_scanerr000", "compress-pdf", clock),
      inputs: [fileId],
      options: { profile: "lossless" },
    });
    // maxAttempts defaults to 3: requeue, requeue, then terminal (dead letter).
    await executor(fixedScanner("error")).drain();

    const snap = metrics.snapshot();
    expect(sumSeries(snap, "worker_scan_total", { verdict: "error", scanned: "false" })).toBe(3);
    expect(sumSeries(snap, "worker_retry_total")).toBe(2);
    expect(sumSeries(snap, "worker_dead_letter_total")).toBe(1);
    expect(sumSeries(snap, "worker_redelivery_total")).toBe(2); // attempts 2 and 3
    expect(sumSeries(snap, "worker_job_terminal_total", { outcome: "failed", failure_class: "scan_unavailable" })).toBe(1);
  });

  it("never leaks a filename, byte, or key into the metric snapshot", async () => {
    const fileId = await seedInput(await makePdf(2), "Q3 Confidential Report.pdf");
    await queue.submit({
      job: queuedJob("job_leak000000", "compress-pdf", clock),
      inputs: [fileId],
      options: { profile: "lossless" },
    });
    await executor(fixedScanner("infected")).drain();

    const text = JSON.stringify(metrics.snapshot()).toLowerCase();
    // The opaque job/session ids and the filename must never appear. (Note "job_"
    // alone is a substring of the metric NAME worker_job_terminal_total, so we assert
    // the specific opaque ids, which are what the executor deliberately omits.)
    for (const bad of ["confidential", "report", ".pdf", "job_leak", "sess_test"]) {
      expect(text, `leaked ${bad}`).not.toContain(bad.toLowerCase());
    }
  });
});

describe("daemon metric emission", () => {
  it("emits tick, claim, and run metrics for a drain", async () => {
    const metrics = createWorkerMetricsCollector();
    const scripted: ExecutorTick[] = [
      { outcome: "completed", jobId: "j1", attempt: 1 },
      { outcome: "idle" },
    ];
    const daemon = createWorkerDaemon({
      executor: {
        runOnce: async () => scripted.shift() ?? { outcome: "idle" },
        drain: async () => [],
      },
      metrics: metrics.sink,
    });

    const summary = await daemon.run({ mode: "drain" });
    expect(summary.reason).toBe("drained");

    const snap = metrics.snapshot();
    expect(sumSeries(snap, "worker_tick_total", { mode: "drain", outcome: "completed" })).toBe(1);
    expect(sumSeries(snap, "worker_tick_total", { mode: "drain", outcome: "idle" })).toBe(1);
    expect(sumSeries(snap, "worker_claim_total", { result: "claimed" })).toBe(1);
    expect(sumSeries(snap, "worker_claim_total", { result: "empty" })).toBe(1);
    expect(sumSeries(snap, "worker_run_total", { mode: "drain", reason: "drained" })).toBe(1);
  });
});
