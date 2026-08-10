/**
 * The content-free **cleanup-verification receipt** (Phase 42): the durable audit record an
 * operator's tooling can emit for a cleanup verification run. It complements the aggregate
 * `worker_cleanup_verification_total` counter (`./metrics`): the counter answers "how many runs,
 * in what verdict" for a dashboard; the receipt answers "which policy decided this, and when"
 * for an audit trail an operator can forward to a SIEM to watch storage-cleanup posture over
 * time.
 *
 * The load-bearing signal it carries: a `drift` verdict means the operator's own evidence shows
 * an artifact still present in object storage past its retention window + reap grace — the
 * bucket lifecycle backstop has NOT removed it. That is a cleanup gap, NOT proof of disclosure
 * (Phase 41 still denies the download) and NOT a claim about the bucket lifecycle policy's
 * correctness. A `verified` verdict means every should-be-gone artifact is confirmed absent.
 *
 * Like every receipt in the worker layer it is emitted through an OPTIONAL, operator-wired
 * observer that DEFAULTS to none (no console noise, no I/O). It carries only the bounded verdict,
 * the bounded storage provider, small integer counts, the stable policy id/version, and an
 * optional ISO timestamp — never a handle, filename, object key, bucket name, signed URL,
 * job/user id, path, size, expiry instant, or byte. So a receipt is safe to log or forward
 * verbatim. See docs/OBSERVABILITY.md and docs/SECURITY.md.
 */

import {
  CLEANUP_POLICY_ID,
  CLEANUP_POLICY_VERSION,
  type CleanupVerdict,
} from "./types";
import type { RetrievalStorageProvider } from "../artifacts/access";

/**
 * A content-free cleanup-verification receipt. Every field is a bounded enum, a small integer
 * count, a stable policy constant, or an optional ISO timestamp — never a user string,
 * identifier, key, path, size, expiry instant, or byte.
 */
export interface CleanupVerificationReceipt {
  /** Fixed category so a receipt is self-describing in a mixed sink. */
  readonly category: "cleanup";
  /** The bounded aggregate verdict. */
  readonly verdict: CleanupVerdict;
  /** The bounded storage backend the verification was evaluated for. A closed enum. */
  readonly provider: RetrievalStorageProvider;
  /** Objects considered this run. */
  readonly total: number;
  /** Objects confirmed absent (active delete-now + lifecycle backstop). */
  readonly reaped: number;
  /** Objects still present past their reap grace (the drift count). */
  readonly drift: number;
  /** Stable policy identity — the id and schema version the verifier enforced. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** Optional ISO-8601 timestamp, when the caller supplied a clock. */
  readonly at?: string;
}

/** The bounded, content-free inputs a cleanup-verification receipt is derived from. */
export interface CleanupVerificationReceiptInput {
  readonly verdict: CleanupVerdict;
  readonly provider: RetrievalStorageProvider;
  readonly total: number;
  readonly reaped: number;
  readonly drift: number;
  /** Optional ISO-8601 timestamp. Omitted from the receipt when absent. */
  readonly at?: string;
}

/** A finite, non-negative integer, clamped — a count can never be a fraction or negative. */
function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Derive a {@link CleanupVerificationReceipt} from a bounded verification. Pure and total: it
 * stamps the stable policy id/version, clamps the counts, and copies the optional timestamp. It
 * can never carry more than its bounded inputs already did, so it is content-free by construction.
 */
export function buildCleanupVerificationReceipt(
  input: CleanupVerificationReceiptInput,
): CleanupVerificationReceipt {
  return {
    category: "cleanup",
    verdict: input.verdict,
    provider: input.provider,
    total: safeCount(input.total),
    reaped: safeCount(input.reaped),
    drift: safeCount(input.drift),
    policyId: CLEANUP_POLICY_ID,
    policyVersion: CLEANUP_POLICY_VERSION,
    ...(input.at ? { at: input.at } : {}),
  };
}

/** A sink an operator wires to observe cleanup receipts (an audit log line, a SIEM, …). */
export type CleanupVerificationObserver = (
  receipt: CleanupVerificationReceipt,
) => void;

// Module-global, swappable observer — the same reset-for-tests posture the artifact expiry
// receipt uses. Default null: nothing is emitted until an operator opts in.
let observer: CleanupVerificationObserver | null = null;

/** Register (or clear, with `null`) the process-wide cleanup-receipt observer. */
export function setCleanupVerificationObserver(
  next: CleanupVerificationObserver | null,
): void {
  observer = next;
}

/** Restore the default (no) observer. Named for test isolation. */
export function resetCleanupVerificationObserverForTests(): void {
  observer = null;
}

/**
 * Derive a receipt from a bounded verification and emit it to the registered observer, if any.
 * A throwing observer is swallowed: observability must never break an operator check. Returns
 * the receipt so a caller can also attach it to its own tracing.
 */
export function emitCleanupVerificationReceipt(
  input: CleanupVerificationReceiptInput,
): CleanupVerificationReceipt {
  const receipt = buildCleanupVerificationReceipt(input);
  try {
    observer?.(receipt);
  } catch {
    // An operator's sink must never turn a verification into a crash.
  }
  return receipt;
}
