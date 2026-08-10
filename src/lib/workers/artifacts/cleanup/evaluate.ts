/**
 * The pure **storage-artifact cleanup evaluator** (Phase 42) — the honest-evidence rung
 * between Phase 41's retrieval-time expiry ENFORCEMENT and an operator's out-of-band
 * bucket cleanup. It takes a bounded, content-free {@link ArtifactInventory} (an offline
 * projection of a bucket listing) and resolves each present object into ONE
 * {@link CleanupCategory}, then folds the set into a content-free {@link ArtifactCleanupReport}
 * an operator can act on.
 *
 * What it is, and (loud, load-bearing) what it is NOT:
 *  - It categorizes PRESENT objects against the app's lifecycle/manifest rules — objects
 *    the bucket still lists. An object the bucket has already reaped simply is not in the
 *    inventory, so its ABSENCE is not evidence this tool needs to see. It therefore reports
 *    "which present objects should no longer be here" (drift/breach), never "prove the
 *    bytes were deleted": it is NOT a deletion proof, NOT a CDN-purge check, NOT a claim
 *    about the bucket lifecycle policy's correctness, NOT malware/sanitization. Actual
 *    object deletion stays operator-owned and out-of-band (see docs/RUNBOOK.md); this tool
 *    NEVER deletes anything.
 *  - It re-derives lifecycle from the SAME evidence the retrieval boundary uses
 *    ({@link evaluateArtifactLifecycle} over `{ expiresAtMs, deleted }` against the run
 *    clock), so an `expired`/`deleted` verdict here means exactly what a `410 Gone`
 *    denial means there — computed from bounded METADATA only, never from an object's
 *    bytes (this tool reads no bytes at all).
 *
 * Honesty of escalation: a record's severity is raised ONLY on positive evidence — an
 * explicit tombstone (`deleted-but-present`, breach), a passed retention deadline
 * (`expired-but-present`, drift), or a structurally invalid record (`invalid-record`,
 * breach). Absent/incomplete evidence (no lifecycle fact, no valid manifest, an
 * unrecognized kind, a not-configured backend) is only ever `unknown` ("not enough
 * evidence"), never a fabricated cleanup recommendation. So a confident `ok` verdict
 * requires COMPLETE healthy evidence, and the tool never recommends deleting an object it
 * cannot positively show is expired or tombstoned.
 *
 * Pure, deterministic, node-free, and content-free by construction: the report references
 * only bounded category/severity/action enums, coarse buckets, small counts, the stable
 * policy id/version, and fixed prose — never an object key, bucket, URL, filename, raw
 * instant, size, id, or byte.
 */

import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "../policy";
import {
  evaluateArtifactLifecycle,
  type StorageArtifactLifecycle,
} from "../lifecycle";
import { ARTIFACT_OUTPUT_KINDS, type ArtifactOutputKind } from "../types";
import type { ProcessorKind } from "../../observability/metrics";
import {
  CLEANUP_ACTION_BY_CATEGORY,
  CLEANUP_CATEGORIES,
  CLEANUP_SEVERITIES,
  CLEANUP_SEVERITY_BY_CATEGORY,
  worseSeverity,
  type CleanupCategory,
  type CleanupPlanAction,
  type CleanupSeverity,
  type CleanupVerdict,
} from "./taxonomy";
import type {
  ArtifactInventory,
  ArtifactInventoryRecord,
  InventoryProvider,
  ObjectAgeBucket,
  ObjectSizeBucket,
} from "./inventory";

/**
 * Resolve a record's EFFECTIVE lifecycle state against the run clock. Raw retention
 * evidence (`expiresAtMs`/`deleted`) is re-evaluated through the exact Phase 41
 * {@link evaluateArtifactLifecycle} — so a passed deadline or a tombstone is derived, not
 * trusted from a possibly-stale pre-resolved field. When no raw evidence is present, a
 * pre-resolved `declaredLifecycle` is honored; absent both, the state is `unknown`
 * (present but no usable evidence — never treated as deletion/expiry).
 */
export function resolveRecordLifecycle(
  record: ArtifactInventoryRecord,
  nowMs: number,
): StorageArtifactLifecycle {
  if (record.expiresAtMs !== null || record.deleted) {
    return evaluateArtifactLifecycle(
      { expiresAtMs: record.expiresAtMs ?? 0, deleted: record.deleted },
      nowMs,
    );
  }
  return record.declaredLifecycle ?? "unknown";
}

/**
 * Classify one record into its single primary {@link CleanupCategory}, by a deterministic
 * precedence that surfaces the most severe / most actionable finding first:
 *
 *   invalid record            → invalid-record        (breach)
 *   lifecycle = deleted       → deleted-but-present    (breach)
 *   lifecycle = expired       → expired-but-present    (drift)
 *   provider = not-configured → storage-unavailable    (unknown)
 *   lifecycle = unknown       → missing-lifecycle      (unknown)
 *   manifest ≠ valid          → missing-manifest       (unknown)
 *   kind = unknown            → unsupported-kind        (unknown)
 *   otherwise                 → ok                      (ok)
 *
 * The breach/drift tiers require POSITIVE evidence (a tombstone, a passed deadline, a
 * broken record); everything after is an evidence GAP that resolves to `unknown`. So a
 * live object with complete, consistent metadata is `ok`, and any gap in that evidence is
 * an honest `unknown`, never an overclaimed cleanup recommendation.
 */
export function classifyArtifactRecord(
  record: ArtifactInventoryRecord,
  nowMs: number,
): CleanupCategory {
  if (!record.wellFormed) return "invalid-record";

  const lifecycle = resolveRecordLifecycle(record, nowMs);
  if (lifecycle === "deleted") return "deleted-but-present";
  if (lifecycle === "expired") return "expired-but-present";

  if (record.provider === "not-configured") return "storage-unavailable";
  if (lifecycle === "unknown") return "missing-lifecycle";
  if (record.manifest !== "valid") return "missing-manifest";
  if (record.kind === "unknown") return "unsupported-kind";
  return "ok";
}

/** One line of the reconciliation plan: an action + a count, per non-empty category. */
export interface CleanupPlanItem {
  readonly category: CleanupCategory;
  readonly action: CleanupPlanAction;
  readonly severity: CleanupSeverity;
  /** How many present objects fell into this category. Never an identifier. */
  readonly count: number;
}

/** Content-free breakdowns over the bounded descriptive dimensions (counts only). */
export interface CleanupBreakdown {
  readonly providers: Readonly<Record<InventoryProvider, number>>;
  readonly kinds: Readonly<Record<ArtifactOutputKind, number>>;
  readonly processors: Readonly<Record<ProcessorKind, number>>;
  readonly ages: Readonly<Record<ObjectAgeBucket, number>>;
  readonly sizes: Readonly<Record<ObjectSizeBucket, number>>;
}

/**
 * The full, content-free cleanup report. Every field is a bounded verdict/category/
 * severity enum, a small count, a coarse bucket tally, the stable policy id/version, or
 * fixed prose — never an object key, bucket, URL, filename, raw instant, size, id, or byte.
 */
export interface ArtifactCleanupReport {
  /** The overall verdict — the worst severity present (`ok` for an empty inventory). */
  readonly verdict: CleanupVerdict;
  /** How many present objects were evaluated. */
  readonly total: number;
  /** Count per category (all categories present, including zeros, for a stable shape). */
  readonly categories: Readonly<Record<CleanupCategory, number>>;
  /** Count per severity (rollup of the categories). */
  readonly severities: Readonly<Record<CleanupSeverity, number>>;
  /**
   * How many present objects have positive evidence they should be gone (the `delete`
   * action: expired or tombstoned) — the headline "sweep candidate" count.
   */
  readonly cleanupRecommended: number;
  /** The reconciliation plan — one item per non-empty category (a count + an action). */
  readonly plan: readonly CleanupPlanItem[];
  /** Content-free tallies over the descriptive dimensions. */
  readonly breakdown: CleanupBreakdown;
  /** Stable policy identity the evaluation was made under. */
  readonly policyId: string;
  readonly policyVersion: number;
  /** One-line, content-free summary of the verdict. */
  readonly summary: string;
}

/** Build a zeroed count map over a bounded tuple. */
function zeroed<T extends string>(keys: readonly T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const key of keys) out[key] = 0;
  return out;
}

const AGE_KEYS = [
  "under-1h",
  "1-24h",
  "1-7d",
  "7-30d",
  "over-30d",
  "unknown",
] as const;
const SIZE_KEYS = [
  "under-64kb",
  "64kb-1mb",
  "1-10mb",
  "10-100mb",
  "over-100mb",
  "unknown",
] as const;
const PROVIDER_KEYS = [
  "local-dev",
  "remote-configured",
  "not-configured",
  "unknown",
] as const;
/**
 * Derived from the taxonomy rather than restated, so a new output kind can never
 * leave this breakdown silently missing a bucket (it did, for `office-document`).
 */
const KIND_KEYS = ARTIFACT_OUTPUT_KINDS;
const PROCESSOR_KEYS = ["compress", "ocr", "other"] as const;

/** A content-free one-line summary keyed off the verdict + headline counts. */
function summarize(
  verdict: CleanupVerdict,
  total: number,
  cleanupRecommended: number,
  breach: number,
): string {
  switch (verdict) {
    case "ok":
      return total === 0
        ? "No artifacts in the inventory; nothing to clean up."
        : `All ${total} inventoried artifact(s) are live with complete, healthy metadata; no cleanup needed.`;
    case "unknown":
      return `Not enough evidence to fully verify ${total} inventoried artifact(s): some carry no usable lifecycle/manifest evidence or a not-configured backend. Investigate before acting.`;
    case "drift":
      return `Cleanup recommended: ${cleanupRecommended} present artifact(s) are past their retention window (or tombstoned) yet still present. Remove them out-of-band.`;
    case "breach":
      return `Policy breach: ${breach} record(s) are structurally invalid or tombstoned-but-present. The inventory cannot be trusted as a clean bill of health until resolved.`;
  }
}

/**
 * Evaluate a whole {@link ArtifactInventory} into a content-free {@link ArtifactCleanupReport}.
 * Deterministic and pure given `(inventory, nowMs)`. The verdict is the worst severity
 * across all records (or `ok` for an empty inventory — nothing present, nothing to clean).
 */
export function evaluateArtifactInventory(
  inventory: ArtifactInventory,
  nowMs: number,
): ArtifactCleanupReport {
  const categories = zeroed(CLEANUP_CATEGORIES);
  const severities = zeroed(CLEANUP_SEVERITIES);
  const providers = zeroed(PROVIDER_KEYS);
  const kinds = zeroed(KIND_KEYS);
  const processors = zeroed(PROCESSOR_KEYS);
  const ages = zeroed(AGE_KEYS);
  const sizes = zeroed(SIZE_KEYS);

  let verdict: CleanupVerdict = "ok";
  let cleanupRecommended = 0;

  for (const record of inventory.records) {
    const category = classifyArtifactRecord(record, nowMs);
    const severity = CLEANUP_SEVERITY_BY_CATEGORY[category];
    categories[category] += 1;
    severities[severity] += 1;
    verdict = worseSeverity(verdict, severity);
    if (CLEANUP_ACTION_BY_CATEGORY[category] === "delete")
      cleanupRecommended += 1;

    providers[record.provider] += 1;
    kinds[record.kind] += 1;
    processors[record.processor] += 1;
    ages[record.age] += 1;
    sizes[record.size] += 1;
  }

  const plan: CleanupPlanItem[] = CLEANUP_CATEGORIES.filter(
    (category) => categories[category] > 0,
  ).map((category) => ({
    category,
    action: CLEANUP_ACTION_BY_CATEGORY[category],
    severity: CLEANUP_SEVERITY_BY_CATEGORY[category],
    count: categories[category],
  }));

  return {
    verdict,
    total: inventory.records.length,
    categories,
    severities,
    cleanupRecommended,
    plan,
    breakdown: { providers, kinds, processors, ages, sizes },
    policyId: ARTIFACT_POLICY_ID,
    policyVersion: ARTIFACT_POLICY_VERSION,
    summary: summarize(
      verdict,
      inventory.records.length,
      cleanupRecommended,
      severities.breach,
    ),
  };
}

/**
 * The CLI exit codes, keyed by verdict. Documented in the CLI usage and docs/RUNBOOK.md;
 * monotonic with severity so a worse finding never lowers the code:
 *  - `ok`      → 0 (no cleanup/drift found);
 *  - `unknown` → 2 (not enough evidence);
 *  - `drift`   → 3 (cleanup recommended / warning drift);
 *  - `breach`  → 4 (invalid/breached policy).
 * (Exit `1` is reserved by the CLI for a usage/input error — never a verdict.)
 */
export const CLEANUP_EXIT_CODES: Readonly<Record<CleanupVerdict, number>> = {
  ok: 0,
  unknown: 2,
  drift: 3,
  breach: 4,
};

/** The CLI exit code a report's verdict maps to. */
export function exitCodeForCleanupVerdict(verdict: CleanupVerdict): number {
  return CLEANUP_EXIT_CODES[verdict];
}
