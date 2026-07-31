/**
 * The typed contract for the secure-worker **artifact manifest / provenance gate** —
 * a bounded, content-free structural validation the executor runs on the outputs a
 * processor produced, AFTER the transform succeeds and immediately BEFORE any bytes
 * are persisted or a downloadable {@link import("@/lib/jobs").JobArtifact} is minted
 * and exposed to a client.
 *
 * This is a provider seam in the same spirit as the soundness gate, the scanner,
 * storage, queue, and processor: pure data plus a tiny interface, node-free (no
 * daemon, native binary, network, filesystem, or PDF parser), so it is reused by the
 * worker executor and the local-dev adapter and is unit-tested in isolation. It does
 * *only* cheap, deterministic structural checks over the produced artifacts' bounded
 * metadata — is there at least one output, and not more than the ceiling? does each
 * output carry non-empty bytes within the size ceiling? does its content-type map to
 * a recognized output kind, cohere with its filename extension, and belong to the set
 * of kinds this processor may legitimately produce? does the job carry a recognizable
 * retention/lifecycle class? — and never decodes, decompresses, parses objects, counts
 * pages, or reads text.
 *
 * Where soundness proves an *input* is structurally sound before processing, this gate
 * proves an *output* has an unambiguous, well-formed PROVENANCE before publication: a
 * processor cannot publish an empty, oversized, unknown-kind, mistyped, or
 * retention-less artifact, and every artifact that IS published has a typed manifest
 * recording where it came from. See docs/WORKER_ARCHITECTURE.md.
 *
 * Honesty rules — load-bearing, and mirrored across the whole worker layer:
 *  - a manifest/provenance pass is ONLY bounded structural metadata validation, NOT
 *    malware scanning, NOT PDF sanitization, NOT OCR-correctness proof, NOT a
 *    lifecycle-deletion guarantee. It never claims any of those; it validates the
 *    shape of what a processor produced, nothing about the document's contents;
 *  - `checked` is the honesty bit: it is true only when the gate actually inspected
 *    the outputs (`valid`/`invalid`). A disabled gate returns `skipped`
 *    (`checked:false`) and nothing downstream may report an artifact as validated
 *    when it was not;
 *  - every field of a manifest is content-free: an output KIND, a normalized
 *    content-type, a byte COUNT (the same figure the client already receives on the
 *    download record), a bounded retention class, the tool slug, and the bounded
 *    processor family — NEVER a filename, object key, signed URL, job/user id, temp
 *    path, OCR text, scanner signature, declared/original name, or document content;
 *  - `reason` is a bounded enum and `detail` NEVER carries any of the above either.
 */

import type { RetentionPolicy } from "@/lib/jobs";
import type { ProcessorArtifact } from "../processor/types";
// Type-only: the bounded processor family lives in the observability layer (which
// value-imports the const tuples BELOW). The `import type` is erased at compile time,
// so there is no runtime import cycle — the same pattern the soundness receipt uses.
import type { ProcessorKind } from "../observability/metrics";

/**
 * The bounded set of output KINDS an artifact can be classified as. Source of truth
 * for the metric schema and the manifest. `unknown` is the closed catch-all for a
 * content-type that maps to no recognized kind — an artifact that reaches it is
 * rejected, never published, so the label space stays closed as tools grow.
 */
export const ARTIFACT_OUTPUT_KINDS = [
  "pdf", // application/pdf — a produced PDF (compressed, searchable, …)
  "text-sidecar", // text/plain — an OCR text sidecar
  "archive", // application/zip — a multi-file bundle
  "office-document", // OOXML docx/xlsx/pptx — a produced Office document
  "image", // image/png|jpeg — a produced raster image
  "unknown", // content-type maps to no recognized output kind (→ rejected)
] as const;
export type ArtifactOutputKind = (typeof ARTIFACT_OUTPUT_KINDS)[number];

/**
 * The bounded retention / lifecycle class an output falls into, derived from the
 * job's {@link RetentionPolicy} (never from an operator's raw TTL value). It records
 * *how long the contract lets the artifact live*, coarsely bucketed so a raw minute
 * count never becomes a field. `unknown` covers a malformed/absent policy or one that
 * claims to persist beyond the job — an artifact that reaches it is rejected, so the
 * privacy-by-default retention contract cannot be silently violated at publish time.
 */
export const ARTIFACT_RETENTION_CLASSES = [
  "ephemeral", // auto-deletes within minutes (output TTL ≤ 15m)
  "short", // auto-deletes within a couple hours (≤ 120m) — the shipped default (60m)
  "standard", // auto-deletes within a day (≤ 1440m)
  "extended", // auto-deletes within the long backstop (> 1 day, still non-persistent)
  "unknown", // no usable/finite class, or a policy claiming persistence (→ rejected)
] as const;
export type ArtifactRetentionClass = (typeof ARTIFACT_RETENTION_CLASSES)[number];

/** The bounded set of verdicts an artifact-manifest validation can reach. */
export const ARTIFACT_VERDICTS = ["valid", "invalid", "skipped"] as const;
/**
 * The outcome of validating a job's produced artifacts:
 *  - `valid`   — the gate ran its bounded checks and every output passed (publish);
 *  - `invalid` — the gate ran and an output (or the set) failed a check (block before
 *                any bytes are persisted or exposed, terminal, no client artifact);
 *  - `skipped` — the gate did not evaluate the outputs (it is disabled), so they were
 *                NOT validated (and are never reported as validated).
 */
export type ArtifactVerdict = (typeof ARTIFACT_VERDICTS)[number];

/**
 * The bounded, content-free reason taxonomy. `ok` accompanies a `valid` verdict and
 * `not_validated` a `skipped` one, so the label space stays closed for telemetry; the
 * rest are the concrete reject reasons. Source of truth for the metric schema (see
 * `../observability/metrics`) and the rejection receipt. Every value is a stable
 * internal code — never a filename, key, size, path, or document content.
 */
export const ARTIFACT_REASONS = [
  "ok", // valid: passed every bounded check
  "not_validated", // skipped: the gate is disabled
  "no_artifacts", // invalid: a "successful" run produced zero outputs (ambiguous)
  "too_many_artifacts", // invalid: more outputs than the bounded per-job ceiling
  "empty_artifact", // invalid: an output had zero bytes
  "oversize_artifact", // invalid: an output exceeded the configured max-bytes ceiling
  "unknown_output_kind", // invalid: content-type maps to no recognized output kind
  "content_type_mismatch", // invalid: content-type disagrees with the filename extension
  "unsupported_content_type", // invalid: a kind/type this processor may not produce
  "missing_retention_class", // invalid: no usable retention/lifecycle class resolved
  "provenance_incomplete", // invalid: a required provenance field (tool/processor) was absent
  "policy_unavailable", // invalid: the gate could not resolve a usable policy (fails closed)
] as const;
export type ArtifactReason = (typeof ARTIFACT_REASONS)[number];

/** The reasons that accompany an `invalid` verdict (everything but `ok`/`not_validated`). */
export type ArtifactRejectReason = Exclude<
  ArtifactReason,
  "ok" | "not_validated"
>;

/**
 * A content-free artifact manifest: the typed, structural provenance record for one
 * produced output. Every field is a bounded enum, a normalized content-type, a byte
 * COUNT, a stable policy constant, or the (public) tool slug / bounded processor
 * family — never a filename, key, URL, id, path, or byte of the document.
 */
export interface ArtifactManifest {
  /** The bounded output kind, derived from the content-type. */
  readonly outputKind: ArtifactOutputKind;
  /** Normalized bare `type/subtype` content-type (parameters stripped); `""` if unclassifiable. */
  readonly contentType: string;
  /**
   * The produced output's byte count — the same structural figure the client already
   * receives on its {@link import("@/lib/jobs").JobArtifact}. Not document content.
   */
  readonly byteCount: number;
  /** The bounded retention/lifecycle class the job's policy resolves to. */
  readonly retentionClass: ArtifactRetentionClass;
  /** The tool slug the job ran (a public catalog value used as provenance). */
  readonly toolSlug: string;
  /** The bounded processor family that produced the output (compress/ocr/other). */
  readonly processor: ProcessorKind;
  /** Stable policy identity — the id and schema version, never the tuned knob values. */
  readonly policyId: string;
  readonly policyVersion: number;
}

/**
 * The per-output verdict: the content-free {@link ArtifactManifest} that was built
 * for it, plus whether it passed and (if not) the bounded reason. Built for EVERY
 * inspected output, so a valid publication and a rejected one both carry a manifest
 * the observability layer can count — the manifest never depends on the verdict.
 */
export interface ArtifactCheck {
  readonly manifest: ArtifactManifest;
  /** `valid` when this output passed every bounded check; `invalid` otherwise. */
  readonly verdict: Exclude<ArtifactVerdict, "skipped">;
  /** `ok` for a pass, else the bounded reject reason. */
  readonly reason: ArtifactReason;
  /** One-line, content-free explanation. Never a filename, key, size, or content. */
  readonly detail: string;
}

/**
 * A content-free validation of a job's whole output set. `checked` is the honesty
 * bit; `verdict` folds the per-output checks (`valid` iff every output is valid AND
 * the set-level checks pass); `reason` is the FIRST failing reason in a deterministic
 * order (or `ok`); `checks` carries the per-output manifests+verdicts (empty for a
 * `skipped` gate or a set-level reject like `no_artifacts`).
 */
export interface ArtifactValidation {
  readonly verdict: ArtifactVerdict;
  /**
   * True ONLY when the gate actually inspected the outputs and reached a verdict
   * (`valid` or `invalid`). false for `skipped` (the gate is disabled). Nothing
   * downstream may report an artifact as validated unless this is true.
   */
  readonly checked: boolean;
  /** The bounded reason code. `ok` for `valid`, `not_validated` for `skipped`. */
  readonly reason: ArtifactReason;
  /** One-line, content-free explanation. Never a filename, key, size, or content. */
  readonly detail: string;
  /** Per-output manifests + verdicts (for observability). Empty when skipped/set-level. */
  readonly checks: readonly ArtifactCheck[];
}

/**
 * What the gate is handed: the tool (for provenance + producible-kind policy), the
 * bounded processor family that produced the outputs, the job's retention policy
 * (for the retention class), and the already-produced artifacts to inspect.
 */
export interface ArtifactValidationInput {
  /** The tool the job ran; a public catalog slug recorded as provenance. */
  readonly tool: string;
  /** The bounded processor family that produced the outputs. */
  readonly processor: ProcessorKind;
  /** The job's retention policy; drives the manifest's retention class. */
  readonly retention: RetentionPolicy;
  /**
   * The already-produced outputs (bytes + naming) to inspect. Never re-read or
   * mutated here; the filename is used only transiently for the content-type
   * coherence check and NEVER enters a manifest, receipt, log, or metric.
   */
  readonly artifacts: readonly ProcessorArtifact[];
}

/** The honest, presence-only capability of the artifact-manifest gate in this environment. */
export interface ArtifactManifestCapability {
  /** True ONLY when the gate is enabled and actually inspects outputs. */
  readonly active: boolean;
  /** Stable mode: `enabled` (checks run) or `disabled` (checks skipped). */
  readonly mode: "enabled" | "disabled";
  /** Stable policy identifier for receipts/telemetry (never an env value). */
  readonly policyId: string;
  /** Stable policy schema version for receipts/telemetry (not the knob values). */
  readonly policyVersion: number;
  /** One-line, content-free explanation. Never a variable, value, or path. */
  readonly detail: string;
}

/**
 * A secure-worker artifact-manifest gate. `validate` inspects a job's produced
 * outputs and returns a content-free validation synchronously (a pure, bounded,
 * in-memory metadata inspection — no I/O, so it is honestly not async);
 * `capability` reports the gate's presence-only readiness. Injected into the
 * executor exactly like the soundness/scanner seams; absent ⇒ no manifest step runs
 * and behavior is unchanged (every output is published as before).
 */
export interface ArtifactManifestGate {
  validate(input: ArtifactValidationInput): ArtifactValidation;
  capability(): ArtifactManifestCapability;
}

const OK_DETAIL =
  "Every produced output passed the bounded worker artifact-manifest check (a structural provenance validation, not malware scanning, sanitization, or a lifecycle guarantee).";
const SKIPPED_DETAIL =
  "The worker artifact-manifest gate is disabled; outputs were not validated (and are never reported as validated).";

/** Content-free explanations per reject reason. Never names a file, size, key, or content. */
export const ARTIFACT_REJECT_DETAIL: Record<ArtifactRejectReason, string> = {
  no_artifacts:
    "The run reported success but produced no output; no artifact was published.",
  too_many_artifacts:
    "The run produced more outputs than the worker artifact ceiling; no artifact was published.",
  empty_artifact: "An output was empty; no artifact was published.",
  oversize_artifact:
    "An output exceeded the worker artifact size ceiling; no artifact was published.",
  unknown_output_kind:
    "An output's content-type is not a recognized output kind; no artifact was published.",
  content_type_mismatch:
    "An output's content-type did not match its filename type; no artifact was published.",
  unsupported_content_type:
    "An output's content-type is not one this tool may produce; no artifact was published.",
  missing_retention_class:
    "The job did not resolve a usable retention class; no artifact was published.",
  provenance_incomplete:
    "An output was missing required provenance; no artifact was published.",
  policy_unavailable:
    "The worker artifact-manifest policy could not be resolved, so the gate failed closed; no artifact was published.",
};

/**
 * Build one per-output {@link ArtifactCheck}. `valid` accepts, any reject reason
 * marks it `invalid`; the manifest is carried through unchanged either way, so a
 * rejected output still has a content-free manifest to count.
 */
export function artifactCheck(
  manifest: ArtifactManifest,
  reason: ArtifactReason,
): ArtifactCheck {
  if (reason === "ok") {
    return { manifest, verdict: "valid", reason: "ok", detail: OK_DETAIL };
  }
  const detail =
    reason === "not_validated"
      ? SKIPPED_DETAIL
      : ARTIFACT_REJECT_DETAIL[reason as ArtifactRejectReason];
  return { manifest, verdict: "invalid", reason, detail };
}

/** A `valid` set result — the gate ran and every output passed. */
export function artifactValid(
  checks: readonly ArtifactCheck[],
  detail: string = OK_DETAIL,
): ArtifactValidation {
  return { verdict: "valid", checked: true, reason: "ok", detail, checks };
}

/** An `invalid` set result — the gate ran and an output (or the set) failed `reason`. */
export function artifactInvalid(
  reason: ArtifactRejectReason,
  checks: readonly ArtifactCheck[] = [],
  detail: string = ARTIFACT_REJECT_DETAIL[reason],
): ArtifactValidation {
  return { verdict: "invalid", checked: true, reason, detail, checks };
}

/** A `skipped` set result — the gate is disabled, so nothing was validated. The honest off state. */
export function artifactSkipped(
  detail: string = SKIPPED_DETAIL,
): ArtifactValidation {
  return {
    verdict: "skipped",
    checked: false,
    reason: "not_validated",
    detail,
    checks: [],
  };
}
