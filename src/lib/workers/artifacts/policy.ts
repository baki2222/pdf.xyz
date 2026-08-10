/**
 * The **configuration policy** for the worker artifact-manifest gate: given an
 * environment it resolves a bounded {@link ArtifactManifestPolicy}.
 *
 * The gate ships ENABLED by default with a conservative policy — require at least one
 * non-empty output, cap the output count, reject an unknown output kind / a
 * content-type this tool may not produce, and require a resolvable retention class —
 * because the check needs no backend and makes no security claim (a manifest pass is
 * pure structural metadata validation, unlike the malware scanner, which is opt-in
 * precisely because it *does* make a claim). The stricter, higher-false-positive check
 * (a hard per-output byte ceiling) is OPT-IN, off by default. An operator can disable
 * the whole gate with {@link ARTIFACT_ENV.enabled}.
 *
 * Strict, fail-safe parsing mirrors `../soundness/policy`, `../scanner/config`, and
 * `../queue/redis-config`: each knob resolves independently, a malformed value falls
 * back to its safe default (never throws, never disturbs another knob), and only
 * variable NAMES ever appear in diagnostics — never a value. Pure and node-free: it
 * reads config only, opens no socket and touches no filesystem.
 */

type EnvSource = Record<string, string | undefined>;

/**
 * Stable identity of the worker artifact-manifest policy, stamped on manifests,
 * rejection receipts, and diagnostics. The id is a fixed slug; the version is the
 * policy *schema* version (the set of checks/fields), bumped when the shape changes —
 * NOT the operator's tuned knob values, which are never surfaced.
 */
export const ARTIFACT_POLICY_ID = "pdfxyz-worker-artifact-manifest";
export const ARTIFACT_POLICY_VERSION = 1;

/** The variable names the gate reads (values are read to configure, never surfaced). */
export const ARTIFACT_ENV = {
  /** Master switch. Recognized OFF tokens disable the gate; default ON. */
  enabled: "PDFXYZ_WORKER_ARTIFACT_MANIFEST",
  /** Hard per-job output-count ceiling (bounded artifact-count sanity). */
  maxArtifacts: "PDFXYZ_WORKER_ARTIFACT_MAX_COUNT",
  /** Hard per-output byte ceiling. `0`/unset ⇒ no ceiling (opt-in). */
  maxBytes: "PDFXYZ_WORKER_ARTIFACT_MAX_BYTES",
  /** Reject a content-type that is not a recognized output kind, disagrees with the
   *  filename extension, or a kind this tool may not produce. Default ON. */
  checkContentType: "PDFXYZ_WORKER_ARTIFACT_CHECK_CONTENT_TYPE",
  /** Require a resolvable retention/lifecycle class for every output. Default ON. */
  requireRetentionClass: "PDFXYZ_WORKER_ARTIFACT_REQUIRE_RETENTION_CLASS",
} as const;

/** Per-knob sanity bounds; an out-of-range value falls back to the default. */
export const ARTIFACT_BOUNDS = {
  /** At least one output; up to a generous cap so a mis-built job with an absurd
   *  output count is caught without disturbing legitimate multi-output jobs. */
  maxArtifacts: { min: 1, max: 10_000 },
  /** 0 (disabled) up to 2 GiB — a generous backstop well above any real output. */
  maxBytes: { min: 0, max: 2_147_483_648 },
} as const;

/** A fully-resolved, bounded artifact-manifest policy the gate consumes. */
export interface ArtifactManifestPolicy {
  /** Master switch. When false the gate returns `skipped` and validates nothing. */
  readonly enabled: boolean;
  /** Hard per-job output-count ceiling. */
  readonly maxArtifacts: number;
  /** Hard per-output byte ceiling; `0` disables the check. */
  readonly maxBytes: number;
  /** Reject an unrecognized/mismatched/unproducible content-type. */
  readonly checkContentType: boolean;
  /** Require a resolvable retention/lifecycle class for every output. */
  readonly requireRetentionClass: boolean;
}

/**
 * The shipped default: enabled, output-count capped, content-type + retention checks
 * on, per-output byte ceiling opt-in (off). The count cap is generous — real tools
 * produce one or two outputs; the cap only catches a pathological run. Frozen.
 */
export const DEFAULT_ARTIFACT_POLICY: ArtifactManifestPolicy = Object.freeze({
  enabled: true,
  maxArtifacts: 64,
  maxBytes: 0,
  checkContentType: true,
  requireRetentionClass: true,
});

/** Tokens that explicitly turn a boolean flag ON (case-insensitive). */
const TRUE_TOKENS = new Set(["1", "true", "yes", "on", "enabled"]);
/** Tokens that explicitly turn a boolean flag OFF (case-insensitive). */
const FALSE_TOKENS = new Set(["0", "false", "no", "off", "disabled", "none"]);

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve a boolean flag with an explicit default: an unrecognized or absent value
 * keeps `fallback`, so a typo never silently flips a default-on check off (or a
 * default-off one on). Only clear ON/OFF tokens move the flag.
 */
function readBool(env: EnvSource, name: string, fallback: boolean): boolean {
  const raw = read(env, name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (TRUE_TOKENS.has(raw)) return true;
  if (FALSE_TOKENS.has(raw)) return false;
  return fallback;
}

/** Parse a bounded integer knob; an out-of-range/malformed value falls back safely. */
function boundedInt(
  env: EnvSource,
  name: string,
  bounds: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  // Reject anything that is not a plain base-10 integer (no `1e9`, `0x10`, `1.5`, `1kb`).
  if (!/^-?\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < bounds.min ||
    value > bounds.max
  ) {
    return fallback;
  }
  return value;
}

/**
 * Resolve the artifact-manifest policy from an environment. Deterministic; `env`
 * injectable. Every knob is parsed independently against {@link ARTIFACT_BOUNDS} and
 * defaults to {@link DEFAULT_ARTIFACT_POLICY}; a bad value is ignored (never throws,
 * never leaks a value).
 */
export function resolveArtifactPolicy(
  env: EnvSource = process.env,
): ArtifactManifestPolicy {
  return {
    enabled: readBool(
      env,
      ARTIFACT_ENV.enabled,
      DEFAULT_ARTIFACT_POLICY.enabled,
    ),
    maxArtifacts: boundedInt(
      env,
      ARTIFACT_ENV.maxArtifacts,
      ARTIFACT_BOUNDS.maxArtifacts,
      DEFAULT_ARTIFACT_POLICY.maxArtifacts,
    ),
    maxBytes: boundedInt(
      env,
      ARTIFACT_ENV.maxBytes,
      ARTIFACT_BOUNDS.maxBytes,
      DEFAULT_ARTIFACT_POLICY.maxBytes,
    ),
    checkContentType: readBool(
      env,
      ARTIFACT_ENV.checkContentType,
      DEFAULT_ARTIFACT_POLICY.checkContentType,
    ),
    requireRetentionClass: readBool(
      env,
      ARTIFACT_ENV.requireRetentionClass,
      DEFAULT_ARTIFACT_POLICY.requireRetentionClass,
    ),
  };
}
