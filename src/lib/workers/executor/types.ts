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

/** Input handed to {@link ExecutorStorage.writeArtifact}. */
export interface WriteArtifactInput {
  jobId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
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
 */
export interface ExecutorLogEvent {
  event:
    | "claimed"
    | "scanning"
    | "processing"
    | "completed"
    | "failed"
    | "requeued"
    | "canceled"
    | "no_processor"
    | "input_missing";
  jobId: string;
  tool: string;
  attempt: number;
  errorCode?: string;
}
