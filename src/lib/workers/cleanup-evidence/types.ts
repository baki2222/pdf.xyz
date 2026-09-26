/**
 * The bounded, content-free vocabulary for **cleanup evidence posture monitoring** (Phase 44).
 *
 * Phases 42–43 gave an operator the *tools* to prove storage-artifact cleanup from content-free
 * evidence: the absence verifier (`pnpm worker:cleanup-check`), the dry-run sweeper
 * (`pnpm worker:artifact-cleanup`), and the offline projector (`pnpm worker:cleanup-project`).
 * Each emits a stable, content-free JSON **report summary**. This phase closes the operational
 * loop: it lets the secure-worker operations surface (the ops-check CLI, the `/status`
 * dashboard, the metrics) read those report summaries and answer, at a glance, whether cleanup
 * evidence monitoring is **configured, healthy, stale, or missing** — WITHOUT calling the cloud,
 * reading a secret, or ever seeing an object identifier.
 *
 * This module is the closed vocabulary that monitoring produces. It obeys the same honesty
 * contract as the rest of the worker layer:
 *  - it reads ONLY a content-free report SUMMARY an operator's own scheduled job already wrote
 *    (the bounded `pdfxyz.cleanup-check/1` / `pdfxyz.artifact-cleanup/1` outputs) — never a raw
 *    provider export, never real bucket data, never a live cloud call;
 *  - every token here is a low-cardinality, redaction-stable enum — never a filename, object
 *    key, bucket, URL, endpoint, region, id, token, size, instant, path, or byte;
 *  - it never fabricates a healthy freshness claim from missing evidence: an absent, unreadable,
 *    malformed, or stale report degrades to an honest warn/critical posture, never a false OK.
 *
 * It is deliberately distinct from every neighbouring seam, and the docs keep the four apart:
 *  - cleanup report GENERATION — the Phase 42/43 tools that WRITE the summaries this reads;
 *  - retrieval-time expiry ENFORCEMENT (Phase 41) — denies an expired/tombstoned download `410`;
 *  - the bucket lifecycle policy verifier/backstop — a different evidence rung;
 *  - real cloud listing/deletion — always operator-owned and out-of-band.
 */

/**
 * The bounded posture a cleanup evidence monitor reports — the single value an operator's
 * dashboard/alert keys on. It is the coarse projection of "do we have fresh, healthy proof
 * that storage-artifact cleanup is working here?":
 *  - `disabled`       — no report is configured, so monitoring is off (the honest default);
 *  - `not-configured` — a report is configured and fresh, but it declares object storage as
 *    `not-configured` (no remote backing store), so there is legitimately nothing to clean up;
 *  - `healthy`        — a fresh report proves cleanup is `verified` (or an inventory sweep found
 *    nothing to reconcile): the good state;
 *  - `stale`          — the configured report is present but older than the freshness threshold,
 *    OR no report is present at the configured location yet: no FRESH evidence (warn);
 *  - `warning`        — a fresh report shows cleanup `drift`: an artifact is still present past
 *    its retention window + reap grace (the backstop has not removed it) (warn);
 *  - `critical`       — a fresh report shows a `breach`: a positively should-be-gone artifact in
 *    a critical category (a tombstoned-but-present object) (critical);
 *  - `unknown`        — a fresh report is inconclusive (`unknown`/`unavailable`): cleanup could
 *    not be proven this run (neutral — never over-pages);
 *  - `invalid`        — the configured report is unreadable, malformed, or is a RAW evidence /
 *    inventory / provider-export object pointed at by mistake (a misconfiguration / privacy
 *    risk) (critical).
 */
export const CLEANUP_EVIDENCE_STATES = [
  "disabled",
  "not-configured",
  "healthy",
  "stale",
  "warning",
  "critical",
  "unknown",
  "invalid",
] as const;
export type CleanupEvidenceState = (typeof CLEANUP_EVIDENCE_STATES)[number];

/**
 * The bounded, content-free reason a posture resolved as it did — a stable token a monitor can
 * route on without parsing prose:
 *  - `no_report_configured` — no report path is set (state `disabled`), or the report declares
 *    storage `not-configured` (state `not-configured`): nothing to monitor;
 *  - `report_missing`       — a report IS configured but no file is present at that location yet;
 *  - `report_unreadable`    — the configured path exists but could not be read (an I/O error);
 *  - `report_malformed`     — the report parsed as JSON but is not a recognized content-free
 *    report summary, OR it is a RAW evidence/inventory/provider-export object (refused);
 *  - `report_stale`         — the report is a valid summary but older than the freshness window;
 *  - `cleanup_verified`     — the report proves cleanup is verified / the sweep found nothing;
 *  - `cleanup_drift`        — the report shows drift (present past retention + reap grace);
 *  - `cleanup_unknown`      — the report is inconclusive (unknown / unavailable / not-configured);
 *  - `cleanup_breach`       — the report shows a breach (a positively should-be-gone object).
 */
export const CLEANUP_EVIDENCE_REASONS = [
  "no_report_configured",
  "report_missing",
  "report_unreadable",
  "report_malformed",
  "report_stale",
  "cleanup_verified",
  "cleanup_drift",
  "cleanup_unknown",
  "cleanup_breach",
] as const;
export type CleanupEvidenceReason = (typeof CLEANUP_EVIDENCE_REASONS)[number];

/**
 * The bounded storage provider a report was evaluated for — the {@link RetrievalStorageProvider}
 * vocabulary the rest of the cleanup layer uses, plus `unknown` for a report that does not
 * declare a single provider (a plain `artifact-cleanup` summary carries none). Never an
 * endpoint, region, bucket, or account — only which class of backend the report concerned.
 */
export const CLEANUP_EVIDENCE_PROVIDERS = [
  "local-dev",
  "remote-configured",
  "not-configured",
  "unknown",
] as const;
export type CleanupEvidenceProvider =
  (typeof CLEANUP_EVIDENCE_PROVIDERS)[number];

/**
 * A coarse freshness tri-state, derived from the report's own `generatedAt` (or, as a documented
 * fallback, the report file's mtime) against the configured threshold — never a raw instant:
 *  - `fresh`   — within the freshness window;
 *  - `stale`   — older than the window;
 *  - `unknown` — no usable timestamp at all (so freshness cannot be claimed — never treated as
 *    fresh, which is why a would-be-healthy report with no timestamp degrades to `stale`).
 */
export const CLEANUP_EVIDENCE_FRESHNESS = [
  "fresh",
  "stale",
  "unknown",
] as const;
export type CleanupEvidenceFreshness =
  (typeof CLEANUP_EVIDENCE_FRESHNESS)[number];

/**
 * A coarse age bucket for the report, for a dashboard to show "how old" WITHOUT a raw timestamp
 * or duration. `unknown` when no usable timestamp is available or no report is present.
 */
export const CLEANUP_EVIDENCE_AGE_BUCKETS = [
  "under-1h",
  "1-24h",
  "1-7d",
  "over-7d",
  "unknown",
] as const;
export type CleanupEvidenceAge = (typeof CLEANUP_EVIDENCE_AGE_BUCKETS)[number];

/**
 * Which content-free tool report drove the posture (or `none` when disabled / no report):
 *  - `cleanup-check`    — the absence verifier's `pdfxyz.cleanup-check/1` summary;
 *  - `artifact-cleanup` — the dry-run sweeper's `pdfxyz.artifact-cleanup/1` summary.
 * A bounded structural token — never a filename or path.
 */
export const CLEANUP_EVIDENCE_REPORT_KINDS = [
  "cleanup-check",
  "artifact-cleanup",
  "none",
] as const;
export type CleanupEvidenceReportKind =
  (typeof CLEANUP_EVIDENCE_REPORT_KINDS)[number];

/**
 * The full, content-free cleanup evidence posture the operations surface embeds and renders.
 * Every field is a bounded enum or authored prose — there is nowhere to put, and it never
 * carries, an object key, bucket, URL, endpoint, region, filename, path, instant, size, or byte.
 */
export interface CleanupEvidencePosture {
  /** The bounded posture state. */
  readonly state: CleanupEvidenceState;
  /** The bounded reason the state resolved. */
  readonly reason: CleanupEvidenceReason;
  /** The bounded storage provider the driving report concerned. */
  readonly provider: CleanupEvidenceProvider;
  /** The coarse freshness tri-state of the driving report. */
  readonly freshness: CleanupEvidenceFreshness;
  /** The coarse age bucket of the driving report. */
  readonly age: CleanupEvidenceAge;
  /** Which content-free tool report drove the posture. */
  readonly reportKind: CleanupEvidenceReportKind;
  /** One-line, content-free explanation. Authored from the bounded inputs; never echoes a path. */
  readonly detail: string;
}

/** The default cleanup evidence posture: monitoring is OFF until a report path is configured. */
export const DISABLED_CLEANUP_EVIDENCE_POSTURE: CleanupEvidencePosture = {
  state: "disabled",
  reason: "no_report_configured",
  provider: "unknown",
  freshness: "unknown",
  age: "unknown",
  reportKind: "none",
  detail:
    "Cleanup evidence monitoring is not configured here, so cleanup posture is not observed. Point it at a content-free cleanup-check or artifact-cleanup report summary to enable it.",
};

/**
 * Content-free detail prose per (state, reason). Authored here so the posture never carries a
 * server- or report-chosen string; the resolver selects one by the resolved reason. Keeping the
 * copy in one exhaustive map means a new reason fails the build here until its prose is written.
 */
export const CLEANUP_EVIDENCE_DETAIL: Record<CleanupEvidenceReason, string> = {
  no_report_configured:
    "No content-free cleanup evidence report is configured (or the configured report reports no object storage), so there is nothing to monitor here.",
  report_missing:
    "A cleanup evidence report is configured, but no report file is present at that location yet. Confirm the generating job (worker:cleanup-check / worker:artifact-cleanup) has run.",
  report_unreadable:
    "A cleanup evidence report is configured, but its file could not be read. Check the file's permissions and that the generating job is writing it where the monitor expects.",
  report_malformed:
    "The configured cleanup evidence report is not a recognized content-free report summary (or is a raw evidence/inventory/provider export). Point the monitor at a worker:cleanup-check or worker:artifact-cleanup JSON summary — never a raw export.",
  report_stale:
    "The configured cleanup evidence report is older than the freshness threshold (or carries no usable timestamp), so there is no fresh proof of cleanup. Confirm the generating job is running on schedule.",
  cleanup_verified:
    "A fresh cleanup evidence report shows cleanup is verified: every should-be-gone artifact is confirmed absent (or the dry-run sweep found nothing to reconcile).",
  cleanup_drift:
    "A fresh cleanup evidence report shows drift: at least one artifact is still present past its retention window and reap grace, so the bucket lifecycle backstop has not removed it. Reconcile it out-of-band.",
  cleanup_unknown:
    "A fresh cleanup evidence report is inconclusive: cleanup could not be proven this run (present-but-denied awaiting reap, no evidence, or no storage backend). Neutral — re-run once evidence is available.",
  cleanup_breach:
    "A fresh cleanup evidence report shows a breach: a positively should-be-gone artifact (a tombstoned-but-present object, or an invalid record) is present. Reconcile it out-of-band and confirm active deletion / the bucket lifecycle backstop.",
};
