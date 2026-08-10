/**
 * Honest, content-free **status** for the abuse guard — the single helper an operator,
 * a boot log, or a monitor uses to answer "is distributed rate limiting actually
 * enforcing here, and if not, why?" without ever revealing an endpoint, token, key, or
 * env *value*. Every diagnostic names *variables* only.
 *
 * It distinguishes the five operationally-distinct states the mission calls out:
 *  - `disabled` — provider unset/off (the default): allow all, nothing throttled.
 *  - `local-memory` — the per-process dev limiter: real, but NOT distributed.
 *  - `remote-missing-config` — a remote backend is selected but no valid store is
 *    wired (or none is registered in this process): the guard skips honestly.
 *  - `remote-configured` — a remote backend is selected, a valid store is wired, and a
 *    provider is registered: a real, distributed, cross-instance throttle.
 *  - `remote-error-fail-open` — configured as above, but a live request came back
 *    unenforced: the store is unreachable/erroring and the guard is failing OPEN. This
 *    is the alertable "configured but not actually enforcing right now" condition, and
 *    it is derived from a real {@link RateLimitDecision} via {@link statusForDecision}.
 *
 * Node-free: it composes only the node-free backend resolver, the node-free provider
 * registry, and pure types — safe to import anywhere.
 */

import { RATE_LIMIT_ENV, isTrustForwardedFor, readKeySalt } from "./config";
import { resolveRateLimitBackend } from "./factory";
import { RATE_LIMIT_REDIS_ENV } from "./redis-config";
import type { RateLimitDecision } from "./types";

type EnvSource = Record<string, string | undefined>;

/** The bounded, content-free status codes for the abuse guard. */
export type RateLimitStatusCode =
  | "disabled"
  | "local-memory"
  | "remote-missing-config"
  | "remote-configured"
  | "remote-configured-shared"
  | "remote-error-fail-open";

/** A content-free status snapshot. `envVars` names variables only — never values. */
export interface RateLimitStatus {
  readonly code: RateLimitStatusCode;
  /** True only when this state actually throttles requests. */
  readonly enforced: boolean;
  /** True only when enforcement is shared across processes (a remote store). */
  readonly distributed: boolean;
  /** The environment variable NAMES relevant to this state. Never their values. */
  readonly envVars: readonly string[];
  /** A generic, content-free explanation safe for a log line or an ops snapshot. */
  readonly detail: string;
}

/** Options for {@link resolveRateLimitStatus}. */
export interface ResolveRateLimitStatusOptions {
  /**
   * Whether a provider is available in this process.
   *
   * Supply it only to describe a specific process's registry — the boot hook does,
   * to report what IT wired. Left unset, this no longer consults the registry at
   * all, and that change is deliberate: the guard stopped depending on
   * registration. It builds a provider from the same environment on demand, so a
   * valid store configuration means a provider is obtainable wherever the guard
   * runs.
   *
   * Defaulting to `getRateLimitProvider() !== null` used to be right and became a
   * lie. On Vercel each route is its own bundle, so the registry the boot hook
   * writes is not the registry a route reads: the old default reported
   * "no provider is registered in this process" from a process that would
   * cheerfully build one and enforce. Reporting a working limiter as unconfigured
   * is the same error as the reverse, pointed the other way.
   */
  readonly providerRegistered?: boolean;
}

const REMOTE_ENV_VARS: readonly string[] = [
  RATE_LIMIT_ENV.provider,
  RATE_LIMIT_REDIS_ENV.restUrl,
  RATE_LIMIT_REDIS_ENV.restToken,
];

/**
 * Resolve the guard's configured status from the environment (and whether a provider
 * is registered). Returns one of the four *static* states; the runtime
 * `remote-error-fail-open` is produced from a decision by {@link statusForDecision}.
 */
export function resolveRateLimitStatus(
  env: EnvSource = process.env,
  opts: ResolveRateLimitStatusOptions = {},
): RateLimitStatus {
  const backend = resolveRateLimitBackend(env);
  // Unset ⇒ a valid store means a provider is obtainable, because the guard builds
  // one on demand. See the field's docblock for why consulting the registry here
  // became wrong rather than merely unnecessary.
  const registered = opts.providerRegistered ?? backend.kind === "redis";
  // Whether the limiter can tell two callers apart at all. Without it the
  // budgets are global, which is a different operational state from enforcing
  // them per client — see `remote-configured-shared`.
  // Per-client bucketing needs BOTH: trusted identity to know who the caller
  // is, and a SHARED SALT so every instance hashes that caller identically.
  // Either missing ⇒ one global bucket, i.e. `remote-configured-shared`. The
  // salt half matters most: it is the combination an operator reaches by
  // setting one variable and not the other, and it must land in a state the
  // posture names rather than silently keying per instance.
  const perClient = isTrustForwardedFor(env) && readKeySalt(env) !== undefined;

  switch (backend.kind) {
    case "disabled":
      return {
        code: "disabled",
        enforced: false,
        distributed: false,
        envVars: [RATE_LIMIT_ENV.provider],
        detail:
          "Rate limiting is disabled (the default): every request is allowed and nothing is throttled. Select a provider to enable it.",
      };

    case "local-memory":
      return {
        code: "local-memory",
        enforced: true,
        distributed: false,
        envVars: [RATE_LIMIT_ENV.provider],
        detail:
          "The per-process in-memory limiter is active. It really throttles, but each instance counts independently — it is a dev/single-process backend, NOT a distributed production limiter.",
      };

    case "redis":
      // A valid store is configured. It is honestly "configured" only if a provider is
      // actually registered in this process; otherwise nothing enforces despite valid
      // credentials, which we report as missing-config, never as active enforcement.
      return registered
        ? perClient
          ? {
              code: "remote-configured",
              enforced: true,
              distributed: true,
              envVars: REMOTE_ENV_VARS,
              detail:
                "A distributed rate-limit store is configured and a provider is registered: fixed-window budgets are enforced atomically across every instance.",
            }
          : {
              // Enforcing, distributed, and counting the whole world in ONE
              // bucket — because identity cannot separate callers unless the
              // forwarding header is trusted. Reported as its own code rather
              // than folded into `remote-configured`, which claimed
              // `enforced: true, distributed: true` while refusing nobody: a
              // field that reads identically in a working state and a broken
              // one is not a status, it is a decoration.
              code: "remote-configured-shared",
              enforced: true,
              distributed: true,
              envVars: [
                ...REMOTE_ENV_VARS,
                RATE_LIMIT_ENV.trustForwardedFor,
                RATE_LIMIT_ENV.keySalt,
              ],
              detail:
                "A distributed rate-limit store is configured and enforcing, but every caller is counted in ONE shared bucket: client identity is not trusted, so the published per-policy budgets apply to all traffic combined rather than per visitor.",
            }
        : {
            code: "remote-missing-config",
            enforced: false,
            distributed: false,
            envVars: REMOTE_ENV_VARS,
            detail:
              "A remote provider is selected and the store credentials are valid, but no provider is registered in this process (boot instrumentation did not run). Nothing is being enforced.",
          };

    case "unconfigured":
    default:
      return {
        code: "remote-missing-config",
        enforced: false,
        distributed: false,
        envVars: REMOTE_ENV_VARS,
        detail: backend.attempted
          ? "A remote provider is selected but the store credentials are incomplete or malformed; the guard is skipping honestly (not enforcing). Check the named variables."
          : "A remote provider is selected but no store credentials are configured; the guard is skipping honestly (not enforcing). Set the named variables to enable distributed enforcement.",
      };
  }
}

/**
 * Refine a configured status against a live {@link RateLimitDecision}. When the guard
 * is `remote-configured` yet a real request came back **unenforced**, the store is
 * failing (unreachable/erroring) and the guard is failing OPEN — surface that as
 * `remote-error-fail-open` so a monitor sees "configured but not actually enforcing".
 * Any other state passes through unchanged. Pure; no I/O.
 */
export function statusForDecision(
  base: RateLimitStatus,
  decision: RateLimitDecision,
): RateLimitStatus {
  if (base.code === "remote-configured" && !decision.enforced) {
    return {
      code: "remote-error-fail-open",
      enforced: false,
      distributed: true,
      envVars: base.envVars,
      detail:
        "The distributed limiter is configured, but the most recent request was not enforced — the store is unreachable or erroring and the guard is failing OPEN (allowing traffic). Investigate the store; requests are not being throttled.",
    };
  }
  return base;
}
