// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, JOB_LIMITS, type Job } from "@/lib/jobs";
import {
  DevWorkerStore,
  isValidArtifactId,
  newArtifactId,
  newFileId,
  newJobId,
  newSessionId,
} from "./store";

const MINUTE_MS = 60_000;

/** A terminal job record, shaped like what the local-dev worker stores. */
function makeJob(jobId: string, expiresAt: string): Job {
  return {
    jobId,
    tool: "compress-pdf",
    capability: "hybrid",
    status: "completed",
    progress: 100,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt,
    retention: DEFAULT_RETENTION,
  };
}

describe("id helpers", () => {
  it("mint ids with the contract-shaped prefixes and charset", () => {
    expect(newFileId()).toMatch(/^f_[A-Za-z0-9_-]{10,64}$/);
    expect(newJobId()).toMatch(/^job_[A-Za-z0-9_-]{10,64}$/);
    expect(newArtifactId()).toMatch(/^art_[A-Za-z0-9_-]{10,64}$/);
    expect(newSessionId()).toMatch(/^sess_[A-Za-z0-9_-]{10,64}$/);
  });

  it("mint unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newFileId()));
    expect(ids.size).toBe(50);
  });

  it("validates artifact ids", () => {
    expect(isValidArtifactId(newArtifactId())).toBe(true);
    expect(isValidArtifactId("art_short")).toBe(false);
    expect(isValidArtifactId("f_1234567890")).toBe(false);
    expect(isValidArtifactId("art_bad*chars!!")).toBe(false);
  });
});

describe("DevWorkerStore — slots", () => {
  let clock: number;
  let store: DevWorkerStore;

  beforeEach(() => {
    clock = 1_000_000;
    store = new DevWorkerStore(() => clock);
  });

  const reserve = (declaredBytes = 4) =>
    store.reserveSlot({
      sessionId: newSessionId(),
      filename: "report.pdf",
      contentType: "application/pdf",
      declaredBytes,
    });

  it("reserves a slot with an input-TTL expiry and finds it", () => {
    const slot = reserve();
    expect(slot.fileId).toMatch(/^f_/);
    expect(slot.bytes).toBeUndefined();
    expect(slot.expiresAt).toBe(
      clock + DEFAULT_RETENTION.inputTtlMinutes * MINUTE_MS,
    );
    expect(store.getSlot(slot.fileId)?.fileId).toBe(slot.fileId);
  });

  it("drops a slot lazily once its window has passed", () => {
    const slot = reserve();
    clock += DEFAULT_RETENTION.inputTtlMinutes * MINUTE_MS; // exactly at expiry
    expect(store.getSlot(slot.fileId)).toBeUndefined();
  });

  it("attaches bytes only when the size matches the declaration", () => {
    const slot = reserve(4);
    expect(store.putBytes(slot.fileId, new Uint8Array([1, 2, 3, 4]))).toEqual({
      ok: true,
    });
    expect(store.getSlot(slot.fileId)?.bytes).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("rejects a size mismatch", () => {
    const slot = reserve(4);
    expect(store.putBytes(slot.fileId, new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      reason: "size_mismatch",
    });
  });

  it("rejects bytes over the hard per-file limit before the size check", () => {
    const slot = reserve(JOB_LIMITS.maxFileBytes + 1);
    const oversized = new Uint8Array(JOB_LIMITS.maxFileBytes + 1);
    expect(store.putBytes(slot.fileId, oversized)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("rejects bytes for an unknown slot", () => {
    expect(store.putBytes("f_missing0000", new Uint8Array([1]))).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("wipes an input slot on deleteSlot (idempotent)", () => {
    const slot = reserve();
    store.putBytes(slot.fileId, new Uint8Array([1, 2, 3, 4]));
    store.deleteSlot(slot.fileId);
    expect(store.getSlot(slot.fileId)).toBeUndefined();
    // Deleting again is safe.
    expect(() => store.deleteSlot(slot.fileId)).not.toThrow();
  });
});

describe("DevWorkerStore — jobs, artifacts, idempotency", () => {
  let clock: number;
  let store: DevWorkerStore;

  beforeEach(() => {
    clock = 5_000_000;
    store = new DevWorkerStore(() => clock);
  });

  it("stores and reads a job, dropping it once expired", () => {
    const expiresAt = new Date(clock + 60 * MINUTE_MS).toISOString();
    const job = makeJob(newJobId(), expiresAt);
    store.putJob(job);
    expect(store.getJob(job.jobId)?.jobId).toBe(job.jobId);

    clock += 60 * MINUTE_MS; // reach the job's expiry
    expect(store.getJob(job.jobId)).toBeUndefined();
  });

  it("resolves a job by idempotency key while it lives", () => {
    const job = makeJob(
      newJobId(),
      new Date(clock + 60 * MINUTE_MS).toISOString(),
    );
    store.putJob(job);
    store.setIdempotency("key:1", job.jobId);
    expect(store.findByIdempotencyKey("key:1")?.jobId).toBe(job.jobId);
    expect(store.findByIdempotencyKey("missing")).toBeUndefined();
  });

  it("stamps an artifact with an output-TTL expiry and drops it lazily", () => {
    const stored = store.putArtifact({
      artifactId: newArtifactId(),
      jobId: newJobId(),
      filename: "out.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(stored.expiresAt).toBe(
      clock + DEFAULT_RETENTION.outputTtlMinutes * MINUTE_MS,
    );
    expect(store.getArtifact(stored.artifactId)?.artifactId).toBe(
      stored.artifactId,
    );

    clock += DEFAULT_RETENTION.outputTtlMinutes * MINUTE_MS;
    expect(store.getArtifact(stored.artifactId)).toBeUndefined();
  });

  it("reset clears everything", () => {
    const job = makeJob(
      newJobId(),
      new Date(clock + 60 * MINUTE_MS).toISOString(),
    );
    store.putJob(job);
    store.setIdempotency("k", job.jobId);
    store.reset();
    expect(store.getJob(job.jobId)).toBeUndefined();
    expect(store.findByIdempotencyKey("k")).toBeUndefined();
  });
});
