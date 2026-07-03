/**
 * The **bounded policy** the upload-intake guardrails evaluate against.
 *
 * This is the single, configurable source of truth for the numeric and boolean
 * knobs the intake layer enforces at the public upload boundary (see
 * `./evaluate`). It is a Node-free leaf: plain string parsing plus a couple of
 * pure helpers, so a route handler, a status reporter, or a unit test can derive
 * a policy without pulling any runtime dependency.
 *
 * Design rules (mirroring `@/lib/ratelimit/config` and `queue/redis-config`):
 *  - Presence + shape only. A knob's *value* is never logged, serialized, or
 *    returned to a client; only the resolved numbers/booleans flow onward.
 *  - Safe, backward-compatible defaults. Unset ⇒ the exact contract limits from
 *    {@link JOB_LIMITS}, so the default build behaves byte-for-byte as before this
 *    phase. A test (`policy.test.ts`) pins this equivalence so the two can never
 *    drift.
 *  - Strict, fail-safe parsing. A malformed, out-of-range, or non-integer value
 *    is ignored in favour of the default — an operator typo can only ever make the
 *    guard fall back to the safe contract limit, never widen it to something absurd
 *    or crash a request. Bounded by absolute ceilings so a fat-fingered env can't
 *    set a multi-terabyte "limit".
 *  - Structural checks are OFF by default. `requirePdfMagic` / `requirePdfEof`
 *    only gate bytes when an operator opts in, exactly like the abuse guard's
 *    `disabled` default — see the note in `./evaluate` on why byte inspection at
 *    the app layer is a dev-transport defense, with production byte checks owned
 *    by the worker (Phase 22 ClamAV + soundness scan).
 */

import { JOB_LIMITS } from "@/lib/jobs";

type EnvSource = Record<string, string | undefined>;

/** The environment variables the intake policy reads (names only; never values). */
export const UPLOAD_INTAKE_ENV = {
  /** Max declared bytes for a single file. */
  maxFileBytes: "PDFXYZ_UPLOAD_MAX_FILE_BYTES",
  /** Max declared bytes summed across all files in one request/session. */
  maxRequestBytes: "PDFXYZ_UPLOAD_MAX_REQUEST_BYTES",
  /** Max number of files per upload request / inputs per job. */
  maxFiles: "PDFXYZ_UPLOAD_MAX_FILES",
  /** Max length of a client-supplied filename. */
  maxFilenameLength: "PDFXYZ_UPLOAD_MAX_FILENAME_LENGTH",
  /** Truthy ⇒ require a `%PDF-` header on uploaded PDF bytes (opt-in). */
  requirePdfMagic: "PDFXYZ_UPLOAD_REQUIRE_PDF_MAGIC",
  /** Truthy ⇒ require a `%%EOF` trailer on uploaded PDF bytes (opt-in). */
  requirePdfEof: "PDFXYZ_UPLOAD_REQUIRE_PDF_EOF",
  /** How many leading bytes the PDF header sniff may scan. */
  pdfHeaderScanBytes: "PDFXYZ_UPLOAD_PDF_HEADER_SCAN_BYTES",
  /** How many trailing bytes the PDF trailer sniff may scan. */
  pdfTrailerScanBytes: "PDFXYZ_UPLOAD_PDF_TRAILER_SCAN_BYTES",
} as const;

/**
 * Absolute clamps for the numeric knobs. A parsed value outside its `[min, max]`
 * is rejected in favour of the default — these are sanity rails against a typo,
 * NOT tuning targets. The byte ceilings sit well above the contract's 100 MB /
 * 500 MB so an operator can raise limits, but not to a value that would let a
 * single request declare an implausible amount of data.
 */
export const INTAKE_BOUNDS = {
  maxFileBytes: { min: 1, max: 2 * 1024 * 1024 * 1024 }, // up to 2 GiB
  maxRequestBytes: { min: 1, max: 20 * 1024 * 1024 * 1024 }, // up to 20 GiB
  maxFiles: { min: 1, max: 10_000 },
  maxFilenameLength: { min: 1, max: 4096 },
  /** The PDF signature is 5 bytes; a scan window narrower than that is pointless. */
  pdfHeaderScanBytes: { min: 8, max: 1024 * 1024 }, // up to 1 MiB
  pdfTrailerScanBytes: { min: 8, max: 1024 * 1024 }, // up to 1 MiB
} as const;

/** A fully-resolved, bounded upload-intake policy. */
export interface IntakePolicy {
  /** Max declared bytes for a single file. */
  readonly maxFileBytes: number;
  /** Max declared bytes summed across all files in one request. */
  readonly maxRequestBytes: number;
  /** Max number of files per request / inputs per job. */
  readonly maxFiles: number;
  /** Max length of a client-supplied filename. */
  readonly maxFilenameLength: number;
  /** Enforce a `%PDF-` header on uploaded PDF bytes. Off unless opted in. */
  readonly requirePdfMagic: boolean;
  /** Enforce a `%%EOF` trailer on uploaded PDF bytes. Off unless opted in. */
  readonly requirePdfEof: boolean;
  /** Upper bound on the leading byte window the header sniff scans. */
  readonly pdfHeaderScanBytes: number;
  /** Upper bound on the trailing byte window the trailer sniff scans. */
  readonly pdfTrailerScanBytes: number;
}

/**
 * The default policy: the exact contract limits, with structural checks off.
 * Kept as a frozen constant so every "unset" resolution shares one object and a
 * caller can compare against it. `policy.test.ts` asserts it equals {@link
 * JOB_LIMITS}, so a change to the contract limits can never silently diverge here.
 */
export const DEFAULT_INTAKE_POLICY: IntakePolicy = Object.freeze({
  maxFileBytes: JOB_LIMITS.maxFileBytes,
  maxRequestBytes: JOB_LIMITS.maxTotalBytes,
  maxFiles: JOB_LIMITS.maxInputFiles,
  maxFilenameLength: JOB_LIMITS.maxFilenameLength,
  requirePdfMagic: false,
  requirePdfEof: false,
  pdfHeaderScanBytes: 1024,
  pdfTrailerScanBytes: 1024,
});

/** Truthy values for the opt-in boolean knobs. Matches the abuse guard's set. */
const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse a bounded, positive integer knob. Anything that is not a base-10 integer
 * within `[min, max]` — blank, non-numeric, negative, fractional, `Infinity`, or
 * over the ceiling — falls back to `fallback`. Never throws.
 */
function boundedInt(
  env: EnvSource,
  name: string,
  bounds: { min: number; max: number },
  fallback: number,
): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  // Reject anything that is not a pure run of digits (optionally signed): this
  // excludes "1e9", "0x10", "12.5", "12px", and whitespace-embedded values that
  // `Number()` would otherwise coerce.
  if (!/^-?\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return fallback;
  if (value < bounds.min || value > bounds.max) return fallback;
  return value;
}

/** Parse an opt-in boolean knob; unset or non-truthy ⇒ `false`. */
function boolean(env: EnvSource, name: string): boolean {
  const value = read(env, name)?.toLowerCase();
  return value !== undefined && TRUTHY.has(value);
}

/**
 * Resolve the intake policy for an environment. Injectable `env` for tests;
 * routes call the zero-argument form against the real process environment. Every
 * knob independently falls back to its safe default, so a single bad value never
 * disturbs the others.
 */
export function resolveIntakePolicy(env: EnvSource = process.env): IntakePolicy {
  return {
    maxFileBytes: boundedInt(
      env,
      UPLOAD_INTAKE_ENV.maxFileBytes,
      INTAKE_BOUNDS.maxFileBytes,
      DEFAULT_INTAKE_POLICY.maxFileBytes,
    ),
    maxRequestBytes: boundedInt(
      env,
      UPLOAD_INTAKE_ENV.maxRequestBytes,
      INTAKE_BOUNDS.maxRequestBytes,
      DEFAULT_INTAKE_POLICY.maxRequestBytes,
    ),
    maxFiles: boundedInt(
      env,
      UPLOAD_INTAKE_ENV.maxFiles,
      INTAKE_BOUNDS.maxFiles,
      DEFAULT_INTAKE_POLICY.maxFiles,
    ),
    maxFilenameLength: boundedInt(
      env,
      UPLOAD_INTAKE_ENV.maxFilenameLength,
      INTAKE_BOUNDS.maxFilenameLength,
      DEFAULT_INTAKE_POLICY.maxFilenameLength,
    ),
    requirePdfMagic: boolean(env, UPLOAD_INTAKE_ENV.requirePdfMagic),
    requirePdfEof: boolean(env, UPLOAD_INTAKE_ENV.requirePdfEof),
    pdfHeaderScanBytes: boundedInt(
      env,
      UPLOAD_INTAKE_ENV.pdfHeaderScanBytes,
      INTAKE_BOUNDS.pdfHeaderScanBytes,
      DEFAULT_INTAKE_POLICY.pdfHeaderScanBytes,
    ),
    pdfTrailerScanBytes: boundedInt(
      env,
      UPLOAD_INTAKE_ENV.pdfTrailerScanBytes,
      INTAKE_BOUNDS.pdfTrailerScanBytes,
      DEFAULT_INTAKE_POLICY.pdfTrailerScanBytes,
    ),
  };
}
