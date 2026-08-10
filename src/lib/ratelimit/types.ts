/**
 * Typed contracts for the public-API **abuse / rate-limit guard**.
 *
 * This is the honest, framework-agnostic boundary between the app's public API
 * routes and whatever throttling backend is active in a given environment. It is
 * pure data + tiny pure helpers — no Next.js, no `node:*`, no network — so it can
 * be reused unchanged by a future edge/WAF/provider client and unit-tested in
 * isolation.
 *
 * Two load-bearing invariants live in these types:
 *  - **Content-free output.** A {@link RateLimitDecision} carries only a bounded
 *    verdict, a coarse retry bucket, an exact retry-after (derived purely from the
 *    policy window and the clock — it reveals nothing about the caller), the
 *    stable policy id, and a provider/enforced flag. It NEVER carries an IP, user
 *    agent, filename, token, object key, job id, env value, or request body. The
 *    thing a limiter must key on to function — a client identity — is derived,
 *    salted-hashed, and used only as an in-memory bucket key by the node layer
 *    (`identity.ts`); it never reaches this decision, a log line, or a response.
 *  - **Honest enforcement.** `enforced` is `false` whenever the guard did not
 *    actually throttle this request (the provider is `disabled`, or a remote
 *    provider is selected but unimplemented in this build). Nothing here ever
 *    claims distributed production enforcement that is not really happening.
 */

/**
 * The public-API actions the guard has a typed policy for. One per
 * (route × method) abuse surface. Stable, low-cardinality, and content-free — an
 * action names a *route capability*, never a caller.
 */
export type RateLimitAction =
  | "uploads.create" // POST /api/uploads — mint an upload session
  | "jobs.create" // POST /api/jobs — enqueue a processing job
  | "jobs.status" // GET /api/jobs/[id] — poll job status
  | "jobs.delete" // DELETE /api/jobs/[id] — cancel / delete-now
  | "artifacts.fetch" // GET /api/artifacts/local/[id] — download a dev output
  | "worker.status" // GET /api/worker/status — presence probe
  | "worker.operations" // GET /api/worker/operations — ops/SLO snapshot
  | "interest.note" // POST /api/interest — count a gated-tool "notify me" click
  | "ai.run"; // POST /api/jobs with an AI-capability tool — the free daily AI allowance

/** Every action, in a stable order, for exhaustive iteration in tests/docs. */
export const RATE_LIMIT_ACTIONS = [
  "uploads.create",
  "jobs.create",
  "jobs.status",
  "jobs.delete",
  "artifacts.fetch",
  "worker.status",
  "worker.operations",
  "interest.note",
  "ai.run",
] as const satisfies readonly RateLimitAction[];

/**
 * A typed throttle policy for one action: at most `limit` requests per
 * `windowSeconds` fixed window, per client bucket. `id` is a stable, content-free
 * label (it names the policy, never a caller) echoed in the decision so a monitor
 * or the client can tell *which* rule fired without any identifying detail.
 */
export interface RateLimitPolicy {
  /** Stable, content-free policy identifier (e.g. `"jobs.create"`). */
  readonly id: string;
  /** The action this policy governs. */
  readonly action: RateLimitAction;
  /** Max requests allowed within one window, per client bucket. */
  readonly limit: number;
  /** Fixed-window length in seconds. */
  readonly windowSeconds: number;
}

/**
 * Coarse, low-cardinality bucket for a retry-after delay. Safe for a log line or
 * a telemetry dimension: it is derived only from the policy window and the clock,
 * so — like {@link RateLimitDecision.retryAfterSeconds} — it says nothing about
 * the caller, only how long the *rule* asks them to wait. `"none"` on an allow.
 */
export type RetryAfterBucket =
  "none" | "<10s" | "10-60s" | "1-5m" | "5-15m" | "15m+";

/** The provider actually backing the guard in this environment. */
export type RateLimitProviderId =
  /** No limiter is wired: every request is allowed, `enforced: false`. */
  | "disabled"
  /** The per-process in-memory dev limiter. Real, but NOT distributed. */
  | "local-memory"
  /**
   * A remote provider is selected AND a real backend is registered (see
   * `provider.ts`): a distributed, `enforced: true` verdict. The label is
   * deliberately generic — the specific backend name is never surfaced.
   */
  | "remote"
  /** A remote provider is selected but no backend is registered: skip honestly. */
  | "remote-unimplemented"
  /**
   * A remote provider is selected and a backend exists, but the check FAILED and
   * the guard allowed the request rather than take the API down. Traffic is
   * passing unthrottled right now, and that is an incident.
   *
   * This exists because `enforced: false` is one bit collapsing four
   * operationally distinct states — deliberately off, selected-but-unwired, a
   * guard bug, and a store outage. The first two need no action; the last two
   * do. Before this member, a live store outage reported `provider: "disabled"`:
   * the same value the default off-state emits.
   *
   * That conflation has already cost real time twice. It is why the fixture in
   * `guard-selfbuild.test.ts` read a DNS failure as "the guard is switched off"
   * and produced, in that file's own words, a confident wrong answer.
   */
  | "remote-error";

/**
 * The content-free outcome of a guard check. This is the ONLY thing the guard
 * emits — to a route, a log, or a response body. Every field is a bounded enum,
 * an integer derived from the policy, or a stable policy id. See the module
 * header for the full no-leak invariant.
 */
export interface RateLimitDecision {
  /** True ⇒ the request may proceed; false ⇒ it must be answered 429. */
  readonly allowed: boolean;
  /** The action that was checked. */
  readonly action: RateLimitAction;
  /** The stable id of the policy that produced this verdict. */
  readonly policyId: string;
  /** The provider that produced this verdict. */
  readonly provider: RateLimitProviderId;
  /**
   * True only when this verdict reflects real throttling state. `false` for every
   * `disabled` / `remote-unimplemented` allow, so nothing can mistake a fail-open
   * pass for enforced capacity. Always `false` when `allowed` is `true` under a
   * non-enforcing provider; `true` on an enforced allow or a deny.
   */
  readonly enforced: boolean;
  /**
   * Whole seconds the caller should wait before retrying. `0` on an allow.
   * Derived purely from the window and the clock — safe to return in a header.
   */
  readonly retryAfterSeconds: number;
  /** Coarse bucket of {@link retryAfterSeconds} for content-free logging. */
  readonly retryAfterBucket: RetryAfterBucket;
}

/**
 * The core in-memory limiter contract: a pure verdict for a `(policy, bucket key,
 * now)` triple. Node-free and clock-injected, so it is deterministically testable
 * and carries no ambient state beyond its own counters.
 */
export interface RateLimiterCore {
  /**
   * Record one hit for `key` under `policy` at `nowMs` and report whether it is
   * within the window budget. `key` is an already-opaque bucket token (never a
   * raw identity); it is used only as a map key and never surfaced.
   */
  check(
    policy: RateLimitPolicy,
    key: string,
    nowMs: number,
  ): RateLimiterVerdict;
  /** Current number of tracked buckets (for tests / bounded-memory assertions). */
  size(): number;
}

/** The limiter core's minimal verdict, before it is shaped into a decision. */
export interface RateLimiterVerdict {
  readonly allowed: boolean;
  /** Whole seconds until the current window resets. `0` when allowed. */
  readonly retryAfterSeconds: number;
}

/** Map an exact retry-after (seconds) to its coarse, content-free bucket. */
export function retryAfterBucket(seconds: number): RetryAfterBucket {
  if (!Number.isFinite(seconds) || seconds <= 0) return "none";
  if (seconds < 10) return "<10s";
  if (seconds < 60) return "10-60s";
  if (seconds < 5 * 60) return "1-5m";
  if (seconds < 15 * 60) return "5-15m";
  return "15m+";
}
