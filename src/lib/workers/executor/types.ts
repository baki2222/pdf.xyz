/**
 * Types for the worker executor: the storage seam it reads inputs from and writes
 * artifacts to, its per-tick outcome, and its content-free log event.
 *
 * Node-free (types only). The concrete local-dev storage lives in
 * `./local-dev-storage` (which touches the in-process store) and is imported only
 * by Node-runtime code.
 */

import type { JobArtifact, JobError } from "@/lib/jobs";
import type { ProcessorInputFile } from "../processor/types";
import type { ArtifactManifest } from "../artifacts/types";

/** Input handed to {@link ExecutorStorage.writeArtifact}. */
export interface WriteArtifactInput {
  jobId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  /**
   * The content-free provenance {@link ArtifactManifest} the manifest gate generated
   * for this output, when a gate ran, so the retrieval boundary can re-validate provenance
   * on download. A byte-store (local-dev) records it alongside the artifact; a bucket
   * provider stamps it as signed object metadata ({@link ARTIFACT_MANIFEST_METADATA_HEADER})
   * and recovers it on the server-side read. Absent when the gate was disabled (retrieval
   * then honestly takes its manifest-less intrinsic path). Content-free by construction, so
   * carrying it as object metadata leaks nothing.
   */
  manifest?: ArtifactManifest;
}

/**
 * The worker-side storage the executor uses. In production this is the encrypted
 * bucket the *worker* touches directly — deliberately narrower and distinct from
 * the app-server {@link import("../storage/types").StorageProvider} (which only
 * reserves and deletes, and never streams bytes). Modeling it as its own seam
 * keeps the app-server contract clean while giving the executor exactly the byte
 * I/O it needs.
 */
export interface ExecutorStorage {
  /** Read an input object as a processor-ready file, or `null` if missing/expired. */
  readInput(fileId: string): Promise<ProcessorInputFile | null>;
  /** Persist a produced artifact and return its downloadable, signed record. */
  writeArtifact(input: WriteArtifactInput): Promise<JobArtifact>;
  /** Delete an input object now (post-processing wipe). Idempotent. */
  deleteInput(fileId: string): Promise<void>;
  /** Delete a produced artifact now (cleanup on cancellation). Idempotent. */
  deleteArtifact(artifactId: string): Promise<void>;
}

/** The result of a single executor tick. */
export type ExecutorOutcome =
  | "idle" // nothing was claimable
  | "completed" // a job finished with real artifacts
  | "failed" // a job failed terminally
  | "requeued" // a retryable failure was returned to the queue
  | "canceled" // the job was canceled before it could complete
  // This attempt lost its lease (another attempt reclaimed the job) and let go:
  // it wrote no artifact or terminal state, and left the inputs for the owner.
  | "lease_lost"
  | "error"; // the queue itself could not be reached

export interface ExecutorTick {
  outcome: ExecutorOutcome;
  jobId?: string;
  attempt?: number;
  /** Present on `failed`/`requeued`: the typed, client-safe job error. */
  error?: JobError;
}

/**
 * A content-free structured log event. It carries only opaque ids, the tool
 * slug, the attempt number, and an error *code* — never filenames, object keys,
 * temp paths, option values, or document bytes.
 *
 * The malware-scan gate adds two events, emitted only when a scanner is wired:
 *  - `scan_clean`   — a real scan ran and passed (its ABSENCE before `processing`
 *    honestly signals an unscanned/`skipped` path);
 *  - `scan_blocked` — the gate blocked an input (a detected threat → `malware_detected`,
 *    or one it cannot scan → `scan_invalid`); the job is failed before processing.
 * A scan that could not complete reuses `requeued`/`failed` with a `scan_unavailable`
 * error code, so no new event is needed for it.
 *
 * The file-soundness gate (Phase 36) adds two more, emitted only when a gate is
 * wired and enabled, immediately after the storage read and BEFORE the scanner and
 * `processing`:
 *  - `soundness_ok`      — the bounded structural preflight passed;
 *  - `soundness_blocked` — an input failed the preflight (e.g. empty, a size
 *    mismatch, an unsupported family, or a PDF-expected input with no `%PDF-`
 *    envelope); the job is failed before scanning and processing with an
 *    `unsound_input` error code, so the input never reaches ClamAV/OCR/compression.
 *    Content-free: the specific reason rides the metric, never a log line,
 *    filename, or byte.
 *
 * The artifact-manifest gate (Phase 37) adds two more, emitted only when a gate is
 * wired and enabled, AFTER the processor succeeds and BEFORE any bytes are persisted:
 *  - `artifact_ok`       — every produced output passed the bounded provenance check;
 *  - `artifact_rejected` — an output failed the check (e.g. empty, an unrecognized
 *    kind, a mistyped/unproducible content-type, or a retention-less job); the job is
 *    failed before any artifact is written with an `artifact_invalid` error code, so
 *    no client artifact is ever minted. Content-free: the specific reason rides the
 *    metric, never a log line, filename, or byte.
 */
export interface ExecutorLogEvent {
  event:
    | "claimed"
    | "scanning"
    | "scan_clean"
    | "scan_blocked"
    | "soundness_ok"
    | "soundness_blocked"
    | "processing"
    | "artifact_ok"
    | "artifact_rejected"
    | "completed"
    | "failed"
    | "requeued"
    | "canceled"
    | "no_processor"
    | "input_missing"
    /**
     * An AI call spent tokens and the global spend ceiling did NOT record them.
     *
     * Emitted rather than swallowed because a permanently-failing record looks
     * identical to success at a call site that ignores the return — which is
     * the state this worker was in before it carried the limiter's
     * configuration: every spend recorded nothing, silently, while the test
     * suite stayed green. Content-free: it names the event, never an amount.
     */
    | "ai_spend_unrecorded"
    /**
     * A lease renewal failed transiently (the queue was unreachable). The job
     * keeps running and renewal keeps trying: only the queue's own ownership
     * check can say the lease is gone. `errorCode` is the queue failure reason.
     */
    | "lease_renew_failed"
    /**
     * This attempt no longer owns the job — a renewal or a terminal write was
     * rejected because another attempt reclaimed it. The processor is aborted
     * and nothing is written; the tick reports `lease_lost`.
     */
    | "lease_lost";
  jobId: string;
  tool: string;
  attempt: number;
  errorCode?: string;
}
