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

import { randomBytes } from "node:crypto";
import { DEFAULT_RETENTION, JOB_LIMITS, type Job } from "@/lib/jobs";

const MINUTE_MS = 60_000;
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{10,64}$/;

/** URL-safe opaque id body, matching the `[A-Za-z0-9_-]` contract charset. */
function token(): string {
  return randomBytes(16).toString("base64url");
}

export function newFileId(): string {
  return `f_${token()}`;
}
export function newJobId(): string {
  return `job_${token()}`;
}
export function newArtifactId(): string {
  return `art_${token()}`;
}
export function newSessionId(): string {
  return `sess_${token()}`;
}

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

/** Why a byte upload to a slot was rejected. */
export type PutBytesError = "not_found" | "size_mismatch" | "too_large";

export class DevWorkerStore {
  private slots = new Map<string, StoredSlot>();
  private jobs = new Map<string, Job>();
  private artifacts = new Map<string, StoredArtifact>();
  private idempotency = new Map<string, string>();

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

  /** Clear everything — used to isolate tests. */
  reset(): void {
    this.slots.clear();
    this.jobs.clear();
    this.artifacts.clear();
    this.idempotency.clear();
  }
}

/** Process-wide store used by the local-dev route handlers. */
export const devWorkerStore = new DevWorkerStore();
