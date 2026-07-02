/**
 * Object-**retention** settings for the secure-worker storage bucket — parsed from
 * the environment, validated for presence and shape only, and the single source of
 * truth the lifecycle-policy generator (`./policy.ts`) turns into a provider
 * backstop.
 *
 * This is the storage-lifetime counterpart of the presign-TTL knobs in
 * `../storage/s3-config.ts`. It answers a different question: not "how long is a
 * signed URL valid?" but "what is the hard upper bound on how long an input object
 * or a produced artifact may physically live in the bucket before the provider's
 * own lifecycle rules delete it — even if the app's active delete-now never runs?".
 *
 * Security & honesty posture (the load-bearing rules of this module):
 *  - Node-free leaf: plain string/integer parsing only, so the presence-only
 *    lifecycle readiness (`./config.ts`) and the client-safe status layer can reuse
 *    it without pulling any Node built-in into a bundle.
 *  - Every bound is a privacy ceiling, not just a sanity check: a deployment can
 *    make retention *shorter* than the default, never longer than the hard maximum.
 *    An out-of-range or malformed override fails closed — the resolver falls back to
 *    the safe {@link DEFAULT_RETENTION_SETTINGS} and names the offending *variable*
 *    (never its value) for server-side diagnostics and the deploy guardrails.
 *  - It defaults to exactly the existing {@link DEFAULT_RETENTION} window, so a bare
 *    environment behaves identically to before this module existed.
 */

import { DEFAULT_RETENTION, type FieldError } from "@/lib/jobs";

type EnvSource = Record<string, string | undefined>;

/** The environment variables this module reads (names only; never values). */
export const RETENTION_ENV = {
  inputTtlMinutes: "PDFXYZ_RETENTION_INPUT_TTL_MINUTES",
  artifactTtlMinutes: "PDFXYZ_RETENTION_ARTIFACT_TTL_MINUTES",
  multipartAbortHours: "PDFXYZ_RETENTION_MULTIPART_ABORT_HOURS",
  noncurrentVersionDays: "PDFXYZ_RETENTION_NONCURRENT_VERSION_DAYS",
} as const;

/**
 * Hard bounds for every retention knob. The maxima are privacy ceilings — a
 * misconfigured deployment can never retain a user's file longer than these — and
 * are aligned with the 7-day ceilings the queue/storage TTLs already enforce.
 */
export const RETENTION_BOUNDS = {
  /** Minutes an input object may live before the lifecycle backstop deletes it. */
  inputTtlMinutes: { min: 1, max: 10_080 }, // 1 min .. 7 days
  /** Minutes a produced artifact may stay downloadable before deletion. */
  artifactTtlMinutes: { min: 1, max: 10_080 },
  /** Hours a stalled multipart upload may linger before it is aborted. */
  multipartAbortHours: { min: 1, max: 168 }, // 1 hour .. 7 days
  /** Days a noncurrent version may survive on a versioned bucket before deletion. */
  noncurrentVersionDays: { min: 1, max: 7 },
} as const;

/** Default hours after which a stalled multipart upload is aborted. */
const DEFAULT_MULTIPART_ABORT_HOURS = 24;

/**
 * A validated object-retention configuration. Minute granularity for object TTLs
 * (matching the app's {@link DEFAULT_RETENTION}); the lifecycle generator converts
 * these to the coarser day granularity that S3-compatible providers enforce.
 */
export interface RetentionSettings {
  /** Hard upper bound (minutes) on an input object's lifetime in the bucket. */
  readonly inputTtlMinutes: number;
  /** Hard upper bound (minutes) on a produced artifact's downloadable lifetime. */
  readonly artifactTtlMinutes: number;
  /** Hours after which a stalled/incomplete multipart upload is aborted. */
  readonly multipartAbortHours: number;
  /**
   * Days a noncurrent object version may survive on a versioned bucket before it
   * is deleted. Only meaningful when the bucket has versioning enabled; the
   * generator emits the corresponding rule when asked for a versioned policy.
   */
  readonly noncurrentVersionDays: number;
}

/**
 * The safe default retention: exactly the app-wide {@link DEFAULT_RETENTION}
 * window for objects, a 24h multipart-abort backstop, and a 1-day noncurrent
 * cleanup. A bare environment resolves to this, unchanged from prior behavior.
 */
export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  inputTtlMinutes: DEFAULT_RETENTION.inputTtlMinutes,
  artifactTtlMinutes: DEFAULT_RETENTION.outputTtlMinutes,
  multipartAbortHours: DEFAULT_MULTIPART_ABORT_HOURS,
  noncurrentVersionDays: RETENTION_BOUNDS.noncurrentVersionDays.min,
};

/** Outcome of parsing the environment for retention settings. */
export type ParseRetentionResult =
  | { ok: true; config: RetentionSettings }
  | {
      ok: false;
      /** Missing/malformed/out-of-bounds variables, by NAME only. */
      issues: FieldError[];
    };

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Parse a positive-integer setting within `[min, max]`; unset ⇒ default. */
function parseBoundedInt(
  raw: string | undefined,
  bounds: { min: number; max: number },
  fallback: number,
): { ok: true; value: number } | { ok: false } {
  if (raw === undefined) return { ok: true, value: fallback };
  if (!/^\d{1,7}$/.test(raw)) return { ok: false };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < bounds.min || n > bounds.max) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

/**
 * Parse and validate the retention configuration from an environment source.
 * Presence and shape only; every knob is optional with a safe default, so this
 * fails only when a *provided* value is malformed or exceeds its privacy ceiling —
 * in which case it returns the offending variable names (never values). `env` is
 * injectable for deterministic tests.
 */
export function parseRetentionSettings(
  env: EnvSource = process.env,
): ParseRetentionResult {
  const issues: FieldError[] = [];

  const inputTtl = parseBoundedInt(
    read(env, RETENTION_ENV.inputTtlMinutes),
    RETENTION_BOUNDS.inputTtlMinutes,
    DEFAULT_RETENTION_SETTINGS.inputTtlMinutes,
  );
  if (!inputTtl.ok) {
    issues.push({
      field: RETENTION_ENV.inputTtlMinutes,
      message: `Integer minutes in [${RETENTION_BOUNDS.inputTtlMinutes.min}, ${RETENTION_BOUNDS.inputTtlMinutes.max}].`,
    });
  }

  const artifactTtl = parseBoundedInt(
    read(env, RETENTION_ENV.artifactTtlMinutes),
    RETENTION_BOUNDS.artifactTtlMinutes,
    DEFAULT_RETENTION_SETTINGS.artifactTtlMinutes,
  );
  if (!artifactTtl.ok) {
    issues.push({
      field: RETENTION_ENV.artifactTtlMinutes,
      message: `Integer minutes in [${RETENTION_BOUNDS.artifactTtlMinutes.min}, ${RETENTION_BOUNDS.artifactTtlMinutes.max}].`,
    });
  }

  const multipartAbort = parseBoundedInt(
    read(env, RETENTION_ENV.multipartAbortHours),
    RETENTION_BOUNDS.multipartAbortHours,
    DEFAULT_RETENTION_SETTINGS.multipartAbortHours,
  );
  if (!multipartAbort.ok) {
    issues.push({
      field: RETENTION_ENV.multipartAbortHours,
      message: `Integer hours in [${RETENTION_BOUNDS.multipartAbortHours.min}, ${RETENTION_BOUNDS.multipartAbortHours.max}].`,
    });
  }

  const noncurrent = parseBoundedInt(
    read(env, RETENTION_ENV.noncurrentVersionDays),
    RETENTION_BOUNDS.noncurrentVersionDays,
    DEFAULT_RETENTION_SETTINGS.noncurrentVersionDays,
  );
  if (!noncurrent.ok) {
    issues.push({
      field: RETENTION_ENV.noncurrentVersionDays,
      message: `Integer days in [${RETENTION_BOUNDS.noncurrentVersionDays.min}, ${RETENTION_BOUNDS.noncurrentVersionDays.max}].`,
    });
  }

  if (
    !inputTtl.ok ||
    !artifactTtl.ok ||
    !multipartAbort.ok ||
    !noncurrent.ok ||
    issues.length > 0
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    config: {
      inputTtlMinutes: inputTtl.value,
      artifactTtlMinutes: artifactTtl.value,
      multipartAbortHours: multipartAbort.value,
      noncurrentVersionDays: noncurrent.value,
    },
  };
}

/**
 * Resolve usable {@link RetentionSettings}, always returning a config: a malformed
 * or out-of-bounds override degrades to the safe {@link DEFAULT_RETENTION_SETTINGS}
 * rather than throwing or silently half-applying. Server-side diagnostics for *why*
 * it degraded remain available via {@link parseRetentionSettings} (and surface as a
 * deploy guardrail).
 */
export function resolveRetentionSettings(
  env: EnvSource = process.env,
): RetentionSettings {
  const parsed = parseRetentionSettings(env);
  return parsed.ok ? parsed.config : { ...DEFAULT_RETENTION_SETTINGS };
}
