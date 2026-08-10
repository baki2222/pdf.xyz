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
import { createConfiguredRateLimitProvider } from "./factory";
import type { RateLimitProvider } from "./provider";

type EnvSource = Record<string, string | undefined>;

/**
 * The provider this module instance built for itself, because the one the boot
 * hook registered is not reachable from here.
 *
 * WHY THIS EXISTS — measured on production, 2026-08-09.
 * `instrumentation.ts` calls `registerRateLimitProvider()` at boot and logs
 * `remote-configured`, and it really did build a provider. But the registry is a
 * plain module-level `let` in `./provider`, and Vercel bundles the instrumentation
 * entry separately from each route handler — so `@/lib/ratelimit/provider` exists
 * TWICE in the deployment. The hook writes to one copy; the guard reads the other,
 * which is still `null`. Registration was a dead write.
 *
 * Nothing failed. The boot line said `remote-configured`, every variable was set
 * correctly, and 65 rapid uploads all returned 201 while the Redis store recorded
 * ZERO commands — the tell that the provider was never called at all. The status
 * was reporting that the environment PARSED, not that the guard could see the
 * result: the same shape as a `ready: true` derived from a dependency being wired
 * rather than from it being able to run.
 *
 * So the guard no longer depends on cross-bundle module state. It prefers a
 * registered provider when one is visible (single-process deployments, tests) and
 * otherwise builds its own from the same environment, once, in whatever module
 * instance is actually serving the request.
 */
let selfBuilt: RateLimitProvider | null = null;
let selfBuildAttempted = false;

function providerFor(env: EnvSource): RateLimitProvider | null {
  const registered = getRateLimitProvider();
  if (registered !== null) return registered;
  if (!selfBuildAttempted) {
    selfBuildAttempted = true;
    selfBuilt = createConfiguredRateLimitProvider(env);
  }
  return selfBuilt;
}

/** Test seam: drop the lazily-built provider so env changes take effect. */
export function resetSelfBuiltProviderForTests(): void {
  selfBuilt = null;
  selfBuildAttempted = false;
}

/**
 * Say out loud that the limiter is configured and is NOT throttling right now.
 *
 * This is the channel that survives everything else. The operations endpoint
 * reports the same condition, but only when somebody asks; a log line reaches an
 * alert rule at 3am with nobody looking, and it still works when the store — the
 * one place a "the store is down" note could otherwise be written — is the thing
 * that is down.
 *
 * It fires on BOTH unenforced-but-configured paths, and the second one is the
 * point: on 2026-08-09 the provider was `null` in the route's bundle while the
 * environment was complete, so nothing ever threw. A line emitted only from a
 * catch would have stayed silent through the entire incident.
 *
 * Content-free (a bounded reason code, nothing else) and throttled to at most one
 * line a minute per instance, so a store outage cannot turn every request into a
 * log entry and bill for the privilege.
 */
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;
let lastFailOpenLogMs = 0;

type FailOpenReason = "store-error" | "provider-unreachable";

function noteFailOpen(
  reason: FailOpenReason,
  nowMs: number = Date.now(),
): void {
  if (nowMs - lastFailOpenLogMs < FAIL_OPEN_LOG_INTERVAL_MS) return;
  lastFailOpenLogMs = nowMs;
  console.warn(
    `[pdf.xyz] rate-limit FAILING OPEN (${reason}) — requests are not being throttled`,
  );
}

/** Test seam: forget the throttle so a case can assert the line is emitted. */
export function resetFailOpenLogForTests(): void {
  lastFailOpenLogMs = 0;
}

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
      const provider = providerFor(env);
      if (provider === null) {
        // A remote backend was ASKED for and could not be produced. That is not
        // the quiet default — somebody set the variable expecting throttling.
        // This is the exact state the 2026-08-09 incident sat in for hours.
        noteFailOpen("provider-unreachable");
        return allowUnenforced(action, policy.id, "remote-unimplemented");
      }
      const token = deriveClientToken(request.headers, config);
      try {
        const verdict = await provider.check(policy, token, nowMs);
        return enforcedDecision(action, policy.id, "remote", verdict);
      } catch {
        // The store is configured and unreachable/erroring. Fail OPEN — a limiter
        // outage must never take the API down — but say WHICH failure this is.
        // Reported as `remote-error`, not `disabled`: traffic is passing
        // unthrottled right now and somebody needs to know, whereas `disabled` is
        // a deliberate state that needs nobody.
        noteFailOpen("store-error");
        return allowUnenforced(action, policy.id, "remote-error");
      }
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
