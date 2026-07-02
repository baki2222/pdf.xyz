// @vitest-environment node
//
// Phase 17 end-to-end honesty: drive a `compress-pdf` deep job through the real
// daemon + executor + processor registry, with a MOCKED native engine (no real
// Ghostscript/qpdf), a fake claimable queue (the local-dev queue), and fake byte
// storage (the local-dev executor storage). Proves the job moves
// queued → processing → completed with a real, validated artifact — and that with
// no native engine the same job fails honestly as not_implemented, never faked.
import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { createLocalDevExecutorStorage } from "../executor/local-dev-storage";
import type { ExecutorLogEvent } from "../executor/types";
import { createProcessorRegistry } from "../processor";
import { looksLikePdf, type CompressionDeps } from "../compression/engine";
import { createWorkerDaemon } from "./daemon";
import { resolveWorkerRuntime } from "./runtime";

async function makePdf(pages = 6): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
  return doc.save();
}

/** Minimal, structurally-valid PDF the mocked native engine "produces". */
function tinyPdf(pad = 32): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

const noEngines: CompressionDeps = {
  tools: { ghostscript: false, qpdf: false, mutool: false },
};

describe("worker daemon — native deep compression end-to-end", () => {
  let clock: number;
  let store: DevWorkerStore;

  beforeEach(() => {
    clock = 1_000;
    store = new DevWorkerStore(() => clock);
  });

  const queuedJob = (jobId: string): Job => ({
    jobId,
    tool: "compress-pdf",
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(clock).toISOString(),
    updatedAt: new Date(clock).toISOString(),
    expiresAt: new Date(clock + 60 * 60 * 1000).toISOString(),
    retention: DEFAULT_RETENTION,
  });

  async function seedJob(jobId: string): Promise<{ fileId: string }> {
    const queue = createLocalDevQueue({ store, now: () => clock });
    const pdf = await makePdf();
    const slot = store.reserveSlot({
      sessionId: "sess_cmp",
      filename: "report.pdf",
      contentType: "application/pdf",
      declaredBytes: pdf.byteLength,
    });
    store.putBytes(slot.fileId, pdf);
    await queue.submit({
      job: queuedJob(jobId),
      inputs: [slot.fileId],
      options: { profile: "deep", targetDpi: 150 },
    });
    return { fileId: slot.fileId };
  }

  it("moves a deep job queued → processing → completed with a mocked native engine", async () => {
    const jobId = "job_cmp0000000001";
    const { fileId } = await seedJob(jobId);

    const compressed = tinyPdf();
    // A registry whose compression processor has a native engine wired to a MOCK —
    // exactly the seam a real Ghostscript runner slots into.
    const registry = createProcessorRegistry({
      compression: {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        native: async () => compressed,
      },
    });

    const queue = createLocalDevQueue({ store, now: () => clock });
    const storage = createLocalDevExecutorStorage({ store, now: () => clock });
    const events: ExecutorLogEvent[] = [];
    const runtime = resolveWorkerRuntime(
      {},
      { queue, storage, registry, log: (e) => events.push(e) },
    );
    expect(runtime.executor).toBeDefined();

    const summary = await createWorkerDaemon({ executor: runtime.executor! }).run({
      mode: "drain",
    });

    // The job really completed — one artifact, no fabrication.
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);

    const job = store.getJob(jobId);
    expect(job?.status).toBe("completed");
    expect(job?.progress).toBe(100);
    expect(job?.artifacts).toHaveLength(1);

    const artifact = job?.artifacts?.[0];
    expect(artifact?.filename).toBe("report-compressed.pdf");
    expect(artifact?.url).toMatch(/^\/api\/artifacts\/local\/art_/);

    // The stored artifact bytes are the (validated) compressed output.
    const stored = store.getArtifact(artifact!.artifactId);
    expect(stored?.bytes).toEqual(compressed);
    expect(looksLikePdf(stored!.bytes)).toBe(true);

    // The state machine progressed through processing to completed (executor log).
    const kinds = events.map((e) => e.event);
    expect(kinds).toContain("processing");
    expect(kinds).toContain("completed");

    // The input was wiped once the job reached a terminal state (retention).
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("fails a deep job honestly as not_implemented when no native engine is installed", async () => {
    const jobId = "job_cmp0000000002";
    const { fileId } = await seedJob(jobId);

    // No native engine wired: deep compression cannot run here.
    const registry = createProcessorRegistry({ compression: noEngines });
    const queue = createLocalDevQueue({ store, now: () => clock });
    const storage = createLocalDevExecutorStorage({ store, now: () => clock });
    const runtime = resolveWorkerRuntime({}, { queue, storage, registry });

    const summary = await createWorkerDaemon({ executor: runtime.executor! }).run({
      mode: "drain",
    });

    // Honest terminal failure — never a completed job, never an artifact.
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(1);
    const job = store.getJob(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.artifacts ?? []).toHaveLength(0);
    expect(job?.error?.code).toBe("not_implemented");
    expect(job?.error?.retryable).toBe(false);
    // Inputs are wiped even on failure.
    expect(store.getSlot(fileId)).toBeUndefined();
  });
});
