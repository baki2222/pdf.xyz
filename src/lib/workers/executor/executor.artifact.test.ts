// @vitest-environment node
/**
 * Executor proof for the Phase 37 artifact-manifest / provenance gate. It pins the
 * load-bearing behaviors the parent contract requires:
 *  - the gate runs AFTER the processor succeeds and BEFORE any artifact is written, so
 *    a malformed output (empty, mistyped, unknown kind, retention-less) is NEVER
 *    persisted — the storage `writeArtifact` spy is never called for a rejection;
 *  - a rejection is a terminal, non-retryable `artifact_invalid` failure with no
 *    client artifact, and the inputs are wiped;
 *  - a valid output (single PDF, or an OCR PDF+sidecar pair) still flows through to
 *    storage and completes, with a `valid`/`ok` manifest metric per output;
 *  - an absent OR disabled gate is byte-for-byte unchanged behavior (even a would-be
 *    -invalid output is published);
 *  - a content-free rejection receipt is emitted when a sink is wired.
 *
 * Everything runs on the in-memory local-dev store with a frozen clock — no network,
 * bucket, or native engine.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job, type RetentionPolicy } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { ProcessorRegistry } from "../processor/registry";
import {
  processorOk,
  type Processor,
  type ProcessorArtifact,
} from "../processor/types";
import {
  defaultArtifactManifestGate,
  disabledArtifactManifestGate,
  type ArtifactManifestGate,
  type ArtifactReceipt,
} from "../artifacts";
import type { WorkerMetricSample } from "../observability/metrics";
import { createLocalDevExecutorStorage } from "./local-dev-storage";
import { createWorkerExecutor } from "./executor";
import type { ExecutorLogEvent, ExecutorStorage } from "./types";

const LEASE_MS = 1_000;
const CLOCK = 1_700_000_000_000;
const JOB_ID = "job_art0000001";
const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc(`%PDF-1.7\n${"0".repeat(64)}\n%%EOF\n`);

function queuedJob(tool: string, retention: RetentionPolicy): Job {
  return {
    jobId: JOB_ID,
    tool,
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(CLOCK).toISOString(),
    updatedAt: new Date(CLOCK).toISOString(),
    expiresAt: new Date(CLOCK + 60 * 60_000).toISOString(),
    retention,
  };
}

/** A processor that returns exactly the outputs the test hands it. */
function outputProcessor(id: string, tool: string, output: ProcessorArtifact[]) {
  const calls: number[] = [];
  const processor: Processor = {
    id,
    tools: [tool],
    supports: (t) => t === tool,
    capability: () => ({ id, tools: [tool], ready: true, detail: "" }),
    process: async () => {
      calls.push(1);
      return processorOk(output);
    },
  };
  return { processor, calls };
}

interface Opts {
  gate?: ArtifactManifestGate;
  tool?: string;
  processorId?: string;
  retention?: RetentionPolicy;
  withReceipts?: boolean;
}

function harness(output: ProcessorArtifact[], opts: Opts = {}) {
  const tool = opts.tool ?? "compress-pdf";
  const processorId = opts.processorId ?? "compression";
  const store = new DevWorkerStore(() => CLOCK);
  const queue = createLocalDevQueue({ store, now: () => CLOCK });
  const base = createLocalDevExecutorStorage({ store, now: () => CLOCK });
  // Count real artifact writes so "no artifact written" is a hard proof, not inference.
  const writes: string[] = [];
  const storage: ExecutorStorage = {
    ...base,
    writeArtifact: async (input) => {
      writes.push(input.contentType);
      return base.writeArtifact(input);
    },
  };
  const { processor, calls } = outputProcessor(processorId, tool, output);
  const registry = new ProcessorRegistry().register(processor);

  const slot = store.reserveSlot({
    sessionId: "sess_test00000",
    filename: "report.pdf",
    contentType: "application/pdf",
    declaredBytes: PDF.byteLength,
  });
  store.putBytes(slot.fileId, PDF);

  const logs: ExecutorLogEvent[] = [];
  const metrics: WorkerMetricSample[] = [];
  const receipts: ArtifactReceipt[] = [];

  const run = async () => {
    await queue.submit({
      job: queuedJob(tool, opts.retention ?? DEFAULT_RETENTION),
      inputs: [slot.fileId],
      options: {},
    });
    const executor = createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
      now: () => CLOCK,
      log: (e) => logs.push(e),
      metrics: (s) => metrics.push(s),
      ...(opts.gate !== undefined ? { artifactManifest: opts.gate } : {}),
      ...(opts.withReceipts
        ? { onArtifactReceipt: (r: ArtifactReceipt) => receipts.push(r) }
        : {}),
    });
    await executor.drain();
  };

  return { store, writes, logs, metrics, receipts, calls, fileId: slot.fileId, run };
}

const manifestSamples = (metrics: WorkerMetricSample[]) =>
  metrics.filter((m) => m.metric === "worker_artifact_manifest_total");
const terminalSample = (metrics: WorkerMetricSample[]) =>
  metrics.find((m) => m.metric === "worker_job_terminal_total");

const pdfOut = (bytes = PDF): ProcessorArtifact => ({
  filename: "report-compressed.pdf",
  contentType: "application/pdf",
  bytes,
});

describe("executor artifact-manifest gate — valid outputs publish", () => {
  it("a valid compression PDF is written and the job completes with an ok manifest", async () => {
    const h = harness([pdfOut()], { gate: defaultArtifactManifestGate() });
    await h.run();

    expect(h.calls).toEqual([1]); // the processor ran
    expect(h.writes).toEqual(["application/pdf"]); // the artifact WAS persisted
    const job = h.store.getJob(JOB_ID);
    expect(job?.status).toBe("completed");
    expect(job?.artifacts ?? []).toHaveLength(1);
    expect(h.logs.some((l) => l.event === "artifact_ok")).toBe(true);
    expect(manifestSamples(h.metrics).map((m) => m.labels)).toEqual([
      { verdict: "valid", reason: "ok", kind: "pdf", processor: "compress" },
    ]);
    // Lifecycle: input wiped after completion; the artifact's retention is intact.
    expect(h.store.getSlot(h.fileId)).toBeUndefined();
    expect(job?.retention).toEqual(DEFAULT_RETENTION);
  });

  it("an OCR PDF + text sidecar pair both publish with per-output manifests", async () => {
    const h = harness(
      [
        { filename: "scan-ocr.pdf", contentType: "application/pdf", bytes: PDF },
        {
          filename: "scan.txt",
          contentType: "text/plain; charset=utf-8",
          bytes: enc("recognized"),
        },
      ],
      { gate: defaultArtifactManifestGate(), tool: "ocr-pdf", processorId: "ocr" },
    );
    await h.run();

    expect(h.writes).toEqual(["application/pdf", "text/plain; charset=utf-8"]);
    expect(h.store.getJob(JOB_ID)?.status).toBe("completed");
    expect(manifestSamples(h.metrics).map((m) => m.labels.kind)).toEqual([
      "pdf",
      "text-sidecar",
    ]);
  });

  it("emits a content-free `generated` provenance receipt for a published set", async () => {
    const h = harness([pdfOut()], {
      gate: defaultArtifactManifestGate(),
      withReceipts: true,
    });
    await h.run();
    expect(h.store.getJob(JOB_ID)?.status).toBe("completed");
    // The published set's provenance is recorded as `generated` (reason `ok`), never
    // as a rejection, and carries only bounded, content-free fields.
    expect(h.receipts).toHaveLength(1);
    expect(h.receipts[0]).toMatchObject({
      category: "generated",
      reason: "ok",
      processor: "compress",
    });
    expect(Object.keys(h.receipts[0]!)).not.toContain("filename");
  });
});

describe("executor artifact-manifest gate — malformed outputs are rejected before exposure", () => {
  const rejectCases: {
    name: string;
    output: ProcessorArtifact[];
    reason: string;
    kind: string;
    opts?: Opts;
  }[] = [
    {
      name: "zero-byte output",
      output: [pdfOut(new Uint8Array())],
      reason: "empty_artifact",
      kind: "pdf",
    },
    {
      name: "content-type / name mismatch",
      output: [{ filename: "out.pdf", contentType: "text/plain", bytes: PDF }],
      reason: "content_type_mismatch",
      kind: "text-sidecar",
    },
    {
      name: "unknown output kind",
      output: [{ filename: "out.bin", contentType: "application/x-weird", bytes: PDF }],
      reason: "unknown_output_kind",
      kind: "unknown",
    },
    {
      name: "missing retention class",
      output: [pdfOut()],
      reason: "missing_retention_class",
      kind: "pdf",
      opts: {
        retention: {
          inputTtlMinutes: 0,
          outputTtlMinutes: 0,
          persistsAfterJob: false,
        },
      },
    },
  ];

  for (const c of rejectCases) {
    it(`${c.name}: no artifact written, terminal artifact_invalid, input wiped`, async () => {
      const h = harness(c.output, {
        gate: defaultArtifactManifestGate(),
        withReceipts: true,
        ...c.opts,
      });
      await h.run();

      expect(h.calls).toEqual([1]); // the processor DID run…
      expect(h.writes).toEqual([]); // …but NOTHING was ever persisted
      const job = h.store.getJob(JOB_ID);
      expect(job?.status).toBe("failed");
      expect(job?.error?.code).toBe("artifact_invalid");
      expect(job?.error?.retryable).toBe(false);
      expect(job?.artifacts ?? []).toHaveLength(0);
      // Input wiped on the terminal failure.
      expect(h.store.getSlot(h.fileId)).toBeUndefined();
      // The specific reason rides the metric (never the client error).
      expect(manifestSamples(h.metrics)[0]?.labels).toEqual({
        verdict: "invalid",
        reason: c.reason,
        kind: c.kind,
        processor: "compress",
      });
      expect(terminalSample(h.metrics)?.labels).toEqual({
        outcome: "failed",
        failure_class: "artifact",
      });
      // A content-free `rejected` receipt was emitted for the block.
      expect(h.receipts).toHaveLength(1);
      expect(h.receipts[0]).toMatchObject({
        category: "rejected",
        reason: c.reason,
        processor: "compress",
      });
      expect(h.logs.some((l) => l.event === "artifact_rejected")).toBe(true);
    });
  }

  it("a set-level empty result (processor returned zero outputs) is rejected", async () => {
    const h = harness([], { gate: defaultArtifactManifestGate(), withReceipts: true });
    await h.run();
    expect(h.writes).toEqual([]);
    expect(h.store.getJob(JOB_ID)?.error?.code).toBe("artifact_invalid");
    // Set-level reject: one metric with an `unknown` kind (no per-output check).
    expect(manifestSamples(h.metrics)[0]?.labels).toEqual({
      verdict: "invalid",
      reason: "no_artifacts",
      kind: "unknown",
      processor: "compress",
    });
    expect(h.receipts[0]?.reason).toBe("no_artifacts");
  });
});

describe("executor artifact-manifest gate — absent/disabled is unchanged behavior", () => {
  it("with NO gate wired, even a zero-byte output is published (pre-Phase-37 behavior)", async () => {
    const h = harness([pdfOut(new Uint8Array())]); // no gate
    await h.run();
    expect(h.writes).toEqual(["application/pdf"]); // published, unvalidated
    expect(h.store.getJob(JOB_ID)?.status).toBe("completed");
    // No manifest metric was ever emitted.
    expect(manifestSamples(h.metrics)).toHaveLength(0);
  });

  it("with a DISABLED gate, the output is published and never reported as validated", async () => {
    const h = harness([pdfOut(new Uint8Array())], {
      gate: disabledArtifactManifestGate(),
    });
    await h.run();
    expect(h.writes).toEqual(["application/pdf"]);
    expect(h.store.getJob(JOB_ID)?.status).toBe("completed");
    // Disabled ⇒ skipped ⇒ no per-output metric and no artifact_ok log.
    expect(manifestSamples(h.metrics)).toHaveLength(0);
    expect(h.logs.some((l) => l.event === "artifact_ok")).toBe(false);
  });
});
