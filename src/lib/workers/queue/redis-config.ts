/**
 * Server-side configuration for the Redis/Upstash-compatible **job-queue**
 * provider — parsed from the environment, validated for presence and shape only.
 *
 * This is the queue counterpart of `../storage/s3-config.ts`, and it carries the
 * same load-bearing security posture:
 *  - We read the REST token *value* only to build the `Authorization` header
 *    inside the provider/client closure. It is **never** logged, serialized,
 *    returned to a client, or placed in a {@link QueueCapability}/status
 *    response. A parse failure names the offending *variable* (e.g.
 *    `PDFXYZ_REDIS_REST_TOKEN`) — never its value.
 *  - This is a node-free leaf (plain string parsing + the WHATWG `URL`), so the
 *    presence-only status reporter (`../providers.ts`) can derive queue readiness
 *    from it without pulling `node:crypto` or the REST client into a client
 *    bundle.
 *
 * Selection is explicit: the queue is only treated as Redis when
 * `PDFXYZ_QUEUE_PROVIDER` is `redis` (or the alias `upstash-redis`). When it is
 * unset the parser reports "not selected" and the caller falls back to the honest
 * not-configured / local-dev behavior. When it *is* set but any required variable
 * is missing or malformed, the parse fails and the caller preserves the honest
 * `not_configured` posture — it never enqueues against a half-configured broker.
 */

import type { FieldError } from "@/lib/jobs";
import type { QueueCapability } from "./types";

/** The environment variables this provider reads (names only; never values). */
export const REDIS_QUEUE_ENV = {
  provider: "PDFXYZ_QUEUE_PROVIDER",
  restUrl: "PDFXYZ_REDIS_REST_URL",
  restToken: "PDFXYZ_REDIS_REST_TOKEN",
  keyPrefix: "PDFXYZ_QUEUE_KEY_PREFIX",
  leaseSeconds: "PDFXYZ_QUEUE_LEASE_SECONDS",
  maxAttempts: "PDFXYZ_QUEUE_MAX_ATTEMPTS",
  jobTtlSeconds: "PDFXYZ_QUEUE_JOB_TTL_SECONDS",
} as const;

/** Values of {@link REDIS_QUEUE_ENV.provider} that select this provider. */
export const REDIS_PROVIDER_VALUES = ["redis", "upstash-redis"] as const;

/** Default key namespace when {@link REDIS_QUEUE_ENV.keyPrefix} is unset. */
export const DEFAULT_QUEUE_PREFIX = "pdfxyz";

// Bounds are deliberately strict: a queue misconfiguration should fail closed,
// and no single value can make the broker retain data or lease a job for an
// unreasonable length of time. All are seconds unless noted.
const LEASE_MIN_SECONDS = 5;
/**
 * The most {@link REDIS_QUEUE_ENV.leaseSeconds} may be set to: a 1h ceiling on a
 * single lease/heartbeat window. Exported because the daemon's `--lease-ms` bound
 * is derived from it (`daemon/args.ts`), so the CLI cannot accept a lease no queue
 * configuration could ever grant.
 */
export const LEASE_MAX_SECONDS = 3600;
/** The lease ceiling when {@link REDIS_QUEUE_ENV.leaseSeconds} is unset — 5 min. */
export const DEFAULT_LEASE_SECONDS = 300;
const ATTEMPTS_MIN = 1;
const ATTEMPTS_MAX = 20;
const DEFAULT_MAX_ATTEMPTS = 5; // dead-letter after this many delivery attempts.
const TTL_MIN_SECONDS = 300; // 5 min floor so a job survives its own lifecycle.
const TTL_MAX_SECONDS = 604_800; // 7 days hard ceiling on any retained key.
/**
 * Default TTL (seconds) of every broker key, the job record included — and so
 * the lifetime of the filename that record holds. Exported because the privacy
 * policy states it (`src/lib/retention-windows.ts`): a figure a page states
 * must be read from the code that enforces it, not typed beside it.
 */
export const DEFAULT_JOB_TTL_SECONDS = 86_400; // 24h: comfortably past the retention window.

type EnvSource = Record<string, string | undefined>;

/**
 * A validated, ready-to-use Redis queue configuration. Holds the REST token used
 * only to authenticate requests inside the provider closure — this object must
 * never be logged, serialized, or handed to a client.
 */
export interface RedisQueueConfig {
  /** Bare REST origin (no path/query/credentials), e.g. `https://x.upstash.io`. */
  readonly baseUrl: string;
  /** SECRET — the REST bearer token. Never logged or returned. */
  readonly token: string;
  /** Sanitized, non-empty key namespace every broker key lives under. */
  readonly keyPrefix: string;
  /** Hard ceiling (ms) a single claim/heartbeat may lease a job for. */
  readonly leaseCeilingMs: number;
  /** Delivery attempts before a job is dead-lettered (fails terminally). */
  readonly maxAttempts: number;
  /** TTL (seconds) applied to every broker key so nothing is retained forever. */
  readonly jobTtlSeconds: number;
}

/**
 * The lease the Redis queue actually grants for a requested one: never more than the
 * configured {@link RedisQueueConfig.leaseCeilingMs}. The single definition of the
 * clamp — `claim` and `heartbeat` in `./redis.ts` apply it, and the daemon runtime
 * uses it to report a `--lease-ms` the queue will shorten, instead of shortening it
 * silently.
 */
export function grantedLeaseMs(
  requestedMs: number,
  config: Pick<RedisQueueConfig, "leaseCeilingMs">,
): number {
  return Math.min(requestedMs, config.leaseCeilingMs);
}

/** Outcome of parsing the environment for a Redis queue configuration. */
export type ParseRedisQueueConfigResult =
  | { ok: true; config: RedisQueueConfig }
  | {
      ok: false;
      /** Whether {@link REDIS_QUEUE_ENV.provider} selected a Redis broker at all. */
      selected: boolean;
      /** Missing/malformed variables, by NAME only. Server-side diagnostics. */
      issues: FieldError[];
    };

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when this environment explicitly selects the Redis queue provider. */
export function isRedisQueueSelected(env: EnvSource = process.env): boolean {
  const value = read(env, REDIS_QUEUE_ENV.provider)?.toLowerCase();
  return (
    value !== undefined &&
    (REDIS_PROVIDER_VALUES as readonly string[]).includes(value)
  );
}

// A REST token: printable ASCII with no spaces. Deliberately loose so we never
// reject a valid token (base64/hex/±/=), only obvious junk. Same rule as the S3
// secret so the two providers validate credentials identically.
const TOKEN_RE = /^[\x21-\x7e]{8,1024}$/;
// Key prefix: a conservative Redis-key-safe namespace. `:` is allowed as a
// nested separator; traversal and whitespace are not.
const PREFIX_RE = /^[A-Za-z0-9:_-]{1,64}$/;

/**
 * Validate a Redis REST **token** for shape only (never against the live service).
 * Exported so every consumer of a Redis/Upstash-REST credential — the job queue AND
 * the distributed rate-limit store (`@/lib/ratelimit`) — validates the bearer token
 * with the *same* rule; the security-relevant "is this a plausible token" check can
 * never drift laxer in a second copy. The value is only tested, never logged/returned.
 */
export function isValidRedisRestToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

/**
 * Normalize + validate a Redis REST URL to a **bare origin** (no path/query/fragment
 * or embedded credentials), so a typo can never redirect commands or smuggle a token
 * into a URL. Exported so the rate-limit store validates its endpoint identically to
 * the queue; the caller appends `/pipeline` etc. itself.
 */
export function parseRedisRestOrigin(
  raw: string,
): { ok: true; baseUrl: string } | { ok: false } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false };
  if (url.username || url.password || url.search || url.hash)
    return { ok: false };
  if (url.pathname !== "" && url.pathname !== "/") return { ok: false };
  if (!url.host) return { ok: false };
  return { ok: true, baseUrl: `${url.protocol}//${url.host}` };
}

/**
 * Sanitize a Redis key **prefix** (strip surrounding colons; reject traversal or
 * illegal chars), applying `fallback` when unset/blank. Exported so the queue and the
 * rate-limit store namespace keys under the identical conservative rule.
 */
export function sanitizeRedisKeyPrefix(
  raw: string | undefined,
  fallback: string,
): { ok: true; value: string } | { ok: false } {
  if (raw === undefined) return { ok: true, value: fallback };
  const trimmed = raw.replace(/^:+/, "").replace(/:+$/, "");
  if (trimmed === "") return { ok: true, value: fallback };
  if (trimmed.includes("..") || !PREFIX_RE.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

/** Parse a positive-integer setting within `[min, max]`; unset ⇒ default. */
function parseBoundedInt(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): { ok: true; value: number } | { ok: false } {
  if (raw === undefined) return { ok: true, value: fallback };
  if (!/^\d{1,10}$/.test(raw)) return { ok: false };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return { ok: false };
  return { ok: true, value: n };
}

/**
 * Parse and validate the Redis queue configuration from an environment source.
 * Presence and shape only: it confirms every required variable is present and
 * well-formed but never checks the token against the live service (that happens
 * when the provider issues its first command). `env` is injectable for tests.
 */
export function parseRedisQueueConfig(
  env: EnvSource = process.env,
): ParseRedisQueueConfigResult {
  if (!isRedisQueueSelected(env)) {
    return { ok: false, selected: false, issues: [] };
  }

  const issues: FieldError[] = [];
  const miss = (name: string, message: string) =>
    issues.push({ field: name, message });

  // Required.
  const urlRaw = read(env, REDIS_QUEUE_ENV.restUrl);
  let baseUrl: string | null = null;
  if (!urlRaw) {
    miss(
      REDIS_QUEUE_ENV.restUrl,
      "Set the Redis REST endpoint origin (https URL).",
    );
  } else {
    const parsed = parseRedisRestOrigin(urlRaw);
    if (!parsed.ok) {
      miss(
        REDIS_QUEUE_ENV.restUrl,
        "Must be an http(s) origin with no path or query.",
      );
    } else {
      baseUrl = parsed.baseUrl;
    }
  }

  const token = read(env, REDIS_QUEUE_ENV.restToken);
  if (!token) miss(REDIS_QUEUE_ENV.restToken, "Set the Redis REST token.");
  else if (!isValidRedisRestToken(token)) {
    miss(REDIS_QUEUE_ENV.restToken, "Malformed REST token.");
  }

  // Optional, bounded.
  const prefix = sanitizeRedisKeyPrefix(
    read(env, REDIS_QUEUE_ENV.keyPrefix),
    DEFAULT_QUEUE_PREFIX,
  );
  if (!prefix.ok) {
    miss(
      REDIS_QUEUE_ENV.keyPrefix,
      "Malformed key prefix (no `..`, use [A-Za-z0-9:_-]).",
    );
  }

  const lease = parseBoundedInt(
    read(env, REDIS_QUEUE_ENV.leaseSeconds),
    LEASE_MIN_SECONDS,
    LEASE_MAX_SECONDS,
    DEFAULT_LEASE_SECONDS,
  );
  if (!lease.ok) {
    miss(
      REDIS_QUEUE_ENV.leaseSeconds,
      `Integer seconds ${LEASE_MIN_SECONDS}–${LEASE_MAX_SECONDS}.`,
    );
  }

  const attempts = parseBoundedInt(
    read(env, REDIS_QUEUE_ENV.maxAttempts),
    ATTEMPTS_MIN,
    ATTEMPTS_MAX,
    DEFAULT_MAX_ATTEMPTS,
  );
  if (!attempts.ok) {
    miss(
      REDIS_QUEUE_ENV.maxAttempts,
      `Integer ${ATTEMPTS_MIN}–${ATTEMPTS_MAX}.`,
    );
  }

  const ttl = parseBoundedInt(
    read(env, REDIS_QUEUE_ENV.jobTtlSeconds),
    TTL_MIN_SECONDS,
    TTL_MAX_SECONDS,
    DEFAULT_JOB_TTL_SECONDS,
  );
  if (!ttl.ok) {
    miss(
      REDIS_QUEUE_ENV.jobTtlSeconds,
      `Integer seconds ${TTL_MIN_SECONDS}–${TTL_MAX_SECONDS}.`,
    );
  }

  if (
    issues.length > 0 ||
    !baseUrl ||
    !token ||
    !prefix.ok ||
    !lease.ok ||
    !attempts.ok ||
    !ttl.ok
  ) {
    return { ok: false, selected: true, issues };
  }

  return {
    ok: true,
    config: {
      baseUrl,
      token,
      keyPrefix: prefix.value,
      leaseCeilingMs: lease.value * 1000,
      maxAttempts: attempts.value,
      jobTtlSeconds: ttl.value,
    },
  };
}

/**
 * The client-safe capability of a *ready* Redis queue provider. Deliberately
 * contains no endpoint, token, prefix, variable name, or key name — only the
 * honest "this environment can accept, report, and cancel jobs" signal and a
 * generic explanation. Note `configured: true`: the broker is genuinely wired,
 * unlike the `remote-unimplemented` placeholder.
 */
export function redisQueueCapability(): QueueCapability {
  return {
    provider: "redis",
    ready: true,
    configured: true,
    enqueue: true,
    status: true,
    cancel: true,
    // Every state transition runs as a server-side Lua compare-and-set (Phase 21),
    // so claim/heartbeat/complete/fail/cancel/expire are atomic and race-safe.
    atomicTransitions: true,
    detail:
      "A production job queue is configured and ready: jobs are enqueued with a server-minted id, and their status, cancellation, and expiry are tracked in a shared broker with atomic, race-safe state transitions. Whether a queued job is then processed depends on a worker being deployed to drain the queue.",
  };
}

/**
 * Presence-only: whether the queue selected by this environment can guarantee
 * **atomic, race-safe state transitions**. True only when the Redis/Upstash
 * provider is selected AND fully valid — its transitions run as server-side Lua
 * compare-and-set over the REST transport. False when the queue is unset,
 * selected-but-misconfigured, or a not-implemented placeholder. The strict
 * production guardrail uses this to fail fast when atomicity is required but the
 * configured provider cannot promise it. Never reads or returns a secret.
 */
export function queueSupportsAtomicTransitions(
  env: EnvSource = process.env,
): boolean {
  return parseRedisQueueConfig(env).ok;
}

/**
 * Presence-only queue readiness for the status layer. Returns the ready Redis
 * capability when the provider is selected AND fully valid; otherwise `null`,
 * signaling the caller to fall back to the mode-based (honest not-configured)
 * capability. A selected-but-misconfigured deployment therefore reports as
 * not-configured to the client (no fingerprinting), while server-side
 * diagnostics remain available via {@link parseRedisQueueConfig}. Never reads or
 * returns a secret.
 */
export function resolveQueueCapability(
  env: EnvSource = process.env,
): QueueCapability | null {
  return parseRedisQueueConfig(env).ok ? redisQueueCapability() : null;
}
