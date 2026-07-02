/**
 * API contracts for server-side PDF processing.
 *
 * These types define the honest boundary between the pdf.xyz web app and the
 * processing engine(s) that will run heavy or AI-assisted operations. The
 * client-side tools (merge, split, rotate, image conversions, etc.) never touch
 * this API — they run in the browser. Everything typed here is
 * IMPLEMENTATION-READY: the shapes are stable, but the workers that fulfil them
 * are added in a later phase. Route handlers currently return `501` with this
 * contract so integrators know exactly what to build against.
 */

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

/** A request to run a server/AI tool against one or more inputs. */
export interface ProcessRequest {
  /** Tool slug, e.g. "compress-pdf". Must exist in the catalog. */
  tool: string;
  /** References to already-uploaded inputs (see UploadTicket). */
  inputs: string[];
  /** Tool-specific options (compression level, target language, etc.). */
  options?: Record<string, unknown>;
  /** Optional idempotency key so retries don't double-charge or double-run. */
  idempotencyKey?: string;
}

/** A short-lived, pre-signed slot the client uploads a file into directly. */
export interface UploadTicket {
  id: string;
  /** Pre-signed URL for a direct, encrypted PUT. */
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  /** ISO-8601 expiry. Tickets are single-use and short-lived. */
  expiresAt: string;
}

/** The state of a processing job, returned by submit + status endpoints. */
export interface ProcessJob {
  id: string;
  tool: string;
  status: JobStatus;
  /** 0–100 progress for long-running jobs. */
  progress: number;
  /** Present when status === "completed". Signed, expiring download URLs. */
  outputs?: {
    id: string;
    filename: string;
    contentType: string;
    bytes: number;
    url: string;
  }[];
  error?: { code: string; message: string };
  createdAt: string;
  /** When the job's outputs are auto-deleted. Privacy-by-default. */
  expiresAt: string;
}

/** Standard error envelope for all API routes. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Link to the contract / docs for this endpoint. */
    docs?: string;
  };
}

/** Marker used by not-yet-implemented route handlers. */
export const NOT_IMPLEMENTED: ApiError = {
  error: {
    code: "not_implemented",
    message:
      "This processing engine is implementation-ready but not yet enabled. See ProcessRequest/ProcessJob contracts.",
    docs: "/tools",
  },
};
