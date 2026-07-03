/**
 * The pure **artifact-manifest evaluation**: the bounded taxonomy tables plus the
 * deterministic build + classify + set-validation the gate delegates to. Node-free
 * (no I/O, no clock, no Node built-in), so it is unit-tested directly and reused by
 * the executor and the local-dev adapter.
 *
 * It builds a content-free {@link ArtifactManifest} for each produced output and
 * decides whether the output set is publishable: at least one non-empty output within
 * the count/size ceilings, each with a recognized output kind whose content-type
 * coheres with its filename extension and is one the producing tool may legitimately
 * emit, and a job that resolves to a usable retention/lifecycle class. It never
 * decodes, decompresses, parses, or reads the output bytes — only their bounded
 * metadata. See ./types for the contract and the honesty rules.
 */

import { extensionOf, normalizeContentType } from "@/lib/uploads/intake";
import type { RetentionPolicy } from "@/lib/jobs";
import type { ProcessorArtifact } from "../processor/types";
import type { ProcessorKind } from "../observability/metrics";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import type { ArtifactManifestPolicy } from "./policy";
import {
  artifactCheck,
  artifactInvalid,
  artifactSkipped,
  artifactValid,
  type ArtifactCheck,
  type ArtifactManifest,
  type ArtifactOutputKind,
  type ArtifactReason,
  type ArtifactRejectReason,
  type ArtifactRetentionClass,
  type ArtifactValidation,
  type ArtifactValidationInput,
} from "./types";

/**
 * Canonical bare content-type → output kind. The source of truth for classifying a
 * produced output; anything not listed classifies as `unknown` and is rejected when
 * the content-type check is on. `text/plain` covers the OCR sidecar (its
 * `; charset=utf-8` parameter is stripped by {@link normalizeContentType} first).
 */
const KIND_BY_CONTENT_TYPE: Readonly<Record<string, ArtifactOutputKind>> = {
  "application/pdf": "pdf",
  "text/plain": "text-sidecar",
  "application/zip": "archive",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image", // non-standard JPEG alias some toolchains emit
};

/**
 * Filename extension → the output kind it implies, for the content-type/name
 * coherence check ONLY. The filename never enters a manifest; it is inspected here
 * and discarded. An unrecognized/absent extension yields `null` (no coherence signal,
 * so no mismatch is asserted).
 */
const KIND_BY_EXTENSION: Readonly<Record<string, ArtifactOutputKind>> = {
  pdf: "pdf",
  txt: "text-sidecar",
  zip: "archive",
  png: "image",
  jpg: "image",
  jpeg: "image",
};

/**
 * The output kinds each bounded processor family may legitimately produce. A tool
 * that emits a kind outside its set is publishing an ambiguous output and is rejected
 * (`unsupported_content_type`). `other` (an unknown/future processor) is deliberately
 * unconstrained across the recognized kinds, so a new tool is never falsely rejected
 * before its own entry is added.
 */
const PRODUCIBLE_BY_PROCESSOR: Readonly<
  Record<ProcessorKind, ReadonlySet<ArtifactOutputKind>>
> = {
  compress: new Set<ArtifactOutputKind>(["pdf"]),
  ocr: new Set<ArtifactOutputKind>(["pdf", "text-sidecar"]),
  other: new Set<ArtifactOutputKind>(["pdf", "text-sidecar", "archive", "image"]),
};

/** The bounded processor families this gate recognizes (defense-in-depth for provenance). */
const KNOWN_PROCESSORS: ReadonlySet<string> = new Set<ProcessorKind>([
  "compress",
  "ocr",
  "other",
]);

/** Coarse retention thresholds (minutes) that bucket a policy TTL into a class. */
const RETENTION_EPHEMERAL_MAX_MINUTES = 15;
const RETENTION_SHORT_MAX_MINUTES = 120;
const RETENTION_STANDARD_MAX_MINUTES = 1440; // 1 day

/**
 * Map a bare content-type to its {@link ArtifactOutputKind}, or `unknown` when it is
 * not a recognized producible type. `contentType` must already be normalized (bare,
 * lower-cased); an empty string maps to `unknown`.
 */
export function outputKindForContentType(
  contentType: string,
): ArtifactOutputKind {
  return KIND_BY_CONTENT_TYPE[contentType] ?? "unknown";
}

/**
 * Map a produced output's filename to the output kind its extension implies, or
 * `null` when the extension is unrecognized/absent. Used ONLY for coherence; the
 * filename is never retained.
 */
export function outputKindForFilename(
  filename: unknown,
): ArtifactOutputKind | null {
  const ext = extensionOf(filename);
  if (ext === null) return null;
  return KIND_BY_EXTENSION[ext] ?? null;
}

/**
 * Derive the bounded {@link ArtifactRetentionClass} from a job's retention policy.
 * Fails closed to `unknown` for a malformed/absent policy, a non-positive/non-finite
 * output TTL, OR a policy that claims to persist beyond the job — so the manifest can
 * never bless an output whose lifecycle contradicts the privacy-by-default guarantee.
 * The raw minute count is bucketed here and never becomes a manifest field.
 */
export function retentionClassFor(
  retention: RetentionPolicy | null | undefined,
): ArtifactRetentionClass {
  if (!retention || typeof retention !== "object") return "unknown";
  // The privacy contract guarantees outputs do not outlive the job. A policy whose
  // persistence flag is anything but the contractual `false` is not one we classify.
  if ((retention as { persistsAfterJob?: unknown }).persistsAfterJob !== false) {
    return "unknown";
  }
  const ttl = retention.outputTtlMinutes;
  if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) {
    return "unknown";
  }
  if (ttl <= RETENTION_EPHEMERAL_MAX_MINUTES) return "ephemeral";
  if (ttl <= RETENTION_SHORT_MAX_MINUTES) return "short";
  if (ttl <= RETENTION_STANDARD_MAX_MINUTES) return "standard";
  return "extended";
}

/** The output kinds a bounded processor family may legitimately produce. */
export function producibleKinds(
  processor: ProcessorKind,
): ReadonlySet<ArtifactOutputKind> {
  return PRODUCIBLE_BY_PROCESSOR[processor] ?? PRODUCIBLE_BY_PROCESSOR.other;
}

/** Clamp a produced output's byte length to a non-negative integer; 0 when unmeasurable. */
function byteCountOf(bytes: ProcessorArtifact["bytes"]): number {
  const n = bytes?.byteLength;
  return typeof n === "number" && Number.isFinite(n) && n >= 0
    ? Math.floor(n)
    : 0;
}

/**
 * Build the content-free {@link ArtifactManifest} for one produced output. Pure
 * projection: it records the derived kind, the normalized content-type, the byte
 * count, the resolved retention class, the tool slug, the processor family, and the
 * stable policy identity — and NOTHING about the filename or the document bytes.
 */
export function buildArtifactManifest(
  input: Pick<ArtifactValidationInput, "tool" | "processor">,
  artifact: ProcessorArtifact,
  retentionClass: ArtifactRetentionClass,
): ArtifactManifest {
  const contentType = normalizeContentType(artifact.contentType) ?? "";
  return {
    outputKind: outputKindForContentType(contentType),
    contentType,
    byteCount: byteCountOf(artifact.bytes),
    retentionClass,
    toolSlug: typeof input.tool === "string" ? input.tool : "",
    processor: input.processor,
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
  };
}

/**
 * Classify one produced output against the policy, returning `ok` or the FIRST reject
 * reason in a deterministic order (provenance → retention → emptiness → size → kind →
 * coherence → producibility). `artifact.filename` is read only for the coherence
 * check and never retained.
 */
export function classifyArtifact(
  policy: ArtifactManifestPolicy,
  input: Pick<ArtifactValidationInput, "processor">,
  artifact: ProcessorArtifact,
  manifest: ArtifactManifest,
): ArtifactReason {
  // Provenance must be complete: a tool slug and a recognized processor family.
  if (!manifest.toolSlug || !KNOWN_PROCESSORS.has(manifest.processor)) {
    return "provenance_incomplete";
  }
  // A resolvable retention/lifecycle class (when required).
  if (policy.requireRetentionClass && manifest.retentionClass === "unknown") {
    return "missing_retention_class";
  }
  // Real, non-empty bytes.
  if (manifest.byteCount <= 0) return "empty_artifact";
  // Within the opt-in per-output byte ceiling.
  if (policy.maxBytes > 0 && manifest.byteCount > policy.maxBytes) {
    return "oversize_artifact";
  }
  // Content-type structural checks (on by default).
  if (policy.checkContentType) {
    // A recognized output kind.
    if (manifest.outputKind === "unknown") return "unknown_output_kind";
    // Coherent with the filename extension, when the extension is recognized.
    const extKind = outputKindForFilename(artifact.filename);
    if (extKind !== null && extKind !== manifest.outputKind) {
      return "content_type_mismatch";
    }
    // A kind the producing tool is allowed to emit.
    if (!producibleKinds(input.processor).has(manifest.outputKind)) {
      return "unsupported_content_type";
    }
  }
  return "ok";
}

/**
 * Validate a job's whole produced output set against `policy`. The single evaluation
 * both the gate and any direct caller use. Returns a `skipped` result when the gate
 * is disabled, an `invalid` result (with per-output checks when the failure is
 * per-output) at the FIRST failing reason, or a `valid` result carrying every
 * output's content-free manifest. Pure and total; never throws.
 */
export function checkArtifacts(
  policy: ArtifactManifestPolicy | null | undefined,
  input: ArtifactValidationInput,
): ArtifactValidation {
  // Fail closed if the policy could not be resolved (defense-in-depth).
  if (!policy || typeof policy !== "object") {
    return artifactInvalid("policy_unavailable");
  }
  if (!policy.enabled) return artifactSkipped();

  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  // Set-level: a "successful" run that produced nothing is ambiguous — never a
  // completed job with no download.
  if (artifacts.length === 0) return artifactInvalid("no_artifacts");
  // Set-level: an absurd output count is a mis-built job.
  if (artifacts.length > policy.maxArtifacts) {
    return artifactInvalid("too_many_artifacts");
  }

  const retentionClass = retentionClassFor(input.retention);
  const checks: ArtifactCheck[] = [];
  let firstReject: ArtifactRejectReason | null = null;
  for (const artifact of artifacts) {
    const manifest = buildArtifactManifest(input, artifact, retentionClass);
    const reason = classifyArtifact(policy, input, artifact, manifest);
    checks.push(artifactCheck(manifest, reason));
    if (reason !== "ok" && firstReject === null) {
      firstReject = reason as ArtifactRejectReason;
    }
  }

  return firstReject === null
    ? artifactValid(checks)
    : artifactInvalid(firstReject, checks);
}
