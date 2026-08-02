// @vitest-environment node
/**
 * OCR backend integration: drive the REAL {@link createWorkerExecutor} against the
 * local-dev store/queue/storage with the OCR processor wired through the standard
 * {@link createProcessorRegistry}, proving the Phase 23 honesty guarantees end to end:
 *
 *  - the shipped default (no OCR runner) fails an `ocr-pdf` job honestly as
 *    `not_implemented` and writes no artifact;
 *  - an INJECTED OCR runner completes the job and persists real artifact bytes,
 *    then the input is wiped;
 *  - malformed OCR options fail before the runner is ever invoked;
 *  - the Phase 22 malware-scan gate blocks an infected input BEFORE OCR runs;
 *  - recognized text and noisy runner errors never leak into the job record or the
 *    content-free executor log — while the artifact bytes still carry the real output.
 *
 * The runner here is a deterministic fake (allowed by the phase rules); product
 * status/copy still reports OCR unavailable unless a real backend is configured.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, buildOcrResultMeta, type Job } from "@/lib/jobs";
import { DevWorkerStore } from "./store";
import { createLocalDevQueue } from "./queue/local-dev";
import type { ClaimableQueue } from "./queue/claim";
import { createLocalDevExecutorStorage } from "./executor/local-dev-storage";
import type { ExecutorStorage, ExecutorLogEvent } from "./executor/types";
import { createWorkerExecutor } from "./executor/executor";
import { createProcessorRegistry } from "./processor";
import type { OcrRunner } from "./processor/ocr";
import { fakeScanner, scanInfected } from "./scanner";

const LEASE_MS = 1_000;

/** A real, structurally-valid searchable PDF the fake runner "produces". */
const OCR_PDF = new TextEncoder().encode(`%PDF-1.7\n${"ocr".repeat(32)}\n%%EOF\n`);
/** A recognized-text sidecar carrying a sentinel that must never leak into logs/status. */
const OCR_TEXT_SENTINEL = "SENSITIVE-OCR-TEXT-9f3c";
const OCR_TEXT = new TextEncoder().encode(`${OCR_TEXT_SENTINEL} recognized on page 1.`);

/** A deterministic fake OCR runner returning a searchable PDF + text sidecar + safe meta. */
const fakeOcrRunner: OcrRunner = async ({ options, inputs }) => {
  const base = inputs[0]?.filename.replace(/\.[^.]+$/, "") ?? "document";
  return {
    artifacts: [
      { filename: `${base}-ocr.pdf`, contentType: "application/pdf", bytes: OCR_PDF },
      { filename: `${base}.txt`, contentType: "text/plain; charset=utf-8", bytes: OCR_TEXT },
    ],
    // Metadata carries only bounded, structural facts — never the recognized text.
    meta: buildOcrResultMeta({
      engine: "ocrmypdf",
      languages: options.languages,
      outputMode: options.outputMode,
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 1,
      textCharacters: OCR_TEXT.byteLength,
    }),
  };
};

function queuedJob(jobId: string, createdAtMs: number): Job {
  return {
    jobId,
    tool: "ocr-pdf",
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(createdAtMs).toISOString(),
    updatedAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + 60 * 60_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

describe("OCR backend — executor integration", () => {
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

  function seedScan(bytes = new Uint8Array([1, 2, 3]), filename = "scan.pdf") {
    const slot = store.reserveSlot({
      sessionId: "sess_ocr000000",
      filename,
      contentType: "application/pdf",
      declaredBytes: bytes.byteLength,
    });
    store.putBytes(slot.fileId, bytes);
    return slot.fileId;
  }

  async function submit(jobId: string, options: Record<string, unknown>, fileId: string) {
    await queue.submit({ job: queuedJob(jobId, clock), inputs: [fileId], options });
  }

  it("fails an OCR job honestly as not_implemented when no runner is wired (default)", async () => {
    const fileId = seedScan();
    await submit("job_ocr_default0", { languages: ["eng"], outputMode: "searchable-pdf" }, fileId);

    const registry = createProcessorRegistry({}); // no OCR deps → not ready
    const [tick] = await createWorkerExecutor({ queue, storage, registry, leaseMs: LEASE_MS }).drain();

    expect(tick?.outcome).toBe("failed");
    const job = store.getJob("job_ocr_default0");
    expect(job?.status).toBe("failed");
    expect(job?.error?.code).toBe("not_implemented");
    expect(job?.artifacts ?? []).toHaveLength(0);
    // No artifact URL was ever minted.
    expect(JSON.stringify(job)).not.toContain("/api/artifacts/");
    // A job that never produced output carries NO result metadata — nothing to imply
    // an OCR run happened.
    expect(job?.results).toBeUndefined();
    // The input was wiped on the terminal failure.
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("completes an OCR job and persists real artifact bytes when a runner is injected", async () => {
    const fileId = seedScan();
    await submit("job_ocr_done000", { languages: ["eng", "spa"], outputMode: "both" }, fileId);

    const registry = createProcessorRegistry({
      ocr: { engines: { ocrmypdf: true, tesseract: false }, runner: fakeOcrRunner },
    });
    const [tick] = await createWorkerExecutor({ queue, storage, registry, leaseMs: LEASE_MS }).drain();

    expect(tick?.outcome).toBe("completed");
    const job = store.getJob("job_ocr_done000");
    expect(job?.status).toBe("completed");
    expect(job?.progress).toBe(100);

    const artifacts = job?.artifacts ?? [];
    expect(artifacts.map((a) => a.filename)).toEqual(["scan-ocr.pdf", "scan.txt"]);

    // The stored bytes are the REAL runner output — not fabricated by the executor.
    const pdf = store.getArtifact(artifacts[0]!.artifactId);
    const txt = store.getArtifact(artifacts[1]!.artifactId);
    expect(pdf?.bytes).toEqual(OCR_PDF);
    expect(new TextDecoder().decode(txt!.bytes)).toContain(OCR_TEXT_SENTINEL);

    // The completed job now carries the safe, structured OCR result metadata the
    // status API returns verbatim: engine family, validated languages, produced
    // artifact kinds, and page/character COUNTS — never the recognized text.
    expect(job?.results?.ocr).toEqual({
      engine: "ocrmypdf",
      languages: ["eng", "spa"],
      outputMode: "both",
      producedSearchablePdf: true,
      producedTextSidecar: true,
      pageCount: 1,
      textCharacters: OCR_TEXT.byteLength,
      meanConfidence: null,
      lowConfidenceWordRatio: null,
      recognizedWords: null,
    });
    // The metadata carries no recognized text, no object key, and no signed URL —
    // it is safe to persist and return to a client.
    const resultsJson = JSON.stringify(job?.results);
    expect(resultsJson).not.toContain(OCR_TEXT_SENTINEL);
    expect(resultsJson).not.toContain("/api/artifacts/");
    expect(resultsJson).not.toContain(artifacts[0]!.artifactId);

    // Input wiped after processing (retention).
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("rejects malformed OCR options before the runner is ever invoked", async () => {
    const fileId = seedScan();
    await submit("job_ocr_badopt0", { languages: ["klingon"] }, fileId);

    let ran = false;
    const runner: OcrRunner = async () => {
      ran = true;
      return {
        artifacts: [],
        meta: buildOcrResultMeta({
          engine: "ocrmypdf",
          languages: ["eng"],
          outputMode: "searchable-pdf",
          producedSearchablePdf: false,
          producedTextSidecar: false,
        }),
      };
    };
    const registry = createProcessorRegistry({
      ocr: { engines: { ocrmypdf: true, tesseract: false }, runner },
    });
    const [tick] = await createWorkerExecutor({ queue, storage, registry, leaseMs: LEASE_MS }).drain();

    expect(tick?.outcome).toBe("failed");
    expect(ran).toBe(false); // validation failed before any recognition
    const job = store.getJob("job_ocr_badopt0");
    expect(job?.error?.code).toBe("unprocessable_entity");
    expect(job?.artifacts ?? []).toHaveLength(0);
    // A request rejected before the runner ran carries no result metadata.
    expect(job?.results).toBeUndefined();
  });

  it("blocks an infected input BEFORE OCR runs (Phase 22 gate preserved)", async () => {
    const fileId = seedScan();
    await submit("job_ocr_virus00", { languages: ["eng"], outputMode: "searchable-pdf" }, fileId);

    let ran = false;
    const runner: OcrRunner = async () => {
      ran = true;
      return {
        artifacts: [{ filename: "x-ocr.pdf", contentType: "application/pdf", bytes: OCR_PDF }],
        meta: buildOcrResultMeta({
          engine: "ocrmypdf",
          languages: ["eng"],
          outputMode: "searchable-pdf",
          producedSearchablePdf: true,
          producedTextSidecar: false,
        }),
      };
    };
    const seen: string[] = [];
    const [tick] = await createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({
        ocr: { engines: { ocrmypdf: true, tesseract: false }, runner },
      }),
      leaseMs: LEASE_MS,
      scanner: fakeScanner(scanInfected()),
      log: (e) => seen.push(e.event),
    }).drain();

    expect(tick?.outcome).toBe("failed");
    expect(ran).toBe(false); // OCR never ran on an infected input
    const job = store.getJob("job_ocr_virus00");
    expect(job?.error?.code).toBe("malware_detected");
    expect(job?.artifacts ?? []).toHaveLength(0);
    // A blocked input never produced output, so no result metadata is written — the
    // record can never imply an OCR run that was actually stopped at the scan gate.
    expect(job?.results).toBeUndefined();
    expect(seen).toContain("scan_blocked");
    expect(seen).not.toContain("processing");
    expect(store.getSlot(fileId)).toBeUndefined();
  });

  it("never leaks recognized text or a noisy runner error into the job record or logs", async () => {
    // 1) A successful run: the recognized text lives only in the artifact bytes.
    const okFile = seedScan();
    await submit("job_ocr_leak000", { languages: ["eng"], outputMode: "both" }, okFile);
    const okEvents: ExecutorLogEvent[] = [];
    await createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({
        ocr: { engines: { ocrmypdf: true, tesseract: false }, runner: fakeOcrRunner },
      }),
      leaseMs: LEASE_MS,
      log: (e) => okEvents.push(e),
    }).drain();
    const okJob = store.getJob("job_ocr_leak000");
    expect(JSON.stringify({ okJob, okEvents })).not.toContain(OCR_TEXT_SENTINEL);

    // 2) A runner that throws a noisy, path-bearing message: the client error stays
    //    content-free (no path, no engine text) and the job fails honestly.
    const badFile = seedScan();
    await submit("job_ocr_leak001", { languages: ["eng"], outputMode: "searchable-pdf" }, badFile);
    const noisy: OcrRunner = async () => {
      throw new Error(`ocrmypdf crashed on /tmp/pdfxyz-ocr-abc/input.pdf: ${OCR_TEXT_SENTINEL}`);
    };
    const badEvents: ExecutorLogEvent[] = [];
    await createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({
        ocr: { engines: { ocrmypdf: true, tesseract: false }, runner: noisy },
      }),
      leaseMs: LEASE_MS,
      maxAttempts: 1, // don't retry the deterministic failure
      log: (e) => badEvents.push(e),
    }).drain();
    const badJob = store.getJob("job_ocr_leak001");
    expect(badJob?.status).toBe("failed");
    expect(badJob?.error?.code).toBe("internal_error");
    const serialized = JSON.stringify({ badJob, badEvents });
    expect(serialized).not.toContain(OCR_TEXT_SENTINEL);
    expect(serialized).not.toContain("/tmp/");
    expect(badJob?.artifacts ?? []).toHaveLength(0);
  });
});
