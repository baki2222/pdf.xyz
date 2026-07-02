/**
 * The queue-provider selector for the eager (production) request path — the
 * counterpart of `../storage/factory.ts`.
 *
 * It returns the *real* Redis/Upstash-compatible provider when — and only when —
 * the environment explicitly selects it (`PDFXYZ_QUEUE_PROVIDER=redis`) and every
 * required variable is present and well-formed. Otherwise it returns the honest
 * not-configured provider, so a missing or half-configured broker can only ever
 * yield a typed failure — never a fabricated job id or status. The fallback id
 * mirrors the resolved worker mode (`remote-unimplemented` when the legacy backend
 * variables are present, else `disabled`), keeping the pre-existing 501/503
 * behavior exactly when Redis is not in play.
 *
 * This module pulls the Redis provider (which imports `node:crypto` for
 * idempotency-key hashing) but NOT the in-process dev store, so it stays safe for
 * the eager adapter bundle. The presence-only status layer uses
 * `resolveQueueCapability` from `./redis-config` instead (node-free).
 */

import { isWorkerBackendConfigured } from "@/lib/jobs";
import { createNotConfiguredQueue } from "./not-configured";
import { parseRedisQueueConfig } from "./redis-config";
import { createRedisQueue, type RedisQueueDeps } from "./redis";
import type { QueueProvider } from "./types";

type EnvSource = Record<string, string | undefined>;

/**
 * Resolve the active queue provider from the environment. `deps` (clock + REST
 * transport / injected client) are forwarded to the Redis provider so
 * callers/tests can inject them; they are ignored for the not-configured fallback.
 */
export function createQueueProvider(
  env: EnvSource = process.env,
  deps: RedisQueueDeps = {},
): QueueProvider {
  const parsed = parseRedisQueueConfig(env);
  if (parsed.ok) return createRedisQueue(parsed.config, deps);

  // Not Redis (unset, or selected-but-invalid): fall back to the honest
  // not-configured provider, preserving the mode-based reason/status.
  const fallbackId = isWorkerBackendConfigured(env)
    ? "remote-unimplemented"
    : "disabled";
  return createNotConfiguredQueue(fallbackId);
}
