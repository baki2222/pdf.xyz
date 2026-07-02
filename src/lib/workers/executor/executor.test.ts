// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_RETENTION, type Job, type JobArtifact } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import type { ClaimableQueue } from "../queue/claim";
import { ProcessorRegistry } from "../processor/registry";
import { createProcessorRegistry } from "../processor";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorInputFile,
} from "../processor/types";
import { createLocalDevExecutorStorage } from "./local-dev-storage";
import { createWorkerExecutor } from "./executor";
import type { ExecutorStorage } from "./types";

const LEASE_MS = 1_000;

async function makePdf(pages = 5): Promise<Uint8Array> {
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
    expiresAt: new Date(createdAtMs + 60 * 60_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

const noEngines = {
  tools: { ghostscript: false, qpdf: false, mutool: false },
};

// ───────────────────────── real local-dev integration ─────────────────────────

describe("worker executor — local-dev integration", () => {
  let clock: number;
  let store: DevWorkerStore;
  let queue: ClaimableQueue;
  let storage: ExecutorStorage;

  beforeEach(() => {
    clock = 100_000;
    store = new DevWorkerStore(() => clock);
    queue = createLocalDevQueue({ store, now: () => clock });
    storage = createLocalDevExecutorStorage({ store, now: () => clock });
  });

  const executor = () =>
    createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({ compression: noEngines }),
      leaseMs: LEASE_MS,
    });

  async function seedInput(bytes: Uint8Array, filename = "report.pdf") {
    const slot = store.reserveSlot({
      sessionId: "sess_test00000",
      filename,
      contentType: "application/pdf",
      declaredBytes: bytes.byteLength,
    });
    store.putBytes(slot.fileId, bytes);
    return slot.fileId;
  }

  it("drains a queued lossless job to completion with a real PDF artifact", async () => {
    const pdf = await makePdf(5);
    const fileId = await seedInput(pdf);
    await queue.submit({
      job: queuedJob("job_ok00000000", "compress-pdf", clock),
      inputs: [fileId],
      options: { profile: "lossless" },
    });

    const ticks = await executor().drain();
    expect(ticks.map((t) => t.outcome)).toEqual(["completed", "idle"]);

    const job = store.getJob("job_ok00000000");
    expect(job?.status).toBe("completed");
    expect(job?.progress).toBe(100);
    const art = job?.artifacts?.[0];
    expect(art?.url).toMatch(/^\/api\/artifacts\/local\/art_/);
    expect(art?.filename).toBe("report-compressed.pdf");

    const stored = store.getArtifact(art!.artifactId);
    const reloaded = await PDFDocument.load(stored!.bytes);
    expect(reloaded.getPageCount()).toBe(5);

    // Input wiped after processing (retention).
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("names the output from the job spec's display name, overriding storage", async () => {
    const pdf = await makePdf(3);
    // The stored slot carries a generic name; the spec carries the real one.
    const fileId = await seedInput(pdf, "upload.pdf");
    await queue.submit({
      job: queuedJob("job_named00000", "compress-pdf", clock),
      inputs: [fileId],
      inputNames: ["Client Q3 Report.pdf"],
      options: { profile: "lossless" },
    });

    const ticks = await executor().drain();
    expect(ticks.map((t) => t.outcome)).toEqual(["completed", "idle"]);
    const art = store.getJob("job_named00000")?.artifacts?.[0];
    // The spec name wins over the storage-recovered "upload.pdf".
    expect(art?.filename).toBe("Client Q3 Report-compressed.pdf");
  });

  it("re-sanitizes an unsafe spec display name before it names the output", async () => {
    const pdf = await makePdf(2);
    const fileId = await seedInput(pdf, "upload.pdf");
    await queue.submit({
      job: queuedJob("job_unsafe0000", "compress-pdf", clock),
      inputs: [fileId],
      inputNames: ["../../etc/passwd.pdf"],
      options: { profile: "lossless" },
    });

    await executor().drain();
    const art = store.getJob("job_unsafe0000")?.artifacts?.[0];
    expect(art?.filename).toBe("passwd-compressed.pdf");
    expect(art?.filename).not.toContain("/");
  });

  it("fails a deep job honestly (no engine) — failed, no artifact, input wiped", async () => {
    const fileId = await seedInput(await makePdf());
    await queue.submit({
      job: queuedJob("job_deep000000", "compress-pdf", clock),
      inputs: [fileId],
      options: { profile: "deep" },
    });

    const [tick] = await executor().drain();
    expect(tick?.outcome).toBe("failed");
    const job = store.getJob("job_deep000000");
    expect(job?.status).toBe("failed");
    expect(job?.artifacts).toBeUndefined();
    expect(job?.error?.code).toBe("not_implemented");
    expect(JSON.stringify(job)).not.toContain("/api/artifacts/");
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("is idle when the queue is empty", async () => {
    const ticks = await executor().drain();
    expect(ticks).toEqual([{ outcome: "idle" }]);
  });

  it("walks a job through scanning → processing → completed", async () => {
    const fileId = await seedInput(await makePdf(2));
    await queue.submit({
      job: queuedJob("job_walk000000", "compress-pdf", clock),
      inputs: [fileId],
      options: { profile: "lossless" },
    });
    const seen: string[] = [];
    const exec = createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({ compression: noEngines }),
      leaseMs: LEASE_MS,
      log: (e) => seen.push(e.event),
    });
    await exec.runOnce();
    expect(seen).toEqual([
      "claimed",
      "scanning",
      "processing",
      "completed",
    ]);
  });
});

// ─────────────────────── orchestration edge cases (synthetic) ───────────────────────

/** An ExecutorStorage with full visibility into what was written and deleted. */
function recordingStorage(inputs: Record<string, ProcessorInputFile>) {
  const artifacts = new Map<string, JobArtifact>();
  const deletedArtifacts: string[] = [];
  const deletedInputs: string[] = [];
  let counter = 0;
  const storage: ExecutorStorage = {
    async readInput(fileId) {
      return inputs[fileId] ?? null;
    },
    async writeArtifact(input) {
      const artifactId = `art_rec${counter++}00000`;
      const record: JobArtifact = {
        artifactId,
        filename: input.filename,
        contentType: input.contentType,
        bytes: input.bytes.byteLength,
        url: `/api/artifacts/local/${artifactId}`,
        expiresAt: new Date(0).toISOString(),
      };
      artifacts.set(artifactId, record);
      return record;
    },
    async deleteInput(fileId) {
      deletedInputs.push(fileId);
    },
    async deleteArtifact(artifactId) {
      deletedArtifacts.push(artifactId);
      artifacts.delete(artifactId);
    },
  };
  return { storage, artifacts, deletedArtifacts, deletedInputs };
}

function fakeProcessor(tool: string, run: Processor["process"]): Processor {
  return {
    id: `fake-${tool}`,
    tools: [tool],
    supports: (t) => t === tool,
    capability: () => ({ id: `fake-${tool}`, tools: [tool], ready: true, detail: "" }),
    process: run,
  };
}

const oneInput: Record<string, ProcessorInputFile> = {
  f_in0000000000: {
    fileId: "f_in0000000000",
    filename: "in.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array([1, 2, 3]),
  },
};

const okArtifact = [
  { filename: "out.pdf", contentType: "application/pdf", bytes: new Uint8Array([9]) },
];

describe("worker executor — orchestration", () => {
  let clock: number;
  let store: DevWorkerStore;
  let queue: ClaimableQueue;

  beforeEach(() => {
    clock = 1_000;
    store = new DevWorkerStore(() => clock);
    queue = createLocalDevQueue({ store, now: () => clock });
  });

  const submit = (jobId: string, tool: string, inputs = ["f_in0000000000"]) =>
    queue.submit({ job: queuedJob(jobId, tool, clock), inputs, options: {} });

  it("fails a job whose tool has no registered processor", async () => {
    const { storage } = recordingStorage(oneInput);
    await submit("job_notool0000", "unknown-tool");
    const exec = createWorkerExecutor({
      queue,
      storage,
      registry: new ProcessorRegistry(),
      leaseMs: LEASE_MS,
    });
    const [tick] = await exec.drain();
    expect(tick?.outcome).toBe("failed");
    expect(store.getJob("job_notool0000")?.error?.code).toBe("not_implemented");
  });

  it("fails a job whose input is missing", async () => {
    const { storage, deletedInputs } = recordingStorage({}); // no inputs seeded
    await submit("job_noinput000", "t");
    const registry = new ProcessorRegistry().register(
      fakeProcessor("t", async () => processorOk(okArtifact)),
    );
    const exec = createWorkerExecutor({ queue, storage, registry, leaseMs: LEASE_MS });
    const [tick] = await exec.drain();
    expect(tick?.outcome).toBe("failed");
    expect(store.getJob("job_noinput000")?.error?.code).toBe("not_found");
    expect(deletedInputs).toContain("f_in0000000000");
  });

  it("skips a job canceled while queued — no processing, no artifacts", async () => {
    const { storage, artifacts } = recordingStorage(oneInput);
    let processed = false;
    await submit("job_cq00000000", "t");
    await queue.cancel("job_cq00000000");
    const registry = new ProcessorRegistry().register(
      fakeProcessor("t", async () => {
        processed = true;
        return processorOk(okArtifact);
      }),
    );
    const [tick] = await createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
    }).drain();
    expect(tick?.outcome).toBe("idle");
    expect(processed).toBe(false);
    expect(artifacts.size).toBe(0);
    expect(store.getJob("job_cq00000000")?.status).toBe("canceled");
  });

  it("cleans up artifacts when a job is canceled while running", async () => {
    const { storage, artifacts, deletedArtifacts, deletedInputs } =
      recordingStorage(oneInput);
    await submit("job_cr00000000", "t");
    // The processor cancels its own job mid-flight, then returns success.
    const registry = new ProcessorRegistry().register(
      fakeProcessor("t", async () => {
        await queue.cancel("job_cr00000000");
        return processorOk(okArtifact);
      }),
    );
    const [tick] = await createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
    }).drain();
    expect(tick?.outcome).toBe("canceled");
    // The artifact was written, then cleaned up; none survives.
    expect(artifacts.size).toBe(0);
    expect(deletedArtifacts).toHaveLength(1);
    expect(deletedInputs).toContain("f_in0000000000");
    expect(store.getJob("job_cr00000000")?.status).toBe("canceled");
  });

  it("requeues a retryable failure, then completes on the next attempt", async () => {
    const { storage, artifacts } = recordingStorage(oneInput);
    let calls = 0;
    await submit("job_retry00000", "t");
    const registry = new ProcessorRegistry().register(
      fakeProcessor("t", async () => {
        calls += 1;
        return calls === 1
          ? processorFail({ code: "internal_error", message: "transient", retryable: true })
          : processorOk(okArtifact);
      }),
    );
    const ticks = await createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
      maxAttempts: 3,
    }).drain();
    expect(ticks.map((t) => t.outcome)).toEqual([
      "requeued",
      "completed",
      "idle",
    ]);
    expect(calls).toBe(2);
    expect(artifacts.size).toBe(1);
    expect(store.getJob("job_retry00000")?.status).toBe("completed");
  });

  it("makes a retryable failure terminal once attempts are exhausted", async () => {
    const { storage } = recordingStorage(oneInput);
    await submit("job_exhaust000", "t");
    const registry = new ProcessorRegistry().register(
      fakeProcessor("t", async () =>
        processorFail({ code: "internal_error", message: "always", retryable: true }),
      ),
    );
    const ticks = await createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
      maxAttempts: 2,
    }).drain();
    expect(ticks.map((t) => t.outcome)).toEqual([
      "requeued",
      "failed",
      "idle",
    ]);
    expect(store.getJob("job_exhaust000")?.status).toBe("failed");
  });

  it("does not requeue a non-retryable failure", async () => {
    const { storage } = recordingStorage(oneInput);
    await submit("job_terminal00", "t");
    const registry = new ProcessorRegistry().register(
      fakeProcessor("t", async () =>
        processorFail({ code: "unprocessable_entity", message: "bad", retryable: false }),
      ),
    );
    const ticks = await createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
    }).drain();
    expect(ticks.map((t) => t.outcome)).toEqual(["failed", "idle"]);
  });
});
