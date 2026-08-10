/**
 * The Redis/Upstash-compatible **liveness heartbeat** provider — the publish and
 * read halves, built on the exact same node-free {@link RedisClient} transport and
 * validated {@link RedisQueueConfig} the job queue uses. Reusing the queue's broker
 * means no new hosted dependency: a deployment that already has Redis wired gets
 * cross-process liveness for free, under the same sanitized key prefix.
 *
 * The entire liveness state is ONE key — `{prefix}:heartbeat:{role}` — holding the
 * bounded, content-free {@link WorkerHeartbeat} JSON with a TTL. A single shared key
 * per role answers exactly the question that matters ("is *a* worker of this role
 * alive?"): any replica's beat keeps it fresh, and no worker id is stored, so there
 * is no per-instance, high-cardinality fan-out. The config (which holds the REST
 * token) is captured in the client closure and never logged, serialized, or
 * returned — identical to the queue provider.
 *
 * Failure is always honest and never disruptive:
 *  - a publish that cannot reach the broker returns `unavailable` and NEVER throws,
 *    so a heartbeat outage cannot corrupt a job or crash the daemon loop;
 *  - a read that cannot reach the broker classifies as `unknown` (we genuinely
 *    cannot tell), never as a fabricated "observed".
 */

import {
  createRedisClient,
  type RedisClient,
  type RedisFetch,
} from "../queue/redis-client";
import type { RedisQueueConfig } from "../queue/redis-config";
import { HEARTBEAT_ROLE } from "./types";
import type {
  HeartbeatCapabilities,
  HeartbeatCapability,
  HeartbeatLiveness,
  HeartbeatMode,
  HeartbeatPublisher,
  HeartbeatPublishResult,
  HeartbeatReader,
} from "./types";
import {
  buildHeartbeat,
  classifyLiveness,
  freshWindowMsFor,
  parseHeartbeat,
  serializeHeartbeat,
  ttlSecondsFor,
} from "./schema";

/** Injectable seams so the provider is fully testable without a real broker. */
export interface HeartbeatRedisDeps {
  /** A ready Redis client; defaults to one built from `config` + `fetchImpl`. */
  client?: RedisClient;
  /** Transport for the default client; ignored when `client` is provided. */
  fetchImpl?: RedisFetch;
  /** Clock (ms); defaults to `Date.now`. Injected for deterministic tests. */
  now?: () => number;
}

/** The heartbeat's single broker key, namespaced under the queue's key prefix. */
export function heartbeatKey(keyPrefix: string): string {
  return [keyPrefix, "heartbeat", HEARTBEAT_ROLE].join(":");
}

/** Build the content-free capability for a ready Redis-backed heartbeat. */
function readyCapability(intervalSeconds: number): HeartbeatCapability {
  return {
    enabled: true,
    source: "queue-broker",
    role: HEARTBEAT_ROLE,
    intervalSeconds,
    freshWindowSeconds: freshWindowMsFor(intervalSeconds) / 1000,
    ttlSeconds: ttlSecondsFor(intervalSeconds),
    detail:
      "Worker liveness heartbeats are published to and read from the shared job-queue broker with a TTL, so a recent beat reads as observed, an aged beat as stale, and a swept beat as unknown.",
  };
}

/** The fixed record fields a publisher stamps onto every beat. */
export interface HeartbeatPublishSpec {
  readonly mode: HeartbeatMode;
  readonly capabilities: HeartbeatCapabilities;
  /** Raw release; coarsened to `major.minor` (or dropped) before storage. */
  readonly release?: string;
}

/**
 * Build a Redis-backed heartbeat publisher. `beat()` is self-throttling (it writes
 * at most once per interval) and self-guarding (any transport error is swallowed to
 * an `unavailable` result), so wiring it into the daemon loop can never disrupt
 * draining. The key is written with a TTL, so a stopped worker's liveness vanishes.
 */
export function createRedisHeartbeatPublisher(
  config: RedisQueueConfig,
  intervalSeconds: number,
  spec: HeartbeatPublishSpec,
  deps: HeartbeatRedisDeps = {},
): HeartbeatPublisher {
  const now = deps.now ?? (() => Date.now());
  const client =
    deps.client ??
    createRedisClient({
      baseUrl: config.baseUrl,
      token: config.token,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
  const key = heartbeatKey(config.keyPrefix);
  const ttlSeconds = ttlSecondsFor(intervalSeconds);
  const intervalMs = intervalSeconds * 1000;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;

  return {
    capability: readyCapability(intervalSeconds),
    async beat(): Promise<HeartbeatPublishResult> {
      const t = now();
      // Throttle to at most one write per interval, so a busy loop that calls this
      // every tick still touches the broker only on the cadence.
      if (t - lastAttemptAt < intervalMs) {
        return { published: false, reason: "throttled" };
      }
      // Back off regardless of the outcome below, so a persistent broker failure is
      // retried at most once per interval rather than hammered every tick.
      lastAttemptAt = t;
      const record = buildHeartbeat({
        mode: spec.mode,
        capabilities: spec.capabilities,
        ...(spec.release !== undefined ? { release: spec.release } : {}),
        at: t,
      });
      try {
        const res = await client.command([
          "SET",
          key,
          serializeHeartbeat(record),
          "EX",
          String(ttlSeconds),
        ]);
        // A transport failure is honest and non-disruptive — never thrown.
        return res.ok
          ? { published: true, reason: "published" }
          : { published: false, reason: "unavailable" };
      } catch {
        // Defensive: a truly unexpected throw must never escape into the loop.
        return { published: false, reason: "unavailable" };
      }
    },
  };
}

/**
 * Build a Redis-backed heartbeat reader. `read()` GETs the single liveness key and
 * classifies it (observed / stale / unknown). A missing key or an unreachable broker
 * classifies as `unknown` — never a fabricated `observed` — and it never throws.
 */
export function createRedisHeartbeatReader(
  config: RedisQueueConfig,
  intervalSeconds: number,
  deps: HeartbeatRedisDeps = {},
): HeartbeatReader {
  const now = deps.now ?? (() => Date.now());
  const client =
    deps.client ??
    createRedisClient({
      baseUrl: config.baseUrl,
      token: config.token,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
  const key = heartbeatKey(config.keyPrefix);
  const freshWindowMs = freshWindowMsFor(intervalSeconds);

  return {
    capability: readyCapability(intervalSeconds),
    async read(): Promise<HeartbeatLiveness> {
      let raw: unknown = null;
      try {
        const res = await client.command(["GET", key]);
        // Broker unreachable/errored ⇒ we genuinely cannot tell ⇒ unknown (below).
        if (res.ok) raw = res.value;
      } catch {
        raw = null;
      }
      const record = parseHeartbeat(raw);
      return classifyLiveness(record, {
        now: now(),
        freshWindowMs,
        source: "queue-broker",
      });
    },
  };
}
