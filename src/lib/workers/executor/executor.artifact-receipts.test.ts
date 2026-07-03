// @vitest-environment node
/**
 * Executor proof for the Phase 37 artifact-PROVENANCE receipts — the content-free
 * lifecycle record the gate emits to an operator sink. It pins:
 *  - a successful publication emits exactly one `generated` receipt (the honest
 *    provenance record of what was minted), all fields bounded;
 *  - a gate rejection emits exactly one `rejected` receipt AND logs `artifact_rejected`
 *    EXACTLY ONCE (no double-log — the single line comes from the terminal disposition,
 *    exactly as the soundness/scanner gates block);
 *  - a cancellation AFTER the artifacts were written emits a `cleaned` receipt, so the
 *    transient manifest is dropped WITH the outputs and no provenance record outlives
 *    the bytes it described;
 *  - with no sink wired, no receipt is built and the clock is never read for one;
 *  - every receipt is content-free even when the produced output is stuffed with
 *    secrets.
 *
 * Runs on the in-memory local-dev store with a frozen clock — no network or engine.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { ProcessorRegistry } from "../processor/registry";
import { processorOk, type Processor, type ProcessorArtifact } from "../processor/types";
import {
  defaultArtifactManifestGate,
  disabledArtifactManifestGate,
  type ArtifactManifestGate,
  type ArtifactReceipt,
} from "../artifacts";
import { createLocalDevExecutorStorage } from "./local-dev-storage";
import { createWorkerExecutor } from "./executor";
import type { ExecutorLogEvent } from "./types";

const LEASE_MS = 1_000;
const CLOCK = 1_700_000_000_000;
const JOB_ID = "job_artrcpt001";
const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc(`%PDF-1.7\n${"0".repeat(64)}\n%%EOF\n`);

function queuedJob(tool = "compress-pdf"): Job {
  return {
    jobId: JOB_ID,
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

interface Opts {
  gate?: ArtifactManifestGate;
  withReceipts?: boolean;
  /** When set, the processor cancels its own job mid-flight, forcing the cleanup path. */
  cancelMidFlight?: boolean;
}

function harness(output: ProcessorArtifact[], opts: Opts = {}) {
  const store = new DevWorkerStore(() => CLOCK);
  const queue = createLocalDevQueue({ store, now: () => CLOCK });
  const storage = createLocalDevExecutorStorage({ store, now: () => CLOCK });
  const processor: Processor = {
    id: "compression",
    tools: ["compress-pdf"],
    supports: (t) => t === "compress-pdf",
    capability: () => ({ id: "compression", tools: ["compress-pdf"], ready: true, detail: "" }),
    process: async () => {
      if (opts.cancelMidFlight) await queue.cancel(JOB_ID);
      return processorOk(output);
    },
  };
  const registry = new ProcessorRegistry().register(processor);

  const slot = store.reserveSlot({
    sessionId: "sess_test00000",
    filename: "report.pdf",
    contentType: "application/pdf",
    declaredBytes: PDF.byteLength,
  });
  store.putBytes(slot.fileId, PDF);

  const logs: ExecutorLogEvent[] = [];
  const receipts: ArtifactReceipt[] = [];
  let clockReads = 0;

  const run = async () => {
    await queue.submit({
      job: queuedJob(),
      inputs: [slot.fileId],
      options: {},
    });
    const executor = createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
      now: () => {
        clockReads += 1;
        return CLOCK;
      },
      log: (e) => logs.push(e),
      // Deliberately NO `metrics` sink — proves the clock is not read for metrics here,
      // so the receipt-clock accounting below is unambiguous.
      artifactManifest: opts.gate ?? defaultArtifactManifestGate(),
      ...(opts.withReceipts
        ? { onArtifactReceipt: (r: ArtifactReceipt) => receipts.push(r) }
        : {}),
    });
    await executor.drain();
  };

  return { store, logs, receipts, getClockReads: () => clockReads, fileId: slot.fileId, run };
}

const pdfOut = (bytes = PDF): ProcessorArtifact => ({
  filename: "report-compressed.pdf",
  contentType: "application/pdf",
  bytes,
});

describe("artifact receipts — generated on a successful publication", () => {
  it("emits exactly one bounded `generated` receipt with the stable policy stamp", async () => {
    const h = harness([pdfOut()], { withReceipts: true });
    await h.run();

    expect(h.store.getJob(JOB_ID)?.status).toBe("completed");
    expect(h.receipts).toHaveLength(1);
    expect(h.receipts[0]).toEqual({
      category: "generated",
      reason: "ok",
      policyId: "pdfxyz-worker-artifact-manifest",
      policyVersion: 1,
      processor: "compress",
      sizeBucket: "<1KiB",
      artifactCount: 1,
      at: new Date(CLOCK).toISOString(),
    });
  });

  it("builds NO receipt (and never reads the clock for one) when no sink is wired", async () => {
    const h = harness([pdfOut()]); // withReceipts omitted
    await h.run();
    expect(h.store.getJob(JOB_ID)?.status).toBe("completed");
    expect(h.receipts).toEqual([]);
    // No metrics sink + no receipt sink ⇒ the executor never reads the clock at all.
    expect(h.getClockReads()).toBe(0);
  });
});

describe("artifact receipts — rejection is a single log + single receipt", () => {
  it("logs `artifact_rejected` exactly once and emits one `rejected` receipt", async () => {
    const h = harness([pdfOut(new Uint8Array())], { withReceipts: true });
    await h.run();

    expect(h.store.getJob(JOB_ID)?.error?.code).toBe("artifact_invalid");
    // The double-log regression guard: exactly ONE artifact_rejected line, carrying
    // the terminal error code (emitted by the shared terminal disposition).
    const rejects = h.logs.filter((l) => l.event === "artifact_rejected");
    expect(rejects).toHaveLength(1);
    expect(rejects[0]).toMatchObject({ errorCode: "artifact_invalid" });
    // Exactly one receipt, category `rejected`, with the specific bounded reason.
    expect(h.receipts).toHaveLength(1);
    expect(h.receipts[0]).toMatchObject({
      category: "rejected",
      reason: "empty_artifact",
      processor: "compress",
    });
    // No `generated` receipt was emitted for a set that never published.
    expect(h.receipts.some((r) => r.category === "generated")).toBe(false);
  });

  it("a hostile output produces a content-free rejection receipt", async () => {
    const h = harness(
      [
        {
          filename: "/etc/passwd Confidential Salaries.pdf",
          contentType: "text/plain", // mismatches the .pdf name ⇒ rejected
          bytes: enc("123-45-6789 X-Amz-Signature=deadbeef AWS_SECRET_ACCESS_KEY=x"),
        },
      ],
      { withReceipts: true },
    );
    await h.run();
    expect(h.receipts).toHaveLength(1);
    const serialized = JSON.stringify(h.receipts[0]);
    for (const secret of [
      "Confidential",
      "Salaries",
      "/etc/passwd",
      "123-45-6789",
      "AWS_SECRET_ACCESS_KEY",
      "X-Amz-Signature",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("artifact receipts — cleaned when a published set is dropped", () => {
  it("emits a `cleaned` receipt when the job is canceled after the artifact is written", async () => {
    // The processor cancels its own job mid-flight, then returns a valid PDF: the gate
    // passes (a manifest is generated), the artifact is written, then `complete` fails
    // because the job is canceled — so the artifact is deleted and its manifest cleaned.
    const h = harness([pdfOut()], { withReceipts: true, cancelMidFlight: true });
    await h.run();

    expect(h.store.getJob(JOB_ID)?.status).toBe("canceled");
    expect(h.store.getJob(JOB_ID)?.artifacts ?? []).toHaveLength(0);
    // The honest sequence: a manifest was GENERATED (gate passed), then CLEANED with
    // the outputs when the cancellation deleted them. No provenance outlives the bytes.
    expect(h.receipts.map((r) => r.category)).toEqual(["generated", "cleaned"]);
    const cleaned = h.receipts.find((r) => r.category === "cleaned")!;
    expect(cleaned).toMatchObject({
      category: "cleaned",
      reason: "ok",
      processor: "compress",
      artifactCount: 1,
    });
  });

  it("emits NO `cleaned` receipt when the gate is disabled (no manifest to drop)", async () => {
    // A cancellation with the manifest gate explicitly disabled: nothing was validated,
    // so there is no manifest state to clean — a `cleaned` receipt would be a phantom.
    const h = harness([pdfOut()], {
      withReceipts: true,
      cancelMidFlight: true,
      gate: disabledArtifactManifestGate(),
    });
    await h.run();
    expect(h.store.getJob(JOB_ID)?.status).toBe("canceled");
    expect(h.receipts.some((r) => r.category === "cleaned")).toBe(false);
    expect(h.receipts.some((r) => r.category === "generated")).toBe(false);
  });
});
