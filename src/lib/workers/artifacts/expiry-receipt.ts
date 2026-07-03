/**
 * The content-free **artifact-lifecycle/expiry drift receipt**: the durable, per-read audit
 * record the storage-backed retrieval boundary emits when it evaluates the lifecycle evidence
 * of an object the bucket still returned. It is the lifecycle/expiry counterpart to
 * `./retrieval-receipt`, and it complements the aggregate `worker_artifact_expiry_total`
 * counter (`./expiry-metrics`): the counter answers "how many present-object reads, in what
 * lifecycle state" for a dashboard; the receipt answers "which policy decided this, and when"
 * for an audit trail an operator can forward to a SIEM to watch lifecycle drift.
 *
 * The load-bearing signal it carries: an `expired` (or `deleted`) state means the bucket
 * served an object the app no longer considers downloadable — i.e. the bucket lifecycle policy
 * has not (yet) reaped it. That is a DRIFT signal, NOT proof of deletion and NOT a claim about
 * the bucket lifecycle policy's correctness; the app enforces the window itself (denying the
 * download 410) regardless. An `unknown` state means the present object carries no usable
 * lifecycle evidence (a legacy object, or metadata-stripping storage).
 *
 * Like every receipt in the worker layer it is emitted through an OPTIONAL, operator-wired
 * observer that DEFAULTS to none (no console noise, no I/O). It carries only a bounded
 * lifecycle state, the bounded storage provider, the stable policy id/version, and an optional
 * ISO timestamp — never a handle, filename, object key, bucket name, signed URL, job/user id,
 * path, size, expiry instant, or byte. So a receipt is safe to log or forward verbatim. See
 * docs/OBSERVABILITY.md and docs/SECURITY.md.
 */

import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import type { StorageArtifactLifecycle } from "./lifecycle";
import type { RetrievalStorageProvider } from "./access";

/**
 * A content-free lifecycle/expiry receipt. Every field is a bounded enum, a stable policy
 * constant, or an optional ISO timestamp — never a user string, identifier, key, path, size,
 * expiry instant, or byte.
 */
export interface ArtifactExpiryReceipt {
  /** Fixed category so a receipt is self-describing in a mixed sink. */
  readonly category: "expiry";
  /** The bounded lifecycle state (`live` / `expired` / `deleted` / `unknown`). */
  readonly state: StorageArtifactLifecycle;
  /** The bounded storage backend that evaluated this read. A closed enum — never a bucket. */
  readonly provider: RetrievalStorageProvider;
  /** Stable policy identity — the id and schema version the boundary enforced. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** Optional ISO-8601 timestamp, when the caller supplied a clock. */
  readonly at?: string;
}

/** The bounded, content-free inputs a lifecycle/expiry receipt is derived from. */
export interface ArtifactExpiryReceiptInput {
  /** The bounded lifecycle state resolved for the read. */
  readonly state: StorageArtifactLifecycle;
  /** The bounded storage backend the read came from. */
  readonly provider: RetrievalStorageProvider;
  /** Optional ISO-8601 timestamp. Omitted from the receipt when absent. */
  readonly at?: string;
}

/**
 * Derive an {@link ArtifactExpiryReceipt} from a bounded evaluation. Pure and total: it
 * stamps the stable policy id/version and copies the optional timestamp. It can never carry
 * more than its bounded inputs already did, so it is content-free by construction.
 */
export function buildArtifactExpiryReceipt(
  input: ArtifactExpiryReceiptInput,
): ArtifactExpiryReceipt {
  return {
    category: "expiry",
    state: input.state,
    provider: input.provider,
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    ...(input.at ? { at: input.at } : {}),
  };
}

/** A sink an operator wires to observe expiry receipts (an audit log line, a SIEM, …). */
export type ArtifactExpiryObserver = (receipt: ArtifactExpiryReceipt) => void;

// Module-global, swappable observer — the same reset-for-tests posture the retrieval
// receipt and metric sinks use. Default null: the boundary derives the receipt but emits
// to nothing until an operator opts in, so there is no side effect in a stock deployment.
let observer: ArtifactExpiryObserver | null = null;

/** Register (or clear, with `null`) the process-wide expiry-receipt observer. */
export function setArtifactExpiryObserver(next: ArtifactExpiryObserver | null): void {
  observer = next;
}

/** Restore the default (no) observer. Named for test isolation. */
export function resetArtifactExpiryObserverForTests(): void {
  observer = null;
}

/**
 * Derive a receipt from a bounded evaluation and emit it to the registered observer, if
 * any. A throwing observer is swallowed: observability must never break — or slow — a
 * download. Returns the receipt so a caller can also attach it to its own tracing.
 */
export function emitArtifactExpiryReceipt(
  input: ArtifactExpiryReceiptInput,
): ArtifactExpiryReceipt {
  const receipt = buildArtifactExpiryReceipt(input);
  try {
    observer?.(receipt);
  } catch {
    // An operator's sink must never turn a valid download into an error.
  }
  return receipt;
}
