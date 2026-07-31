/**
 * The **artifact-retrieval access policy**: the bounded, content-free decision the
 * client-facing download boundary makes BEFORE it streams a produced output — the
 * retrieval counterpart to the publish-time manifest gate (`./manifest`).
 *
 * Where the manifest gate proves an output is publishable, this layer proves a
 * *handle a client presented* still maps to a completed, non-expired output that is a
 * recognized, downloadable, non-empty kind — and, when it does, generates the safe,
 * deterministic response headers the byte stream is served with. When a content-free
 * provenance {@link ArtifactManifest} was recorded at publish (the shipped default),
 * it is additionally re-validated for self-consistency, so the boundary is strongest
 * exactly when provenance exists. A denial always carries one of a closed set of
 * stable, content-free reasons.
 *
 * It is a pure, node-free leaf (data + tiny functions, no I/O, no clock, no Node
 * built-in), exactly like the manifest evaluation it mirrors, so the download route
 * and the local-dev adapter both delegate to it and it is unit-tested in isolation.
 * The caller does the store lookup and hands this layer only a bounded
 * {@link RetrievableArtifact} descriptor; nothing here ever sees — let alone returns
 * — a filename, object key, signed URL, job/user id, temp path, token, or document
 * byte.
 *
 * Honesty rules — load-bearing, mirrored across the worker layer:
 *  - a retrieval PASS is only a bounded structural + lifecycle eligibility check. It
 *    is NOT authentication, NOT authorization, NOT malware scanning, NOT
 *    sanitization, NOT a proof the bytes were deleted — it never claims any of those.
 *    It re-validates provenance ONLY when a manifest was recorded, and never claims
 *    provenance validation for a manifest-less output. This boundary has NO auth model:
 *    possession of the unguessable opaque handle is the capability (the signed-URL
 *    posture); the optional `?job=` binding is a caller-opted integrity cross-check that
 *    never GATES access, not access control;
 *  - every field of a decision is content-free: a bounded reason enum, a bounded
 *    output kind, a normalized content-type, a byte COUNT (the same figure the client
 *    already holds on its download record), a GENERATED filename derived only from the
 *    output kind + processor family, and fixed header strings — never user input;
 *  - the generated `Content-Disposition` filename is built from a closed vocabulary,
 *    so a hostile original filename can never reach a response header.
 */

import { normalizeContentType } from "@/lib/uploads/intake";
import type { ApiErrorCode } from "@/lib/jobs";
import { ARTIFACT_POLICY_ID } from "./policy";
import { outputKindForContentType } from "./manifest";
import type { ArtifactManifest, ArtifactOutputKind } from "./types";
import type { ProcessorKind } from "../observability/metrics";

/** Canonical opaque artifact-handle shape: `art_` + 10–64 url-safe chars. Source of truth. */
const ARTIFACT_HANDLE = /^art_[A-Za-z0-9_-]{10,64}$/;

/**
 * True if `handle` is a syntactically valid opaque artifact handle. A shape check
 * only — it proves nothing about existence, and by construction reveals nothing
 * about the storage layout (the handle is an opaque id, never a key or path).
 */
export function isValidArtifactHandle(handle: unknown): handle is string {
  return typeof handle === "string" && ARTIFACT_HANDLE.test(handle);
}

/**
 * The lifecycle state the store reports for a presented handle, without leaking why:
 *  - `live`    — a non-expired entry exists;
 *  - `expired` — an entry existed but its retention window has passed (auto-deleted);
 *  - `deleted` — an entry was explicitly deleted before its window elapsed (tombstoned);
 *  - `absent`  — no entry (unknown handle, or reaped past the tombstone horizon).
 * `expired` and `deleted` are the two "provably was here, gone now" states (410 Gone);
 * `absent` is "never here / no longer known" (404).
 */
export type ArtifactLifecycle = "live" | "expired" | "deleted" | "absent";

/**
 * The bounded storage-provider capability the download boundary reports — the same
 * three-way distinction the worker layer uses elsewhere, carried WITHOUT any object
 * key, bucket, region, URL, or endpoint. Optional input to a decision: when the caller
 * (e.g. a route that has already gated on local-dev mode) omits it, the storage check is
 * skipped; when present and not `ready`, the boundary denies `storage_unavailable`.
 */
export const RETRIEVAL_STORAGE_PROVIDERS = [
  "local-dev",
  "remote-configured",
  "not-configured",
] as const;
export type RetrievalStorageProvider =
  (typeof RETRIEVAL_STORAGE_PROVIDERS)[number];

/** The honest, key-free storage capability a retrieval decision may be evaluated against. */
export interface RetrievalStorageCapability {
  /** The bounded provider id (never a bucket/region/endpoint). */
  readonly provider: RetrievalStorageProvider;
  /** True only when this boundary can actually serve a download now. */
  readonly ready: boolean;
}

/**
 * The bounded, content-free reason taxonomy for a retrieval decision. `ok` accompanies
 * a served artifact; the rest are the closed set of denial reasons. Every value is a
 * stable internal code — never a filename, key, URL, id, size, path, or document byte.
 */
export const ARTIFACT_ACCESS_REASONS = [
  "ok", // served: the handle maps to a completed, valid, downloadable output
  "malformed_handle", // the presented handle is not a syntactically valid opaque id
  "storage_unavailable", // the storage backend cannot serve downloads here (not configured → 503)
  "storage_error", // storage IS configured but the read failed transiently — retry later (→ 503)
  "policy_unavailable", // the guardrail could not resolve a usable policy — fails closed (→ 503)
  "not_found", // no artifact for this handle (unknown or reaped)
  "deleted", // the artifact was explicitly deleted before its window elapsed (→ 410)
  "not_ready", // the owning job is not in a completed/downloadable state
  "expired", // the artifact existed but its retention window has passed (→ 410)
  "job_mismatch", // the artifact does not belong to the job the request asserted (→ 403)
  "missing_manifest", // no provenance manifest recorded (stricter posture requires one)
  "invalid_manifest", // a manifest is present but fails structural re-validation
  "unsupported_kind", // the output kind is not a recognized, downloadable kind
  "empty_artifact", // the output has zero bytes
] as const;
export type ArtifactAccessReason = (typeof ARTIFACT_ACCESS_REASONS)[number];

/** The reasons that accompany a DENIED decision (everything but `ok`). */
export type ArtifactAccessDenyReason = Exclude<ArtifactAccessReason, "ok">;

/** The coarse outcome of a retrieval decision, for low-cardinality observability. */
export const ARTIFACT_RETRIEVAL_OUTCOMES = ["served", "denied"] as const;
export type ArtifactRetrievalOutcome =
  (typeof ARTIFACT_RETRIEVAL_OUTCOMES)[number];

/** Fold a retrieval reason to its coarse outcome (`ok` ⇒ served, else denied). */
export function retrievalOutcomeFor(
  reason: ArtifactAccessReason,
): ArtifactRetrievalOutcome {
  return reason === "ok" ? "served" : "denied";
}

/**
 * The bounded, content-free descriptor the retrieval boundary hands this layer. The
 * caller (the download route) does the store I/O and projects the stored entry into
 * exactly these fields — never a filename, key, URL, id, path, or byte. `contentType`
 * is the raw stored value (re-normalized here); `byteLength` is the artifact's ACTUAL
 * stored byte length (cross-checked against the manifest when one is present).
 */
export interface RetrievableArtifact {
  /** The store's lifecycle verdict for the presented handle. */
  readonly lifecycle: ArtifactLifecycle;
  /** Whether the owning job is in a completed/downloadable state. */
  readonly jobCompleted: boolean;
  /** The raw stored content-type (re-normalized here; never surfaced verbatim). */
  readonly contentType: string;
  /** The artifact's actual stored byte length. */
  readonly byteLength: number;
  /** The content-free provenance manifest recorded at publish, or `null` if none. */
  readonly manifest: ArtifactManifest | null;
  /**
   * OPTIONAL: the storage backend serving this boundary. When present and not `ready`,
   * the decision is `storage_unavailable`; when omitted (a caller that already gated on
   * storage/mode), the check is skipped.
   */
  readonly storage?: RetrievalStorageCapability;
  /**
   * OPTIONAL: a job-binding assertion — an integrity cross-check, NOT authorization. A
   * client that holds a job id may bind the download to it; when `asserted` and the
   * artifact's owning job does not match, the decision is `job_mismatch`. This never
   * GATES access — a caller with only the opaque handle downloads normally (omitted ⇒
   * skipped); it only refuses a caller's own FALSE explicit claim. The caller compares
   * the ids and passes only the boolean — the raw job ids never cross into this pure layer.
   */
  readonly jobBinding?: {
    /** Whether the caller asserted a job binding at all. */
    readonly asserted: boolean;
    /** Whether the asserted job matches the artifact's owning job (caller-computed). */
    readonly matches: boolean;
  };
}

/**
 * The retrieval access policy. `requireManifest` is the ONE knob: the shipped default
 * (`false`) serves a recognized, non-empty, live output even if the manifest gate was
 * disabled at publish (intrinsic checks still apply, and the boundary honestly does
 * NOT claim provenance validation in that case). A stricter operator posture
 * (`true`) fails closed for a manifest-less output (`missing_manifest`).
 */
export interface ArtifactAccessPolicy {
  readonly requireManifest: boolean;
}

/** The shipped default: do not hard-require a manifest (intrinsic checks are the floor). */
export const DEFAULT_ARTIFACT_ACCESS_POLICY: ArtifactAccessPolicy = Object.freeze({
  requireManifest: false,
});

/** The safe, deterministic response headers a served artifact is streamed with. */
export type ArtifactDownloadHeaders = Readonly<Record<string, string>>;

/**
 * A retrieval decision: either `ok` with the served content-type, output kind, byte
 * length, generated filename, and the safe response headers — or a denial with a
 * bounded reason and a fixed, content-free detail. Never carries user input.
 */
export type ArtifactAccessDecision =
  | {
      readonly ok: true;
      readonly reason: "ok";
      readonly kind: ArtifactOutputKind;
      /** The canonical content-type served (never the raw stored value). */
      readonly contentType: string;
      readonly byteLength: number;
      /** The generated, safe download filename (from kind/processor, never user input). */
      readonly filename: string;
      readonly headers: ArtifactDownloadHeaders;
    }
  | {
      readonly ok: false;
      readonly reason: ArtifactAccessDenyReason;
      /** One-line, content-free explanation. Never a filename, key, size, or content. */
      readonly detail: string;
    };

/** Content-free explanations per denial reason. Never names a file, size, key, or content. */
export const ARTIFACT_ACCESS_DETAIL: Record<ArtifactAccessDenyReason, string> = {
  malformed_handle: "The artifact handle is malformed.",
  storage_unavailable:
    "The artifact storage backend is not available to serve downloads in this environment.",
  storage_error:
    "The artifact storage backend could not be reached to serve this download. Please try again.",
  policy_unavailable:
    "The artifact-retrieval guardrail could not resolve a usable policy, so it failed closed.",
  not_found: "No such artifact (it may have expired).",
  deleted: "This artifact was deleted and is no longer available.",
  not_ready: "The artifact is not ready for download.",
  expired: "This artifact is no longer available; its retention window has passed.",
  job_mismatch: "The artifact does not belong to the job asserted by the request.",
  missing_manifest: "This artifact is not available for download.",
  invalid_manifest: "This artifact is not available for download.",
  unsupported_kind: "This artifact is not available for download.",
  empty_artifact: "This artifact is not available for download.",
};

/**
 * The client-facing {@link ApiErrorCode} each denial maps to. Every code is content-free
 * and reveals no storage internals. The mapping is deliberate:
 *  - a handle that provably existed and is now gone (`expired`/`deleted`) → `410 gone`,
 *    the honest HTTP "was here, permanently gone" semantic. The handle is a high-entropy
 *    opaque capability the caller already holds, so confirming prior existence leaks
 *    nothing exploitable and lets a well-behaved client stop retrying;
 *  - a caller's own FALSE job-binding assertion (`job_mismatch`) → `403 forbidden` (an
 *    integrity cross-check the caller opted into, NOT access control);
 *  - infrastructure/fail-closed (`storage_unavailable`/`policy_unavailable`) → `503`;
 *  - a configured backend that hiccupped transiently (`storage_error`) → `503`
 *    `service_unavailable` — a distinct, retryable code (NOT `worker_not_configured`),
 *    so a well-behaved client learns the difference between "no backend" and "try again";
 *  - everything else — an unknown handle and every structural/provenance refusal
 *    (`not_found`/`missing_manifest`/`not_ready`/`invalid_manifest`/`unsupported_kind`/
 *    `empty_artifact`) — keeps its existing code; the precise internal reason lives only
 *    in the decision + receipt/metric, never widening what the client learns.
 */
const CODE_BY_REASON: Record<ArtifactAccessDenyReason, ApiErrorCode> = {
  malformed_handle: "invalid_request",
  storage_unavailable: "worker_not_configured",
  storage_error: "service_unavailable",
  policy_unavailable: "worker_not_configured",
  not_found: "not_found",
  deleted: "gone",
  not_ready: "conflict",
  expired: "gone",
  job_mismatch: "forbidden",
  missing_manifest: "not_found",
  invalid_manifest: "unprocessable_entity",
  unsupported_kind: "unsupported_media_type",
  empty_artifact: "unprocessable_entity",
};

/** The content-free `{ code, message }` a denial reason maps to for an API response. */
export function httpErrorForAccessReason(reason: ArtifactAccessDenyReason): {
  code: ApiErrorCode;
  message: string;
} {
  return { code: CODE_BY_REASON[reason], message: ARTIFACT_ACCESS_DETAIL[reason] };
}

/**
 * The output kinds a client may legitimately download. `unknown` is excluded — an
 * artifact that classifies to it is denied `unsupported_kind`, so the boundary only
 * ever streams a recognized kind. Kept as a set so it stays closed as kinds grow.
 */
const DOWNLOADABLE_KINDS: ReadonlySet<ArtifactOutputKind> = new Set<ArtifactOutputKind>(
  ["pdf", "text-sidecar", "archive", "office-document", "image"],
);

/** Canonical file extension per bare content-type (inverse of the manifest's kind map). */
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/zip": "zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg", // non-standard JPEG alias some toolchains emit (mirrors the manifest map)
};

/** A generated download filename must match this — a closed, header-safe vocabulary. */
const SAFE_GENERATED_FILENAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * The base noun for a generated download filename, derived ONLY from the bounded
 * output kind and processor family — never from any stored/user name. A `pdf` is
 * named for what produced it (`compressed`/`searchable`); other kinds get a generic,
 * kind-appropriate noun. Total; the result is always a safe lower-case token.
 */
function downloadBaseName(
  kind: ArtifactOutputKind,
  processor: ProcessorKind,
): string {
  switch (kind) {
    case "pdf":
      if (processor === "compress") return "compressed";
      if (processor === "ocr") return "searchable";
      return "document";
    case "text-sidecar":
      return "extracted-text";
    case "archive":
      return "documents";
    case "office-document":
      // The extension (docx/xlsx/pptx) already says which Office format it is, so
      // the base stays a single generic, content-free noun.
      return "document";
    case "image":
      return "image";
    default:
      return "download";
  }
}

/**
 * Build the generated, safe download filename: `<base>.<ext>` where the base comes from
 * the kind/processor and the extension from the canonical content-type. The result is
 * always from a closed ASCII vocabulary; a paranoia guard falls back to a constant if
 * anything ever produced an unsafe token.
 */
export function downloadFilenameFor(
  kind: ArtifactOutputKind,
  contentType: string,
  processor: ProcessorKind,
): string {
  const base = downloadBaseName(kind, processor);
  const ext = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
  const name = `${base}.${ext}`;
  return SAFE_GENERATED_FILENAME.test(name) ? name : "download.bin";
}

/**
 * The content-type a served artifact carries: the canonical bare type, with a
 * `; charset=utf-8` parameter restored for the UTF-8 text sidecar (the one kind whose
 * bytes are text). Never the raw stored value, which may carry an unbounded parameter.
 */
function servedContentType(contentType: string): string {
  return contentType === "text/plain" ? "text/plain; charset=utf-8" : contentType;
}

/**
 * Build the safe, deterministic response headers for a served artifact:
 *  - a canonical `Content-Type` (never the raw stored value);
 *  - an `attachment` `Content-Disposition` with a GENERATED filename (never user input);
 *  - `Content-Length` from the known byte count;
 *  - `Cache-Control: private, no-store` so a private/ephemeral output is never cached
 *    by a browser or shared proxy;
 *  - `X-Content-Type-Options: nosniff` so the bytes are never re-interpreted as another
 *    type by a browser.
 * Pure and deterministic: identical inputs always yield byte-identical headers.
 */
export function downloadHeadersFor(
  kind: ArtifactOutputKind,
  contentType: string,
  processor: ProcessorKind,
  byteLength: number,
): ArtifactDownloadHeaders {
  const filename = downloadFilenameFor(kind, contentType, processor);
  return {
    "content-type": servedContentType(contentType),
    "content-disposition": `attachment; filename="${filename}"`,
    "content-length": String(Math.max(0, Math.floor(byteLength))),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
}

/**
 * Structurally re-validate a stored manifest against the artifact's actual bytes at
 * retrieval time, returning `ok` or the FIRST failing reason in a deterministic order
 * (foreign policy → unrecognized/incoherent kind → content-type desync → unresolved
 * retention → emptiness → count desync). Defense-in-depth over the publish-time gate:
 * it proves the manifest still describes THIS output and that the output is a
 * recognized, non-empty, downloadable kind — never re-reading bytes, only metadata.
 */
function classifyManifestForRetrieval(
  manifest: ArtifactManifest,
  rawContentType: string,
  byteLength: number,
): ArtifactAccessReason {
  // A manifest not stamped by this policy is not one we can vouch for.
  if (manifest.policyId !== ARTIFACT_POLICY_ID) return "invalid_manifest";
  // The manifest's content-type must map to a recognized, downloadable output kind.
  const kind = outputKindForContentType(manifest.contentType);
  if (kind === "unknown" || !DOWNLOADABLE_KINDS.has(kind)) {
    return "unsupported_kind";
  }
  // The recorded kind must agree with its own content-type (no internal contradiction).
  if (manifest.outputKind !== kind) return "invalid_manifest";
  // The manifest must describe THIS artifact: its content-type must re-normalize to the
  // stored content-type. A mismatch means the manifest and bytes have desynchronized.
  if (normalizeContentType(rawContentType) !== manifest.contentType) {
    return "invalid_manifest";
  }
  // A retention/lifecycle class must have resolved at publish (privacy-by-default).
  if (manifest.retentionClass === "unknown") return "invalid_manifest";
  // Real, non-empty bytes — both as recorded and as actually stored.
  if (manifest.byteCount <= 0 || byteLength <= 0) return "empty_artifact";
  // The recorded byte count must match the actual stored bytes (no tamper/desync).
  if (manifest.byteCount !== byteLength) return "invalid_manifest";
  return "ok";
}

/**
 * Decide whether a presented artifact handle may be served, and if so with what safe
 * headers. The single evaluation the download route delegates to, in a deterministic
 * precedence:
 *
 *   policy resolvable → storage ready → lifecycle (absent/deleted/expired)
 *   → job ready → job binding → manifest re-validation (or intrinsic checks) → served
 *
 * The storage / job-binding steps only fire when the caller supplies the corresponding
 * OPTIONAL fact (a route that already gated on local-dev mode may omit the storage
 * capability, and a caller that asserts no `?job=` binding skips that step). This
 * boundary has NO authentication or authorization: possession of the opaque handle is
 * the capability. Pure and total; never throws.
 */
export function decideArtifactAccess(
  input: RetrievableArtifact,
  policy: ArtifactAccessPolicy = DEFAULT_ARTIFACT_ACCESS_POLICY,
): ArtifactAccessDecision {
  // Fail closed if the policy could not be resolved (defense-in-depth).
  if (!policy || typeof policy !== "object") return denied("policy_unavailable");
  // The storage backend must be able to serve a download here at all (when reported).
  if (input.storage && !input.storage.ready) return denied("storage_unavailable");
  // Lifecycle: a handle that provably mapped to something now gone is `deleted`/`expired`
  // (410); an unknown/reaped handle is `not_found` (404).
  if (input.lifecycle === "absent") return denied("not_found");
  if (input.lifecycle === "deleted") return denied("deleted");
  if (input.lifecycle === "expired") return denied("expired");
  // The owning job must be a completed, downloadable job (defense-in-depth: an
  // artifact is only ever stored for a completed job, so this normally holds).
  if (!input.jobCompleted) return denied("not_ready");
  // Job binding (when asserted): the artifact must belong to the asserted job.
  if (input.jobBinding?.asserted === true && input.jobBinding.matches !== true) {
    return denied("job_mismatch");
  }

  if (input.manifest === null) {
    // No provenance manifest was recorded (the gate was disabled at publish). Fail
    // closed under a strict posture; otherwise apply intrinsic checks only, without
    // ever claiming the output was provenance-validated.
    if (policy.requireManifest) return denied("missing_manifest");
    return decideWithoutManifest(input);
  }

  const reason = classifyManifestForRetrieval(
    input.manifest,
    input.contentType,
    input.byteLength,
  );
  if (reason !== "ok") return denied(reason as ArtifactAccessDenyReason);

  return served(
    input.manifest.outputKind,
    input.manifest.contentType,
    input.manifest.processor,
    input.byteLength,
  );
}

/**
 * The intrinsic-only path for a manifest-less output: derive the kind from the stored
 * content-type, require a recognized/downloadable kind and non-empty bytes, and serve
 * with a generically-named download (no processor provenance to draw on). Honest: it
 * never asserts the output was provenance-validated.
 */
function decideWithoutManifest(
  input: RetrievableArtifact,
): ArtifactAccessDecision {
  const contentType = normalizeContentType(input.contentType);
  if (contentType === null) return denied("unsupported_kind");
  const kind = outputKindForContentType(contentType);
  if (kind === "unknown" || !DOWNLOADABLE_KINDS.has(kind)) {
    return denied("unsupported_kind");
  }
  if (input.byteLength <= 0) return denied("empty_artifact");
  return served(kind, contentType, "other", input.byteLength);
}

/** Build a served (ok) decision with generated, content-free headers. */
function served(
  kind: ArtifactOutputKind,
  contentType: string,
  processor: ProcessorKind,
  byteLength: number,
): ArtifactAccessDecision {
  return {
    ok: true,
    reason: "ok",
    kind,
    contentType: servedContentType(contentType),
    byteLength,
    filename: downloadFilenameFor(kind, contentType, processor),
    headers: downloadHeadersFor(kind, contentType, processor, byteLength),
  };
}

/** Build a denied decision with its fixed, content-free detail. */
function denied(reason: ArtifactAccessDenyReason): ArtifactAccessDecision {
  return { ok: false, reason, detail: ARTIFACT_ACCESS_DETAIL[reason] };
}

/**
 * Public builder for a denied decision — the retrieval orchestrator uses it for the
 * reasons that arise BEFORE the pure descriptor exists (e.g. a transient
 * `storage_error` from the object read), so every denial, wherever it originates,
 * carries the same fixed, content-free `{ reason, detail }` shape as {@link decideArtifactAccess}.
 */
export function deniedArtifactAccess(
  reason: ArtifactAccessDenyReason,
): ArtifactAccessDecision {
  return denied(reason);
}
