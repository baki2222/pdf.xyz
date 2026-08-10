/**
 * Environment-driven configuration for the abuse guard — parsed for presence and
 * shape only, never for a secret value.
 *
 * Selection is explicit and fails safe. Until an operator opts in with
 * {@link RATE_LIMIT_ENV.provider}, the guard is `disabled` and every request is
 * allowed (`enforced: false`) — so the default build, the e2e suite, and every
 * local-first browser tool behave exactly as before this phase. This mirrors the
 * rest of the codebase's honest not-configured posture (see `queue/redis-config.ts`).
 *
 * Two knobs, both name-only in any diagnostic:
 *  - `provider` — which backend to use: `disabled` (default), `local-memory`
 *    (the per-process dev limiter), or a remote provider name (selected but
 *    unimplemented in this build ⇒ the guard skips honestly).
 *  - `trustForwardedFor` — whether to attribute requests to a client from the
 *    proxy's forwarding header. OFF by default because that header is
 *    client-spoofable unless a trusted edge overwrites it; when OFF the limiter
 *    keys every request into one shared bucket (a coarse global process throttle).
 *    Turn it ON only behind a proxy/CDN you trust to set it. Never a value leaks.
 */

import type { FieldError } from "@/lib/jobs";
import type { RateLimitProviderId } from "./types";

type EnvSource = Record<string, string | undefined>;

/** The environment variables the guard reads (names only; never values). */
export const RATE_LIMIT_ENV = {
  /** Selects the backend: `disabled` (default) | `local-memory` | a remote name. */
  provider: "PDFXYZ_RATE_LIMIT_PROVIDER",
  /** Truthy ⇒ attribute requests to a client via the proxy forwarding header. */
  trustForwardedFor: "PDFXYZ_RATE_LIMIT_TRUST_PROXY",
  /**
   * Secret that salts the bucket keys. Must be the SAME on every instance, or
   * the same client hashes to a different bucket on each one — which is not a
   * weaker limit but effectively no limit. See `identity.ts`.
   */
  keySalt: "PDFXYZ_RATE_LIMIT_KEY_SALT",
} as const;

/** Values that select the per-process in-memory dev limiter. */
const LOCAL_MEMORY_VALUES = new Set([
  "local-memory",
  "memory",
  "in-memory",
  "local",
]);
/** Values that explicitly turn the guard off (same as unset). */
const DISABLED_VALUES = new Set(["", "disabled", "off", "none", "false", "0"]);
/**
 * Values that name a remote/edge provider. This build ships no client for any of
 * them, so each resolves to `remote-unimplemented`: the guard skips honestly
 * rather than pretend to enforce a distributed limit that is not really running.
 */
const REMOTE_VALUES = new Set([
  "remote",
  "redis",
  "upstash-redis",
  "upstash",
  "edge",
  "waf",
  "provider",
]);
/**
 * The configured key salt, trimmed, or `undefined` when unset or blank.
 *
 * Deliberately NOT defaulted to a generated value: "unset ⇒ random per
 * instance" is exactly the defect this variable exists to end, and it would
 * arrive silently. The caller falls back to the shared bucket instead, which is
 * stricter but visible — see `remote-configured-shared`.
 */
export function readKeySalt(env: EnvSource): string | undefined {
  const raw = env[RATE_LIMIT_ENV.keySalt];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value === "" ? undefined : value;
}

/** Truthy values for {@link RATE_LIMIT_ENV.trustForwardedFor}. */
const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);

/** Trimmed, lower-cased value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The fully-resolved guard configuration for an environment. */
export interface RateLimitConfig {
  readonly providerId: RateLimitProviderId;
  /** True ⇒ derive a per-client bucket from the proxy forwarding header. */
  readonly trustForwardedFor: boolean;
  /**
   * The configured key salt, or `undefined`. Per-client bucketing requires it:
   * without a shared secret every instance would salt differently and the same
   * caller would land in a different bucket on each one.
   */
  readonly keySalt?: string;
  /** Name-only diagnostic for an unrecognized provider value; server-side use. */
  readonly issue?: FieldError;
}

/**
 * Resolve which provider this environment selects. Unset, blank, or an explicit
 * off value ⇒ `disabled`. A recognized local value ⇒ `local-memory`. A recognized
 * remote name ⇒ `remote-unimplemented`. An UNRECOGNIZED non-empty value fails safe
 * to `disabled` (never silently enforce on a value we do not understand) and the
 * caller can surface a name-only diagnostic via {@link resolveRateLimitConfig}.
 */
export function resolveRateLimitProviderId(
  env: EnvSource = process.env,
): RateLimitProviderId {
  const raw = env[RATE_LIMIT_ENV.provider];
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "" || DISABLED_VALUES.has(value)) return "disabled";
  if (LOCAL_MEMORY_VALUES.has(value)) return "local-memory";
  if (REMOTE_VALUES.has(value)) return "remote-unimplemented";
  return "disabled";
}

/** True when the proxy forwarding header is trusted for client attribution. */
export function isTrustForwardedFor(env: EnvSource = process.env): boolean {
  const value = read(env, RATE_LIMIT_ENV.trustForwardedFor)?.toLowerCase();
  return value !== undefined && TRUTHY.has(value);
}

/** Resolve the full guard configuration, with a name-only diagnostic when needed. */
export function resolveRateLimitConfig(
  env: EnvSource = process.env,
): RateLimitConfig {
  const raw = env[RATE_LIMIT_ENV.provider];
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const providerId = resolveRateLimitProviderId(env);
  const trustForwardedFor = isTrustForwardedFor(env);
  const keySalt = readKeySalt(env);

  // Only a non-empty, unrecognized value is worth a diagnostic — it likely means
  // an operator meant to enable the guard but mistyped the provider name.
  const unrecognized =
    value !== "" && providerId === "disabled" && !DISABLED_VALUES.has(value);

  return {
    providerId,
    trustForwardedFor,
    ...(keySalt ? { keySalt } : {}),
    ...(unrecognized
      ? {
          issue: {
            field: RATE_LIMIT_ENV.provider,
            message:
              "Unrecognized rate-limit provider; the guard is disabled. Use `local-memory`, a supported remote provider name, or `disabled`.",
          },
        }
      : {}),
  };
}
