/**
 * The honest boundary between the web app's route handlers and whatever backend
 * is active in this environment (none, a remote worker, or the local dev
 * worker). Implementations must never fabricate a completed job or hand out an
 * upload slot they cannot honor — the type here makes that the only expressible
 * outcome shape.
 */

import type {
  ApiError,
  ApiResult,
  CreateJobRequest,
  CreateUploadSessionRequest,
  Job,
  UploadSession,
} from "@/lib/jobs";
import type { WorkerMode } from "./mode";

/**
 * The result of an adapter operation. Mirrors the route contract exactly:
 * success carries the HTTP status the route should use plus the typed value;
 * failure carries a ready-to-send {@link ApiResult} error envelope. This lets
 * route handlers stay one-liners and guarantees an adapter can only ever return
 * an honest, typed outcome — a real value or a real error, never a stub dressed
 * up as success.
 */
export type AdapterOutcome<T> =
  | { ok: true; status: number; value: T }
  | { ok: false; error: ApiResult<ApiError> };

/** Build a successful adapter outcome (defaults to `200 OK`). */
export function adapterOk<T>(value: T, status = 200): AdapterOutcome<T> {
  return { ok: true, status, value };
}

/** Wrap a ready-to-send error envelope as a failed adapter outcome. */
export function adapterError<T = never>(
  error: ApiResult<ApiError>,
): AdapterOutcome<T> {
  return { ok: false, error };
}

/**
 * A processing backend. The three request-shaped methods take the already
 * validated contract objects from `@/lib/jobs` and return typed outcomes; the
 * route handlers do nothing but serialize what these return.
 */
export interface WorkerAdapter {
  /** Which mode produced this adapter — useful for diagnostics and tests. */
  readonly mode: WorkerMode;
  createUploadSession(
    request: CreateUploadSessionRequest,
  ): Promise<AdapterOutcome<UploadSession>>;
  createJob(request: CreateJobRequest): Promise<AdapterOutcome<Job>>;
  getJob(jobId: string): Promise<AdapterOutcome<Job>>;
  /**
   * Cancel an in-flight job and/or delete its outputs now — the user's honest
   * "stop and delete my data" control (see `DELETE /api/jobs/:id`). With no
   * backend this returns the same not-configured / not-implemented error as
   * every other operation; it never pretends to have deleted a job that never
   * existed.
   */
  cancelJob(jobId: string): Promise<AdapterOutcome<Job>>;
}
