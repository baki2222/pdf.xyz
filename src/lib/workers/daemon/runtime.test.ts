// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { createNotConfiguredQueue } from "../queue/not-configured";
import type { ClaimableQueue } from "../queue/claim";
import { createLocalDevExecutorStorage } from "../executor/local-dev-storage";
import type { ExecutorStorage } from "../executor/types";
import { createProcessorRegistry } from "../processor";
import { createWorkerDaemon } from "./daemon";
import { deriveCompressionHealth, resolveWorkerRuntime } from "./runtime";

const noEngines = { tools: { ghostscript: false, qpdf: false, mutool: false } };

/** A minimal ClaimableQueue stub — only the guard-relevant methods are real. */
const fakeClaimable = {
  claim: async () => ({ ok: true as const, value: null }),
  complete: async () => ({ ok: true as const, value: {} as Job }),
} as unknown as ClaimableQueue;

/** A no-op ExecutorStorage stub for wiring (never exercised in gating tests). */
const fakeStorage = {
  readInput: async () => null,
  writeArtifact: async () => ({}) as never,
  deleteInput: async () => {},
  deleteArtifact: async () => {},
} satisfies ExecutorStorage;

describe("resolveWorkerRuntime — gating", () => {
  it("refuses to build an executor when nothing is configured", () => {
    const runtime = resolveWorkerRuntime({}, { compression: noEngines });
    expect(runtime.executor).toBeUndefined();
    expect(runtime.blocked).toBe("not_configured");
    // Processors are still reported honestly (compression lossless + OCR).
    expect(runtime.processors.map((p) => p.id).sort()).toEqual(["compression", "ocr"]);
  });

  it("blocks on storage when the queue is drainable but storage is absent", () => {
    const runtime = resolveWorkerRuntime(
      {},
      { queue: fakeClaimable, storage: null, compression: noEngines },
    );
    expect(runtime.executor).toBeUndefined();
    expect(runtime.blocked).toBe("storage_not_configured");
  });

  it("blocks on the queue when storage is ready but the queue is not drainable", () => {
    const runtime = resolveWorkerRuntime(
      {},
      {
        queue: createNotConfiguredQueue("disabled"),
        storage: fakeStorage,
        compression: noEngines,
      },
    );
    expect(runtime.executor).toBeUndefined();
    expect(runtime.blocked).toBe("queue_not_drainable");
  });

  it("builds an executor only when the queue is drainable and storage is ready", () => {
    const runtime = resolveWorkerRuntime(
      {},
      { queue: fakeClaimable, storage: fakeStorage, compression: noEngines },
    );
    expect(runtime.executor).toBeDefined();
    expect(runtime.blocked).toBeUndefined();
  });
});

describe("deriveCompressionHealth", () => {
  it("is lossless-only when no native engine is present", () => {
    const health = deriveCompressionHealth({
      ghostscript: false,
      qpdf: false,
      mutool: false,
    });
    expect(health).toMatchObject({ lossless: true, deep: false, engines: [] });
    // States the honest consequence: deep jobs fail as not_implemented.
    expect(health.detail).toMatch(/not_implemented/);
  });

  it("reports deep available and lists engines in preference order", () => {
    const health = deriveCompressionHealth({
      ghostscript: false,
      qpdf: true,
      mutool: true,
    });
    expect(health.deep).toBe(true);
    // Preference order is fixed (ghostscript, qpdf, mutool); ghostscript is absent.
    expect(health.engines).toEqual(["qpdf", "mutool"]);
    expect(health.detail).toMatch(/qpdf/);
  });
});

describe("resolveWorkerRuntime — compression-engine health vs drainability", () => {
  it("reports lossless-only health even when nothing is configured (not drainable)", () => {
    const runtime = resolveWorkerRuntime({}, { compression: noEngines });
    // Not drainable — but the compression health is still reported, honestly
    // distinguishing "no queue/storage" from "no deep engine".
    expect(runtime.executor).toBeUndefined();
    expect(runtime.blocked).toBe("not_configured");
    expect(runtime.compression).toMatchObject({
      lossless: true,
      deep: false,
      engines: [],
    });
  });

  it("reports deep-capable health from the wired engine, independent of drainability", () => {
    const runtime = resolveWorkerRuntime(
      {},
      { compression: { tools: { ghostscript: true, qpdf: false, mutool: false } } },
    );
    expect(runtime.compression).toMatchObject({
      deep: true,
      engines: ["ghostscript"],
    });
  });

  it("never leaks a path or secret into the health detail", () => {
    const runtime = resolveWorkerRuntime({}, { compression: noEngines });
    // Presence-only: engine names, booleans, and prose — never a path/key/value.
    expect(JSON.stringify(runtime.compression)).not.toMatch(/[/\\]/);
  });
});

describe("resolveWorkerRuntime — real providers from the environment", () => {
  it("wires a drainable Redis queue + S3 storage into a runnable executor", () => {
    const env = {
      PDFXYZ_QUEUE_PROVIDER: "redis",
      PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
      PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
      PDFXYZ_STORAGE_PROVIDER: "s3",
      PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
      PDFXYZ_S3_REGION: "auto",
      PDFXYZ_S3_BUCKET: "pdfxyz-store",
      PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
      PDFXYZ_S3_SECRET_ACCESS_KEY: "s3-secret-value-1234567890",
    };
    // Construction alone contacts nothing; the executor is built and ready.
    const runtime = resolveWorkerRuntime(env, { compression: noEngines });
    expect(runtime.executor).toBeDefined();
    expect(runtime.readiness.drainable).toBe(true);
  });
});

describe("worker daemon runtime — honesty end-to-end", () => {
  let clock: number;
  let store: DevWorkerStore;

  beforeEach(() => {
    clock = 1_000;
    store = new DevWorkerStore(() => clock);
  });

  const queuedJob = (jobId: string, tool: string): Job => ({
    jobId,
    tool,
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(clock).toISOString(),
    updatedAt: new Date(clock).toISOString(),
    expiresAt: new Date(clock + 60 * 60 * 1000).toISOString(),
    retention: DEFAULT_RETENTION,
  });

  it("fails an unavailable-processor job honestly and never fabricates a completion", async () => {
    const queue = createLocalDevQueue({ store, now: () => clock });
    const storage = createLocalDevExecutorStorage({ store, now: () => clock });
    // A registry with NO native/OCR runner: OCR is registered but not implemented.
    const registry = createProcessorRegistry({});

    // Seed a real input object + an OCR job that references it.
    const slot = store.reserveSlot({
      sessionId: "sess_x",
      filename: "scan.pdf",
      contentType: "application/pdf",
      declaredBytes: 3,
    });
    store.putBytes(slot.fileId, new Uint8Array([1, 2, 3]));
    await queue.submit({
      job: queuedJob("job_ocr0000000001", "ocr-pdf"),
      inputs: [slot.fileId],
      options: {},
    });

    // `compression: noEngines` keeps the derived compression health hermetic (no
    // host PATH probe); the injected `registry` is what actually runs the job.
    const runtime = resolveWorkerRuntime({}, {
      queue,
      storage,
      registry,
      compression: noEngines,
    });
    expect(runtime.executor).toBeDefined();

    const summary = await createWorkerDaemon({ executor: runtime.executor! }).run({
      mode: "drain",
    });

    // The job failed honestly — it was never completed, and produced no artifact.
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(1);
    const job = store.getJob("job_ocr0000000001");
    expect(job?.status).toBe("failed");
    expect(job?.artifacts ?? []).toHaveLength(0);
    expect(job?.error?.code).toBe("not_implemented");
  });
});
