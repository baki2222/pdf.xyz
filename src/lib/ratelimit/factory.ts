/**
 * The environment-driven selector that turns configuration into a concrete
 * {@link RateLimitProvider} (or nothing) — the rate-limit counterpart of the queue's
 * `createQueueProvider` and the heartbeat's `createHeartbeatPublisher`.
 *
 * A distributed provider is built only when BOTH hold, mirroring those seams:
 *  1. `PDFXYZ_RATE_LIMIT_PROVIDER` names a **remote** backend (redis/upstash/…), and
 *  2. a **compatible store** is configured (`parseRateLimitRedisConfig` succeeds).
 *
 * In every other case it returns `null`, and the guard keeps its honest posture:
 * `disabled` allows everything unenforced, `local-memory` uses the per-process dev
 * limiter, and a remote selection with no valid store resolves to
 * `remote-unimplemented` (an honest skip — never fabricated enforcement). Node-free:
 * it composes only the node-free config parser and the node-free REST transport, so
 * the boot hook (`src/instrumentation.ts`) can call it without pulling anything
 * Node-only into a bundle.
 */

import type { FieldError } from "@/lib/jobs";
import { resolveRateLimitProviderId } from "./config";
import type { RateLimitProvider } from "./provider";
import {
  createRedisRateLimitProvider,
  type RateLimitRedisDeps,
} from "./redis";
import {
  parseRateLimitRedisConfig,
  type RateLimitRedisConfig,
} from "./redis-config";

type EnvSource = Record<string, string | undefined>;

/** The concrete backend this environment resolves to. */
export type RateLimitBackendKind =
  /** Provider unset / off — allow all, unenforced. */
  | "disabled"
  /** The per-process in-memory dev limiter. Real, not distributed. */
  | "local-memory"
  /** A remote backend selected AND a valid distributed store is configured. */
  | "redis"
  /** A remote backend selected but the store is unset/misconfigured — honest skip. */
  | "unconfigured";

/** The resolved rate-limit backend for an environment (presence + shape only). */
export interface ResolvedRateLimitBackend {
  readonly kind: RateLimitBackendKind;
  /** The validated store config, or `null` when not `"redis"`. */
  readonly redis: RateLimitRedisConfig | null;
  /**
   * True when a remote backend is selected AND at least one store credential was
   * supplied — i.e. the operator *tried* to wire a distributed store. Lets the status
   * layer tell "not configured at all" from "partially/mis-configured".
   */
  readonly attempted: boolean;
  /** Missing/malformed store variables, by NAME only, when `"unconfigured"`. */
  readonly issues: FieldError[];
}

/**
 * Resolve which backend this environment selects. Never contacts a store; never reads
 * or returns a secret value.
 */
export function resolveRateLimitBackend(
  env: EnvSource = process.env,
): ResolvedRateLimitBackend {
  const providerId = resolveRateLimitProviderId(env);

  if (providerId === "disabled") {
    return { kind: "disabled", redis: null, attempted: false, issues: [] };
  }
  if (providerId === "local-memory") {
    return { kind: "local-memory", redis: null, attempted: false, issues: [] };
  }

  // A remote backend is selected (providerId === "remote-unimplemented"): back it with
  // the distributed Redis/Upstash store when — and only when — that store is valid.
  const parsed = parseRateLimitRedisConfig(env);
  if (parsed.ok) {
    return { kind: "redis", redis: parsed.config, attempted: true, issues: [] };
  }
  return {
    kind: "unconfigured",
    redis: null,
    attempted: parsed.provided,
    issues: parsed.issues,
  };
}

/**
 * Build the configured distributed provider for this environment, or `null` when no
 * remote backend applies (disabled / local-memory / remote-selected-but-unconfigured).
 * The boot hook registers the result exactly once. `deps` injects the transport for
 * deterministic tests.
 */
export function createConfiguredRateLimitProvider(
  env: EnvSource = process.env,
  deps: RateLimitRedisDeps = {},
): RateLimitProvider | null {
  const backend = resolveRateLimitBackend(env);
  if (backend.kind === "redis" && backend.redis) {
    return createRedisRateLimitProvider(backend.redis, deps);
  }
  return null;
}
