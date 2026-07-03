/**
 * The content-free **artifact-retrieval receipt**: the durable, per-attempt audit record
 * the client-facing download boundary emits for every retrieval decision — served or
 * denied. It is the retrieval counterpart to the manifest gate's `./receipt`, and it
 * complements the aggregate `worker_artifact_retrieval_total` counter (`./retrieval-metrics`)
 * exactly as the manifest gate pairs a receipt with `artifactManifestMetric`: the counter
 * answers "how many, of what outcome" for a dashboard; the receipt answers "which policy
 * decided this attempt, and when" for an audit trail an operator can forward to a SIEM.
 *
 * Like every receipt in the worker layer it is emitted through an OPTIONAL, operator-wired
 * observer that DEFAULTS to none (no console noise, no I/O). It carries only a bounded
 * outcome, a bounded reason enum, the bounded output kind, the stable policy id/version,
 * and an optional ISO timestamp — never a handle, filename, object key, signed URL,
 * job/user id, path, size, or byte. So a receipt is safe to log or forward verbatim.
 * See docs/OBSERVABILITY.md and docs/SECURITY.md.
 */

import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import {
  retrievalOutcomeFor,
  type ArtifactAccessReason,
  type ArtifactRetrievalOutcome,
} from "./access";
import type { ArtifactOutputKind } from "./types";

/**
 * A content-free retrieval receipt. Every field is a bounded enum, a stable policy
 * constant, or an optional ISO timestamp — never a user string, identifier, key, path,
 * size, or byte.
 */
export interface ArtifactRetrievalReceipt {
  /** Fixed category so a receipt is self-describing in a mixed sink. */
  readonly category: "retrieval";
  /** The coarse outcome (`served` / `denied`). */
  readonly outcome: ArtifactRetrievalOutcome;
  /** The bounded reason (`ok` for a served attempt, else the denial reason). */
  readonly reason: ArtifactAccessReason;
  /** The served output kind, or `unknown` for a denial (never a filename/key). */
  readonly kind: ArtifactOutputKind;
  /** Stable policy identity — the id and schema version the boundary enforced. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** Optional ISO-8601 timestamp, when the caller supplied a clock. */
  readonly at?: string;
}

/** The bounded, content-free inputs a receipt is derived from. */
export interface ArtifactRetrievalReceiptInput {
  /** The bounded decision reason (`ok` folds to `served`, else `denied`). */
  readonly reason: ArtifactAccessReason;
  /** The served output kind, or `unknown` for a denial. */
  readonly kind: ArtifactOutputKind;
  /** Optional ISO-8601 timestamp. Omitted from the receipt when absent. */
  readonly at?: string;
}

/**
 * Derive an {@link ArtifactRetrievalReceipt} from a bounded decision. Pure and total: it
 * folds the reason to its coarse outcome, stamps the stable policy id/version, and copies
 * the optional timestamp. It can never carry more than its bounded inputs already did, so
 * it is content-free by construction.
 */
export function buildArtifactRetrievalReceipt(
  input: ArtifactRetrievalReceiptInput,
): ArtifactRetrievalReceipt {
  return {
    category: "retrieval",
    outcome: retrievalOutcomeFor(input.reason),
    reason: input.reason,
    kind: input.kind,
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    ...(input.at ? { at: input.at } : {}),
  };
}

/** A sink an operator wires to observe retrieval receipts (an audit log line, a SIEM, …). */
export type ArtifactRetrievalObserver = (
  receipt: ArtifactRetrievalReceipt,
) => void;

// Module-global, swappable observer — the same reset-for-tests posture the rate-limit
// guard and the retrieval metric sink use. Default null: the boundary derives the receipt
// but emits to nothing until an operator opts in, so there is no side effect in a stock
// deployment.
let observer: ArtifactRetrievalObserver | null = null;

/** Register (or clear, with `null`) the process-wide retrieval-receipt observer. */
export function setArtifactRetrievalObserver(
  next: ArtifactRetrievalObserver | null,
): void {
  observer = next;
}

/** Restore the default (no) observer. Named for test isolation. */
export function resetArtifactRetrievalObserverForTests(): void {
  observer = null;
}

/**
 * Derive a receipt from a bounded decision and emit it to the registered observer, if
 * any. A throwing observer is swallowed: observability must never break — or slow — a
 * download. Returns the receipt so a caller can also attach it to its own tracing.
 */
export function emitArtifactRetrievalReceipt(
  input: ArtifactRetrievalReceiptInput,
): ArtifactRetrievalReceipt {
  const receipt = buildArtifactRetrievalReceipt(input);
  try {
    observer?.(receipt);
  } catch {
    // An operator's sink must never turn a valid download into an error.
  }
  return receipt;
}
