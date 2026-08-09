/**
 * The **gated-tool interest counter** — the storage half of the "notify me"
 * demand signal. One integer per catalogue slug, and nothing else.
 *
 * A visitor pressing "Notify me" on an unbuilt tool is performing an act of
 * communication — telling us which tool they want — and this module records
 * exactly that act: `INCR {prefix}:interest:{slug}` on the web-tier
 * Redis/Upstash store the rate limiter already runs. It deliberately stores
 * **no second dimension**: no identifier, no hash of an identifier, no
 * timestamp per event, no user agent, no count-by-day. A slug and a number.
 * `/privacy` §4 discloses this in exactly those terms ("the tool's name, and
 * nothing else"), and `interest-disclosure.test.ts` fails the build if this
 * capability exists while that disclosure does not.
 *
 * Posture:
 *  - **Fail open, silent to the user, visible to the operator.** A counter
 *    write must never affect the caller's request: no store configured (the
 *    default) is a quiet no-op, and a failing store is swallowed — but a
 *    failure is NOT silent to operations: it emits the same throttled,
 *    content-free warn line the abuse guard uses (`guard.ts`), because a
 *    counter that quietly stops counting is a `ready:true` in a new costume.
 *  - **Bounded key space.** Callers pass a slug they took from the compiled
 *    catalogue (the route re-derives it from `getToolBySlug(...).slug`), so
 *    the store can never hold a key an attacker chose.
 *  - **No new credentials, no new dependency.** It reuses the rate limiter's
 *    web-tier store config and REST client verbatim; the queue's worker-only
 *    credentials are never touched.
 */

import { createRedisClient } from "@/lib/workers/queue/redis-client";
import { parseRateLimitRedisConfig } from "@/lib/ratelimit/redis-config";

type EnvSource = Record<string, string | undefined>;

/** The key namespace, distinct from the limiter's `ratelimit` segment. */
export const INTEREST_NAMESPACE = "interest";

/** `{prefix}:interest:{slug}` — the one key shape the counter reads or writes. */
export function interestCounterKey(keyPrefix: string, slug: string): string {
  return [keyPrefix, INTEREST_NAMESPACE, slug].join(":");
}

/**
 * Say out loud that clicks are not being counted. Same shape and rationale as
 * the guard's fail-open note: the condition an operator must hear about is the
 * one where everything looks fine and the data quietly stops. Content-free and
 * throttled to at most one line a minute per instance.
 */
const FAIL_OPEN_LOG_INTERVAL_MS = 60_000;
let lastFailOpenLogMs = 0;

function noteInterestFailOpen(nowMs: number = Date.now()): void {
  if (nowMs - lastFailOpenLogMs < FAIL_OPEN_LOG_INTERVAL_MS) return;
  lastFailOpenLogMs = nowMs;
  console.warn(
    "[pdf.xyz] tool-interest counter FAILING OPEN (store-error) — clicks are not being counted",
  );
}

/** Test seam: forget the throttle so a case can assert the line is emitted. */
export function resetInterestFailOpenLogForTests(): void {
  lastFailOpenLogMs = 0;
}

/**
 * Count one act of interest in `slug`. Never throws, never blocks on a missing
 * store, never surfaces an error to the caller — the return value says only
 * whether a store write was attempted-and-acknowledged, for tests and the CLI.
 */
export async function noteToolInterest(
  slug: string,
  env: EnvSource = process.env,
): Promise<boolean> {
  try {
    const parsed = parseRateLimitRedisConfig(env);
    // No store wired — the local-dev / default deployment. A deliberate
    // off-state stays quiet (the guard's own rule); nothing to warn about.
    if (!parsed.ok) return false;
    const client = createRedisClient({
      baseUrl: parsed.config.baseUrl,
      token: parsed.config.token,
    });
    const res = await client.command([
      "INCR",
      interestCounterKey(parsed.config.keyPrefix, slug),
    ]);
    if (!res.ok) {
      noteInterestFailOpen();
      return false;
    }
    return true;
  } catch {
    noteInterestFailOpen();
    return false;
  }
}
