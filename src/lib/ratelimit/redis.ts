/**
 * The **distributed rate-limit provider** — a real {@link RateLimitProvider} backed
 * by the same node-free Redis/Upstash-REST transport (`createRedisClient`) the job
 * queue and the liveness heartbeat use. Registering it (see `factory.ts` +
 * `src/instrumentation.ts`) is what upgrades the guard from a per-process dev limiter
 * to an honest cross-instance throttle: every web replica increments the same window
 * counter, so a policy's budget is shared, not multiplied by the replica count.
 *
 * Atomic by construction — never a race-prone get-then-set. Each check is ONE server
 * side Lua script (`EVAL`): `INCR` the window key, set the window TTL on first hit,
 * read the remaining TTL, and return `{count, pttlMs}` — all executed to completion
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
 * length (ms) is `ARGV[1]`. Returns `{ count, pttlMs }`:
 *  - `INCR` counts this hit (creating the key at 1 on the first hit of a window);
 *  - `PEXPIRE` stamps the window TTL exactly once, when the counter is created, so the
 *    window is fixed from its first hit and self-expires (bounded memory, no sweep);
 *  - `PTTL` reports the ms remaining, which becomes the caller's retry-after on a deny.
 */
export const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
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
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
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

  return {
    async check(
      policy: RateLimitPolicy,
      key: string,
      _nowMs: number,
    ): Promise<RateLimiterVerdict> {
      // A non-positive limit means "never allow"; honor it without a round-trip.
      if (policy.limit < 1) {
        return { allowed: false, retryAfterSeconds: Math.max(1, policy.windowSeconds) };
      }

      const storeKey = rateLimitBucketKey(config.keyPrefix, policy.id, key);
      const windowMs = policy.windowSeconds * 1000;
      const res = await client.command([
        "EVAL",
        FIXED_WINDOW_SCRIPT,
        "1",
        storeKey,
        String(windowMs),
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
          return { allowed: false, retryAfterSeconds: Math.max(1, policy.windowSeconds) };
        }
        throw new Error("rate-limit store unavailable");
      };

      if (!res.ok) return onBackendError();

      const reply = res.value;
      const count = Array.isArray(reply) ? toInt(reply[0]) : null;
      if (count === null) return onBackendError();

      if (count <= policy.limit) return { allowed: true, retryAfterSeconds: 0 };

      // Over budget ⇒ deliberate deny. Prefer the store's remaining TTL for retry-after;
      // fall back to the full window if PTTL was unavailable (-1/-2) or malformed.
      const pttl = Array.isArray(reply) ? toInt(reply[1]) : null;
      const retryAfterSeconds =
        pttl !== null && pttl > 0 ? Math.ceil(pttl / 1000) : policy.windowSeconds;
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    },
  };
}
