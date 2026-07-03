/**
 * The **per-process, in-memory** fixed-window limiter — the honest local-dev /
 * test backend for the abuse guard.
 *
 * It is a real limiter: it counts hits per `(policy, client bucket)` and denies
 * once a window's budget is spent. But it is deliberately and explicitly NOT a
 * production distributed limiter:
 *  - counters live in this process's heap, so each app instance limits
 *    independently and a restart resets every window — behind N instances the
 *    effective limit is up to N× the configured number;
 *  - there is no shared clock or store, so it cannot enforce a global budget.
 * That is exactly why the guard reports `provider: "local-memory"` and the docs
 * tell operators to wire a real edge/WAF/rate-limit provider before a high-traffic
 * launch. See docs/SECURITY.md and docs/DEPLOYMENT.md.
 *
 * The module itself is pure and `node:*`-free: the clock is injected as a `nowMs`
 * argument to {@link RateLimiterCore.check}, and the bucket key is an already
 * opaque token supplied by the caller (never a raw identity), so the limiter can
 * never read, log, or retain an IP, filename, or secret. Memory is bounded by
 * sweeping expired windows, so a flood of distinct keys cannot grow the map past
 * the set of clients currently inside a live window.
 */

import type {
  RateLimitPolicy,
  RateLimiterCore,
  RateLimiterVerdict,
} from "./types";

/** One client's fixed window for one policy. */
interface WindowState {
  /** Hits recorded in the current window (clamped at the policy limit). */
  count: number;
  /** Epoch ms at which this window resets and a fresh budget begins. */
  resetAtMs: number;
}

/** Tunables for {@link createMemoryRateLimiter}. All have safe defaults. */
export interface MemoryLimiterOptions {
  /**
   * How often (ms) to sweep expired windows out of the map. A sweep also runs
   * opportunistically whenever the map crosses {@link softBucketCap} on a write,
   * so steady-state memory is bounded by the clients inside a live window.
   */
  readonly sweepIntervalMs?: number;
  /** Map size above which a write forces an immediate expired-window sweep. */
  readonly softBucketCap?: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_SOFT_BUCKET_CAP = 50_000;

/** Compose the internal map key. The null separator keeps ids/keys unambiguous. */
function bucketKey(policyId: string, clientKey: string): string {
  return `${policyId}\0${clientKey}`;
}

/**
 * Create a fresh in-memory fixed-window limiter. Each instance owns its own
 * counters, so a test (or the guard) gets an isolated, deterministic limiter with
 * no shared global state.
 */
export function createMemoryRateLimiter(
  opts: MemoryLimiterOptions = {},
): RateLimiterCore {
  const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const softBucketCap = opts.softBucketCap ?? DEFAULT_SOFT_BUCKET_CAP;
  const windows = new Map<string, WindowState>();
  let lastSweepMs = Number.NEGATIVE_INFINITY;

  /** Drop every window that has already reset by `nowMs`. O(n), run rarely. */
  function sweep(nowMs: number): void {
    for (const [key, state] of windows) {
      if (state.resetAtMs <= nowMs) windows.delete(key);
    }
    lastSweepMs = nowMs;
  }

  return {
    check(
      policy: RateLimitPolicy,
      clientKey: string,
      nowMs: number,
    ): RateLimiterVerdict {
      if (nowMs - lastSweepMs >= sweepIntervalMs) sweep(nowMs);

      const key = bucketKey(policy.id, clientKey);
      const windowMs = policy.windowSeconds * 1000;
      const existing = windows.get(key);

      // No live window, or the previous one has reset ⇒ start a fresh window.
      if (!existing || nowMs >= existing.resetAtMs) {
        if (!existing && windows.size >= softBucketCap) sweep(nowMs);
        windows.set(key, { count: 1, resetAtMs: nowMs + windowMs });
        // A non-positive limit means "never allow"; honor it even on a fresh window.
        return policy.limit >= 1
          ? { allowed: true, retryAfterSeconds: 0 }
          : { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }

      // Budget spent for this window ⇒ deny without further incrementing (so the
      // counter stays bounded) and report the whole seconds until the reset.
      if (existing.count >= policy.limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((existing.resetAtMs - nowMs) / 1000),
        );
        return { allowed: false, retryAfterSeconds };
      }

      existing.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },

    size(): number {
      return windows.size;
    },
  };
}
