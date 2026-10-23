/**
 * The two bounded alert vocabularies, kept in a module of their own.
 *
 * They live apart from `alerts.ts` because the status page renders them in the
 * browser (`alert-posture.tsx`), and `alerts.ts` takes a value import from
 * `snapshot.ts`, which reaches the compression engine and so pdf-lib. Read from
 * there, the status page carried pdf-lib and the tool catalogue for two arrays
 * of strings: 418.5 KB gz first load on production (2026-10-23), 224.1 once
 * moved. `alerts.ts` re-exports both, so server-side callers are unchanged.
 * Not guarded here: `src/deploy/lazy-chunks.test.ts` and the status page row
 * of `bundle-budget.test.ts` fail on the built page if an import added to
 * this file brings pdf-lib back.
 */

/**
 * The alert-oriented severity ladder a pager reads — the coarse projection of the
 * finer snapshot {@link HealthClass} and SLO {@link SloStatus}. `critical` is the
 * union of a startup blocker and an SLO breach; `unknown` means "not determinable
 * here", which never escalates over a concrete signal but is surfaced honestly.
 */
export const ALERT_SEVERITIES = ["ok", "warn", "critical", "unknown"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * The operator-meaningful problem category. Bounded and stable, so an alert rule can
 * match on `reason` rather than free text. `healthy` is the no-alert baseline.
 */
export const ALERT_REASONS = [
  "healthy",
  "not-drainable",
  "storage-unconfigured",
  "queue-unconfigured",
  "guardrail-error",
  "guardrail-warning",
  "engine-degraded",
  "ocr-unavailable",
  "scanner-unavailable",
  "rate-limit-misconfigured",
  "rate-limit-fail-open",
  "rate-limit-shared-bucket",
  // The COST control's three alertable states. `ai-spend-ceiling-reached` is
  // deliberately separate from the other two: it means the ceiling WORKED, and
  // an hourly watcher that could not tell it from a broken one would either
  // page on a healthy degradation or learn to ignore both.
  "ai-spend-unenforced",
  "ai-spend-tiers-unproven",
  "ai-spend-ceiling-reached",
  "lifecycle-undeclared",
  "lifecycle-unverified",
  "lifecycle-drift",
  "cleanup-evidence-stale",
  "cleanup-evidence-drift",
  "cleanup-evidence-breach",
  "cleanup-evidence-invalid",
  // The running IMAGE does not carry something the product's copy promises.
  // Separate from every liveness reason: the worker is alive, drainable and
  // healthy — it is simply not the build `main` describes. Nine days of that
  // went unnoticed because every liveness signal was green the whole time.
  "worker-capability-missing",
  "worker-capability-unknown",
  "loop-errors",
  "liveness-observed",
  "liveness-stale",
  "liveness-absent",
  "liveness-disabled",
  "slo-breach",
  "slo-warn",
  "indeterminate",
] as const;
export type AlertReason = (typeof ALERT_REASONS)[number];
