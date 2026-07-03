/**
 * The content-free **artifact cleanup-verifier receipt**: the durable, per-run audit
 * record a cleanup verification emits. It is the cleanup counterpart to
 * `../expiry-receipt` (per-read lifecycle drift) and `../../lifecycle` verification: the
 * aggregate metric (`worker_artifact_cleanup_total`, see `../../observability`) answers
 * "how many present objects, in what cleanup category" for a dashboard; this receipt
 * answers "what did one verifier RUN conclude, and when" for an audit trail an operator
 * can forward to a SIEM to watch cleanup posture over time.
 *
 * The load-bearing signal it carries: a `drift` verdict means present objects are past
 * their retention window (or tombstoned) yet still in the bucket — the bucket has not
 * reaped what the app no longer serves. A `breach` verdict means a tombstoned-but-present
 * object or a structurally invalid inventory record. Neither is proof of deletion, nor a
 * claim about the bucket lifecycle policy's correctness; the app already denies the
 * download at retrieval (Phase 41) regardless. `unknown` means some objects carry no
 * usable lifecycle/manifest evidence.
 *
 * Like every receipt in the worker layer it is emitted through an OPTIONAL, operator-wired
 * observer that DEFAULTS to none (no console noise, no I/O). It carries only bounded
 * verdict/severity enums, small counts, the stable policy id/version, and an optional ISO
 * timestamp — never a handle, filename, object key, bucket name, signed URL, job/user id,
 * path, size, expiry instant, or byte. So a receipt is safe to log or forward verbatim.
 * See docs/OBSERVABILITY.md and docs/SECURITY.md.
 */

import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "../policy";
import { CLEANUP_SEVERITIES, type CleanupSeverity, type CleanupVerdict } from "./taxonomy";
import type { ArtifactCleanupReport } from "./evaluate";

/**
 * A content-free cleanup-verifier receipt. Every field is a bounded enum, a small count,
 * a stable policy constant, or an optional ISO timestamp — never a user string, key,
 * path, size, instant, or byte.
 */
export interface ArtifactCleanupReceipt {
  /** Fixed category so a receipt is self-describing in a mixed sink. */
  readonly category: "artifact-cleanup";
  /** The overall verdict (`ok` / `unknown` / `drift` / `breach`). */
  readonly verdict: CleanupVerdict;
  /** How many present objects were evaluated. */
  readonly total: number;
  /** How many have positive evidence they should be gone (expired/tombstoned). */
  readonly cleanupRecommended: number;
  /** Count per severity (a bounded rollup — never a per-object identity). */
  readonly severities: Readonly<Record<CleanupSeverity, number>>;
  /** Stable policy identity — the id and schema version the run evaluated under. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** Optional ISO-8601 timestamp, when the caller supplied a clock. */
  readonly at?: string;
}

/**
 * Derive an {@link ArtifactCleanupReceipt} from a completed {@link ArtifactCleanupReport}.
 * Pure and total: it copies only the report's already-bounded verdict/counts and stamps
 * the stable policy id/version, so it can never carry more than the report already did —
 * content-free by construction.
 */
export function buildArtifactCleanupReceipt(
  report: ArtifactCleanupReport,
  at?: string,
): ArtifactCleanupReceipt {
  const severities = {} as Record<CleanupSeverity, number>;
  for (const severity of CLEANUP_SEVERITIES) {
    severities[severity] = report.severities[severity];
  }
  return {
    category: "artifact-cleanup",
    verdict: report.verdict,
    total: report.total,
    cleanupRecommended: report.cleanupRecommended,
    severities,
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    ...(at ? { at } : {}),
  };
}

/** A sink an operator wires to observe cleanup receipts (an audit log line, a SIEM, …). */
export type ArtifactCleanupObserver = (receipt: ArtifactCleanupReceipt) => void;

// Module-global, swappable observer — the same reset-for-tests posture the expiry and
// retrieval receipt sinks use. Default null: a caller derives the receipt but emits to
// nothing until an operator opts in, so there is no side effect in a stock deployment.
let observer: ArtifactCleanupObserver | null = null;

/** Register (or clear, with `null`) the process-wide cleanup-receipt observer. */
export function setArtifactCleanupObserver(
  next: ArtifactCleanupObserver | null,
): void {
  observer = next;
}

/** Restore the default (no) observer. Named for test isolation. */
export function resetArtifactCleanupObserverForTests(): void {
  observer = null;
}

/**
 * Derive a receipt from a completed report and emit it to the registered observer, if
 * any. A throwing observer is swallowed: observability must never break a verification
 * run. Returns the receipt so a caller can also attach it to its own output.
 */
export function emitArtifactCleanupReceipt(
  report: ArtifactCleanupReport,
  at?: string,
): ArtifactCleanupReceipt {
  const receipt = buildArtifactCleanupReceipt(report, at);
  try {
    observer?.(receipt);
  } catch {
    // An operator's sink must never turn a valid verification into an error.
  }
  return receipt;
}
