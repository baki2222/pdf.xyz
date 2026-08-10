/**
 * The **internal artifact-retrieval seam**: the tiny contract a download boundary reads
 * one artifact through, plus the pure orchestrator that maps a backend's lifecycle-tagged
 * result onto the Phase 38 {@link decideArtifactAccess} policy.
 *
 * Phase 38 hardened the LOCAL-dev download route against an in-process store. Phase 39
 * generalizes the *source*: a backend is anything that can resolve an opaque handle to a
 * bounded {@link ArtifactRetrievalResult} — the developer store, or a configured object
 * bucket read server-side. Both funnel through {@link decideRetrieval} → `decideArtifactAccess`,
 * so local-dev and storage-backed artifacts get byte-identical access checks, safe
 * generated headers, and a content-free denial taxonomy. The bytes are streamed through
 * THIS app server; a signed object-store URL is never exposed to the client.
 *
 * This module is a pure, node-free leaf (types + one total function, no I/O, no clock, no
 * Node built-in): the concrete backends live in `./retrieval-source` (which touches the
 * store / the signer) and the route glue in the app layer, so the decision logic is unit
 * tested in isolation exactly like the access policy it wraps. Nothing here — or in any
 * `ArtifactRetrievalResult` a backend returns — carries a filename, object key, signed
 * URL, bucket name, endpoint, job/user id (beyond the caller-opaque binding handle the
 * backend already resolved), token, OCR text, or document byte.
 */

import {
  DEFAULT_ARTIFACT_ACCESS_POLICY,
  decideArtifactAccess,
  deniedArtifactAccess,
  type ArtifactAccessDecision,
  type ArtifactAccessPolicy,
  type RetrievalStorageCapability,
} from "./access";
import type { ArtifactManifest } from "./types";

/**
 * The content-free descriptor of a LIVE artifact a backend resolved: the bytes to stream
 * plus exactly the bounded facts {@link decideArtifactAccess} needs. Projected by the
 * backend from its stored entry / object — never a filename, key, URL, path, or (beyond
 * the opaque `jobId`) an identifier.
 */
export interface RetrievedArtifact {
  /** The raw stored content-type (re-normalized by the access layer; never surfaced verbatim). */
  readonly contentType: string;
  /** The artifact's actual byte length (cross-checked against the manifest when present). */
  readonly byteLength: number;
  /** The bytes to stream. `byteLength` MUST equal `bytes.byteLength`. */
  readonly bytes: Uint8Array;
  /**
   * OPTIONAL length the UPSTREAM provider declared for the object (e.g. an object
   * store's `Content-Length` response header), for the delivery layer to cross-check
   * against the actual bytes before emitting a `Content-Length` header. Absent/`null`
   * when the source reports no separate provider length (the in-process developer
   * store). A content-free byte COUNT, never a size the client did not already receive.
   */
  readonly reportedLength?: number | null;
  /** The content-free provenance manifest recorded at publish, or `null` if none. */
  readonly manifest: ArtifactManifest | null;
  /** Whether the owning job is in a completed/downloadable state. */
  readonly jobCompleted: boolean;
  /**
   * OPTIONAL owning-job handle, present ONLY for a backend with a server-side job record
   * (the developer store). Enables the caller's opt-in `?job=` integrity cross-check; a
   * storage-backed object has no such record, so it is absent and the binding is skipped.
   */
  readonly jobId?: string;
}

/**
 * The lifecycle-tagged outcome of reading one artifact from a backend, mapped 1:1 to the
 * access layer's {@link import("./access").ArtifactLifecycle} plus a transient
 * `unavailable`:
 *  - `live`        — a non-expired object exists; its content-free descriptor is carried;
 *  - `expired`     — an object existed but its retention window has passed (→ 410);
 *  - `deleted`     — an object was explicitly deleted before its window (→ 410);
 *  - `absent`      — no object (unknown handle, reaped, or a 404 from the bucket) (→ 404);
 *  - `unavailable` — the backend IS configured but the read failed transiently (→ 503,
 *                    retryable). Distinct from a not-ready backend (`storage_unavailable`).
 */
export type ArtifactRetrievalResult =
  | { readonly kind: "live"; readonly artifact: RetrievedArtifact }
  | { readonly kind: "expired" }
  | { readonly kind: "deleted" }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable" };

/**
 * A source the retrieval boundary reads one artifact from. `capability()` reports the
 * key-free storage capability (fed to the access layer's readiness gate); `fetch` resolves
 * an opaque handle to a bounded {@link ArtifactRetrievalResult}. Implemented by the
 * developer store and the storage-backed object reader (`./retrieval-source`).
 */
export interface ArtifactRetrievalBackend {
  capability(): RetrievalStorageCapability;
  fetch(artifactId: string): Promise<ArtifactRetrievalResult>;
}

/** A retrieval decision plus the bytes to stream (present iff `decision.ok`). */
export interface RetrievalDecision {
  readonly decision: ArtifactAccessDecision;
  readonly bytes?: Uint8Array;
  /**
   * The upstream-provider-declared length carried through on a served decision (or
   * `null` when the source reports none), for the delivery layer to cross-check the
   * emitted `Content-Length` against. Absent on a denial (no bytes are served).
   */
  readonly reportedLength?: number | null;
}

/**
 * Map a backend's lifecycle-tagged result onto the Phase 38 access policy, in the same
 * deterministic precedence for every source:
 *
 *   transient error → storage readiness → lifecycle → job ready → job binding
 *   → manifest re-validation (or intrinsic checks) → served
 *
 * The ONLY reason produced here directly is the transient `storage_error` (it arises
 * before a pure descriptor exists); every other outcome flows through `decideArtifactAccess`,
 * so the storage-readiness gate, the lifecycle mapping, and the manifest re-validation are
 * shared verbatim with the local path. Pure and total; never throws.
 */
export function decideRetrieval(
  result: ArtifactRetrievalResult,
  storage: RetrievalStorageCapability,
  assertedJob: string | null = null,
  policy: ArtifactAccessPolicy = DEFAULT_ARTIFACT_ACCESS_POLICY,
): RetrievalDecision {
  // A configured backend that hiccupped transiently: retryable, and deliberately
  // distinct from a not-configured backend (which the readiness gate denies below).
  if (result.kind === "unavailable") {
    return { decision: deniedArtifactAccess("storage_error") };
  }

  // A non-live lifecycle: hand the access layer the bounded lifecycle with empty
  // descriptor fields. Storage readiness is still enforced first, so a not-ready backend
  // denies `storage_unavailable` before any lifecycle distinction is revealed.
  if (result.kind !== "live") {
    return {
      decision: decideArtifactAccess(
        {
          lifecycle: result.kind, // "absent" | "deleted" | "expired"
          jobCompleted: true,
          contentType: "",
          byteLength: 0,
          manifest: null,
          storage,
        },
        policy,
      ),
    };
  }

  const { artifact } = result;
  // The `?job=` binding is a caller-opted integrity cross-check, never access control.
  // Only a backend with a server-side job record carries a `jobId`; a storage-backed
  // object has none, so the binding is simply skipped (it never gates access).
  const jobBinding =
    artifact.jobId && assertedJob
      ? { asserted: true as const, matches: assertedJob === artifact.jobId }
      : undefined;

  const decision = decideArtifactAccess(
    {
      lifecycle: "live",
      jobCompleted: artifact.jobCompleted,
      contentType: artifact.contentType,
      byteLength: artifact.byteLength,
      manifest: artifact.manifest,
      storage,
      ...(jobBinding ? { jobBinding } : {}),
    },
    policy,
  );

  return decision.ok
    ? {
        decision,
        bytes: artifact.bytes,
        reportedLength: artifact.reportedLength ?? null,
      }
    : { decision };
}
