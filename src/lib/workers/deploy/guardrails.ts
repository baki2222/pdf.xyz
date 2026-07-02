/**
 * Production **guardrails** — the fail-fast checks that turn a dangerous or
 * silently-broken deployment configuration into an explicit, typed error instead of
 * a worker that quietly does the wrong thing.
 *
 * The threat these address is the *silent fallback*: the provider config layers
 * (`s3-config`, `redis-config`, `native-config`) deliberately degrade a
 * half-configured provider to "not configured" so the app never processes against a
 * broken backend. That is the right runtime default, but for an operator it can hide
 * a typo — you set `…_STORAGE_PROVIDER=s3`, fat-finger one variable, and the worker
 * reports "not configured" as if you had set nothing. Guardrails re-surface those
 * cases as errors, and add opt-in production requirements (`require drainable`,
 * `require deep engine`, `require lifecycle`, `require atomic queue`) an operator
 * can enforce.
 *
 * Output contract: every violation is a typed `code` plus a **content-free**
 * message — no secret, value, path, object key, endpoint, or signed URL, and no
 * environment-variable *name* in the message either. The offending variable names
 * ARE available in a separate `fields` array for the `--check` diagnostics command
 * (env var names are public, documented, and not secrets), but they are kept out of
 * the message so the message is safe to surface anywhere. Defaults stay safe: a bare
 * environment (nothing selected, strict off) produces zero violations.
 *
 * Node-free: it composes the existing node-free parsers and the daemon readiness; the
 * one host-dependent input (whether a native engine is installed) is *injected* by
 * the Node runtime, never probed here.
 */

import type { FieldError } from "@/lib/jobs";
import { resolveDaemonReadiness } from "../daemon/readiness";
import { parseS3Config, S3_ENV } from "../storage/s3-config";
import {
  parseRedisQueueConfig,
  queueSupportsAtomicTransitions,
  REDIS_QUEUE_ENV,
  REDIS_PROVIDER_VALUES,
} from "../queue/redis-config";
import {
  parseNativeCompressionConfig,
  NATIVE_COMPRESSION_ENV,
} from "../compression/native-config";
import {
  parseRetentionSettings,
  parseLifecycleConfig,
  resolveLifecycleReadiness,
  LIFECYCLE_ENV,
} from "../lifecycle";
import type { EngineHealthInput } from "./readiness";

type EnvSource = Record<string, string | undefined>;

/** The environment variables that arm the opt-in guardrails (names only). */
export const GUARDRAIL_ENV = {
  /** Master switch: enforce every production requirement as an error. */
  strict: "PDFXYZ_WORKER_STRICT",
  /** Require both storage and a claimable queue (a runnable worker). */
  requireDrainable: "PDFXYZ_WORKER_REQUIRE_DRAINABLE",
  /** Require a native engine to be installed when deep compression is wanted. */
  requireDeepEngine: "PDFXYZ_WORKER_REQUIRE_DEEP_ENGINE",
  /** Require the lifecycle/retention backstop to be declared AND validated. */
  requireLifecycle: "PDFXYZ_WORKER_REQUIRE_LIFECYCLE",
  /** Require the configured queue to guarantee atomic, race-safe transitions. */
  requireAtomicQueue: "PDFXYZ_QUEUE_REQUIRE_ATOMIC",
} as const;

/** A typed, content-free guardrail failure code. */
export type GuardrailCode =
  | "storage_selected_but_invalid"
  | "storage_provider_unrecognized"
  | "queue_selected_but_invalid"
  | "queue_provider_unrecognized"
  | "compression_config_invalid"
  | "lifecycle_config_invalid"
  | "retention_out_of_bounds"
  | "deep_compression_without_engine"
  | "require_drainable_unmet"
  | "require_lifecycle_unmet"
  | "queue_atomic_unsupported";

export type GuardrailSeverity = "error" | "warn";

/** One guardrail violation. The `message` is content-free; `fields` names variables. */
export interface GuardrailViolation {
  readonly code: GuardrailCode;
  readonly severity: GuardrailSeverity;
  /** Content-free explanation — no value, secret, path, or variable name. */
  readonly message: string;
  /**
   * Offending environment-variable NAMES (never values), for the `--check`
   * diagnostics command. Kept out of `message` so `message` is safe to surface
   * anywhere; env var names are public and documented, not secrets.
   */
  readonly fields?: string[];
}

/** The result of evaluating every guardrail. */
export interface GuardrailReport {
  /** True when there are no `error`-severity violations. */
  readonly ok: boolean;
  /** Whether strict mode (or any require flag) is armed. */
  readonly strict: boolean;
  readonly violations: GuardrailViolation[];
}

/** Injectable, host-dependent inputs (the native engine probe). */
export interface GuardrailDeps {
  /** Probed compression-engine health; omit when it can't be determined here. */
  readonly engine?: EngineHealthInput;
}

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);

/** A boolean env flag is armed when its value is a recognized truthy token. */
function flagOn(env: EnvSource, name: string): boolean {
  const raw = read(env, name)?.toLowerCase();
  return raw !== undefined && TRUE_VALUES.has(raw);
}

/** Explicit-enable tokens for native compression that mean "I want deep" (not auto). */
const WANTS_DEEP = new Set(["on", "true", "1", "yes", "enabled"]);

/** Collect just the field names from a list of {@link FieldError}s. */
function fieldNames(issues: FieldError[]): string[] {
  return issues.map((i) => i.field);
}

/**
 * Evaluate every production guardrail against an environment. Pure and
 * deterministic; `env` and the engine probe are injectable. Returns a typed,
 * content-free report — safe to log and to drive an exit code from.
 */
export function evaluateGuardrails(
  env: EnvSource = process.env,
  deps: GuardrailDeps = {},
): GuardrailReport {
  const violations: GuardrailViolation[] = [];
  const strict = flagOn(env, GUARDRAIL_ENV.strict);
  // Strict enforces the universal safety requirements — a runnable worker and a
  // validated lifecycle backstop — but NOT a deep engine: a lossless-only worker is
  // a legitimate production choice, so requiring a native engine stays opt-in.
  const requireDrainable = strict || flagOn(env, GUARDRAIL_ENV.requireDrainable);
  const requireDeepEngine = flagOn(env, GUARDRAIL_ENV.requireDeepEngine);
  const requireLifecycle = strict || flagOn(env, GUARDRAIL_ENV.requireLifecycle);
  // Strict production runs demand atomic, race-safe queue transitions; it can also
  // be required on its own. A selected-but-non-atomic (or misconfigured) queue then
  // fails fast rather than silently degrading to last-writer-wins.
  const requireAtomicQueue =
    strict || flagOn(env, GUARDRAIL_ENV.requireAtomicQueue);

  // ── Config-integrity checks (always errors — a selected provider must be valid) ──

  // Object storage: selected-but-invalid, or an unrecognized provider value that
  // would silently fall back to "not configured".
  const storageProviderRaw = read(env, S3_ENV.provider)?.toLowerCase();
  if (storageProviderRaw !== undefined) {
    if (storageProviderRaw !== "s3") {
      violations.push({
        code: "storage_provider_unrecognized",
        severity: "error",
        message:
          "An object-storage provider is selected but its value is not a supported provider, so storage silently falls back to not-configured.",
        fields: [S3_ENV.provider],
      });
    } else {
      const parsed = parseS3Config(env);
      if (!parsed.ok) {
        violations.push({
          code: "storage_selected_but_invalid",
          severity: "error",
          message:
            "Object storage is selected but its configuration is incomplete or malformed, so a worker cannot read inputs or write artifacts.",
          fields: fieldNames(parsed.issues),
        });
      }
    }
  }

  // Job queue: same two failure modes.
  const queueProviderRaw = read(env, REDIS_QUEUE_ENV.provider)?.toLowerCase();
  if (queueProviderRaw !== undefined) {
    if (!(REDIS_PROVIDER_VALUES as readonly string[]).includes(queueProviderRaw)) {
      violations.push({
        code: "queue_provider_unrecognized",
        severity: "error",
        message:
          "A job-queue provider is selected but its value is not a supported provider, so the queue silently falls back to not-configured.",
        fields: [REDIS_QUEUE_ENV.provider],
      });
    } else {
      const parsed = parseRedisQueueConfig(env);
      if (!parsed.ok) {
        violations.push({
          code: "queue_selected_but_invalid",
          severity: "error",
          message:
            "The job queue is selected but its configuration is incomplete or malformed, so a worker has no broker to drain.",
          fields: fieldNames(parsed.issues),
        });
      }
    }
  }

  // Native compression: a malformed engine config is dangerous (unbounded limits,
  // unsafe path); the parser fails closed, but surface it so it is not silent.
  const compression = parseNativeCompressionConfig(env);
  if (!compression.ok) {
    violations.push({
      code: "compression_config_invalid",
      severity: "error",
      message:
        "The native compression configuration is malformed and was disabled; deep compression will not run until it is fixed.",
      fields: fieldNames(compression.issues),
    });
  }

  // Lifecycle declaration: a malformed declaration is ignored at runtime; surface it.
  const lifecycleParse = parseLifecycleConfig(env);
  if (!lifecycleParse.ok && lifecycleParse.selected) {
    violations.push({
      code: "lifecycle_config_invalid",
      severity: "error",
      message:
        "The lifecycle/retention policy declaration is malformed and was ignored, leaving the retention backstop state unknown.",
      fields: fieldNames(lifecycleParse.issues),
    });
  }

  // Retention TTLs: an out-of-bounds override is a privacy risk (too long) or would
  // delete live objects (too short); always an error.
  const retention = parseRetentionSettings(env);
  if (!retention.ok) {
    violations.push({
      code: "retention_out_of_bounds",
      severity: "error",
      message:
        "A retention TTL override is outside the safe bounds and was ignored; a value beyond the privacy ceiling (or below the minimum) is rejected.",
      fields: fieldNames(retention.issues),
    });
  }

  // ── Deep compression vs. installed engine ──
  // Only meaningful when deep is explicitly wanted (not the graceful auto default)
  // or explicitly required. Warns by default; escalates to an error under a require
  // flag / strict. Skipped when the engine probe is unavailable in this context.
  const rawEnable = read(env, NATIVE_COMPRESSION_ENV.enable)?.toLowerCase();
  const deepWanted = rawEnable !== undefined && WANTS_DEEP.has(rawEnable);
  if (
    (deepWanted || requireDeepEngine) &&
    deps.engine !== undefined &&
    !deps.engine.deep
  ) {
    violations.push({
      code: "deep_compression_without_engine",
      severity: requireDeepEngine ? "error" : "warn",
      message:
        "Deep compression is enabled, but no native engine is installed on this worker, so deep jobs cannot run (lossless still works).",
      fields: [NATIVE_COMPRESSION_ENV.enable],
    });
  }

  // ── Opt-in production requirements ──

  if (requireDrainable) {
    const readiness = resolveDaemonReadiness(env);
    if (!readiness.drainable) {
      violations.push({
        code: "require_drainable_unmet",
        severity: "error",
        message:
          "A runnable worker is required, but object storage and/or a claimable job queue are not both configured.",
        fields: [
          ...(readiness.storageConfigured ? [] : [S3_ENV.provider]),
          ...(readiness.queueConfigured ? [] : [REDIS_QUEUE_ENV.provider]),
        ],
      });
    }
  }

  if (requireLifecycle) {
    const lifecycle = resolveLifecycleReadiness(env);
    if (lifecycle.state !== "validated") {
      violations.push({
        code: "require_lifecycle_unmet",
        severity: "error",
        message:
          "A validated lifecycle/retention backstop is required, but it is not declared and asserted validated.",
        fields: [LIFECYCLE_ENV.provider, LIFECYCLE_ENV.validated],
      });
    }
  }

  // Atomic-transition guarantee: the configured queue must promise race-safe,
  // server-side compare-and-set transitions. Today only the fully-valid Redis
  // provider does; a missing/misconfigured/placeholder queue does not.
  if (requireAtomicQueue && !queueSupportsAtomicTransitions(env)) {
    violations.push({
      code: "queue_atomic_unsupported",
      severity: "error",
      message:
        "Atomic, race-safe queue transitions are required, but the configured job queue cannot guarantee them (no atomic-capable queue provider is fully configured).",
      fields: [REDIS_QUEUE_ENV.provider],
    });
  }

  const ok = !violations.some((v) => v.severity === "error");
  return {
    ok,
    strict:
      strict ||
      requireDrainable ||
      requireDeepEngine ||
      requireLifecycle ||
      requireAtomicQueue,
    violations,
  };
}
