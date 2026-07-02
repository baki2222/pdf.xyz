/**
 * The typed contract for the secure-worker **object-storage provider** — the
 * component *behind* the worker adapter that mints signed upload/download
 * targets and enforces delete-now on ephemeral, encrypted objects.
 *
 * This is a pure contract: no Next.js, no network, no `fetch`. A real deployment
 * implements {@link StorageProvider} against S3/GCS/R2 (pre-signed URLs +
 * lifecycle deletion); this build ships a not-configured provider (the honest
 * default) and a developer-only in-process provider. The interface is the same
 * for all three, so the route/adapter layer above it can never tell a stub from
 * the real thing by accident — a not-configured provider can only return a typed
 * failure, never a usable target.
 *
 * The app server performs exactly three storage operations, all modeled here:
 * reserve an upload target, reserve a download target, and delete an object now.
 * It never streams object bytes itself — in production the browser uploads
 * straight to the bucket and downloads straight from a signed URL. (The
 * developer transport that stands in for that lives in the local-dev store, not
 * in this contract.)
 */

import type { FieldError } from "@/lib/jobs";

/** Which concrete provider produced an outcome — for diagnostics and tests. */
export type StorageProviderId =
  | "disabled" // no storage wired; every op is an honest not_configured
  | "remote-unimplemented" // bucket configured but this build ships no client
  | "local-dev"; // developer-only in-process store

/**
 * Why a storage operation could not be honored. Framework-agnostic: the adapter
 * layer maps each reason to an HTTP status; the provider never speaks HTTP.
 */
export type StorageFailureReason =
  | "not_configured" // no storage provider in this environment
  | "not_implemented" // provider configured, but no client shipped in this build
  | "not_found" // object missing or past its retention window
  | "payload_too_large"; // object exceeds the enforced ceiling

export interface StorageFailure {
  reason: StorageFailureReason;
  /** Client-safe message. Never names a variable or leaks a value. */
  message: string;
  details?: FieldError[];
}

/** A provider operation result: a typed value, or a typed, honest failure. */
export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageFailure };

// ─────────────────────────────── Upload target ───────────────────────────────

/** What the app knows about a file before a single byte is transferred. */
export interface ReserveUploadRequest {
  /** Groups slots from one upload session (for storage partitioning). */
  sessionId: string;
  filename: string;
  contentType: string;
  /** Client-declared size; the provider enforces its own hard ceiling too. */
  declaredBytes: number;
}

/** A single-use, pre-signed target the client PUTs/POSTs exactly one file to. */
export interface SignedUploadTarget {
  url: string;
  method: "PUT" | "POST";
  /** Headers the client must echo on the upload request. */
  headers: Record<string, string>;
  /** Hard byte ceiling the storage layer enforces on the stored object. */
  maxBytes: number;
}

export interface UploadReservation {
  /** Opaque id the client later lists in a job's `inputs`. */
  fileId: string;
  filename: string;
  contentType: string;
  target: SignedUploadTarget;
  /** ISO-8601: the target and the reserved slot are short-lived and single-use. */
  expiresAt: string;
}

// ────────────────────────────── Download target ──────────────────────────────

/** A request to mint a signed, expiring download URL for a produced artifact. */
export interface ReserveDownloadRequest {
  artifactId: string;
  filename: string;
  contentType: string;
}

/** A signed, expiring GET target for exactly one artifact. */
export interface SignedDownloadTarget {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  /** ISO-8601 auto-expiry of the signed link. */
  expiresAt: string;
}

export interface DownloadReservation {
  artifactId: string;
  target: SignedDownloadTarget;
  expiresAt: string;
}

// ─────────────────────────────────── Delete ──────────────────────────────────

/** The two object namespaces a delete-now can target. */
export type StorageObjectKind = "input" | "artifact";

/** The receipt of a delete-now. `deleted` is idempotent: already-gone counts. */
export interface DeleteReceipt {
  kind: StorageObjectKind;
  id: string;
  deleted: boolean;
  /** ISO-8601 time the object was confirmed gone. */
  deletedAt: string;
}

// ───────────────────────────────── Capability ────────────────────────────────

/** The honest, client-safe status of the storage provider in this environment. */
export interface StorageCapability {
  provider: StorageProviderId;
  /** True only when the provider can serve reserve/delete operations now. */
  ready: boolean;
  /** Infra present in env but no live client shipped (remote-unimplemented). */
  configured: boolean;
  signedUploads: boolean;
  signedDownloads: boolean;
  deleteNow: boolean;
  /** One-line, client-safe explanation. Never names a variable or a value. */
  detail: string;
}

/**
 * The object-storage provider. Every method returns a typed {@link StorageResult}
 * so the only expressible not-configured outcome is an honest failure — a
 * disabled provider physically cannot return a usable upload/download target.
 */
export interface StorageProvider {
  readonly id: StorageProviderId;
  /**
   * Readiness gate. `ok` when the provider can serve requests; otherwise the
   * typed not_configured / not_implemented failure the adapter maps to HTTP.
   * Lets the adapter answer honestly without constructing a dummy request.
   */
  probe(): StorageResult<void>;
  reserveUpload(
    request: ReserveUploadRequest,
  ): Promise<StorageResult<UploadReservation>>;
  reserveDownload(
    request: ReserveDownloadRequest,
  ): Promise<StorageResult<DownloadReservation>>;
  deleteNow(
    kind: StorageObjectKind,
    id: string,
  ): Promise<StorageResult<DeleteReceipt>>;
  capability(): StorageCapability;
}

/**
 * The static capability of the developer-only in-process storage provider.
 * Kept here (a node-free leaf) so both the provider and the presence-only status
 * reporter can share it without pulling the in-process store's Node built-ins.
 */
export const LOCAL_DEV_STORAGE_CAPABILITY: StorageCapability = {
  provider: "local-dev",
  ready: true,
  configured: false,
  signedUploads: true,
  signedDownloads: true,
  deleteNow: true,
  detail:
    "Local-dev object storage is active: uploads, downloads, and delete-now run in-process on this machine — nothing is sent to any third party. Not for production.",
};

/** Build a successful storage result. */
export function storageOk<T>(value: T): StorageResult<T> {
  return { ok: true, value };
}

/** Build a failed storage result. */
export function storageFail<T = never>(
  reason: StorageFailureReason,
  message: string,
  details?: FieldError[],
): StorageResult<T> {
  return { ok: false, error: { reason, message, ...(details ? { details } : {}) } };
}
