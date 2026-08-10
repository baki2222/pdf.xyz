/**
 * The pure, node-free **posture resolver** for cleanup evidence monitoring (Phase 44).
 *
 * It folds the resolved {@link CleanupEvidenceConfig}, the per-report read observations the Node
 * reader produced (a parsed summary + a file-mtime fallback, or a bounded read/parse failure),
 * and an injected clock into ONE content-free {@link CleanupEvidencePosture}. All the interesting
 * logic — the freshness rule, the verdict → state mapping, and the worst-wins fold across
 * multiple configured reports — lives here, so every branch is unit-testable without a filesystem
 * or a wall clock.
 *
 * Two honesty rules shape the freshness logic:
 *  - Freshness can only DOWNGRADE a benign reading, never UPGRADE a bad one. A stale (or
 *    timestamp-less) `verified`/`unknown` report becomes `stale` — an old "all clear" is not
 *    fresh proof. A `drift`/`breach` report stays a real warning/critical even when stale: a
 *    concrete cleanup gap does not become less real because the evidence is old.
 *  - A report with no usable timestamp is `freshness: "unknown"`, which is treated as NOT fresh,
 *    so a healthy verdict with no timestamp degrades to `stale` rather than a fabricated healthy.
 */

import {
  CLEANUP_EVIDENCE_DETAIL,
  DISABLED_CLEANUP_EVIDENCE_POSTURE,
  type CleanupEvidenceAge,
  type CleanupEvidenceFreshness,
  type CleanupEvidencePosture,
  type CleanupEvidenceProvider,
  type CleanupEvidenceReason,
  type CleanupEvidenceReportKind,
  type CleanupEvidenceState,
} from "./types";
import type { CleanupEvidenceConfig } from "./config";
import type { CleanupVerdictClass, ParsedCleanupReport } from "./parse";

/** One hour / one day in milliseconds. */
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * One per-report read observation the Node reader hands the resolver:
 *  - `report` — the configured file was read and parsed to a bounded summary; `mtimeMs` is the
 *    file's modification time (epoch ms) for the freshness fallback when the summary itself
 *    carried no `generatedAt`;
 *  - `error`  — the file could not be read (`report_missing` / `report_unreadable`) or was not a
 *    recognized content-free summary (`report_malformed`, incl. a raw export the parser refused).
 */
export type CleanupEvidenceObservation =
  | {
      readonly kind: "report";
      readonly report: ParsedCleanupReport;
      readonly mtimeMs: number | null;
    }
  | {
      readonly kind: "error";
      readonly reason:
        "report_missing" | "report_unreadable" | "report_malformed";
    };

/**
 * A monotonic "worseness" scale over the posture states — a strict total order so a fold across
 * several configured reports deterministically surfaces the single most-actionable posture, with
 * no ambiguous ties. A concrete `critical` breach outranks an `invalid` report, which outranks a
 * `warning` drift, which outranks a `stale` report, which outranks a neutral `unknown`; the
 * neutral non-alerting states share the floor.
 */
const STATE_WORSENESS: Record<CleanupEvidenceState, number> = {
  healthy: 0,
  disabled: 0,
  "not-configured": 0,
  unknown: 1,
  stale: 2,
  warning: 3,
  invalid: 4,
  critical: 5,
};

/** Bucket a report age (ms) into a coarse, content-free age bucket. */
function ageBucket(ageMs: number | null): CleanupEvidenceAge {
  if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) return "unknown";
  if (ageMs < MS_PER_HOUR) return "under-1h";
  if (ageMs < MS_PER_DAY) return "1-24h";
  if (ageMs < 7 * MS_PER_DAY) return "1-7d";
  return "over-7d";
}

/** Assemble a posture from its bounded parts, selecting the authored detail by reason. */
function posture(
  state: CleanupEvidenceState,
  reason: CleanupEvidenceReason,
  provider: CleanupEvidenceProvider,
  freshness: CleanupEvidenceFreshness,
  age: CleanupEvidenceAge,
  reportKind: CleanupEvidenceReportKind,
): CleanupEvidencePosture {
  return {
    state,
    reason,
    provider,
    freshness,
    age,
    reportKind,
    detail: CLEANUP_EVIDENCE_DETAIL[reason],
  };
}

/** Map a parsed report's verdict class to its base (pre-freshness) state. */
function baseStateForVerdict(
  verdictClass: CleanupVerdictClass,
): CleanupEvidenceState {
  switch (verdictClass) {
    case "verified":
      return "healthy";
    case "drift":
      return "warning";
    case "breach":
      return "critical";
    case "unknown":
      return "unknown";
    case "not-configured":
      return "not-configured";
  }
}

/** Resolve the posture for a single successfully-parsed report against the clock. */
function resolveReportPosture(
  report: ParsedCleanupReport,
  mtimeMs: number | null,
  config: CleanupEvidenceConfig,
  now: number,
): CleanupEvidencePosture {
  // Freshness prefers the report's own generatedAt; falls back to the file mtime; neither ⇒
  // unknown (never fabricate a fresh claim).
  const stampMs = report.generatedAtMs ?? mtimeMs;
  const ageMs = stampMs !== null ? Math.max(0, now - stampMs) : null;
  const freshness: CleanupEvidenceFreshness =
    ageMs === null ? "unknown" : ageMs <= config.maxAgeMs ? "fresh" : "stale";
  const age = ageBucket(ageMs);
  const isFresh = freshness === "fresh";

  const base = baseStateForVerdict(report.verdictClass);
  const p = (state: CleanupEvidenceState, reason: CleanupEvidenceReason) =>
    posture(state, reason, report.provider, freshness, age, report.reportKind);

  switch (base) {
    case "not-configured":
      // No remote storage to clean up — neutral regardless of freshness.
      return p("not-configured", "no_report_configured");
    case "warning":
      // A concrete drift stays a warning even if the evidence is stale.
      return p("warning", "cleanup_drift");
    case "critical":
      // A concrete breach stays critical even if the evidence is stale.
      return p("critical", "cleanup_breach");
    case "healthy":
      return isFresh
        ? p("healthy", "cleanup_verified")
        : p("stale", "report_stale"); // an old "all clear" is not fresh proof
    case "unknown":
      return isFresh
        ? p("unknown", "cleanup_unknown")
        : p("stale", "report_stale"); // old + inconclusive ⇒ refresh it
    default:
      return p("unknown", "cleanup_unknown");
  }
}

/** Resolve the posture for a single read observation (a report or a read/parse failure). */
export function resolveObservationPosture(
  observation: CleanupEvidenceObservation,
  config: CleanupEvidenceConfig,
  now: number,
): CleanupEvidencePosture {
  if (observation.kind === "error") {
    switch (observation.reason) {
      case "report_missing":
        return posture(
          "stale",
          "report_missing",
          "unknown",
          "unknown",
          "unknown",
          "none",
        );
      case "report_unreadable":
        return posture(
          "invalid",
          "report_unreadable",
          "unknown",
          "unknown",
          "unknown",
          "none",
        );
      case "report_malformed":
        return posture(
          "invalid",
          "report_malformed",
          "unknown",
          "unknown",
          "unknown",
          "none",
        );
    }
  }
  return resolveReportPosture(
    observation.report,
    observation.mtimeMs,
    config,
    now,
  );
}

/**
 * Fold the resolved config and every per-report observation into one {@link CleanupEvidencePosture}.
 * A disabled config (no report paths) is the honest `disabled` default. With reports configured,
 * the worst posture wins by the strict {@link STATE_WORSENESS} order, so several reports resolve
 * to the single most-actionable posture. Defensive: an enabled config that yielded no
 * observations resolves to `stale`/`report_missing` rather than a fabricated healthy.
 */
export function resolveCleanupEvidencePosture(
  config: CleanupEvidenceConfig,
  observations: readonly CleanupEvidenceObservation[],
  now: number,
): CleanupEvidencePosture {
  if (!config.enabled) return DISABLED_CLEANUP_EVIDENCE_POSTURE;
  if (observations.length === 0) {
    return posture(
      "stale",
      "report_missing",
      "unknown",
      "unknown",
      "unknown",
      "none",
    );
  }
  let worst: CleanupEvidencePosture | null = null;
  for (const observation of observations) {
    const candidate = resolveObservationPosture(observation, config, now);
    if (
      worst === null ||
      STATE_WORSENESS[candidate.state] > STATE_WORSENESS[worst.state]
    ) {
      worst = candidate;
    }
  }
  return worst ?? DISABLED_CLEANUP_EVIDENCE_POSTURE;
}
