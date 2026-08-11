/**
 * The **distributed rate-limit provider** — a real {@link RateLimitProvider} backed
 * by the same node-free Redis/Upstash-REST transport (`createRedisClient`) the job
 * queue and the liveness heartbeat use. Registering it (see `factory.ts` +
 * `src/instrumentation.ts`) is what upgrades the guard from a per-process dev limiter
 * to an honest cross-instance throttle: every web replica increments the same window
 * counter, so a policy's budget is shared, not multiplied by the replica count.
 *
 * Atomic by construction — never a race-prone get-then-set. Each check is ONE server
 * side Lua script (`EVAL`): `INCRBY` the window key by this hit's cost, stamp the
 * window TTL when there is none, read the remaining TTL, and return `{count, pttlMs}`
 * — or, at cost 0, `GET` only. All executed to completion
 * with no interleaving, so two replicas incrementing at once can never both read a
 * stale count. (Redis runs a script atomically; the Upstash REST transport is
 * stateless, so `EVAL` — not `WATCH`/`MULTI` — is the primitive that gives a genuine
 * atomic increment over HTTP. Same rationale as the queue's `redis-scripts.ts`.)
 *
 * Security posture (load-bearing, identical to the rest of the module):
 *  - The script body is a **constant** — no policy id, key, token, or any dynamic
 *    datum is interpolated into the program text; the key travels in `KEYS[1]` and the
 *    window in `ARGV[1]`, so nothing sensitive can become part of the script.
 *  - The `key` handed in is ALREADY an opaque, salted-hash bucket token (or the shared
 *    sentinel) from `identity.ts` — never a raw IP. The provider composes it into a
 *    store key and uses that key ONLY as a Redis key: it is never logged, returned, or
 *    placed in a decision. The token is captured in the client closure for the auth
 *    header and likewise never surfaced.
 *  - **Fail-open semantics** per the {@link RateLimitProvider} contract: a genuine
 *    over-limit returns `{ allowed: false }` (a deliberate deny), but any transport or
 *    protocol failure THROWS, so the guard fails OPEN (allow, unenforced) — a limiter
 *    outage can never take the API down. It fabricates no enforcement.
 */

import {
  createRedisClient,
  type RedisClient,
  type RedisFetch,
  type RedisValue,
} from "@/lib/workers/queue/redis-client";
import type { RateLimitPolicy, RateLimiterVerdict } from "./types";
import type { RateLimitProvider } from "./provider";
import type { RateLimitRedisConfig } from "./redis-config";

/**
 * The atomic fixed-window script. Constant text — the key is `KEYS[1]`, the window
 * length (ms) is `ARGV[1]`, and the COST is `ARGV[2]`. Returns `{ count, pttlMs }`:
 *  - `INCRBY` adds this hit's cost (creating the key at `cost` on the window's first);
 *  - `PEXPIRE` stamps the window TTL so the window is fixed from its first hit and
 *    self-expires (bounded memory, no sweep);
 *  - `PTTL` reports the ms remaining, which becomes the caller's retry-after on a deny.
 *
 * COST 0 IS A PEEK and takes a different branch on purpose: `GET`, never `INCRBY`.
 * `INCRBY key 0` would CREATE a missing key at zero — so merely asking whether AI is
 * affordable would start the accounting window, and the answer would depend on having
 * asked. A read must not be a write.
 *
 * The TTL guard is `PTTL < 0` rather than the older `count == 1`. `PTTL` returns -2 for
 * a missing key and -1 for one with no expiry, so this stamps exactly when there is no
 * live window — which is the condition actually meant. `count == 1` was equivalent only
 * while every hit cost exactly one; with a cost of 40,000 the first hit of a window is
 * never 1, and the key would have lived forever.
 */
export const FIXED_WINDOW_SCRIPT = `
local cost = tonumber(ARGV[2]) or 1
local count
if cost > 0 then
  count = redis.call('INCRBY', KEYS[1], cost)
  if redis.call('PTTL', KEYS[1]) < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
else
  count = tonumber(redis.call('GET', KEYS[1])) or 0
end
local pttl = redis.call('PTTL', KEYS[1])
return { count, pttl }`;

/** Injectable transport seams so the provider is testable without a real broker. */
export interface RateLimitRedisDeps {
  /** A ready Redis client; defaults to one built from `config` + `fetchImpl`. */
  client?: RedisClient;
  /** Transport for the default client; ignored when `client` is provided. */
  fetchImpl?: RedisFetch;
}

/**
 * Compose the opaque store key for a `(policy, client bucket)` pair, namespaced under
 * the configured prefix so limiter keys never collide with queue/heartbeat keys. Every
 * segment is already content-free: the prefix is an operator namespace, `policy.id` is
 * a stable capability label, and `clientKey` is the shared sentinel or a salted hash.
 */
export function rateLimitBucketKey(
  keyPrefix: string,
  policyId: string,
  clientKey: string,
): string {
  return [keyPrefix, "ratelimit", policyId, clientKey].join(":");
}

/** Coerce a Redis reply element to a finite integer, or `null` when it is not one. */
function toInt(value: RedisValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim()))
    return Number(value.trim());
  return null;
}

/**
 * Build the distributed rate-limit provider from a validated store config. The token
 * is captured in the client closure (auth header only); neither it nor any store key
 * is ever logged or returned.
 */
export function createRedisRateLimitProvider(
  config: RateLimitRedisConfig,
  deps: RateLimitRedisDeps = {},
): RateLimitProvider {
  const client =
    deps.client ??
    createRedisClient({
      baseUrl: config.baseUrl,
      token: config.token,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });

  /**
   * One round-trip for a `(policy, key, cost)` triple. `cost` 0 peeks, 1 is an
   * ordinary request hit, N records a measured spend.
   */
  async function evaluate(
    policy: RateLimitPolicy,
    key: string,
    cost: number,
  ): Promise<RateLimiterVerdict> {
    // A non-positive limit means "never allow"; honor it without a round-trip.
    if (policy.limit < 1) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, policy.windowSeconds),
      };
    }

    const storeKey = rateLimitBucketKey(config.keyPrefix, policy.id, key);
    const windowMs = policy.windowSeconds * 1000;
    const res = await client.command([
      "EVAL",
      FIXED_WINDOW_SCRIPT,
      "1",
      storeKey,
      String(windowMs),
      String(cost),
    ]);

    // Transport/protocol failure (unreachable, non-2xx, command error, malformed
    // reply) ⇒ degrade per the configured fail mode. We NEVER fabricate an *allow*
    // from an errored backend; the choice is only "fail open" vs "fail closed":
    //  - `open` (default): THROW so the guard fails OPEN (allow, unenforced) — a
    //    limiter outage can never take the API down. The reason is generic and
    //    content-free (no key, endpoint, or token).
    //  - `closed`: return a deliberate DENY so the guard answers 429 — shed load
    //    rather than serve unthrottled. Retry-after is the full window (the store
    //    is down, so no live TTL is available).
    const failMode = config.failMode ?? "open";
    const onBackendError = (): RateLimiterVerdict => {
      if (failMode === "closed") {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, policy.windowSeconds),
        };
      }
      throw new Error("rate-limit store unavailable");
    };

    if (!res.ok) return onBackendError();

    const reply = res.value;
    const count = Array.isArray(reply) ? toInt(reply[0]) : null;
    if (count === null) return onBackendError();

    if (count <= policy.limit)
      return { allowed: true, retryAfterSeconds: 0, used: count };

    // Over budget ⇒ deliberate deny. Prefer the store's remaining TTL for retry-after;
    // fall back to the full window if PTTL was unavailable (-1/-2) or malformed.
    const pttl = Array.isArray(reply) ? toInt(reply[1]) : null;
    const retryAfterSeconds =
      pttl !== null && pttl > 0 ? Math.ceil(pttl / 1000) : policy.windowSeconds;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
      used: count,
    };
  }

  return {
    check: (policy, key, _nowMs) => evaluate(policy, key, 1),
    peek: (policy, key, _nowMs) => evaluate(policy, key, 0),
    async spend(policy, key, _nowMs, cost): Promise<void> {
      // A provider that reported no usage must not take the ceiling down with
      // it: record nothing rather than guessing a number.
      if (!Number.isFinite(cost) || cost <= 0) return;
      // The verdict is DELIBERATELY discarded. This runs after the spend has
      // already happened; "over budget" is information for the NEXT peek, not a
      // reason to drop the measurement that put us over.
      await evaluate(policy, key, Math.floor(cost));
    },
  };
}
