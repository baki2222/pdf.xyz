// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, buildOcrResultMeta, type Job } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { createNotConfiguredQueue } from "../queue/not-configured";
import type { ClaimableQueue } from "../queue/claim";
import { createLocalDevExecutorStorage } from "../executor/local-dev-storage";
import type { ExecutorStorage } from "../executor/types";
import { createProcessorRegistry } from "../processor";
import type { QpdfStructureRunner } from "../pdf-structure/engine";
import { fakeScanner, scanInfected } from "../scanner";
import { createWorkerDaemon } from "./daemon";
import { deriveCompressionHealth, resolveWorkerRuntime } from "./runtime";

const noEngines = { tools: { ghostscript: false, qpdf: false, mutool: false } };

/**
 * A structurally-sound minimal PDF envelope (`%PDF-` header + `%%EOF` trailer) used
 * as the input for compress/OCR jobs. The runtime wires the Phase 36 file-soundness
 * gate (enabled by default), so an input must carry a PDF envelope to reach the
 * processor; these tests exercise processor/scanner behavior, not the gate, so a
 * valid envelope keeps them focused. The dedicated gate rejection is proven in the
 * executor and soundness suites.
 */
const MINIMAL_PDF = new TextEncoder().encode(
  `%PDF-1.7\n${"0".repeat(64)}\n%%EOF\n`,
);

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
    // Processors are still reported honestly (compression lossless + OCR + PDF security).
    expect(runtime.processors.map((p) => p.id).sort()).toEqual([
      "compression",
      "html-render",
      "ocr",
      "office-conversion",
      "pdf-archive",
      "pdf-security",
      "pdf-structure",
    ]);
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

  it("threads injected qpdf structure deps into the standard processor registry", () => {
    const output = new TextEncoder().encode(`%PDF-1.7\n${"1".repeat(32)}\n%%EOF\n`);
    const qpdf: QpdfStructureRunner = {
      repair: async () => output,
      linearize: async () => output,
    };
    const runtime = resolveWorkerRuntime(
      {},
      { queue: fakeClaimable, storage: fakeStorage, compression: noEngines, pdfStructure: { qpdf } },
    );
    const facet = runtime.processors.find((p) => p.id === "pdf-structure");
    expect(facet).toMatchObject({
      id: "pdf-structure",
      ready: true,
      tools: ["repair-pdf", "optimize-web"],
    });
  });
});

describe("resolveWorkerRuntime — malware-scan gate", () => {
  const fixedTransport = (reply: string) => ({
    async roundtrip() {
      const b = new Uint8Array(reply.length);
      for (let i = 0; i < reply.length; i++) b[i] = reply.charCodeAt(i);
      return b;
    },
  });

  it("reports the honest no-op scanner (inactive) even when not drainable", () => {
    const runtime = resolveWorkerRuntime({}, { compression: noEngines });
    expect(runtime.executor).toBeUndefined();
    expect(runtime.scanner.active).toBe(false);
    expect(runtime.scanner.provider).toBe("not-configured");
  });

  it("reports an inactive scanner for a selected-but-misconfigured endpoint", () => {
    const runtime = resolveWorkerRuntime(
      { PDFXYZ_MALWARE_SCANNER: "clamav://" },
      { compression: noEngines },
    );
    expect(runtime.scanner.active).toBe(false);
    expect(runtime.scanner.provider).toBe("unavailable");
  });

  it("wires an ACTIVE clamav scanner when configured, leaking nothing", () => {
    const runtime = resolveWorkerRuntime(
      { PDFXYZ_MALWARE_SCANNER: "clamav://scanner.internal:3310" },
      { compression: noEngines, scannerTransport: fixedTransport("stream: OK\0") },
    );
    expect(runtime.scanner.active).toBe(true);
    expect(runtime.scanner.provider).toBe("clamav");
    const serialized = JSON.stringify(runtime.scanner);
    expect(serialized).not.toContain("scanner.internal");
    expect(serialized).not.toContain("PDFXYZ_");
  });
});

describe("resolveWorkerRuntime — artifact-manifest gate (Phase 37)", () => {
  it("reports an ENABLED gate by default, even when not drainable", () => {
    const runtime = resolveWorkerRuntime({}, { compression: noEngines });
    expect(runtime.executor).toBeUndefined(); // not drainable (no engine)
    expect(runtime.artifact.active).toBe(true); // …but the capability is still reported
    expect(runtime.artifact.mode).toBe("enabled");
    expect(runtime.artifact.policyId).toBe("pdfxyz-worker-artifact-manifest");
    expect(runtime.artifact.policyVersion).toBe(1);
  });

  it("reports a DISABLED gate when an operator turns it off, leaking nothing", () => {
    const runtime = resolveWorkerRuntime(
      { PDFXYZ_WORKER_ARTIFACT_MANIFEST: "off" },
      { compression: noEngines },
    );
    expect(runtime.artifact.active).toBe(false);
    expect(runtime.artifact.mode).toBe("disabled");
    const serialized = JSON.stringify(runtime.artifact);
    expect(serialized).not.toContain("PDFXYZ_");
    expect(serialized).not.toMatch(/\/|=/); // no path/value in the content-free detail
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

describe("resolveWorkerRuntime — OCR backend wiring (Phase 23)", () => {
  it("registers OCR not-ready by default and reports the facet not-configured", () => {
    // No OCR deps injected + no `PDFXYZ_OCR` in the env ⇒ empty native deps ⇒ the OCR
    // processor is registered but honestly not ready (a bare env touches no host).
    const runtime = resolveWorkerRuntime({}, { compression: noEngines });
    expect(runtime.processors.find((p) => p.id === "ocr")?.ready).toBe(false);
    expect(runtime.deployment.facets.find((f) => f.id === "ocr")?.state).toBe(
      "not-configured",
    );
  });

  it("flips the OCR facet to ready when a runner + engine are wired, leaking no path", () => {
    const runtime = resolveWorkerRuntime(
      {},
      {
        compression: noEngines,
        ocr: {
          engines: { ocrmypdf: true, tesseract: false },
          runner: async () => ({
            artifacts: [],
            meta: buildOcrResultMeta({
              engine: "ocrmypdf",
              languages: ["eng"],
              outputMode: "searchable-pdf",
              producedSearchablePdf: false,
              producedTextSidecar: false,
            }),
          }),
        },
      },
    );
    const ocrProc = runtime.processors.find((p) => p.id === "ocr");
    expect(ocrProc?.ready).toBe(true);
    const facet = runtime.deployment.facets.find((f) => f.id === "ocr")!;
    expect(facet.state).toBe("ready");
    // Presence-only: engine name + prose, never a path or value.
    expect(JSON.stringify(facet)).not.toMatch(/[/\\]/);
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
      declaredBytes: MINIMAL_PDF.byteLength,
    });
    store.putBytes(slot.fileId, MINIMAL_PDF);
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

  it("wires an injected scanner into the executor so an infected job is blocked before processing", async () => {
    const queue = createLocalDevQueue({ store, now: () => clock });
    const storage = createLocalDevExecutorStorage({ store, now: () => clock });
    const slot = store.reserveSlot({
      sessionId: "sess_x",
      filename: "upload.pdf",
      contentType: "application/pdf",
      declaredBytes: MINIMAL_PDF.byteLength,
    });
    store.putBytes(slot.fileId, MINIMAL_PDF);
    await queue.submit({
      job: queuedJob("job_infected00001", "compress-pdf"),
      inputs: [slot.fileId],
      options: { profile: "lossless" },
    });

    // A drainable runtime with an injected infected scanner — proves the runtime
    // actually threads the scanner into the executor gate.
    const runtime = resolveWorkerRuntime(
      {},
      {
        queue,
        storage,
        registry: createProcessorRegistry({ compression: noEngines }),
        compression: noEngines,
        scanner: fakeScanner(scanInfected()),
      },
    );
    expect(runtime.scanner.active).toBe(true);

    const summary = await createWorkerDaemon({ executor: runtime.executor! }).run({
      mode: "drain",
    });

    // Blocked before processing: failed, no artifact, and the input was wiped.
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(1);
    const job = store.getJob("job_infected00001");
    expect(job?.status).toBe("failed");
    expect(job?.error?.code).toBe("malware_detected");
    expect(job?.artifacts ?? []).toHaveLength(0);
    expect(store.getSlot(slot.fileId)).toBeUndefined();
  });

  it("completes an OCR job end-to-end when a real OCR runner is wired into the runtime", async () => {
    const queue = createLocalDevQueue({ store, now: () => clock });
    const storage = createLocalDevExecutorStorage({ store, now: () => clock });
    const slot = store.reserveSlot({
      sessionId: "sess_x",
      filename: "scan.pdf",
      contentType: "application/pdf",
      declaredBytes: MINIMAL_PDF.byteLength,
    });
    store.putBytes(slot.fileId, MINIMAL_PDF);
    await queue.submit({
      job: queuedJob("job_ocr_ready0001", "ocr-pdf"),
      inputs: [slot.fileId],
      options: { languages: ["eng"], outputMode: "searchable-pdf" },
    });

    // A structurally-valid searchable PDF the injected runner "produces".
    const ocrPdf = new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(64)}\n%%EOF\n`);
    const runtime = resolveWorkerRuntime(
      {},
      {
        queue,
        storage,
        compression: noEngines,
        ocr: {
          engines: { ocrmypdf: true, tesseract: false },
          runner: async () => ({
            artifacts: [
              { filename: "scan-ocr.pdf", contentType: "application/pdf", bytes: ocrPdf },
            ],
            meta: buildOcrResultMeta({
              engine: "ocrmypdf",
              languages: ["eng"],
              outputMode: "searchable-pdf",
              producedSearchablePdf: true,
              producedTextSidecar: false,
              pageCount: 1,
            }),
          }),
        },
      },
    );
    // The wired OCR processor reports ready, and the deployment facet agrees.
    expect(runtime.processors.find((p) => p.id === "ocr")?.ready).toBe(true);
    expect(runtime.deployment.facets.find((f) => f.id === "ocr")?.state).toBe("ready");

    const summary = await createWorkerDaemon({ executor: runtime.executor! }).run({
      mode: "drain",
    });

    // A genuinely completed OCR job with a real artifact — never fabricated by the
    // orchestration, and only because a runner + engine were actually wired.
    expect(summary.completed).toBe(1);
    const job = store.getJob("job_ocr_ready0001");
    expect(job?.status).toBe("completed");
    expect(job?.artifacts?.[0]?.filename).toBe("scan-ocr.pdf");
    // The full runtime wiring threads the runner's safe, structural OCR metadata all
    // the way onto the completed job record (what the status API returns).
    expect(job?.results?.ocr).toEqual({
      engine: "ocrmypdf",
      languages: ["eng"],
      outputMode: "searchable-pdf",
      producedSearchablePdf: true,
      producedTextSidecar: false,
      pageCount: 1,
      textCharacters: null,
      meanConfidence: null,
    });
    expect(store.getSlot(slot.fileId)).toBeUndefined();
  });
});
