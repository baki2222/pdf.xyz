/**
 * The **storage-backed artifact-retrieval backend**: an {@link ArtifactRetrievalBackend}
 * that reads a produced artifact's bytes (and its content-free provenance manifest) from a
 * configured S3-compatible bucket SERVER-SIDE, so they stream through the same Phase 38
 * access/header/denial layer as a local-dev download.
 *
 * This is the production counterpart of the developer store's in-process read. It signs a
 * short-lived GET for the artifact object exactly as the worker executor storage signs its
 * input reads (`../executor/s3-storage`), reusing the shared key derivation + signer so the
 * object it reads is byte-for-byte the one the worker wrote. Crucially it never hands the
 * client a signed URL: the bytes are proxied through THIS app server, so nothing about the
 * bucket, key, endpoint, region, or signature ever reaches the browser. The manifest travels
 * as content-free object metadata (`./s3-manifest-metadata` ← the worker signs it on the
 * PUT), so provenance can be re-validated on download without a side table.
 *
 * Lifecycle enforcement (Phase 41): a bucket cannot itself tell a live object from an
 * expired-but-not-yet-reaped one — both answer a GET `200`. So the worker signs the artifact's
 * retention window (and, where a deployment records one, a deletion tombstone) as content-free
 * object metadata (`../storage/s3-lifecycle-metadata`), and on the `200` this reader decodes
 * that evidence and evaluates it against its clock ({@link evaluateArtifactLifecycle}) BEFORE
 * reading the body — so a logically-expired or tombstoned object is denied `410 Gone` even in
 * the window before the bucket lifecycle rule physically reaps it, and its bytes are never even
 * buffered. Absent/unknown evidence (a legacy object, or storage that strips user-metadata) is
 * served honestly — never reported as deleted — with the bucket lifecycle rule as the eventual
 * backstop (surfacing as an honest `404`/`absent`). This app-level denial is distinct from, and
 * additional to, both that bucket backstop and any active delete-now the executor performs.
 *
 * Failure taxonomy (mapped to the retrieval lifecycle, all content-free):
 *  - a genuine `404` → `absent` (an object actively deleted, reaped by the lifecycle backstop,
 *    or never-existed — honestly indistinguishable, the honest 404 semantic);
 *  - metadata evidence of a passed retention window → `expired`; of a tombstone → `deleted`
 *    (both `410 Gone`, denied before the body is read);
 *  - a transient error (5xx, network, malformed body) → `unavailable` (retryable `503`,
 *    NEVER a false `not_found`);
 *  - a well-formed `200` with live/absent lifecycle evidence → `live` with the fetched bytes,
 *    content-type, and decoded manifest.
 *
 * Node-only: it pulls the `node:crypto` signer, so it is constructed by the storage-backed
 * download route (and its tests), never a client bundle. `env` and the object transport are
 * injectable, so no test ever touches real S3.
 */

import { isWorkerBackendConfigured } from "@/lib/jobs";
import { buildObjectKey, signingTarget } from "../storage/s3-keys";
import { parseS3Config, type S3StorageConfig } from "../storage/s3-config";
import {
  ARTIFACT_MANIFEST_METADATA_HEADER,
  decodeArtifactManifestMetadata,
} from "../storage/s3-manifest-metadata";
import {
  ARTIFACT_LIFECYCLE_METADATA_HEADER,
  decodeArtifactLifecycleMetadata,
} from "../storage/s3-lifecycle-metadata";
import { presignS3Url } from "../storage/s3-signer";
import {
  evaluateArtifactLifecycle,
  type StorageArtifactLifecycle,
} from "./lifecycle";
import { recordArtifactExpiry } from "./expiry-metrics";
import { emitArtifactExpiryReceipt } from "./expiry-receipt";
import type { ArtifactManifest } from "./types";
import type { RetrievalStorageCapability } from "./access";
import type {
  ArtifactRetrievalBackend,
  ArtifactRetrievalResult,
} from "./retrieval";

type EnvSource = Record<string, string | undefined>;

// A worker-side GET is executed immediately; a small signed window covers clock skew
// without leaving a long-lived signed link lying around.
const READ_TTL_SECONDS = 300;
const FALLBACK_CONTENT_TYPE = "application/octet-stream";
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{10,64}$/;

/**
 * The minimal object transport the reader needs to GET bytes from the bucket — a narrow
 * subset of the global `fetch`/`Response` shape (not the DOM types), so a test injects a
 * stub without the DOM lib and the module never assumes a browser runtime. The global
 * `fetch` satisfies it directly.
 */
export interface S3ArtifactObjectResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type S3ArtifactFetch = (
  url: string,
  init: { method: "GET" },
) => Promise<S3ArtifactObjectResponse>;

/** Injectable seams so the reader is fully testable with a fake clock/network. */
export interface S3ArtifactReaderDeps {
  now?: () => number;
  /** Transport for the signed GET; defaults to the global `fetch`. */
  fetchImpl?: S3ArtifactFetch;
}

/**
 * The typed outcome of reading one artifact object from the bucket. `expired`/`deleted` are
 * lifecycle denials resolved from the object's signed lifecycle metadata BEFORE its body is
 * read (so the bytes of a gone artifact are never buffered); `not-found` is a genuine bucket
 * `404`; `unavailable` is a transient failure. An `ok` read only ever carries a live/absent-
 * evidence object.
 */
export type S3ArtifactRead =
  | {
      readonly status: "ok";
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly manifest: ArtifactManifest | null;
      /**
       * The length the bucket DECLARED in the object's `Content-Length` response
       * header, parsed to a bounded byte count, or `null` when absent/malformed. The
       * delivery layer cross-checks it against the actual bytes before emitting a
       * `Content-Length` — so a truncated / over-declared object is refused, never
       * streamed under a header that lies about its size.
       */
      readonly reportedLength: number | null;
      /**
       * The resolved lifecycle state for this SERVED read — always `live` (evidence
       * records a window that has not passed) or `unknown` (the present object carries no
       * usable lifecycle evidence). `expired`/`deleted` never reach an `ok` read (they
       * short-circuit above), so they are excluded here. Carried ONLY so the backend can
       * emit the bounded lifecycle observation distinguishing "served fresh" from "served
       * with no evidence" (the missing-metadata drift signal); it never gates delivery.
       */
      readonly lifecycleState: Extract<
        StorageArtifactLifecycle,
        "live" | "unknown"
      >;
    }
  | { readonly status: "expired" }
  | { readonly status: "deleted" }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" };

/** The server-side artifact object reader: resolve an opaque handle to bucket bytes. */
export interface S3ArtifactReader {
  readArtifact(artifactId: string): Promise<S3ArtifactRead>;
}

const defaultFetch: S3ArtifactFetch = (url, init) =>
  fetch(url, {
    method: init.method,
  }) as unknown as Promise<S3ArtifactObjectResponse>;

/**
 * Parse a raw `Content-Length` response header into a bounded, non-negative integer
 * byte count, or `null` when absent or not a plain base-10 integer. Never throws; the
 * value is only ever used as a cross-check against the actual bytes, so a malformed
 * header simply means "provider declared no usable length" (the delivery layer then
 * verifies against the actual bytes alone).
 */
function parseContentLength(raw: string | null): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Build the S3 artifact reader from a validated config. The config holds the signing
 * secret; it is captured in this closure and never logged, serialized, or returned. The
 * reader never throws: a transient failure resolves to `unavailable`, so the retrieval
 * layer denies a retryable `503` rather than a false `not_found`.
 */
export function createS3ArtifactReader(
  config: S3StorageConfig,
  deps: S3ArtifactReaderDeps = {},
): S3ArtifactReader {
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetchImpl ?? defaultFetch;

  const sign = (key: string): string => {
    const { host, path } = signingTarget(config, key);
    return presignS3Url({
      method: "GET",
      protocol: config.protocol,
      host,
      path,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
      date: new Date(now()),
      expiresSeconds: READ_TTL_SECONDS,
    }).url;
  };

  return {
    async readArtifact(artifactId: string): Promise<S3ArtifactRead> {
      // The handle is already shape-checked by the route, but re-validate defensively so a
      // malformed id can never be shaped into an unexpected bucket key.
      if (!ARTIFACT_ID.test(artifactId)) return { status: "not-found" };

      const key = buildObjectKey(config, "artifact", artifactId);
      const url = sign(key);

      let res: S3ArtifactObjectResponse;
      try {
        res = await fetchImpl(url, { method: "GET" });
      } catch {
        // Network error / DNS / reset: transient, retryable.
        return { status: "unavailable" };
      }

      // A genuine 404 means the object is gone/expired/never-existed → honest not-found.
      if (res.status === 404) return { status: "not-found" };
      // Any other non-2xx is transient (throttling, 5xx): retry, never a false not-found.
      if (!res.ok) return { status: "unavailable" };

      // Lifecycle enforcement — resolved from the object's SIGNED lifecycle metadata (present
      // in the response headers before the body) and this reader's clock. A logically-expired
      // or tombstoned object is denied here, BEFORE its bytes are read, so a gone artifact's
      // body is never buffered. Absent/malformed evidence evaluates to `unknown` → served (the
      // bucket lifecycle rule remains the eventual backstop); never an overclaimed deletion.
      const lifecycle = evaluateArtifactLifecycle(
        decodeArtifactLifecycleMetadata(
          res.headers.get(ARTIFACT_LIFECYCLE_METADATA_HEADER),
        ),
        now(),
      );
      if (lifecycle === "expired") return { status: "expired" };
      if (lifecycle === "deleted") return { status: "deleted" };

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch {
        return { status: "unavailable" };
      }
      const contentType =
        res.headers.get("content-type")?.trim() || FALLBACK_CONTENT_TYPE;
      // Recover the content-free provenance manifest from object metadata when present;
      // a malformed/absent value decodes to `null` (the honest manifest-less path).
      const manifest = decodeArtifactManifestMetadata(
        res.headers.get(ARTIFACT_MANIFEST_METADATA_HEADER),
      );
      // Capture the bucket's declared length for the delivery layer to verify against
      // the actual bytes (never emitted verbatim; only cross-checked).
      const reportedLength = parseContentLength(
        res.headers.get("content-length"),
      );
      // `lifecycle` is narrowed to `live` | `unknown` here (expired/deleted returned above);
      // carry it so the backend can distinguish "served fresh" from "served with no evidence".
      return {
        status: "ok",
        bytes,
        contentType,
        manifest,
        reportedLength,
        lifecycleState: lifecycle,
      };
    },
  };
}

/**
 * Fold a read outcome to the bounded {@link StorageArtifactLifecycle} state to OBSERVE, or
 * `null` when there is nothing present to evaluate (a genuine `404`/`absent`, or a transient
 * failure). An `ok` read carries the resolved `live`/`unknown` state; `expired`/`deleted` map
 * to themselves. This is the single source for the lifecycle/expiry metric + drift receipt.
 */
function lifecycleStateToObserve(
  read: S3ArtifactRead,
): StorageArtifactLifecycle | null {
  switch (read.status) {
    case "ok":
      return read.lifecycleState; // "live" | "unknown"
    case "expired":
      return "expired";
    case "deleted":
      return "deleted";
    default:
      return null; // not-found / unavailable — no present object to evaluate
  }
}

/**
 * Wrap a server-side artifact reader into an {@link ArtifactRetrievalBackend}. A read maps
 * to the retrieval lifecycle: `ok` → `live` (an object exists only for a completed job, so
 * `jobCompleted` is true and there is no server-side `?job=` record to bind against);
 * `expired`/`deleted` → the matching lifecycle denial (`410 Gone`, resolved from the object's
 * lifecycle metadata before its body was read); `not-found` → `absent`; `unavailable` → the
 * transient outcome.
 *
 * For every read that touched a PRESENT object (served, expired, or tombstoned) it also emits
 * one bounded, content-free lifecycle/expiry observation — a metric + drift receipt carrying
 * only the resolved state and the storage provider. An `expired`/`deleted` observation IS the
 * "present after the app retention window / tombstoned" drift signal; `unknown` is the
 * missing-lifecycle-metadata signal. Observability never gates the outcome and a throwing sink
 * can never break a download (the emitters swallow their own errors).
 */
export function createStorageArtifactBackend(
  reader: S3ArtifactReader,
  capability: RetrievalStorageCapability,
): ArtifactRetrievalBackend {
  return {
    capability() {
      return capability;
    },
    async fetch(artifactId: string): Promise<ArtifactRetrievalResult> {
      const read = await reader.readArtifact(artifactId);

      // Observe the resolved lifecycle state for any read that saw a present object. This is
      // the ONLY place the served-fresh (`live`) vs no-evidence (`unknown`) distinction still
      // exists — by the time a result reaches the shared serve layer both are `kind: "live"`.
      // Best-effort: observability must NEVER turn a valid download into a failure, so a
      // throwing collector sink is swallowed here (the receipt observer already self-guards).
      const observed = lifecycleStateToObserve(read);
      if (observed !== null) {
        try {
          recordArtifactExpiry(observed, capability.provider);
          emitArtifactExpiryReceipt({
            state: observed,
            provider: capability.provider,
          });
        } catch {
          // A misbehaving metrics collector can never break the download.
        }
      }

      if (read.status === "expired") return { kind: "expired" };
      if (read.status === "deleted") return { kind: "deleted" };
      if (read.status === "not-found") return { kind: "absent" };
      if (read.status === "unavailable") return { kind: "unavailable" };
      return {
        kind: "live",
        artifact: {
          contentType: read.contentType,
          byteLength: read.bytes.byteLength,
          bytes: read.bytes,
          // The bucket's declared length, for the delivery layer to verify before it
          // emits a `Content-Length` (a mismatch fails closed, never streams a lie).
          reportedLength: read.reportedLength,
          manifest: read.manifest,
          jobCompleted: true,
          // No server-side job→artifact record for a bucket object, so no `jobId`: the
          // caller's `?job=` binding is honestly skipped (it is never access control).
        },
      };
    },
  };
}

/**
 * A not-ready backend for when storage is absent or half-configured. Its `capability` is
 * never `ready`, so the access layer denies `storage_unavailable` (503) before any fetch —
 * `fetch` is defined only to satisfy the seam and never runs on the ready path. The
 * provider label mirrors the honest posture WITHOUT fingerprinting which variables are set.
 */
function notConfiguredBackend(env: EnvSource): ArtifactRetrievalBackend {
  const capability: RetrievalStorageCapability = {
    provider: isWorkerBackendConfigured(env)
      ? "remote-configured"
      : "not-configured",
    ready: false,
  };
  return {
    capability() {
      return capability;
    },
    async fetch(): Promise<ArtifactRetrievalResult> {
      return { kind: "absent" };
    },
  };
}

/**
 * Resolve the storage-backed retrieval backend from the environment: a ready S3 reader
 * backend when — and only when — S3 is explicitly selected AND fully valid; otherwise the
 * honest not-ready backend, so a missing or half-configured bucket can only ever yield a
 * `storage_unavailable` (503) denial, never a fabricated stream. `deps` (clock + transport)
 * are forwarded to the S3 reader for tests. Never reads or returns a secret value.
 */
export function resolveArtifactRetrievalBackend(
  env: EnvSource = process.env,
  deps: S3ArtifactReaderDeps = {},
): ArtifactRetrievalBackend {
  const parsed = parseS3Config(env);
  if (!parsed.ok) return notConfiguredBackend(env);
  const reader = createS3ArtifactReader(parsed.config, deps);
  return createStorageArtifactBackend(reader, {
    provider: "remote-configured",
    ready: true,
  });
}

// Module-global, swappable backend override — the same reset-for-tests posture the
// retrieval metric sink and receipt observer use. Default null: the route resolves the real
// backend from the environment; a route test points this at a fake to exercise the shared
// serve path without touching real S3.
let backendOverride: ArtifactRetrievalBackend | null = null;

/** Point the storage-backed download route at `backend` (a fake) for a test. */
export function setArtifactRetrievalBackendForTests(
  backend: ArtifactRetrievalBackend,
): void {
  backendOverride = backend;
}

/** Restore the default (env-resolved) backend. Named for test isolation. */
export function resetArtifactRetrievalBackendForTests(): void {
  backendOverride = null;
}

/**
 * The backend the storage-backed download route serves from: the test override when one is
 * registered, else the env-resolved backend. This is the single call the route makes.
 */
export function storageArtifactBackend(
  env: EnvSource = process.env,
): ArtifactRetrievalBackend {
  return backendOverride ?? resolveArtifactRetrievalBackend(env);
}
