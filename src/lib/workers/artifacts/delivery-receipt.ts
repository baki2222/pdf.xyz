/**
 * The content-free **artifact-download delivery receipt**: the durable, per-attempt
 * audit record the client-facing download boundary emits for every delivery decision —
 * delivered or denied. It is the delivery counterpart to `./retrieval-receipt`, and it
 * complements the aggregate `worker_artifact_delivery_total` counter (`./delivery-metrics`)
 * exactly as the retrieval receipt pairs with `artifactRetrievalMetric`: the counter
 * answers "how many, of what outcome" for a dashboard; the receipt answers "which
 * policy decided this attempt, over which method/range, and when" for an audit trail an
 * operator can forward to a SIEM.
 *
 * Where the aggregate delivery metric stays lean (outcome/reason/kind/provider, exactly
 * parallel to retrieval), the per-attempt receipt additionally records the bounded HTTP
 * `method` (`GET`/`HEAD`) and the bounded `range` disposition (`none`/`ignored`), so the
 * "how are clients probing this endpoint — HEAD checks, range requests we do not serve"
 * signal is auditable without any high-cardinality value. Like every receipt in the
 * worker layer it is emitted through an OPTIONAL, operator-wired observer that DEFAULTS
 * to none (no console noise, no I/O). Every field is a bounded enum, a stable policy
 * constant, or an optional ISO timestamp — never a handle, filename, object key, bucket
 * name, signed URL, byte range, job/user id, path, size, or byte. So a receipt is safe
 * to log or forward verbatim. See docs/OBSERVABILITY.md and docs/SECURITY.md.
 */

import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import {
  deliveryOutcomeFor,
  type ArtifactDeliveryMethod,
  type ArtifactDeliveryOutcome,
  type ArtifactDeliveryRange,
  type ArtifactDeliveryReason,
} from "./delivery";
import type { RetrievalStorageProvider } from "./access";
import type { ArtifactOutputKind } from "./types";

/**
 * A content-free delivery receipt. Every field is a bounded enum, a stable policy
 * constant, or an optional ISO timestamp — never a user string, identifier, key, path,
 * byte range, size, or byte.
 */
export interface ArtifactDeliveryReceipt {
  /** Fixed category so a receipt is self-describing in a mixed sink. */
  readonly category: "delivery";
  /** The coarse outcome (`delivered` / `denied`). */
  readonly outcome: ArtifactDeliveryOutcome;
  /** The bounded reason (`ok` for a delivered attempt, else the denial reason). */
  readonly reason: ArtifactDeliveryReason;
  /** The served output kind, or `unknown` for a pre-decision failure (never a key). */
  readonly kind: ArtifactOutputKind;
  /** The bounded storage backend that served this attempt (never a bucket/endpoint). */
  readonly provider: RetrievalStorageProvider;
  /** The bounded HTTP method (`GET` streams bytes; `HEAD` returns headers only). */
  readonly method: ArtifactDeliveryMethod;
  /** The bounded `Range`-header disposition (`none`, or `ignored` — whole file served). */
  readonly range: ArtifactDeliveryRange;
  /** Stable policy identity — the id and schema version the boundary enforced. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** Optional ISO-8601 timestamp, when the caller supplied a clock. */
  readonly at?: string;
}

/** The bounded, content-free inputs a delivery receipt is derived from. */
export interface ArtifactDeliveryReceiptInput {
  /** The bounded decision reason (`ok` folds to `delivered`, else `denied`). */
  readonly reason: ArtifactDeliveryReason;
  /** The served output kind, or `unknown` for a pre-decision failure. */
  readonly kind: ArtifactOutputKind;
  /** The bounded storage backend the download came from (local vs remote vs none). */
  readonly provider: RetrievalStorageProvider;
  /** The bounded HTTP method. */
  readonly method: ArtifactDeliveryMethod;
  /** The bounded `Range`-header disposition. */
  readonly range: ArtifactDeliveryRange;
  /** Optional ISO-8601 timestamp. Omitted from the receipt when absent. */
  readonly at?: string;
}

/**
 * Derive an {@link ArtifactDeliveryReceipt} from a bounded decision. Pure and total: it
 * folds the reason to its coarse outcome, stamps the stable policy id/version, and
 * copies the optional timestamp. It can never carry more than its bounded inputs
 * already did, so it is content-free by construction.
 */
export function buildArtifactDeliveryReceipt(
  input: ArtifactDeliveryReceiptInput,
): ArtifactDeliveryReceipt {
  return {
    category: "delivery",
    outcome: deliveryOutcomeFor(input.reason),
    reason: input.reason,
    kind: input.kind,
    provider: input.provider,
    method: input.method,
    range: input.range,
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    ...(input.at ? { at: input.at } : {}),
  };
}

/** A sink an operator wires to observe delivery receipts (an audit log line, a SIEM, …). */
export type ArtifactDeliveryObserver = (
  receipt: ArtifactDeliveryReceipt,
) => void;

// Module-global, swappable observer — the same reset-for-tests posture the retrieval
// receipt observer uses. Default null: the boundary derives the receipt but emits to
// nothing until an operator opts in, so there is no side effect in a stock deployment.
let observer: ArtifactDeliveryObserver | null = null;

/** Register (or clear, with `null`) the process-wide delivery-receipt observer. */
export function setArtifactDeliveryObserver(
  next: ArtifactDeliveryObserver | null,
): void {
  observer = next;
}

/** Restore the default (no) observer. Named for test isolation. */
export function resetArtifactDeliveryObserverForTests(): void {
  observer = null;
}

/**
 * Derive a receipt from a bounded decision and emit it to the registered observer, if
 * any. A throwing observer is swallowed: observability must never break — or slow — a
 * download. Returns the receipt so a caller can also attach it to its own tracing.
 */
export function emitArtifactDeliveryReceipt(
  input: ArtifactDeliveryReceiptInput,
): ArtifactDeliveryReceipt {
  const receipt = buildArtifactDeliveryReceipt(input);
  try {
    observer?.(receipt);
  } catch {
    // An operator's sink must never turn a valid download into an error.
  }
  return receipt;
}
