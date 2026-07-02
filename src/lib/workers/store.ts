/**
 * In-memory store for the developer-only local worker.
 *
 * This exists ONLY to make the local-dev worker a real, end-to-end flow on a
 * developer's machine: reserve an upload slot → receive bytes → run a job →
 * download the artifact. It is intentionally NOT a production store — it holds
 * bytes in the Node process, is per-instance (not shared across replicas), and
 * is lost on restart. Production uses encrypted object storage with lifecycle
 * deletion (see docs/WORKER_ARCHITECTURE.md). To stay honest about retention it
 * still stamps every entry with an expiry and lazily drops expired entries on
 * read, mirroring the contract's auto-delete guarantee.
 */

import { DEFAULT_RETENTION, JOB_LIMITS, type Job } from "@/lib/jobs";

const MINUTE_MS = 60_000;
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{10,64}$/;

// Opaque-id minting lives in the node-only `./ids` leaf (no dependency on this
// store), so the eager production adapter can mint ids without pulling the dev
// store in. Imported for internal use and re-exported for the many existing
// call sites that import them from the store.
import { newFileId, newJobId, newArtifactId, newSessionId } from "./ids";

export { newFileId, newJobId, newArtifactId, newSessionId };

/** True if `id` is a syntactically valid local artifact id. */
export function isValidArtifactId(id: string): boolean {
  return ARTIFACT_ID.test(id);
}

/** A reserved upload slot; `bytes` is set once the client uploads to it. */
export interface StoredSlot {
  fileId: string;
  sessionId: string;
  filename: string;
  contentType: string;
  declaredBytes: number;
  bytes?: Uint8Array;
  expiresAt: number;
}

/** A produced, downloadable output held for the retention window. */
export interface StoredArtifact {
  artifactId: string;
  jobId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  expiresAt: number;
}

/**
 * The executor-facing spec of a queued job: the inputs to read and the raw
 * options to run. Held separately from the client-facing {@link Job} record (which
 * never exposes inputs) and dropped once the job reaches a terminal state.
 */
export interface StoredJobSpec {
  inputs: string[];
  options: Record<string, unknown>;
}

/** A worker's lease on a claimed job: the deadline plus the attempt count. */
export interface StoredLease {
  leaseExpiresAt: number;
  /** How many times this job has been claimed (redelivery/retry increments it). */
  attempts: number;
}

/** Why a byte upload to a slot was rejected. */
export type PutBytesError = "not_found" | "size_mismatch" | "too_large";

export class DevWorkerStore {
  private slots = new Map<string, StoredSlot>();
  private jobs = new Map<string, Job>();
  private artifacts = new Map<string, StoredArtifact>();
  private idempotency = new Map<string, string>();
  private specs = new Map<string, StoredJobSpec>();
  private leases = new Map<string, StoredLease>();

  /** Injectable clock keeps expiry deterministic under test. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  private expired(expiresAt: number): boolean {
    return this.now() >= expiresAt;
  }

  /** Reserve an upload slot for one declared file and return it. */
  reserveSlot(input: {
    sessionId: string;
    filename: string;
    contentType: string;
    declaredBytes: number;
  }): StoredSlot {
    const slot: StoredSlot = {
      fileId: newFileId(),
      sessionId: input.sessionId,
      filename: input.filename,
      contentType: input.contentType,
      declaredBytes: input.declaredBytes,
      expiresAt: this.now() + DEFAULT_RETENTION.inputTtlMinutes * MINUTE_MS,
    };
    this.slots.set(slot.fileId, slot);
    return slot;
  }

  /** Look up a live (non-expired) slot; drops it if the window has passed. */
  getSlot(fileId: string): StoredSlot | undefined {
    const slot = this.slots.get(fileId);
    if (!slot) return undefined;
    if (this.expired(slot.expiresAt)) {
      this.slots.delete(fileId);
      return undefined;
    }
    return slot;
  }

  /**
   * Wipe an input slot (and its bytes) immediately. Called right after a job
   * finishes processing so inputs never linger past their use, mirroring the
   * contract's "inputs are wiped after processing" guarantee. Idempotent.
   */
  deleteSlot(fileId: string): void {
    this.slots.delete(fileId);
  }

  /**
   * Attach uploaded bytes to a reserved slot. The uploaded size must match the
   * size declared when the slot was created and stay within the hard per-file
   * limit — otherwise the upload is rejected rather than silently accepted.
   */
  putBytes(
    fileId: string,
    bytes: Uint8Array,
  ): { ok: true } | { ok: false; reason: PutBytesError } {
    const slot = this.getSlot(fileId);
    if (!slot) return { ok: false, reason: "not_found" };
    if (bytes.byteLength > JOB_LIMITS.maxFileBytes) {
      return { ok: false, reason: "too_large" };
    }
    if (bytes.byteLength !== slot.declaredBytes) {
      return { ok: false, reason: "size_mismatch" };
    }
    slot.bytes = bytes;
    return { ok: true };
  }

  putJob(job: Job): void {
    this.jobs.set(job.jobId, job);
  }

  /** Look up a live (non-expired) job; drops it if the window has passed. */
  getJob(jobId: string): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    if (this.expired(new Date(job.expiresAt).getTime())) {
      this.jobs.delete(jobId);
      return undefined;
    }
    return job;
  }

  setIdempotency(key: string, jobId: string): void {
    this.idempotency.set(key, jobId);
  }

  /** Resolve a prior job by idempotency key, if it still exists. */
  findByIdempotencyKey(key: string): Job | undefined {
    const jobId = this.idempotency.get(key);
    if (!jobId) return undefined;
    return this.getJob(jobId);
  }

  /**
   * All live (non-expired) jobs, dropping any that have passed their window.
   * The queue provider uses this to find the next claimable job; it never leaks
   * outside the Node-runtime worker code.
   */
  liveJobs(): Job[] {
    const live: Job[] = [];
    for (const jobId of [...this.jobs.keys()]) {
      const job = this.getJob(jobId); // drops it lazily if expired
      if (job) live.push(job);
    }
    return live;
  }

  /** Record the executor-facing spec (inputs + options) for a queued job. */
  putSpec(jobId: string, spec: StoredJobSpec): void {
    this.specs.set(jobId, spec);
  }

  /** The spec for a job, if one is still recorded. */
  getSpec(jobId: string): StoredJobSpec | undefined {
    return this.specs.get(jobId);
  }

  /** Drop a job's spec (called when it reaches a terminal state). Idempotent. */
  deleteSpec(jobId: string): void {
    this.specs.delete(jobId);
  }

  /** Read a job's current lease, if it is (or was) claimed. */
  getLease(jobId: string): StoredLease | undefined {
    return this.leases.get(jobId);
  }

  /** Record/refresh a job's lease (claim, heartbeat, redelivery). */
  setLease(jobId: string, lease: StoredLease): void {
    this.leases.set(jobId, lease);
  }

  /** Drop a job's lease (terminal transition). Idempotent. */
  deleteLease(jobId: string): void {
    this.leases.delete(jobId);
  }

  putArtifact(artifact: Omit<StoredArtifact, "expiresAt">): StoredArtifact {
    const stored: StoredArtifact = {
      ...artifact,
      expiresAt: this.now() + DEFAULT_RETENTION.outputTtlMinutes * MINUTE_MS,
    };
    this.artifacts.set(stored.artifactId, stored);
    return stored;
  }

  /** Look up a live (non-expired) artifact; drops it if the window has passed. */
  getArtifact(artifactId: string): StoredArtifact | undefined {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return undefined;
    if (this.expired(artifact.expiresAt)) {
      this.artifacts.delete(artifactId);
      return undefined;
    }
    return artifact;
  }

  /**
   * Wipe an output artifact (and its bytes) immediately — the local-dev
   * stand-in for a signed "delete now" against object storage. Idempotent:
   * returns true if the artifact existed and was removed, false if it was
   * already gone. Mirrors the contract's explicit delete-now guarantee.
   */
  deleteArtifact(artifactId: string): boolean {
    return this.artifacts.delete(artifactId);
  }

  /** Clear everything — used to isolate tests. */
  reset(): void {
    this.slots.clear();
    this.jobs.clear();
    this.artifacts.clear();
    this.idempotency.clear();
    this.specs.clear();
    this.leases.clear();
  }
}

/** Process-wide store used by the local-dev route handlers. */
export const devWorkerStore = new DevWorkerStore();
