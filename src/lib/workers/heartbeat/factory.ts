/**
 * The environment-driven selector for the worker liveness **heartbeat** — the
 * counterpart of the queue's `createQueueProvider`.
 *
 * The feature is doubly gated, both for honesty and for safety:
 *  1. it must be **explicitly enabled** (`PDFXYZ_WORKER_HEARTBEAT` truthy), and
 *  2. a **compatible backend** must be configured (the same Redis/Upstash broker the
 *     job queue uses — `parseRedisQueueConfig` must succeed).
 *
 * Only when BOTH hold does this return a real Redis-backed publisher/reader; in
 * every other case it returns a disabled no-op. That gate is what keeps the web
 * vantage honest: with the feature off, an absent heartbeat means "observation not
 * enabled" (neutral), not "the worker is down". With it on, an absent heartbeat is a
 * meaningful `unknown`. The read side never touches the network when disabled, so
 * the no-config path stays offline and deterministic.
 *
 * Node-free: it composes only the node-free queue config parser and the node-free
 * `RedisClient` transport, so `readWorkerHeartbeatLiveness` is safe to call from the
 * `/api/worker/operations` route, and `createHeartbeatPublisher` is called by the
 * Node-only daemon CLI.
 */

import type { FieldError } from "@/lib/jobs";
import {
  parseRedisQueueConfig,
  type RedisQueueConfig,
} from "../queue/redis-config";
import {
  HEARTBEAT_DEFAULT_INTERVAL_SECONDS,
  HEARTBEAT_MAX_INTERVAL_SECONDS,
  HEARTBEAT_MIN_INTERVAL_SECONDS,
  disabledLiveness,
  freshWindowMsFor,
  ttlSecondsFor,
} from "./schema";
import {
  createRedisHeartbeatPublisher,
  createRedisHeartbeatReader,
  type HeartbeatPublishSpec,
  type HeartbeatRedisDeps,
} from "./redis";
import { HEARTBEAT_ROLE } from "./types";
import type {
  HeartbeatCapabilities,
  HeartbeatCapability,
  HeartbeatLiveness,
  HeartbeatPublisher,
  HeartbeatReader,
  HeartbeatSource,
} from "./types";

type EnvSource = Record<string, string | undefined>;

/** The environment variables this seam reads (names only; never values). */
export const WORKER_HEARTBEAT_ENV = {
  /** Truthy ⇒ publish + read cross-process liveness (when a backend is configured). */
  enabled: "PDFXYZ_WORKER_HEARTBEAT",
  /** Optional publish cadence in seconds (bounded); unset ⇒ the default. */
  intervalSeconds: "PDFXYZ_WORKER_HEARTBEAT_INTERVAL_SECONDS",
} as const;

/** Values of {@link WORKER_HEARTBEAT_ENV.enabled} that turn the feature on. */
const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when the heartbeat feature is explicitly enabled in this environment. */
export function isHeartbeatEnabled(env: EnvSource = process.env): boolean {
  const value = read(env, WORKER_HEARTBEAT_ENV.enabled)?.toLowerCase();
  return value !== undefined && TRUTHY.has(value);
}

/**
 * Parse the bounded publish cadence (seconds). An unset or malformed value falls
 * back to the default — a bad interval must never disable liveness or crash a run.
 * A malformed value is reported (by NAME only) for server-side diagnostics.
 */
export function resolveHeartbeatIntervalSeconds(env: EnvSource = process.env): {
  intervalSeconds: number;
  issue?: FieldError;
} {
  const raw = read(env, WORKER_HEARTBEAT_ENV.intervalSeconds);
  if (raw === undefined)
    return { intervalSeconds: HEARTBEAT_DEFAULT_INTERVAL_SECONDS };
  if (/^\d{1,7}$/.test(raw)) {
    const n = Number(raw);
    if (
      Number.isInteger(n) &&
      n >= HEARTBEAT_MIN_INTERVAL_SECONDS &&
      n <= HEARTBEAT_MAX_INTERVAL_SECONDS
    ) {
      return { intervalSeconds: n };
    }
  }
  return {
    intervalSeconds: HEARTBEAT_DEFAULT_INTERVAL_SECONDS,
    issue: {
      field: WORKER_HEARTBEAT_ENV.intervalSeconds,
      message: `Integer seconds ${HEARTBEAT_MIN_INTERVAL_SECONDS}–${HEARTBEAT_MAX_INTERVAL_SECONDS}; using the default.`,
    },
  };
}

/** The resolved heartbeat wiring for this environment. */
export interface ResolvedHeartbeat {
  /** True only when enabled AND a compatible backend is configured. */
  readonly enabled: boolean;
  readonly source: HeartbeatSource;
  readonly intervalSeconds: number;
  /** The validated broker config, or `null` when not configured. */
  readonly redis: RedisQueueConfig | null;
}

/** Resolve whether/how liveness is wired here. Presence + shape only; no network. */
export function resolveHeartbeat(
  env: EnvSource = process.env,
): ResolvedHeartbeat {
  const { intervalSeconds } = resolveHeartbeatIntervalSeconds(env);
  const enabledFlag = isHeartbeatEnabled(env);
  const parsed = parseRedisQueueConfig(env);
  const redis = parsed.ok ? parsed.config : null;
  const enabled = enabledFlag && redis !== null;
  return {
    enabled,
    source: enabled ? "queue-broker" : "none",
    intervalSeconds,
    redis,
  };
}

/** The content-free capability of a disabled heartbeat seam. */
function disabledCapability(
  intervalSeconds: number,
  enabledFlag: boolean,
): HeartbeatCapability {
  return {
    enabled: false,
    source: "none",
    role: HEARTBEAT_ROLE,
    intervalSeconds,
    freshWindowSeconds: freshWindowMsFor(intervalSeconds) / 1000,
    ttlSeconds: ttlSecondsFor(intervalSeconds),
    detail: enabledFlag
      ? "Worker liveness heartbeats are enabled but no compatible backend (a configured job-queue broker) is present, so nothing is published or observed."
      : "Worker liveness heartbeats are not enabled here, so nothing is published or observed; confirm a worker out-of-band.",
  };
}

/** Options for {@link createHeartbeatPublisher}. */
export interface HeartbeatPublisherOptions extends HeartbeatPublishSpec {
  /** Injectable Redis seams (client/fetch/clock) for deterministic tests. */
  readonly deps?: HeartbeatRedisDeps;
}

/**
 * Build the active heartbeat publisher from the environment. Returns a real
 * Redis-backed publisher only when the feature is enabled AND a broker is
 * configured; otherwise a disabled no-op whose `beat()` reports `disabled` without
 * any network call.
 */
export function createHeartbeatPublisher(
  env: EnvSource = process.env,
  opts: HeartbeatPublisherOptions = {
    mode: "starting",
    capabilities: emptyCapabilities(),
  },
): HeartbeatPublisher {
  const resolved = resolveHeartbeat(env);
  if (resolved.enabled && resolved.redis) {
    return createRedisHeartbeatPublisher(
      resolved.redis,
      resolved.intervalSeconds,
      {
        mode: opts.mode,
        capabilities: opts.capabilities,
        ...(opts.release !== undefined ? { release: opts.release } : {}),
      },
      opts.deps ?? {},
    );
  }
  const capability = disabledCapability(
    resolved.intervalSeconds,
    isHeartbeatEnabled(env),
  );
  return {
    capability,
    async beat() {
      return { published: false, reason: "disabled" };
    },
  };
}

/**
 * Build the active heartbeat reader from the environment. Returns a real
 * Redis-backed reader only when the feature is enabled AND a broker is configured;
 * otherwise a disabled reader whose `read()` returns a neutral `disabled` liveness
 * without any network call.
 */
export function createHeartbeatReader(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): HeartbeatReader {
  const resolved = resolveHeartbeat(env);
  if (resolved.enabled && resolved.redis) {
    return createRedisHeartbeatReader(
      resolved.redis,
      resolved.intervalSeconds,
      deps,
    );
  }
  const capability = disabledCapability(
    resolved.intervalSeconds,
    isHeartbeatEnabled(env),
  );
  return {
    capability,
    async read() {
      return disabledLiveness("none");
    },
  };
}

/**
 * Convenience for the web route: resolve the reader and read the latest liveness in
 * one call. Never throws; a disabled seam returns a neutral `disabled` liveness and
 * an unreachable broker returns `unknown`.
 */
export function readWorkerHeartbeatLiveness(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<HeartbeatLiveness> {
  return createHeartbeatReader(env, deps).read();
}

/** All-false capabilities — the safe default when a caller has nothing to report. */
export function emptyCapabilities(): HeartbeatCapabilities {
  return {
    deepCompression: false,
    ocr: false,
    ocrLanguages: [],
    malwareScan: false,
    atomicQueue: false,
  };
}
