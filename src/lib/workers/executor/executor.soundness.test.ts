// @vitest-environment node
/**
 * Executor proof for the Phase 36 file-soundness gate. It pins the load-bearing
 * behaviors the parent contract requires:
 *  - the gate runs immediately after the storage read and BEFORE the scanner and any
 *    processor, so an unsound/mismatched input NEVER reaches ClamAV, OCR, or
 *    compression — the scanner spy and the processor spy are both never invoked;
 *  - a rejection is a terminal, non-retryable `unsound_input` failure with no
 *    artifact, and the rejected input bytes are wiped (active deletion);
 *  - a valid PDF still flows through to the processor and completes;
 *  - an absent or disabled gate is byte-for-byte unchanged behavior;
 *  - a content-free quarantine receipt is emitted for a rejection and never leaks a
 *    filename, key, path, secret, or byte.
 *
 * Everything runs on the in-memory local-dev store (or a tiny storage stub) with a
 * frozen clock — no network, bucket, native engine, or real PDF library.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { ProcessorRegistry } from "../processor/registry";
import { processorOk, type Processor } from "../processor/types";
import { fakeScanner, scanInfected, type MalwareScanResult } from "../scanner";
import {
  createSoundnessGate,
  defaultSoundnessGate,
  disabledSoundnessGate,
  DEFAULT_SOUNDNESS_POLICY,
  type SoundnessGate,
  type SoundnessReceipt,
} from "../soundness";
import type { WorkerMetricSample } from "../observability/metrics";
import { createLocalDevExecutorStorage } from "./local-dev-storage";
import { createWorkerExecutor } from "./executor";
import type { ExecutorLogEvent, ExecutorStorage } from "./types";

const LEASE_MS = 1_000;
const CLOCK = 1_700_000_000_000;
const enc = (s: string) => new TextEncoder().encode(s);
const VALID_PDF = enc(`%PDF-1.7\n${"0".repeat(64)}\n%%EOF\n`);
// Junk that is NOT a PDF and embeds strings we assert never leak into logs/receipts.
const NOT_PDF = enc(
  "this is not a pdf — /etc/passwd AWS_SECRET_ACCESS_KEY=abc123",
);

function queuedJob(jobId: string, tool = "compress-pdf"): Job {
  return {
    jobId,
    tool,
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(CLOCK).toISOString(),
    updatedAt: new Date(CLOCK).toISOString(),
    expiresAt: new Date(CLOCK + 60 * 60_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

/** A spy processor for `compress-pdf` that records whether it was ever invoked. */
function spyProcessor() {
  const calls: number[] = [];
  const processor: Processor = {
    id: "compression",
    tools: ["compress-pdf"],
    supports: (t) => t === "compress-pdf",
    capability: () => ({
      id: "compression",
      tools: ["compress-pdf"],
      ready: true,
      detail: "",
    }),
    process: async (input) => {
      calls.push(input.inputs.length);
      return processorOk([
        {
          filename: "out.pdf",
          contentType: "application/pdf",
          bytes: enc("ok"),
        },
      ]);
    },
  };
  return { processor, calls };
}

/** A scanner that records every call, so we can prove it never runs behind the gate. */
function spyScanner(result: MalwareScanResult) {
  const calls: number[] = [];
  const scanner = fakeScanner(() => {
    calls.push(1);
    return result;
  });
  return { scanner, calls };
}

interface Harness {
  store: DevWorkerStore;
  logs: ExecutorLogEvent[];
  metrics: WorkerMetricSample[];
  receipts: SoundnessReceipt[];
  calls: number[];
  scanCalls: number[];
  fileId: string;
  run: () => Promise<void>;
}

/** Seed one input + a compress job, and build a soundness-gated executor over a spy. */
function harness(
  bytes: Uint8Array,
  opts: {
    soundness?: SoundnessGate;
    filename?: string;
    contentType?: string;
    scanResult?: MalwareScanResult;
    withReceipts?: boolean;
  } = {},
): Harness {
  const store = new DevWorkerStore(() => CLOCK);
  const queue = createLocalDevQueue({ store, now: () => CLOCK });
  const storage = createLocalDevExecutorStorage({ store, now: () => CLOCK });
  const { processor, calls } = spyProcessor();
  const registry = new ProcessorRegistry().register(processor);
  const { scanner, calls: scanCalls } = spyScanner(
    opts.scanResult ?? scanInfected(),
  );

  const slot = store.reserveSlot({
    sessionId: "sess_test00000",
    filename: opts.filename ?? "report.pdf",
    contentType: opts.contentType ?? "application/pdf",
    declaredBytes: bytes.byteLength,
  });
  store.putBytes(slot.fileId, bytes);

  const logs: ExecutorLogEvent[] = [];
  const metrics: WorkerMetricSample[] = [];
  const receipts: SoundnessReceipt[] = [];

  const run = async () => {
    await queue.submit({
      job: queuedJob("job_snd0000001"),
      inputs: [slot.fileId],
      options: { profile: "lossless" },
    });
    const executor = createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
      now: () => CLOCK,
      log: (e) => logs.push(e),
      metrics: (s) => metrics.push(s),
      ...(opts.soundness ? { soundness: opts.soundness } : {}),
      // The scanner is wired ONLY when a scan result was requested, so the "no
      // scanner" default matches the pre-Phase-36 executor exactly.
      ...(opts.scanResult ? { scanner } : {}),
      ...(opts.withReceipts
        ? { onSoundnessReceipt: (r: SoundnessReceipt) => receipts.push(r) }
        : {}),
    });
    await executor.drain();
  };

  return {
    store,
    logs,
    metrics,
    receipts,
    calls,
    scanCalls,
    fileId: slot.fileId,
    run,
  };
}

const soundnessSample = (metrics: WorkerMetricSample[]) =>
  metrics.find((m) => m.metric === "worker_soundness_total");

describe("executor file-soundness gate — rejects before the scanner AND processor", () => {
  it("blocks a malformed PDF terminally: no processor call, no artifact, input wiped", async () => {
    const h = harness(NOT_PDF, { soundness: defaultSoundnessGate() });
    await h.run();

    expect(h.calls).toEqual([]); // the processor was NEVER invoked
    const job = h.store.getJob("job_snd0000001");
    expect(job?.status).toBe("failed");
    expect(job?.error?.code).toBe("unsound_input");
    expect(job?.error?.retryable).toBe(false); // terminal, not retryable
    expect(job?.artifacts ?? []).toHaveLength(0);
    // Lifecycle: the input object was wiped on the terminal failure.
    expect(h.store.getSlot(h.fileId)).toBeUndefined();
    expect(soundnessSample(h.metrics)?.labels).toEqual({
      verdict: "unsound",
      reason: "malformed_pdf",
    });
  });

  it("runs soundness BEFORE the scanner — a malformed input never reaches ClamAV", async () => {
    // The input is BOTH malformed AND (hypothetically) infected. Because soundness
    // runs first, it is rejected as `unsound_input`; the scanner is never consulted.
    const h = harness(NOT_PDF, {
      soundness: defaultSoundnessGate(),
      scanResult: scanInfected(),
    });
    await h.run();

    expect(h.scanCalls).toEqual([]); // the scanner spy was NEVER called
    expect(h.calls).toEqual([]); // …and the processor never ran either
    expect(h.store.getJob("job_snd0000001")?.error?.code).toBe("unsound_input");
    // No scan metric was ever emitted (the scanner did not run).
    expect(h.metrics.some((m) => m.metric === "worker_scan_total")).toBe(false);
  });

  it("a valid-but-infected input DOES reach the scanner and blocks as malware", async () => {
    // Contrast: a sound input passes the gate, so the scanner runs next and blocks it.
    const h = harness(VALID_PDF, {
      soundness: defaultSoundnessGate(),
      scanResult: scanInfected(),
    });
    await h.run();

    expect(soundnessSample(h.metrics)?.labels).toEqual({
      verdict: "sound",
      reason: "ok",
    });
    expect(h.scanCalls).toEqual([1]); // the scanner ran after a sound verdict
    expect(h.calls).toEqual([]); // …and blocked before the processor
    expect(h.store.getJob("job_snd0000001")?.error?.code).toBe(
      "malware_detected",
    );
  });

  it("classifies the terminal failure as `unsound` (distinct from a scan block)", async () => {
    const h = harness(NOT_PDF, { soundness: defaultSoundnessGate() });
    await h.run();
    const terminal = h.metrics.find(
      (m) => m.metric === "worker_job_terminal_total",
    );
    expect(terminal?.labels).toMatchObject({
      outcome: "failed",
      failure_class: "unsound",
    });
  });

  it("blocks an empty input with the `empty` reason", async () => {
    const h = harness(new Uint8Array(), { soundness: defaultSoundnessGate() });
    await h.run();
    expect(h.calls).toEqual([]);
    expect(soundnessSample(h.metrics)?.labels).toEqual({
      verdict: "unsound",
      reason: "empty",
    });
  });

  it("blocks an unsupported family (image sent to a PDF-only tool)", async () => {
    const h = harness(enc("\x89PNG\r\n\x1a\n not a pdf"), {
      soundness: defaultSoundnessGate(),
      filename: "photo.png",
      contentType: "image/png",
    });
    await h.run();
    expect(h.calls).toEqual([]);
    expect(soundnessSample(h.metrics)?.labels).toEqual({
      verdict: "unsound",
      reason: "unsupported_family",
    });
  });
});

describe("executor file-soundness gate — size mismatch via storage drift", () => {
  it("rejects when the fetched byte count differs from the declared size", async () => {
    // A storage stub that returns MORE bytes than were declared — the exact "the
    // object no longer matches the contract" drift the worker-side gate exists to
    // catch. (The in-memory store enforces the match on write, so we stub here.)
    const deleted: string[] = [];
    const stub: ExecutorStorage = {
      readInput: async (fileId) => ({
        fileId,
        filename: "report.pdf",
        contentType: "application/pdf",
        bytes: VALID_PDF,
        declaredBytes: VALID_PDF.byteLength + 4096, // declared ≠ fetched
      }),
      writeArtifact: async () => {
        throw new Error("a rejected job must never write an artifact");
      },
      deleteInput: async (fileId) => {
        deleted.push(fileId);
      },
      deleteArtifact: async () => {},
    };
    const store = new DevWorkerStore(() => CLOCK);
    const queue = createLocalDevQueue({ store, now: () => CLOCK });
    const { processor, calls } = spyProcessor();
    await queue.submit({
      job: queuedJob("job_sizemismat1"),
      inputs: ["f_sizedrift0001"],
      options: { profile: "lossless" },
    });
    const metrics: WorkerMetricSample[] = [];
    await createWorkerExecutor({
      queue,
      storage: stub,
      registry: new ProcessorRegistry().register(processor),
      soundness: defaultSoundnessGate(),
      metrics: (s) => metrics.push(s),
    }).drain();

    expect(calls).toEqual([]);
    expect(store.getJob("job_sizemismat1")?.error?.code).toBe("unsound_input");
    expect(deleted).toEqual(["f_sizedrift0001"]); // the drifted input was wiped
    expect(soundnessSample(metrics)?.labels).toEqual({
      verdict: "unsound",
      reason: "size_mismatch",
    });
  });
});

describe("executor file-soundness gate — sound + honest off", () => {
  it("lets a valid PDF reach the processor and complete (soundness_ok logged)", async () => {
    const h = harness(VALID_PDF, { soundness: defaultSoundnessGate() });
    await h.run();

    expect(h.calls).toEqual([1]); // the processor really ran, over the one input
    expect(h.store.getJob("job_snd0000001")?.status).toBe("completed");
    expect(h.logs.some((e) => e.event === "soundness_ok")).toBe(true);
    expect(soundnessSample(h.metrics)?.labels).toEqual({
      verdict: "sound",
      reason: "ok",
    });
  });

  it("with NO gate wired, junk bytes reach the processor (byte-for-byte unchanged)", async () => {
    const h = harness(NOT_PDF); // no soundness dep
    await h.run();
    expect(h.calls).toEqual([1]);
    expect(h.store.getJob("job_snd0000001")?.status).toBe("completed");
    expect(h.metrics.some((m) => m.metric === "worker_soundness_total")).toBe(
      false,
    );
  });

  it("a disabled gate is skipped: junk reaches the processor, metric records skipped", async () => {
    const h = harness(NOT_PDF, { soundness: disabledSoundnessGate() });
    await h.run();
    expect(h.calls).toEqual([1]);
    expect(h.store.getJob("job_snd0000001")?.status).toBe("completed");
    expect(soundnessSample(h.metrics)?.labels).toEqual({
      verdict: "skipped",
      reason: "not_checked",
    });
    expect(h.logs.some((e) => e.event === "soundness_ok")).toBe(false);
  });

  it("respects a custom policy (EOF required) via an injected gate", async () => {
    const gate = createSoundnessGate({
      ...DEFAULT_SOUNDNESS_POLICY,
      requireEof: true,
    });
    const h = harness(enc(`%PDF-1.7\n${"0".repeat(64)}\n`), {
      soundness: gate,
    });
    await h.run();
    expect(h.calls).toEqual([]);
    expect(soundnessSample(h.metrics)?.labels).toEqual({
      verdict: "unsound",
      reason: "malformed_pdf",
    });
  });
});

describe("executor file-soundness gate — content-free quarantine receipts", () => {
  it("emits a receipt on a rejection with only bounded, content-free fields", async () => {
    const h = harness(NOT_PDF, {
      soundness: defaultSoundnessGate(),
      filename: "Confidential Q3 Salaries.pdf",
      withReceipts: true,
    });
    await h.run();

    expect(h.receipts).toHaveLength(1);
    const receipt = h.receipts[0]!;
    expect(receipt).toEqual({
      verdict: "unsound",
      reason: "malformed_pdf",
      policyId: "pdfxyz-worker-soundness",
      policyVersion: 1,
      processor: "compress",
      sizeBucket: "<1KiB",
      inputCount: 1,
      at: new Date(CLOCK).toISOString(),
    });

    // Nothing content-bearing can appear anywhere the receipt is serialized.
    const serialized = JSON.stringify(receipt);
    for (const secret of [
      "Confidential",
      "Salaries",
      "/etc/passwd",
      "AWS_SECRET_ACCESS_KEY",
      "abc123",
      "report.pdf",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("emits NO receipt when the input is sound", async () => {
    const h = harness(VALID_PDF, {
      soundness: defaultSoundnessGate(),
      withReceipts: true,
    });
    await h.run();
    expect(h.receipts).toEqual([]);
  });
});
