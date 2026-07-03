/**
 * The **guard** the public-API routes call: turn a request + action into a
 * content-free {@link RateLimitDecision}, using whichever provider the environment
 * selects. This is the node entry point (it composes the `node:crypto` identity
 * leaf), imported directly by the `runtime = "nodejs"` route handlers — it is
 * intentionally not re-exported from the node-free `@/lib/ratelimit` surface.
 *
 * Honest by construction:
 *  - `disabled` (the default) and `remote-unimplemented` never throttle: they
 *    return an `allowed`, `enforced: false` decision without even reading the
 *    request's headers, so the default build, the e2e suite, the monitoring
 *    endpoints, and every local-first browser tool are byte-for-byte unaffected.
 *  - `local-memory` is the only provider that actually counts, and its decisions
 *    carry `enforced: true` — a real, but per-process (non-distributed), verdict.
 *  - Any internal error fails **open** (allow), never closed: a bug in the guard
 *    must not take down the API. The fail-open decision is marked `enforced: false`.
 *
 * The in-memory limiter is a process singleton so its counters persist across
 * requests; `resetRateLimitGuardForTests` clears it for deterministic tests.
 */

import type {
  RateLimitAction,
  RateLimitDecision,
  RateLimiterCore,
  RateLimiterVerdict,
} from "./types";
import { retryAfterBucket } from "./types";
import { policyFor } from "./policy";
import { resolveRateLimitConfig } from "./config";
import { createMemoryRateLimiter } from "./memory";
import { deriveClientToken } from "./identity";
import { getRateLimitProvider } from "./provider";

type EnvSource = Record<string, string | undefined>;

// Process-wide singleton so counts accumulate across requests within an instance.
// Created lazily, and only ever exercised on the `local-memory` path.
let memoryLimiter: RateLimiterCore | null = null;
function limiter(): RateLimiterCore {
  if (memoryLimiter === null) memoryLimiter = createMemoryRateLimiter();
  return memoryLimiter;
}

/** Reset the in-memory counters. Test-only; call in `beforeEach`/`afterEach`. */
export function resetRateLimitGuardForTests(): void {
  memoryLimiter = null;
}

/** A non-enforcing allow (disabled / remote-unimplemented / fail-open). */
function allowUnenforced(
  action: RateLimitAction,
  policyId: string,
  provider: RateLimitDecision["provider"],
): RateLimitDecision {
  return {
    allowed: true,
    action,
    policyId,
    provider,
    enforced: false,
    retryAfterSeconds: 0,
    retryAfterBucket: "none",
  };
}

/**
 * Shape a real limiter verdict into a content-free decision. Shared by the two
 * enforcing paths (`local-memory` and a registered `remote` provider) so their
 * output — and its no-leak guarantees — cannot drift.
 */
function enforcedDecision(
  action: RateLimitAction,
  policyId: string,
  provider: "local-memory" | "remote",
  verdict: RateLimiterVerdict,
): RateLimitDecision {
  const retryAfterSeconds = verdict.allowed ? 0 : verdict.retryAfterSeconds;
  return {
    allowed: verdict.allowed,
    action,
    policyId,
    provider,
    enforced: true,
    retryAfterSeconds,
    retryAfterBucket: retryAfterBucket(retryAfterSeconds),
  };
}

/**
 * Check `action` for `request` against the active provider. Never throws.
 * `env`/`nowMs` are injectable for deterministic tests; routes call it with the
 * one-argument form and the real environment + clock.
 */
export async function enforceRateLimit(
  action: RateLimitAction,
  request: Request,
  env: EnvSource = process.env,
  nowMs: number = Date.now(),
): Promise<RateLimitDecision> {
  const policy = policyFor(action);
  try {
    const config = resolveRateLimitConfig(env);

    // Disabled (the default) short-circuits BEFORE reading any header, so the
    // default build never touches request identity at all.
    if (config.providerId === "disabled") {
      return allowUnenforced(action, policy.id, "disabled");
    }

    // A remote provider is selected: delegate to the registered backend if one is
    // wired, otherwise skip honestly. This build registers none by default, so the
    // status/operations endpoints and every default deployment stay untouched.
    if (config.providerId === "remote-unimplemented") {
      const provider = getRateLimitProvider();
      if (provider === null) {
        return allowUnenforced(action, policy.id, "remote-unimplemented");
      }
      const token = deriveClientToken(request.headers, config);
      const verdict = await provider.check(policy, token, nowMs);
      return enforcedDecision(action, policy.id, "remote", verdict);
    }

    // local-memory: the per-process dev limiter actually counts.
    const token = deriveClientToken(request.headers, config);
    const verdict = limiter().check(policy, token, nowMs);
    return enforcedDecision(action, policy.id, "local-memory", verdict);
  } catch {
    // Fail open: a guard bug — or a remote backend that threw — must never break
    // the API. Marked unenforced so the pass is never mistaken for real capacity.
    return allowUnenforced(action, policy.id, "disabled");
  }
}
