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
import { AI_ALLOWANCE_ACTION } from "@/lib/jobs/ai-allowance";
import { policyFor } from "./policy";
import { resolveRateLimitConfig } from "./config";
import { createMemoryRateLimiter } from "./memory";
import { deriveClientToken } from "./identity";
import { getRateLimitProvider } from "./provider";
import { createConfiguredRateLimitProvider } from "./factory";
import { AI_SPEND_BUCKET } from "@/lib/jobs/ai-spend-ceiling";
import {
  SPEND_PROBE_BUCKET,
  SPEND_PROBE_UNITS,
  spendProbePolicy,
  type SpendProbeVerdict,
} from "./spend-probe";
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

/**
 * A reservation of the free daily AI allowance, and the one way to undo it.
 *
 * `decision` is what the route answers with. `release` gives the characters
 * back, and exists because the charge happens BEFORE the job does: the route
 * reserves, then asks the adapter to create the job, and a creation that fails
 * produced nothing the caller could ever receive — no job id, so no result. On
 * 67e8d0f nothing gave the charge back, so three failed creations of an
 * undeclared job (a third of the day each) locked a connection out of AI until
 * tomorrow with nothing to show for it.
 *
 * The bucket token is captured in the closure and never surfaced, so the
 * handle carries no identity — the same no-leak rule as the decision.
 */
export interface AiAllowanceReservation {
  readonly decision: RateLimitDecision;
  /**
   * Give the reserved characters back. Resolves `true` only when a refund was
   * actually recorded; `false` when there was nothing to refund (a refused,
   * unenforced, or fail-open decision — none of those spent anything), when it
   * already ran, or when the backend could not record it. Never throws.
   * Idempotent: a second call is a no-op, so a caller cannot refund twice.
   */
  release(nowMs?: number): Promise<boolean>;
}

const NOTHING_TO_RELEASE = async (): Promise<boolean> => false;

/**
 * Reserve `characters` of a client's free daily AI allowance.
 *
 * Its own entry point rather than a `cost` parameter on {@link enforceRateLimit},
 * for the reason the spend ceiling got one: a flag that changed what a function
 * charges would be one function with two meanings at exactly the interesting
 * point, and every existing caller charges one hit.
 *
 * TWO PHASES, NOT ONE, AND THE ORDER IS THE POINT. The limiter's atomic path
 * increments and then reports, so a charge-then-refuse would bill a caller for
 * a job it declined. This peeks, decides, and only then spends — so a refused
 * job costs nothing.
 *
 * THE RACE THAT LEAVES, STATED RATHER THAN HIDDEN: two concurrent requests can
 * both peek before either spends, so a day's budget can be exceeded by at most
 * the size of the jobs in flight. That is the right direction for a FAIRNESS
 * device — the alternative charges people for work they did not get — and the
 * cost control that actually bounds money (`ai.spend`) is separate, atomic, and
 * unaffected by this.
 *
 * A claim that is not a positive finite count is REFUSED, never treated as free
 * and never as unlimited: the caller has to say what it intends to use.
 *
 * The returned {@link AiAllowanceReservation.release} undoes the spend when the
 * work it paid for never happened. A release that straddles a window reset
 * gives the characters back to the NEW window (clamped at zero): the gap is the
 * latency of one `createJob`, and the direction is toward the caller.
 */
export async function reserveAiCharacterAllowance(
  characters: number,
  request: Request,
  env: EnvSource = process.env,
  nowMs: number = Date.now(),
): Promise<AiAllowanceReservation> {
  // The shared constant, so the message this refusal produces cannot drift
  // from the policy it is refused under. See AI_ALLOWANCE_ACTION.
  const action = AI_ALLOWANCE_ACTION;
  const policy = policyFor(action);
  const nothing = (decision: RateLimitDecision): AiAllowanceReservation => ({
    decision,
    release: NOTHING_TO_RELEASE,
  });
  if (!Number.isFinite(characters) || characters <= 0) {
    return nothing({
      allowed: false,
      enforced: true,
      action,
      policyId: policy.id,
      provider: "local-memory",
      retryAfterSeconds: 1,
      retryAfterBucket: retryAfterBucket(1),
    });
  }
  try {
    const config = resolveRateLimitConfig(env);
    if (config.providerId === "disabled")
      return nothing(allowUnenforced(action, policy.id, "disabled"));

    const spendIfItFits = async (
      peekVerdict: RateLimiterVerdict,
      spend: () => void | Promise<void>,
      refund: (at: number) => void | Promise<void>,
      backend: "local-memory" | "remote",
    ): Promise<AiAllowanceReservation> => {
      const used = peekVerdict.used ?? 0;
      if (used + characters > policy.limit) {
        // This refusal happens ON TOP of an allowing peek (the store is not
        // over; the store plus THIS claim would be), so the peek's
        // `retryAfterSeconds` is a present `0` that `??` would pass straight
        // through to the Retry-After header — measured on production
        // 2026-08-25: an honest daily-allowance message under `Retry-After: 0`.
        // The window's remaining life is what the caller must wait.
        const windowRemaining =
          peekVerdict.resetAfterSeconds ?? peekVerdict.retryAfterSeconds;
        return nothing(
          enforcedDecision(action, policy.id, backend, {
            allowed: false,
            retryAfterSeconds:
              windowRemaining > 0 ? windowRemaining : policy.windowSeconds,
          }),
        );
      }
      await spend();
      // Only a reservation that SPENT can be released — every other return in
      // this function hands back NOTHING_TO_RELEASE.
      let released = false;
      return {
        decision: enforcedDecision(action, policy.id, backend, {
          allowed: true,
          retryAfterSeconds: 0,
        }),
        async release(at: number = Date.now()): Promise<boolean> {
          if (released) return false;
          released = true;
          try {
            await refund(at);
            return true;
          } catch {
            return false;
          }
        },
      };
    };

    if (config.providerId === "remote-unimplemented") {
      const provider = providerFor(env);
      if (provider === null || !provider.peek || !provider.spend) {
        noteFailOpen("provider-unreachable");
        return nothing(
          allowUnenforced(action, policy.id, "remote-unimplemented"),
        );
      }
      const token = deriveClientToken(request.headers, config);
      try {
        const peeked = await provider.peek(policy, token, nowMs);
        return await spendIfItFits(
          peeked,
          () => provider.spend!(policy, token, nowMs, characters),
          async (at) => {
            // A backend that predates refunds keeps the charge — the
            // behaviour every caller had before this existed — and says so
            // by resolving `false`.
            if (!provider.refund) throw new Error("refund unsupported");
            await provider.refund(policy, token, at, characters);
          },
          "remote",
        );
      } catch {
        noteFailOpen("store-error");
        return nothing(allowUnenforced(action, policy.id, "remote-error"));
      }
    }

    const token = deriveClientToken(request.headers, config);
    const peeked = limiter().peek(policy, token, nowMs);
    return await spendIfItFits(
      peeked,
      () => limiter().spend(policy, token, nowMs, characters),
      (at) => limiter().refund(policy, token, at, characters),
      "local-memory",
    );
  } catch {
    return nothing(allowUnenforced(action, policy.id, "disabled"));
  }
}

/**
 * {@link reserveAiCharacterAllowance} for a caller that will never give the
 * characters back — the decision alone.
 */
export async function enforceAiCharacterAllowance(
  characters: number,
  request: Request,
  env: EnvSource = process.env,
  nowMs: number = Date.now(),
): Promise<RateLimitDecision> {
  return (await reserveAiCharacterAllowance(characters, request, env, nowMs))
    .decision;
}

/* ------------------------------------------------------------------ *
 *  The GLOBAL AI spend ceiling — a separate entry point, on purpose.
 * ------------------------------------------------------------------ */

/**
 * The ceiling's verdict. Deliberately NOT a {@link RateLimitDecision}: that
 * shape carries `retryAfterSeconds` and is answered as a 429, and a tripped
 * COST control is not the caller's fault and must not read like their quota.
 */
export interface AiSpendVerdict {
  /** False ⇒ the global daily token ceiling is spent; refuse and degrade. */
  readonly affordable: boolean;
  /**
   * True only when a real limiter answered. `false` means the ceiling did not
   * actually bound anything — the same honesty rule the request guard follows,
   * and the reason the posture must report it rather than showing a green
   * "ceiling: on".
   */
  readonly enforced: boolean;
  /** Tokens counted in the current window, when the backend reports it. */
  readonly used?: number;
}

const UNENFORCED_AFFORDABLE: AiSpendVerdict = {
  affordable: true,
  enforced: false,
};

/**
 * Phase one: can we afford another AI run right now?
 *
 * **Its own entry point rather than a flag on {@link enforceRateLimit}**, and
 * named so the two cannot be confused at a call site. A flag that switched key
 * derivation would be one function with two meanings at exactly the interesting
 * point — the same defect as a `cost` parameter on `check()`.
 *
 * Two things it does NOT do, both load-bearing:
 *  - it never derives a client token. The bucket is the constant
 *    {@link AI_SPEND_BUCKET}; this is a cost control, not a fairness device.
 *  - it never spends. `peek` leaves the counter and the window untouched, so
 *    asking whether AI is affordable cannot make it unaffordable.
 *
 * FAILS OPEN, like the request guard: a limiter outage must not take AI down.
 * The `enforced: false` that comes back is the honest half of that — a caller
 * that reports "ceiling healthy" on an unenforced verdict is claiming a bound
 * nothing applied.
 */
export async function peekAiSpendCeiling(
  env: EnvSource = process.env,
  nowMs: number = Date.now(),
): Promise<AiSpendVerdict> {
  const policy = policyFor("ai.spend");
  try {
    const config = resolveRateLimitConfig(env);
    if (config.providerId === "disabled") return UNENFORCED_AFFORDABLE;

    if (config.providerId === "remote-unimplemented") {
      const provider = providerFor(env);
      // No backend, or a backend predating the two-phase contract. Falling back
      // to `check` here would SPEND a token on a question, so it does not.
      if (provider === null || !provider.peek) {
        noteFailOpen("provider-unreachable");
        return UNENFORCED_AFFORDABLE;
      }
      try {
        const verdict = await provider.peek(policy, AI_SPEND_BUCKET, nowMs);
        return {
          affordable: verdict.allowed,
          enforced: true,
          ...(verdict.used !== undefined ? { used: verdict.used } : {}),
        };
      } catch {
        noteFailOpen("store-error");
        return UNENFORCED_AFFORDABLE;
      }
    }

    const verdict = limiter().peek(policy, AI_SPEND_BUCKET, nowMs);
    return {
      affordable: verdict.allowed,
      enforced: true,
      ...(verdict.used !== undefined ? { used: verdict.used } : {}),
    };
  } catch {
    return UNENFORCED_AFFORDABLE;
  }
}

/**
 * Phase two: record what a completed AI call actually cost.
 *
 * Called on the TERMINAL TRANSITION of a job — every outcome that spent tokens,
 * not the success branch. `incomplete_output` is the case that proves the hook
 * is on the right seam: it is classified non-retryable *precisely because* the
 * model hit its output ceiling, so it burned the maximum budget and is the most
 * expensive call in the system. A success-only hook would record it as free.
 *
 * Returns whether the measurement was recorded, so the caller can say
 * "unrecorded" rather than assume zero. It never throws: a limiter outage must
 * not fail a job that already succeeded.
 */
export async function recordAiSpend(
  tokens: number,
  env: EnvSource = process.env,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!Number.isFinite(tokens) || tokens <= 0) return false;
  const policy = policyFor("ai.spend");
  try {
    const config = resolveRateLimitConfig(env);
    if (config.providerId === "disabled") return false;

    if (config.providerId === "remote-unimplemented") {
      const provider = providerFor(env);
      if (provider === null || !provider.spend) return false;
      await provider.spend(policy, AI_SPEND_BUCKET, nowMs, tokens);
      return true;
    }

    limiter().spend(policy, AI_SPEND_BUCKET, nowMs, tokens);
    return true;
  } catch {
    // A lost increment under-counts, which is the direction this whole feature
    // exists to avoid — so it is reported as unrecorded rather than swallowed.
    return false;
  }
}

/**
 * WORKER SIDE: write the shared-bucket probe.
 *
 * Called from the process that records spend. Returns whether the write landed —
 * a `false` here means this tier has no limiter, which is precisely the
 * condition that made the ceiling inert, so it must be visible rather than
 * swallowed.
 */
export async function writeSpendProbe(
  env: EnvSource = process.env,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const policy = spendProbePolicy();
  try {
    const config = resolveRateLimitConfig(env);
    if (config.providerId === "disabled") return false;
    if (config.providerId === "remote-unimplemented") {
      const provider = providerFor(env);
      if (provider === null || !provider.spend) return false;
      await provider.spend(
        policy,
        SPEND_PROBE_BUCKET,
        nowMs,
        SPEND_PROBE_UNITS,
      );
      return true;
    }
    limiter().spend(policy, SPEND_PROBE_BUCKET, nowMs, SPEND_PROBE_UNITS);
    return true;
  } catch {
    return false;
  }
}

/**
 * WEB SIDE: read the probe back.
 *
 * `shared: true` is the only claim worth making, and it is empirical — the units
 * came back, so both tiers key into one bucket through whatever chain of
 * provider, URL, instance and prefix each of them resolved. Nothing is compared;
 * something is observed.
 *
 * It deliberately CANNOT distinguish "the worker never wrote" from "the tiers
 * disagree", and says so rather than guessing. A posture that reported
 * `misconfigured` for a worker that had simply not started yet would be the
 * confident-wrong answer this codebase keeps removing.
 */
export async function readSpendProbe(
  env: EnvSource = process.env,
  nowMs: number = Date.now(),
): Promise<SpendProbeVerdict> {
  const policy = spendProbePolicy();
  try {
    const config = resolveRateLimitConfig(env);
    if (config.providerId === "disabled")
      return { shared: false, reason: "unenforced" };

    let used: number | undefined;
    if (config.providerId === "remote-unimplemented") {
      const provider = providerFor(env);
      if (provider === null || !provider.peek)
        return { shared: false, reason: "unenforced" };
      used = (await provider.peek(policy, SPEND_PROBE_BUCKET, nowMs)).used;
    } else {
      used = limiter().peek(policy, SPEND_PROBE_BUCKET, nowMs).used;
    }

    return used !== undefined && used > 0
      ? { shared: true, writtenUnits: used }
      : { shared: false, reason: "no-probe-visible" };
  } catch {
    return { shared: false, reason: "unenforced" };
  }
}
