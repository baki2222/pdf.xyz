/**
 * The **config seam** for cleanup evidence posture monitoring (Phase 44) — node-free env
 * resolution, disabled by default.
 *
 * Monitoring is OFF until an operator explicitly points it at a content-free report SUMMARY
 * one of the Phase 42/43 tools already writes. There is nothing to enable beyond a path: the
 * presence of a configured report path is the enable signal, so the default (no paths) is an
 * honest `disabled` posture. Two independent, optional report paths are supported so a
 * deployment can monitor the absence verifier's summary, the dry-run sweeper's summary, or both.
 *
 * This module reads ONLY a bounded env record. It never reads a file, calls the cloud, or reads
 * a secret VALUE — the file read happens behind the injectable Node seam in `./read`. The
 * resolved config carries the operator's own file references so the reader can open them; those
 * paths are used ONLY to open the files and are NEVER surfaced into the posture, output, logs,
 * or errors. `env` is injectable, so every branch is unit-testable.
 */

type EnvSource = Record<string, string | undefined>;

/** The environment variables that configure cleanup evidence monitoring. */
export const CLEANUP_EVIDENCE_ENV = {
  /** Path to the absence verifier's content-free `pdfxyz.cleanup-check/1` JSON summary. */
  checkReport: "PDFXYZ_CLEANUP_EVIDENCE_CHECK_REPORT",
  /** Path to the dry-run sweeper's content-free `pdfxyz.artifact-cleanup/1` JSON summary. */
  sweepReport: "PDFXYZ_CLEANUP_EVIDENCE_SWEEP_REPORT",
  /** Freshness threshold in hours (a report older than this is `stale`). */
  maxAgeHours: "PDFXYZ_CLEANUP_EVIDENCE_MAX_AGE_HOURS",
} as const;

/** One hour in milliseconds. */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * The default freshness threshold, in hours. A cleanup evidence report is typically written by a
 * scheduled (e.g. daily) job, so the default tolerates a daily cadence plus jitter: a report
 * older than ~26h is `stale`. Documented in docs/OBSERVABILITY.md and docs/RUNBOOK.md.
 */
export const DEFAULT_MAX_AGE_HOURS = 26;

/** The freshness threshold is bounded to a sane operational range: 1 hour … 30 days. */
export const MIN_MAX_AGE_HOURS = 1;
export const MAX_MAX_AGE_HOURS = 24 * 30;

/** The resolved, bounded cleanup evidence monitoring configuration. */
export interface CleanupEvidenceConfig {
  /** True iff at least one report path is configured (the enable signal). */
  readonly enabled: boolean;
  /**
   * Operator file reference for the cleanup-check summary, or `null`. Used ONLY to open the
   * file in `./read`; never surfaced into the posture, output, logs, or errors.
   */
  readonly checkReportPath: string | null;
  /** Operator file reference for the artifact-cleanup summary, or `null`. Same handling. */
  readonly sweepReportPath: string | null;
  /** The resolved freshness threshold in milliseconds (already clamped to the bounded range). */
  readonly maxAgeMs: number;
}

/** Read a trimmed non-empty string env value, or `undefined`. */
function readString(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the freshness threshold in ms from the env, clamped to the bounded range. A missing,
 * non-numeric, or out-of-range value falls back to the default — never throws, never trusts a
 * pathological number that could make everything look fresh or everything look stale.
 */
function resolveMaxAgeMs(env: EnvSource): number {
  const raw = readString(env, CLEANUP_EVIDENCE_ENV.maxAgeHours);
  const parsed = raw !== undefined ? Number(raw) : NaN;
  const hours =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(MAX_MAX_AGE_HOURS, Math.max(MIN_MAX_AGE_HOURS, parsed))
      : DEFAULT_MAX_AGE_HOURS;
  return hours * MS_PER_HOUR;
}

/**
 * Resolve the {@link CleanupEvidenceConfig} from an environment. Pure and total: it never reads
 * a file or a secret value, never throws, and defaults to `disabled` (no report paths). `env` is
 * injectable so the resolution is unit-testable.
 */
export function resolveCleanupEvidenceConfig(
  env: EnvSource = process.env,
): CleanupEvidenceConfig {
  const checkReportPath =
    readString(env, CLEANUP_EVIDENCE_ENV.checkReport) ?? null;
  const sweepReportPath =
    readString(env, CLEANUP_EVIDENCE_ENV.sweepReport) ?? null;
  return {
    enabled: checkReportPath !== null || sweepReportPath !== null,
    checkReportPath,
    sweepReportPath,
    maxAgeMs: resolveMaxAgeMs(env),
  };
}
