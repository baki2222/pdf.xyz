// @vitest-environment node
/**
 * Active-deletion proof for the worker executor: an invariant sweep proving that no
 * input object and no orphaned artifact ever survives a terminal job, across EVERY
 * path the executor can drive a claimed job to a terminal state.
 *
 * The retention contract (docs/WORKER_ARCHITECTURE.md, "Retention model") is that
 * inputs are wiped the instant a job finishes — success OR failure — and that a
 * failed/canceled job leaves NO artifact behind; only a *successful* job retains its
 * one intended artifact, and only with a bounded TTL. The lifecycle backstop
 * (`../lifecycle`) is the independent safety net if this active deletion ever fails;
 * this suite proves the active path itself does not leak.
 *
 * It exercises the terminal paths the phase calls out — completion, no-processor,
 * expired/missing input, a terminal processing failure, an OCR failure, the three
 * malware-scan blocks (infected / unscannable / scan-unavailable), and cancellation
 * mid-run — plus the crucial COMPLEMENT: a retryable requeue is NOT terminal, so its
 * inputs must SURVIVE for the retry. Everything runs on in-memory fakes with a frozen
 * clock; no network, bucket, or native engine.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_RETENTION,
  isTerminalStatus,
  type Job,
  type JobArtifact,
} from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { ProcessorRegistry } from "../processor/registry";
import { createProcessorRegistry } from "../processor";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorInputFile,
} from "../processor/types";
import {
  fakeScanner,
  scanError,
  scanInfected,
  scanInvalid,
  type MalwareScanner,
} from "../scanner";
import { createLocalDevExecutorStorage } from "./local-dev-storage";
import { createWorkerExecutor } from "./executor";
import type { ExecutorOutcome, ExecutorStorage } from "./types";

const LEASE_MS = 1_000;
const CLOCK = 1_000;

function queuedJob(jobId: string, tool: string): Job {
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

/** An ExecutorStorage that records every write and delete for leak assertions. */
function recordingStorage(inputs: Record<string, ProcessorInputFile>) {
  const artifacts = new Map<string, JobArtifact>();
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
      artifacts.delete(artifactId);
    },
  };
  return { storage, artifacts, deletedInputs };
}

function fakeProcessor(tool: string, run: Processor["process"]): Processor {
  return {
    id: `fake-${tool}`,
    tools: [tool],
    supports: (t) => t === tool,
    capability: () => ({
      id: `fake-${tool}`,
      tools: [tool],
      ready: true,
      detail: "",
    }),
    process: run,
  };
}

const OK_ARTIFACT = [
  {
    filename: "out.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array([9]),
  },
];

/** Two input ids, so the invariant proves EVERY input is wiped, not just the first. */
const TWO_INPUTS = ["f_leak00000001", "f_leak00000002"];

function seededInputs(ids: string[]): Record<string, ProcessorInputFile> {
  return Object.fromEntries(
    ids.map((fileId) => [
      fileId,
      {
        fileId,
        filename: "in.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]),
  );
}

// ─────────── terminal failure/cancel paths must leave NOTHING behind ───────────

interface LeakScenario {
  name: string;
  /** `false` ⇒ the inputs are absent (an expired/missing object). */
  seed: boolean;
  tool: string;
  processor?: Processor;
  /** Job options (OCR needs a valid request to reach its capability check). */
  options?: Record<string, unknown>;
  /** Use the REAL processor registry (for the genuine `ocr-pdf` → not_implemented path). */
  useRealRegistry?: boolean;
  scanner?: MalwareScanner;
  maxAttempts?: number;
  /** The processor cancels its own job mid-run, then returns success. */
  cancelMidRun?: boolean;
  expectOutcome: ExecutorOutcome;
  /** When set, assert the EXACT drain outcome sequence (pins e.g. no requeue). */
  expectExactOutcomes?: ExecutorOutcome[];
}

const FAILING: Processor = fakeProcessor("t", async () =>
  processorFail({
    code: "unprocessable_entity",
    message: "bad",
    retryable: false,
  }),
);
const OK: Processor = fakeProcessor("t", async () => processorOk(OK_ARTIFACT));

const SCENARIOS: LeakScenario[] = [
  {
    name: "no registered processor",
    seed: true,
    tool: "no-such-tool",
    expectOutcome: "failed",
  },
  {
    name: "an expired/missing input",
    seed: false,
    tool: "t",
    processor: OK,
    expectOutcome: "failed",
  },
  {
    name: "a terminal processing failure",
    seed: true,
    tool: "t",
    processor: FAILING,
    expectOutcome: "failed",
  },
  {
    // The REAL OCR processor: with no runner wired it validates the request then fails
    // honestly as not_implemented — the genuine "OCR unavailable" path, not a stand-in.
    name: "an OCR failure (real processor, no engine)",
    seed: true,
    tool: "ocr-pdf",
    useRealRegistry: true,
    options: { languages: ["eng"], outputMode: "searchable-pdf" },
    expectOutcome: "failed",
  },
  {
    name: "a malware-scan block (infected)",
    seed: true,
    tool: "t",
    processor: OK,
    scanner: fakeScanner(scanInfected()),
    expectOutcome: "failed",
  },
  {
    name: "an unscannable input (invalid)",
    seed: true,
    tool: "t",
    processor: OK,
    scanner: fakeScanner(scanInvalid()),
    expectOutcome: "failed",
  },
  {
    // maxAttempts:1 ⇒ a retryable scan error must terminate IMMEDIATELY with no requeue.
    // The exact-outcome assertion pins that (a `drain()`+`toContain` would pass even
    // under a broken attempt budget that requeued first).
    name: "a scan that never completes (unavailable, attempts exhausted)",
    seed: true,
    tool: "t",
    processor: OK,
    maxAttempts: 1,
    scanner: fakeScanner(scanError()),
    expectOutcome: "failed",
    expectExactOutcomes: ["failed", "idle"],
  },
  {
    name: "cancellation mid-run (artifact written then reclaimed)",
    seed: true,
    tool: "t",
    cancelMidRun: true,
    expectOutcome: "canceled",
  },
];

describe("executor active-deletion proof — no leak on any terminal path", () => {
  const jobId = "job_leak000000";

  for (const s of SCENARIOS) {
    it(`wipes every input and leaves no artifact after ${s.name}`, async () => {
      const store = new DevWorkerStore(() => CLOCK);
      const queue = createLocalDevQueue({ store, now: () => CLOCK });
      const { storage, artifacts, deletedInputs } = recordingStorage(
        s.seed ? seededInputs(TWO_INPUTS) : {},
      );

      // The real registry gives a genuine `ocr-pdf` → not_implemented; otherwise a
      // bare registry with just this scenario's fake processor.
      const registry = s.useRealRegistry
        ? createProcessorRegistry({})
        : new ProcessorRegistry();
      const processor = s.cancelMidRun
        ? fakeProcessor(s.tool, async () => {
            await queue.cancel(jobId); // cancel arrives while "processing"
            return processorOk(OK_ARTIFACT);
          })
        : s.processor;
      if (processor) registry.register(processor);

      await queue.submit({
        job: queuedJob(jobId, s.tool),
        inputs: TWO_INPUTS,
        options: s.options ?? {},
      });

      const exec = createWorkerExecutor({
        queue,
        storage,
        registry,
        leaseMs: LEASE_MS,
        ...(s.scanner ? { scanner: s.scanner } : {}),
        ...(s.maxAttempts !== undefined ? { maxAttempts: s.maxAttempts } : {}),
      });
      const ticks = await exec.drain();

      // The executor reached the expected terminal outcome (exact sequence when pinned)...
      if (s.expectExactOutcomes) {
        expect(ticks.map((t) => t.outcome)).toEqual(s.expectExactOutcomes);
      } else {
        expect(ticks.map((t) => t.outcome)).toContain(s.expectOutcome);
      }
      // ...the job is in a terminal state...
      const job = store.getJob(jobId);
      expect(job && isTerminalStatus(job.status)).toBe(true);
      // ...EVERY input was wiped (even the ones never read, on the missing-input path)...
      for (const id of TWO_INPUTS) expect(deletedInputs).toContain(id);
      // ...and NO artifact survives a failed/canceled job.
      expect(artifacts.size).toBe(0);
      // The stored job carries no artifact reference either.
      expect(job?.artifacts ?? []).toHaveLength(0);
    });
  }
});

// ─────────────── the complement: a retryable requeue must NOT delete ───────────────

describe("executor active-deletion proof — a retryable requeue preserves inputs", () => {
  it("requeues without wiping inputs on the first of several attempts", async () => {
    const jobId = "job_requeue001";
    const store = new DevWorkerStore(() => CLOCK);
    const queue = createLocalDevQueue({ store, now: () => CLOCK });
    const { storage, artifacts, deletedInputs } = recordingStorage(
      seededInputs(TWO_INPUTS),
    );
    const registry = new ProcessorRegistry().register(
      fakeProcessor("t", async () =>
        processorFail({
          code: "internal_error",
          message: "transient",
          retryable: true,
        }),
      ),
    );
    await queue.submit({
      job: queuedJob(jobId, "t"),
      inputs: TWO_INPUTS,
      options: {},
    });

    const tick = await createWorkerExecutor({
      queue,
      storage,
      registry,
      leaseMs: LEASE_MS,
      maxAttempts: 3,
    }).runOnce();

    expect(tick.outcome).toBe("requeued");
    // A requeue is NOT terminal — the inputs must survive for the next attempt...
    expect(deletedInputs).toHaveLength(0);
    // ...and no artifact was produced.
    expect(artifacts.size).toBe(0);
    // The job returned to a non-terminal state.
    expect(isTerminalStatus(store.getJob(jobId)!.status)).toBe(false);
  });
});

// ─────────── completion retains exactly one artifact, with a bounded TTL ───────────

describe("executor active-deletion proof — completion wipes inputs, retains one TTL'd artifact", () => {
  it("wipes the input and keeps a single artifact whose expiry honors the output TTL", async () => {
    const store = new DevWorkerStore(() => CLOCK);
    const queue = createLocalDevQueue({ store, now: () => CLOCK });
    const storage = createLocalDevExecutorStorage({ store, now: () => CLOCK });

    // A real lossless compression completes with real artifact bytes.
    const pdf = await PDFDocument.create().then((d) => {
      d.addPage([300, 300]);
      return d.save();
    });
    const slot = store.reserveSlot({
      sessionId: "sess_test00000",
      filename: "report.pdf",
      contentType: "application/pdf",
      declaredBytes: pdf.byteLength,
    });
    store.putBytes(slot.fileId, pdf);
    await queue.submit({
      job: queuedJob("job_done000000", "compress-pdf"),
      inputs: [slot.fileId],
      options: { profile: "lossless" },
    });

    const ticks = await createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({
        compression: {
          tools: { ghostscript: false, qpdf: false, mutool: false },
        },
      }),
      leaseMs: LEASE_MS,
    }).drain();

    expect(ticks.map((t) => t.outcome)).toEqual(["completed", "idle"]);
    const job = store.getJob("job_done000000");
    expect(job?.status).toBe("completed");

    // The input is gone the instant the job finished (active delete-now).
    expect(store.getSlot(slot.fileId)).toBeUndefined();

    // Exactly one artifact is retained — and only until a bounded TTL, after which
    // the storage lifecycle backstop removes the bytes. This is the artifact-expiry
    // contract: the record never lives "forever".
    expect(job?.artifacts).toHaveLength(1);
    const artifact = job!.artifacts![0]!;
    expect(artifact.expiresAt).toBe(
      new Date(
        CLOCK + DEFAULT_RETENTION.outputTtlMinutes * 60_000,
      ).toISOString(),
    );
    expect(new Date(artifact.expiresAt).getTime()).toBeGreaterThan(CLOCK);
  });
});
