/**
 * Typed contracts for pdf.xyz secure-worker and AI jobs.
 *
 * This module is the honest, framework-agnostic boundary between the web app and
 * the processing backend(s) that will run heavy or AI-assisted operations. It is
 * pure data + tiny pure helpers — no Next.js, no storage, no network — so it can
 * be reused unchanged by future queues, workers, and SDKs, and unit-tested in
 * isolation.
 *
 * Design rules (see docs/WORKER_ARCHITECTURE.md):
 *  - The client-side tools (merge, split, rotate, image conversions, …) never
 *    touch this API. They run entirely in the browser.
 *  - Nothing here fakes processing. The route handlers validate against these
 *    shapes and then return an honest "worker backend not configured" response
 *    until a real worker is wired up.
 *  - Privacy by default: every job carries an explicit RetentionPolicy and an
 *    `expiresAt`, so auto-deletion is part of the contract, not an afterthought.
 */

import type { JobResults } from "./results";

/**
 * How a tool executes. This is the vocabulary the job/worker layer speaks in; it
 * maps 1:1 from the catalog's {@link ProcessingMode} via `capabilities.ts`.
 * - `in-browser`   : runs fully on the device; never uploaded (no job).
 * - `secure-worker`: processed on an encrypted, isolated, auto-deleting worker.
 * - `hybrid`       : browser-first, with a secure-worker fallback for hard files.
 * - `ai`           : runs on secure AI infrastructure; content never trains models.
 */
export type ToolCapability = "in-browser" | "secure-worker" | "hybrid" | "ai";

/**
 * Lifecycle of a server-side job, in the order a job normally moves through.
 * `failed`, `expired`, and `canceled` are terminal alongside `completed`.
 */
export type JobStatus =
  | "queued" // accepted and waiting for a worker slot
  | "scanning" // malware / soundness scan in progress
  | "processing" // worker is transforming the inputs
  | "completed" // outputs are ready to download
  | "failed" // terminal error; see `error`
  | "expired" // outputs auto-deleted after the retention window
  | "canceled"; // canceled by the client before completion

/** Whether a tool takes uploaded files or a single URL as its input. */
export type ToolInputKind = "file" | "url";

/**
 * Privacy-by-default retention. Inputs are deleted immediately after a job
 * finishes; these are the hard upper bounds enforced by storage lifecycle rules.
 */
export interface RetentionPolicy {
  /** Max minutes an input file may live in storage before automatic deletion. */
  inputTtlMinutes: number;
  /** Minutes a completed output stays downloadable before automatic deletion. */
  outputTtlMinutes: number;
  /** Contractual guarantee: nothing is persisted beyond the job lifecycle. */
  readonly persistsAfterJob: false;
}

/** The single retention policy applied to every job in this contract. */
export const DEFAULT_RETENTION: RetentionPolicy = {
  inputTtlMinutes: 60,
  outputTtlMinutes: 60,
  persistsAfterJob: false,
};

/**
 * Hard limits enforced by request validation. Kept here as the single source of
 * truth so the UI, docs, and validators never drift.
 */
export const JOB_LIMITS = {
  /** Max files per upload session / job. */
  maxInputFiles: 20,
  /** Max size of a single input file. */
  maxFileBytes: 100 * 1024 * 1024, // 100 MB
  /** Max combined size across all files in one session. */
  maxTotalBytes: 500 * 1024 * 1024, // 500 MB
  /** Max length of a client-supplied filename. */
  maxFilenameLength: 255,
  /** Max serialized size of a job's `options` object. */
  maxOptionsBytes: 8 * 1024, // 8 KB
  /** Max length of an idempotency key. */
  maxIdempotencyKeyLength: 200,
  /** Max size of a request's JSON metadata body (files upload out-of-band). */
  maxRequestBodyBytes: 64 * 1024, // 64 KB
} as const;

/**
 * Contract-level rate limits. Enforcement lives at the edge/worker in
 * production (documented in docs/WORKER_ARCHITECTURE.md); this build does not
 * fake enforcement, it only publishes the numbers integrators should honor.
 */
export const RATE_LIMITS = {
  uploadsPerHourPerClient: 60,
  jobsPerHourPerClient: 60,
  statusRequestsPerMinutePerClient: 120,
  /**
   * The free daily AI allowance, counted in the unit a user can actually act
   * on — runs, not dollars. Deliberately conservative (owner ruling,
   * 2026-08-10): raising a limit is an announcement, lowering one is a broken
   * promise. Every user-facing mention derives from this constant; the
   * numbers census owns the figure. The global daily spend ceiling is a
   * separate, internal circuit breaker and is never published.
   */
  aiRunsPerDayPerClient: 3,
} as const;

// ─────────────────────────────── Upload session ──────────────────────────────

/**
 * A file the client intends to upload, declared up-front so the server can
 * pre-authorize a slot and reject over-limit or wrong-type files before a single
 * byte is transferred.
 */
export interface UploadFileDescriptor {
  /** Client-chosen name; used only for output naming and display. */
  filename: string;
  /** Declared MIME type; validated against the tool's accepted types. */
  contentType: string;
  /** Declared size in bytes; validated against {@link JOB_LIMITS}. */
  bytes: number;
}

/** Request body for `POST /api/uploads`. */
export interface CreateUploadSessionRequest {
  /** Tool slug the upload is for; determines accepted types and limits. */
  tool: string;
  files: UploadFileDescriptor[];
}

/** A short-lived, single-use slot the client PUTs exactly one file into. */
export interface UploadSlot {
  /** Opaque id the client later lists in a job's `inputs`. */
  fileId: string;
  filename: string;
  /** Pre-signed URL for a direct, encrypted upload to object storage. */
  url: string;
  method: "PUT" | "POST";
  /** Headers the client must echo on the upload request. */
  headers: Record<string, string>;
}

/** Response body for a created upload session. */
export interface UploadSession {
  sessionId: string;
  tool: string;
  slots: UploadSlot[];
  /** ISO-8601 expiry. Slots are single-use and short-lived. */
  expiresAt: string;
  retention: RetentionPolicy;
}

// ─────────────────────────────────── Jobs ────────────────────────────────────

/** Request body for `POST /api/jobs`. */
export interface CreateJobRequest {
  /** Tool slug. Must exist in the catalog and use a worker capability. */
  tool: string;
  /** `fileId`s returned by an upload session (file-input tools). */
  inputs: string[];
  /**
   * Optional, positionally-aligned display names for `inputs` — the sanitized
   * original filenames, used only to name outputs and for display. They are
   * sanitized server-side (see {@link sanitizeDisplayFilename}) and NEVER become
   * an object key, broker key, path, or log line. Omitting them is fully
   * supported: the worker still recovers a name from object metadata, and legacy
   * jobs fall back to a safe content-type-derived name. Backward-compatible.
   */
  inputNames?: string[];
  /** Tool-specific options (compression level, target language, url, …). */
  options?: Record<string, unknown>;
  /** Optional idempotency key so retries don't double-run or double-charge. */
  idempotencyKey?: string;
}

/** A single downloadable result of a completed job. */
export interface JobArtifact {
  artifactId: string;
  filename: string;
  contentType: string;
  bytes: number;
  /** Signed, expiring download URL. Present only once the job is completed. */
  url: string;
  /** ISO-8601 auto-deletion time for this artifact. */
  expiresAt: string;
}

/** Terminal error attached to a `failed` job. */
export interface JobError {
  code: string;
  message: string;
  /** True if the identical request may succeed on retry. */
  retryable: boolean;
}

/** The full state of a job, returned by the create and status endpoints. */
export interface Job {
  jobId: string;
  tool: string;
  capability: ToolCapability;
  status: JobStatus;
  /** 0–100 for long-running jobs; 100 when completed. */
  progress: number;
  /** Present only when `status === "completed"`. */
  artifacts?: JobArtifact[];
  /**
   * Safe, bounded, content-free result metadata for tools that report it (today
   * OCR). Present only on a completed job that produced described output, and
   * dropped again when those outputs are deleted (cancel/expire), so it never
   * outlives the artifacts it describes. Namespaced by tool family — a job only
   * carries the block for the work it did. See {@link JobResults}; every write
   * funnels through `sanitizeJobResults`, so this can never carry recognized text,
   * a filename, key, path, URL, or secret.
   */
  results?: JobResults;
  /** Present only when `status === "failed"`. */
  error?: JobError;
  createdAt: string;
  updatedAt: string;
  /** When the job and all its artifacts are auto-deleted. */
  expiresAt: string;
  retention: RetentionPolicy;
}

/** Job states that never change again. */
export const TERMINAL_STATUSES = [
  "completed",
  "failed",
  "expired",
  "canceled",
] as const satisfies readonly JobStatus[];

/** True once a job has reached a state it can never leave. */
export function isTerminalStatus(status: JobStatus): boolean {
  return (TERMINAL_STATUSES as readonly JobStatus[]).includes(status);
}

/**
 * Whether a completed job's outputs are currently downloadable. Encodes the
 * "download readiness" part of the contract: outputs are only ready when the job
 * completed AND at least one non-expired artifact exists.
 */
export function isDownloadReady(
  job: Pick<Job, "status" | "artifacts">,
): boolean {
  return job.status === "completed" && (job.artifacts?.length ?? 0) > 0;
}
