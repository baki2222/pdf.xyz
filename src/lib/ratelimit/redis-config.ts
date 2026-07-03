/**
 * Environment configuration for the **distributed rate-limit store** — a
 * Redis/Upstash-REST endpoint the public-API abuse guard keys its fixed windows
 * into so a limit is honored across every web instance, not just one process.
 *
 * Why its own variables, not the queue's `PDFXYZ_REDIS_REST_*`:
 *  - The rate-limit guard runs on the **public web tier** (it is called by the API
 *    route handlers). The job-queue broker credentials are **worker-only** and, by a
 *    load-bearing deployment invariant, must never land on the public web pod (see
 *    `src/deploy/deployment-blueprint.test.ts`). Giving the limiter its own
 *    `PDFXYZ_RATE_LIMIT_REDIS_REST_*` names lets an operator wire a web-tier store
 *    without leaking any worker secret onto the web tier. They MAY point these at the
 *    same managed instance the queue uses — that is a deployment choice, expressed by
 *    setting the same *values* under these web-safe *names*.
 *  - It keeps rate limiting independent of the queue provider: distributed throttling
 *    works even when the queue is not Redis, and vice-versa.
 *
 * The *validation* is NOT duplicated: the URL-origin, token, and key-prefix checks are
 * the exact shared primitives the queue config uses (`parseRedisRestOrigin`,
 * `isValidRedisRestToken`, `sanitizeRedisKeyPrefix`), so the one "is this a plausible
 * credential" rule is single-sourced and can never drift laxer here. Presence + shape
 * only: the token value is read solely to build the client's `Authorization` header
 * inside the provider closure and is NEVER logged, serialized, returned, or placed in
 * a status/diagnostic. A parse failure names the offending *variable*, never its value.
 *
 * Node-free leaf: plain string parsing + the WHATWG `URL`, so a status reporter can
 * derive posture from it without pulling `node:crypto` or the REST client.
 */

import type { FieldError } from "@/lib/jobs";
import {
  isValidRedisRestToken,
  parseRedisRestOrigin,
  sanitizeRedisKeyPrefix,
} from "@/lib/workers/queue/redis-config";

type EnvSource = Record<string, string | undefined>;

/** The environment variables the rate-limit store reads (names only; never values). */
export const RATE_LIMIT_REDIS_ENV = {
  /** Bare REST origin (https URL) of the web-tier limiter store. */
  restUrl: "PDFXYZ_RATE_LIMIT_REDIS_REST_URL",
  /** SECRET — the REST bearer token. Read only to build the auth header. */
  restToken: "PDFXYZ_RATE_LIMIT_REDIS_REST_TOKEN",
  /** Optional key namespace for limiter keys; unset ⇒ the default prefix. */
  keyPrefix: "PDFXYZ_RATE_LIMIT_KEY_PREFIX",
  /** Optional degrade policy when the store errors: `open` (default) | `closed`. */
  failMode: "PDFXYZ_RATE_LIMIT_FAIL_MODE",
} as const;

/** Default key namespace when {@link RATE_LIMIT_REDIS_ENV.keyPrefix} is unset. */
export const DEFAULT_RATE_LIMIT_PREFIX = "pdfxyz";

/**
 * How the guard degrades when the distributed store is unreachable or errors — an
 * explicit, operator-chosen policy (never an accident):
 *  - `open` (default): the provider THROWS, so the guard fails OPEN (allow,
 *    `enforced: false`). A limiter outage can never take the public API down —
 *    the codebase's standing posture for an optional protection layer.
 *  - `closed`: the provider returns a deliberate DENY, so the guard answers `429`.
 *    For a deployment that would rather shed load than serve unthrottled while the
 *    limiter is down. A store outage then surfaces as a 429 spike in metrics
 *    (never as the `remote-error-fail-open` status, which is fail-open-specific).
 */
export type RateLimitFailMode = "open" | "closed";

/** Values selecting fail-closed; anything else (incl. unset) ⇒ the fail-open default. */
const FAIL_CLOSED_VALUES = new Set(["closed", "close", "deny", "denied"]);

/** Resolve the degrade policy; unset/unknown ⇒ the fail-open default. */
export function resolveRateLimitFailMode(
  env: EnvSource = process.env,
): RateLimitFailMode {
  const value = read(env, RATE_LIMIT_REDIS_ENV.failMode)?.toLowerCase();
  return value !== undefined && FAIL_CLOSED_VALUES.has(value) ? "closed" : "open";
}

/**
 * A validated, ready-to-use distributed rate-limit store configuration. Holds the
 * REST token used only to authenticate requests inside the provider closure — this
 * object must never be logged, serialized, or handed to a client.
 */
export interface RateLimitRedisConfig {
  /** Bare REST origin (no path/query/credentials), e.g. `https://x.upstash.io`. */
  readonly baseUrl: string;
  /** SECRET — the REST bearer token. Never logged or returned. */
  readonly token: string;
  /** Sanitized, non-empty key namespace every limiter key lives under. */
  readonly keyPrefix: string;
  /**
   * How the provider degrades when the store errors. Optional so a hand-built
   * config may omit it (the provider then defaults to fail-open); the parser
   * always resolves it from {@link RATE_LIMIT_REDIS_ENV.failMode}.
   */
  readonly failMode?: RateLimitFailMode;
}

/** Outcome of parsing the environment for a distributed rate-limit store. */
export type ParseRateLimitRedisConfigResult =
  | { ok: true; config: RateLimitRedisConfig }
  | {
      ok: false;
      /**
       * Whether the operator supplied ANY store credential (URL or token). `false`
       * ⇒ nothing was wired (the honest not-configured default). `true` ⇒ a partial
       * or malformed attempt that the caller should surface (by NAME only).
       */
      provided: boolean;
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

/**
 * Parse and validate the distributed rate-limit store configuration. Presence and
 * shape only — it never contacts the store (that happens on the first limiter check).
 * `env` is injectable for tests.
 */
export function parseRateLimitRedisConfig(
  env: EnvSource = process.env,
): ParseRateLimitRedisConfigResult {
  const urlRaw = read(env, RATE_LIMIT_REDIS_ENV.restUrl);
  const tokenRaw = read(env, RATE_LIMIT_REDIS_ENV.restToken);
  const provided = urlRaw !== undefined || tokenRaw !== undefined;

  const issues: FieldError[] = [];
  const miss = (name: string, message: string) => issues.push({ field: name, message });

  let baseUrl: string | null = null;
  if (!urlRaw) {
    miss(RATE_LIMIT_REDIS_ENV.restUrl, "Set the rate-limit store REST endpoint origin (https URL).");
  } else {
    const parsed = parseRedisRestOrigin(urlRaw);
    if (!parsed.ok) {
      miss(RATE_LIMIT_REDIS_ENV.restUrl, "Must be an http(s) origin with no path or query.");
    } else {
      baseUrl = parsed.baseUrl;
    }
  }

  if (!tokenRaw) miss(RATE_LIMIT_REDIS_ENV.restToken, "Set the rate-limit store REST token.");
  else if (!isValidRedisRestToken(tokenRaw)) {
    miss(RATE_LIMIT_REDIS_ENV.restToken, "Malformed REST token.");
  }

  const prefix = sanitizeRedisKeyPrefix(
    read(env, RATE_LIMIT_REDIS_ENV.keyPrefix),
    DEFAULT_RATE_LIMIT_PREFIX,
  );
  if (!prefix.ok) {
    miss(
      RATE_LIMIT_REDIS_ENV.keyPrefix,
      "Malformed key prefix (no `..`, use [A-Za-z0-9:_-]).",
    );
  }

  if (issues.length > 0 || !baseUrl || !tokenRaw || !prefix.ok) {
    return { ok: false, provided, issues };
  }

  return {
    ok: true,
    config: {
      baseUrl,
      token: tokenRaw,
      keyPrefix: prefix.value,
      failMode: resolveRateLimitFailMode(env),
    },
  };
}
