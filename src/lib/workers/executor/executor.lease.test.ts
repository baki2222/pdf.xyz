// @vitest-environment node
/**
 * Lease renewal while a claimed job runs.
 *
 * THE DEFECT THIS FILE PINS (found 2026-10-31 reviewing PR #244). `claim.ts`
 * says the executor "must finish or heartbeat before" `leaseExpiresAt`, and both
 * queues implement `heartbeat` — but the executor never called it. It claimed
 * with a 30 s lease and then ran Ghostscript / OCR / LibreOffice for as long as
 * they took, so any job past 30 s was claimable again while still running:
 * duplicated work, and two attempts racing to complete one job.
 *
 * Every test here runs a job for ~3x its lease on a fake clock, through the real
 * local-dev queue AND the real Redis queue (over the faithful script fake), and
 * asks the property — "is the running job claimable by someone else?" — rather
 * than "was `heartbeat` called?". The cadence test exists too, but it is not the
 * one that proves the job is safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RETENTION, type Job, type JobArtifact } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import type { ClaimableQueue } from "../queue/claim";
import { createFakeRedis, type FakeRedis } from "../queue/redis-fake";
import { parseRedisQueueConfig, REDIS_QUEUE_ENV } from "../queue/redis-config";
import { createRedisQueue } from "../queue/redis";
import { queueFail } from "../queue/types";
import { ProcessorRegistry } from "../processor/registry";
import {
  processorOk,
  type Processor,
  type ProcessorInput,
  type ProcessorInputFile,
} from "../processor/types";
import { createWorkerExecutor, leaseRenewalIntervalMs } from "./executor";
import type { ExecutorLogEvent, ExecutorStorage } from "./types";

/** The lease the executor asks for. Renewal runs every LEASE_MS / 3 = 1 s. */
const LEASE_MS = 3_000;
const RENEW_MS = 1_000;
/** The job runs for a little over 3x its lease (off the renewal grid on purpose). */
const RUN_MS = 9_500;
const T0 = 100_000;
const JOB = "job_lease000001";
const INPUT = "f_lease00000001";

function queuedJob(): Job {
  return {
    jobId: JOB,
    tool: "t",
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + 60 * 60_000).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

const INPUT_FILE: ProcessorInputFile = {
  fileId: INPUT,
  filename: "in.pdf",
  contentType: "application/pdf",
  bytes: new Uint8Array([1, 2, 3]),
};

function recordingStorage() {
  const written: string[] = [];
  const deletedInputs: string[] = [];
  const deletedArtifacts: string[] = [];
  let n = 0;
  const storage: ExecutorStorage = {
    async readInput(fileId) {
      return fileId === INPUT ? INPUT_FILE : null;
    },
    async writeArtifact(input) {
      const artifactId = `art_lease${n++}0000`;
      written.push(artifactId);
      const record: JobArtifact = {
        artifactId,
        filename: input.filename,
        contentType: input.contentType,
        bytes: input.bytes.byteLength,
        url: `/api/artifacts/local/${artifactId}`,
        expiresAt: new Date(0).toISOString(),
      };
      return record;
    },
    async deleteInput(fileId) {
      deletedInputs.push(fileId);
    },
    async deleteArtifact(artifactId) {
      deletedArtifacts.push(artifactId);
    },
  };
  return { storage, written, deletedInputs, deletedArtifacts };
}

/**
 * A processor that takes RUN_MS of (fake) wall time, or stops early when its
 * signal aborts — the cooperative shape a real engine would follow. Records what
 * it saw so a test can assert the abort reached it.
 */
function slowProcessor() {
  const seen = { signal: undefined as AbortSignal | undefined, aborted: false };
  const processor: Processor = {
    id: "fake-t",
    tools: ["t"],
    supports: (t) => t === "t",
    capability: () => ({ id: "fake-t", tools: ["t"], ready: true, detail: "" }),
    async process(input: ProcessorInput) {
      seen.signal = input.signal;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, RUN_MS);
        input.signal?.addEventListener("abort", () => {
          seen.aborted = true;
          clearTimeout(timer);
          resolve();
        });
      });
      return processorOk([
        {
          filename: "out.pdf",
          contentType: "application/pdf",
          bytes: new Uint8Array([9]),
        },
      ]);
    },
  };
  return { processor, seen };
}

/** Count heartbeats (and optionally inject transient failures) around a real queue. */
function countingQueue(inner: ClaimableQueue, transientFailures = 0) {
  const beats: {
    at: number;
    jobId: string;
    leaseMs: number;
    attempt?: number;
  }[] = [];
  let failuresLeft = transientFailures;
  const queue: ClaimableQueue = Object.create(inner) as ClaimableQueue;
  // Bind every method so `Object.create` delegation keeps the inner `this`.
  for (const key of [
    "probe",
    "enqueue",
    "lookupIdempotent",
    "status",
    "cancel",
    "expire",
    "capability",
    "submit",
    "claim",
    "advance",
    "complete",
    "fail",
  ] as const) {
    (queue as unknown as Record<string, unknown>)[key] = (
      inner[key] as (...a: unknown[]) => unknown
    ).bind(inner);
  }
  queue.heartbeat = async (jobId, leaseMs, attempt) => {
    beats.push({
      at: Date.now(),
      jobId,
      leaseMs,
      ...(attempt !== undefined ? { attempt } : {}),
    });
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return queueFail(
        "unavailable",
        "The job queue is temporarily unavailable.",
      );
    }
    return inner.heartbeat(jobId, leaseMs, attempt);
  };
  return { queue, beats };
}

interface Harness {
  /** The queue the executor under test drains. */
  queue: ClaimableQueue;
  /** A second worker's handle on the SAME backing store. */
  other: ClaimableQueue;
  /** Force the current lease past its deadline, as if renewal had not happened. */
  forceExpiry(): Promise<void>;
}

function localHarness(): Harness {
  const store = new DevWorkerStore(() => Date.now());
  const queue = createLocalDevQueue({ store, now: () => Date.now() });
  return {
    queue,
    other: queue,
    async forceExpiry() {
      const lease = store.getLease(JOB);
      if (!lease) throw new Error("forceExpiry: no lease to expire");
      store.setLease(JOB, { ...lease, leaseExpiresAt: 0 });
    },
  };
}

function redisHarness(): Harness & { fake: FakeRedis } {
  const parsed = parseRedisQueueConfig({
    [REDIS_QUEUE_ENV.provider]: "redis",
    [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
    [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
  });
  if (!parsed.ok) throw new Error("invalid test config");
  const fake = createFakeRedis();
  // Two independent queue clients over ONE broker: two workers, as in production.
  const queue = createRedisQueue(parsed.config, {
    client: fake,
    now: () => Date.now(),
  });
  const other = createRedisQueue(parsed.config, {
    client: fake,
    now: () => Date.now(),
  });
  return {
    fake,
    queue,
    other,
    async forceExpiry() {
      // The active set's score IS the lease deadline the redelivery sweep reads.
      const res = await fake.command(["ZADD", "pdfxyz:active", "0", JOB]);
      if (!res.ok) throw new Error("forceExpiry: ZADD failed");
    },
  };
}

const HARNESSES = [
  ["local-dev queue", localHarness],
  ["redis queue (script fake)", redisHarness],
] as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("leaseRenewalIntervalMs", () => {
  it("renews at a third of the lease, never at or past it", () => {
    expect(leaseRenewalIntervalMs(30_000)).toBe(10_000);
    expect(leaseRenewalIntervalMs(LEASE_MS)).toBe(RENEW_MS);
    // (A lease under 3 ms has no interval strictly inside it; none is configured.)
    for (const lease of [3, 50, 300, 3_000, 30_000, 300_000]) {
      const every = leaseRenewalIntervalMs(lease);
      expect(every).toBeGreaterThan(0);
      expect(every).toBeLessThan(lease);
    }
  });
});

describe.each(HARNESSES)("executor lease renewal — %s", (_name, make) => {
  async function submit(h: Harness) {
    const res = await h.queue.submit({
      job: queuedJob(),
      inputs: [INPUT],
      options: {},
    });
    expect(res.ok).toBe(true);
  }

  it("(a) a job running 3x its lease is never claimable by a second worker", async () => {
    const h = make();
    await submit(h);
    const { processor } = slowProcessor();
    const { storage } = recordingStorage();
    const exec = createWorkerExecutor({
      queue: h.queue,
      storage,
      registry: new ProcessorRegistry().register(processor),
      leaseMs: LEASE_MS,
    });

    const tick = exec.runOnce();
    // Probe at every half-lease, well past the original 3 s deadline each time.
    const probes: unknown[] = [];
    for (let t = 1_500; t < RUN_MS; t += 1_500) {
      await vi.advanceTimersByTimeAsync(1_500);
      const stolen = await h.other.claim({ leaseMs: LEASE_MS });
      expect(stolen.ok).toBe(true);
      probes.push(stolen.ok ? stolen.value : "error");
    }
    // Health check: the probe loop actually ran past the lease, repeatedly.
    expect(probes.length).toBe(6);
    // Printed in full on failure: the stolen claims (attempt 2, 3, …) are the defect.
    expect(probes).toEqual([null, null, null, null, null, null]);

    await vi.advanceTimersByTimeAsync(RUN_MS);
    const result = await tick;
    expect(result.outcome).toBe("completed");
    expect(result.attempt).toBe(1);
    const status = await h.queue.status(JOB);
    expect(status.ok && status.value.status).toBe("completed");
  });

  it("(b) heartbeats at leaseMs/3 with the claim's attempt fingerprint, and (c) stops at completion", async () => {
    const h = make();
    await submit(h);
    const { queue, beats } = countingQueue(h.queue);
    const { processor } = slowProcessor();
    const { storage } = recordingStorage();
    const exec = createWorkerExecutor({
      queue,
      storage,
      registry: new ProcessorRegistry().register(processor),
      leaseMs: LEASE_MS,
    });

    const tick = exec.runOnce();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect((await tick).outcome).toBe("completed");

    // 9.5 s of work at a 1 s cadence: renewals at +1 s … +9 s.
    expect(beats.map((b) => b.at - T0)).toEqual([
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000,
    ]);
    for (const beat of beats) {
      expect(beat).toMatchObject({ jobId: JOB, leaseMs: LEASE_MS, attempt: 1 });
    }

    // (c) No timer outlives the job, and time passing renews nothing more.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * LEASE_MS);
    expect(beats.length).toBe(9);
  });

  it("(d) a rejected heartbeat (stolen lease) aborts the processor and the zombie writes nothing", async () => {
    const h = make();
    await submit(h);
    const { queue, beats } = countingQueue(h.queue);
    const { processor, seen } = slowProcessor();
    const rec = recordingStorage();
    const events: ExecutorLogEvent[] = [];
    const exec = createWorkerExecutor({
      queue,
      storage: rec.storage,
      registry: new ProcessorRegistry().register(processor),
      leaseMs: LEASE_MS,
      log: (e) => events.push(e),
    });

    const tick = exec.runOnce();
    await vi.advanceTimersByTimeAsync(4_500); // four good renewals
    expect(beats.length).toBe(4);
    // Simulate the lease being lost anyway (a GC pause, a partition): force it
    // past its deadline and let a second worker reclaim the job as attempt 2.
    await h.forceExpiry();
    const second = await h.other.claim({ leaseMs: LEASE_MS });
    expect(second.ok && second.value?.attempt).toBe(2);

    // The next renewal (+5 s) is rejected; the executor must let go.
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await tick;

    expect(seen.signal).toBeDefined();
    expect(seen.aborted).toBe(true);
    expect(result).toMatchObject({
      outcome: "lease_lost",
      jobId: JOB,
      attempt: 1,
    });
    // The zombie wrote no artifact, completed nothing, and left attempt 2's
    // inputs alone — the new owner still needs them.
    expect(rec.written).toEqual([]);
    expect(rec.deletedInputs).toEqual([]);
    const status = await h.queue.status(JOB);
    expect(status.ok && status.value.status).toBe("scanning");
    expect(status.ok && status.value.artifacts).toBeUndefined();
    expect(events.map((e) => e.event)).toContain("lease_lost");
    // Renewal stopped with the rejection.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * LEASE_MS);
    expect(beats.length).toBe(5);
  });

  it("a lease lost AFTER the last renewal is caught at completion: no write, inputs kept", async () => {
    const h = make();
    await submit(h);
    const { processor } = slowProcessor();
    const rec = recordingStorage();
    const exec = createWorkerExecutor({
      queue: h.queue,
      storage: rec.storage,
      registry: new ProcessorRegistry().register(processor),
      leaseMs: LEASE_MS,
    });

    const tick = exec.runOnce();
    await vi.advanceTimersByTimeAsync(9_200); // past the last renewal (+9 s)
    await h.forceExpiry();
    const second = await h.other.claim({ leaseMs: LEASE_MS });
    expect(second.ok && second.value?.attempt).toBe(2);
    await vi.advanceTimersByTimeAsync(RUN_MS);
    const result = await tick;

    // No heartbeat saw the theft, so the processor finished and complete() was
    // rejected by the attempt CAS. That is NOT a cancellation: the job is alive
    // under attempt 2, whose inputs must survive.
    expect(result.outcome).toBe("lease_lost");
    expect(rec.deletedInputs).toEqual([]);
    // Whatever the zombie wrote before the CAS refused it is cleaned up.
    expect([...rec.deletedArtifacts].sort()).toEqual([...rec.written].sort());
    const status = await h.queue.status(JOB);
    expect(status.ok && status.value.status).toBe("scanning");
  });

  it("a transient heartbeat error does not kill the job; it retries and completes", async () => {
    const h = make();
    await submit(h);
    const { queue, beats } = countingQueue(h.queue, 2);
    const { processor, seen } = slowProcessor();
    const events: ExecutorLogEvent[] = [];
    const exec = createWorkerExecutor({
      queue,
      storage: recordingStorage().storage,
      registry: new ProcessorRegistry().register(processor),
      leaseMs: LEASE_MS,
      log: (e) => events.push(e),
    });

    const tick = exec.runOnce();
    await vi.advanceTimersByTimeAsync(RUN_MS);
    const result = await tick;
    expect(result.outcome).toBe("completed");
    expect(seen.aborted).toBe(false);
    expect(beats.length).toBe(9);
    const failed = events.filter((e) => e.event === "lease_renew_failed");
    expect(failed.length).toBe(2);
    expect(failed[0]).toMatchObject({
      jobId: JOB,
      attempt: 1,
      errorCode: "unavailable",
    });
    expect(events.map((e) => e.event)).not.toContain("lease_lost");
  });
});

describe("executor lease renewal — a queue that grants less than asked", () => {
  it("paces renewal to the GRANTED lease (Redis ceiling below the request), not the request", async () => {
    const parsed = parseRedisQueueConfig({
      [REDIS_QUEUE_ENV.provider]: "redis",
      [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
      [REDIS_QUEUE_ENV.restToken]: "AX_tokenEXAMPLEvalue000000000000000000000",
      [REDIS_QUEUE_ENV.leaseSeconds]: "6", // the minimum the config accepts is 5
    });
    if (!parsed.ok) throw new Error("invalid test config");
    const fake = createFakeRedis();
    const q = createRedisQueue(parsed.config, {
      client: fake,
      now: () => Date.now(),
    });
    const other = createRedisQueue(parsed.config, {
      client: fake,
      now: () => Date.now(),
    });
    await q.submit({ job: queuedJob(), inputs: [INPUT], options: {} });
    const { queue, beats } = countingQueue(q);
    const { processor } = slowProcessor();
    // Ask for 30 s — the executor's production default — against a 6 s ceiling.
    const exec = createWorkerExecutor({
      queue,
      storage: recordingStorage().storage,
      registry: new ProcessorRegistry().register(processor),
      leaseMs: 30_000,
    });
    const tick = exec.runOnce();
    const probes: unknown[] = [];
    for (let t = 1_500; t < RUN_MS; t += 1_500) {
      await vi.advanceTimersByTimeAsync(1_500);
      const stolen = await other.claim({ leaseMs: 30_000 });
      probes.push(stolen.ok ? stolen.value : "error");
    }
    expect(probes).toEqual([null, null, null, null, null, null]);
    await vi.advanceTimersByTimeAsync(RUN_MS);
    expect((await tick).outcome).toBe("completed");
    // Every 2 s (a third of the 6 s grant), not every 10 s (a third of 30 s).
    expect(beats.map((b) => b.at)).toEqual(
      [2_000, 4_000, 6_000, 8_000].map((ms) => T0 + ms),
    );
  });
});

describe("executor lease renewal — a canceled running job", () => {
  it("is aborted by the rejected renewal and still reported canceled, inputs wiped", async () => {
    const h = localHarness();
    await h.queue.submit({ job: queuedJob(), inputs: [INPUT], options: {} });
    const { processor, seen } = slowProcessor();
    const rec = recordingStorage();
    const exec = createWorkerExecutor({
      queue: h.queue,
      storage: rec.storage,
      registry: new ProcessorRegistry().register(processor),
      leaseMs: LEASE_MS,
    });
    const tick = exec.runOnce();
    await vi.advanceTimersByTimeAsync(2_500);
    const canceled = await h.queue.cancel(JOB);
    expect(canceled.ok).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await tick;
    expect(seen.aborted).toBe(true);
    expect(result.outcome).toBe("canceled");
    expect(rec.written).toEqual([]);
    expect(rec.deletedInputs).toEqual([INPUT]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
