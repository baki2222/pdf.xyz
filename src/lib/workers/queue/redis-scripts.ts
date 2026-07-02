/**
 * The **atomic transition layer** for the Redis/Upstash queue (Phase 21).
 *
 * Phase 15 shipped the queue with atomic *primitives* (`RPOP` dequeue, `ZREM`
 * redelivery election) and multi-key `MULTI/EXEC` writes, but the individual
 * state transitions (`heartbeat`/`advance`/`complete`/`fail`/`cancel`/`expire`
 * and the claim commit) still did a client-side **read → decide → write**: the
 * state machine was consulted in JS against a value that another worker could
 * change inside the tiny read→write window. That window is *last-writer-wins*,
 * so two racing actors could both pass the check and both write.
 *
 * This module closes that window. Each transition is a single server-side Lua
 * script (`EVAL`) that re-reads the authoritative job/lease, re-validates the
 * expected state **and** lease ownership, and only then writes — all atomically,
 * because Redis runs a script to completion with no interleaving. The JS layer
 * still *computes* the next {@link import("@/lib/jobs").Job} record (it owns the
 * client-facing JSON shape); the script only enforces the compare-and-set and
 * applies the precomputed record plus its index/lease/TTL side effects.
 *
 * Why Lua and not `WATCH`/`MULTI`: the Upstash Redis REST transport is
 * stateless — every command is an independent HTTP request with no persistent
 * connection — so a `WATCH` set on one request cannot guard an `EXEC` on a
 * later one. `EVAL` is the only primitive that gives a genuine atomic
 * compare-and-set over that transport, and Upstash executes it server-side with
 * the same atomicity guarantee as any Redis. See docs/WORKER_ARCHITECTURE.md.
 *
 * Security posture (load-bearing): the script bodies below are **constant** —
 * no job id, filename, option value, token, key, or any other dynamic datum is
 * ever interpolated into a script. Every dynamic value is passed positionally
 * through the `KEYS`/`ARGV` arrays, so user/job data can never become part of
 * the program text (no Lua injection, and nothing sensitive lands in a place a
 * log or error could echo). The tests in `redis-scripts.test.ts` enforce this.
 */

import type { JobStatus } from "@/lib/jobs";
import type { RedisArg, RedisClient, RedisValue } from "./redis-client";

/**
 * The typed result of an atomic transition. The provider maps these onto the
 * public {@link import("./types").QueueFailureReason} set; keeping the internal
 * vocabulary richer lets tests and logs distinguish *why* a compare-and-set was
 * rejected without inventing a new client-facing reason.
 */
export type AtomicOutcome =
  | "applied" // the CAS held; the job/lease/indexes were written
  | "invalid_state" // the stored status was not one the transition allows
  | "stale_lease" // the lease is gone or belongs to a newer claim (attempt) — rejected
  | "missing_job" // the job record is absent (expired/never existed)
  | "unavailable"; // the broker errored or was unreachable — transient

/**
 * The five keys every transition script declares, in a fixed positional order
 * (`KEYS[1..5]`). Passing the full set for every script keeps the provider and
 * the script contract uniform and is Redis-Cluster-safe (all touched keys are
 * declared), even when a given script only reads/writes a subset.
 */
export interface TransitionKeys {
  job: string;
  spec: string;
  lease: string;
  ready: string;
  active: string;
}

/** Flatten {@link TransitionKeys} into the positional `KEYS` array. */
export function transitionKeyList(keys: TransitionKeys): string[] {
  return [keys.job, keys.spec, keys.lease, keys.ready, keys.active];
}

/**
 * A sentinel `ARGV` value meaning "skip the lease-ownership (attempt) check".
 * App-server transitions (`cancel`/`expire`) carry no worker lease, so they
 * pass this; worker transitions pass the attempt number they were claimed with.
 * A non-empty numeric string can never collide with it.
 */
export const NO_ATTEMPT = "" as const;

/*
 * ── The scripts ──────────────────────────────────────────────────────────────
 * Each is a constant string. Shared shape:
 *   KEYS[1]=job  KEYS[2]=spec  KEYS[3]=lease  KEYS[4]=ready  KEYS[5]=active
 * Each returns one of the lowercase status codes below, which {@link outcomeOf}
 * maps to an {@link AtomicOutcome}:
 *   'applied' | 'invalid' | 'stale' | 'missing'
 *
 * `statusAllowed(csv, status)` is expressed inline as a delimiter-wrapped plain
 * substring search (`string.find(..., 1, true)` — no Lua patterns), so a status
 * enum value can never be misread as a pattern. The allowed-status *set* is
 * derived from the shared JS state machine (`./state`) and passed in `ARGV`, so
 * the transition rules stay single-sourced in JS and are merely *enforced*
 * atomically here.
 */

/** Guard `status ∈ ARGV[csvIndex]`; the set is a comma-joined status list. */
const STATUS_GUARD = (csvArg: string, statusExpr: string) =>
  `string.find(',' .. ${csvArg} .. ',', ',' .. ${statusExpr} .. ',', 1, true)`;

/** Reject unless the stored lease exists and its attempt matches `ARGV[attemptIdx]`. */
const OWNERSHIP_GUARD = (attemptArg: string) => `
  if ${attemptArg} ~= '' then
    local leaseRaw = redis.call('GET', KEYS[3])
    if not leaseRaw then return 'stale' end
    local lease = cjson.decode(leaseRaw)
    if tostring(lease.attempts) ~= ${attemptArg} then return 'stale' end
  end`;

/**
 * Commit a claim: the popped id must still be `queued` (no cancel slipped in),
 * then write the leased job, its lease, and its active-set entry as one unit.
 *   ARGV[1]=jobJson ARGV[2]=ttl ARGV[3]=leaseJson ARGV[4]=leaseScore ARGV[5]=jobId
 */
const CLAIM_COMMIT = `
local jobRaw = redis.call('GET', KEYS[1])
if not jobRaw then return 'missing' end
local job = cjson.decode(jobRaw)
if job.status ~= 'queued' then return 'invalid' end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[2])
redis.call('ZADD', KEYS[5], ARGV[4], ARGV[5])
return 'applied'`;

/**
 * Redeliver a lease-expired job (its `ZREM` from active already elected this
 * caller as the sole winner): requeue it only if it is still actively leased
 * (`scanning`/`processing`) — never resurrect one canceled/completed meanwhile.
 * Spec + lease are kept so the retry has its inputs and the attempt carries on.
 *   ARGV[1]=jobJson ARGV[2]=ttl ARGV[3]=jobId
 */
const REDELIVER = `
local jobRaw = redis.call('GET', KEYS[1])
if not jobRaw then return 'missing' end
local job = cjson.decode(jobRaw)
if job.status ~= 'scanning' and job.status ~= 'processing' then return 'invalid' end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('LPUSH', KEYS[4], ARGV[3])
return 'applied'`;

/**
 * Extend a claimed job's lease. The job must be actively leased and the caller
 * must still own the lease (attempt match) — a stolen/expired-and-reclaimed lease
 * is rejected `stale`, so a zombie worker can never resurrect its job. The attempt
 * count is preserved by mutating the stored lease server-side (only the deadline
 * changes), so a base-contract heartbeat cannot clobber it.
 *   ARGV[1]=leaseExpiresAt (also the active-set score) ARGV[2]=expectedAttempt
 *   ARGV[3]=ttl ARGV[4]=jobId
 */
const HEARTBEAT = `
local jobRaw = redis.call('GET', KEYS[1])
if not jobRaw then return 'missing' end
local job = cjson.decode(jobRaw)
if job.status ~= 'scanning' and job.status ~= 'processing' then return 'invalid' end
local leaseRaw = redis.call('GET', KEYS[3])
if not leaseRaw then return 'stale' end
local lease = cjson.decode(leaseRaw)
if ARGV[2] ~= '' and tostring(lease.attempts) ~= ARGV[2] then return 'stale' end
lease.leaseExpiresAt = tonumber(ARGV[1])
redis.call('SET', KEYS[3], cjson.encode(lease), 'EX', ARGV[3])
redis.call('ZADD', KEYS[5], ARGV[1], ARGV[4])
return 'applied'`;

/**
 * Advance a running job (scan→process and/or progress). Guarded on the allowed
 * current-status set and lease ownership; writes only the job record.
 *   ARGV[1]=jobJson ARGV[2]=ttl ARGV[3]=expectedAttempt ARGV[4]=allowedCsv
 */
const ADVANCE = `
local jobRaw = redis.call('GET', KEYS[1])
if not jobRaw then return 'missing' end
local job = cjson.decode(jobRaw)
if not ${STATUS_GUARD("ARGV[4]", "job.status")} then return 'invalid' end
${OWNERSHIP_GUARD("ARGV[3]")}
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 'applied'`;

/**
 * Finalize a job to a terminal, output-less-or-completed state
 * (`complete`/`fail`-terminal/`cancel`/`expire`): write the record and drop all
 * execution bookkeeping (spec, lease, ready entry, active entry) atomically.
 * Worker finalizations (`complete`/`fail`) pass an attempt so a stale lease is
 * rejected; app finalizations (`cancel`/`expire`) pass {@link NO_ATTEMPT}.
 *   ARGV[1]=jobJson ARGV[2]=ttl ARGV[3]=expectedAttempt ARGV[4]=allowedCsv ARGV[5]=jobId
 */
const FINALIZE = `
local jobRaw = redis.call('GET', KEYS[1])
if not jobRaw then return 'missing' end
local job = cjson.decode(jobRaw)
if not ${STATUS_GUARD("ARGV[4]", "job.status")} then return 'invalid' end
${OWNERSHIP_GUARD("ARGV[3]")}
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
redis.call('LREM', KEYS[4], '0', ARGV[5])
redis.call('ZREM', KEYS[5], ARGV[5])
return 'applied'`;

/**
 * Requeue a running job for another attempt (retryable failure): back to
 * `queued`, re-listed, removed from active. Spec + lease are kept so the retry
 * reads its inputs and the attempt counter carries forward to the dead-letter
 * cap. Guarded on allowed status and lease ownership.
 *   ARGV[1]=jobJson ARGV[2]=ttl ARGV[3]=expectedAttempt ARGV[4]=allowedCsv ARGV[5]=jobId
 */
const REQUEUE = `
local jobRaw = redis.call('GET', KEYS[1])
if not jobRaw then return 'missing' end
local job = cjson.decode(jobRaw)
if not ${STATUS_GUARD("ARGV[4]", "job.status")} then return 'invalid' end
${OWNERSHIP_GUARD("ARGV[3]")}
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('LPUSH', KEYS[4], ARGV[5])
redis.call('ZREM', KEYS[5], ARGV[5])
return 'applied'`;

/**
 * The full script set, keyed by name. Frozen constants — the source of truth for
 * both the production runner and the test fake's twin executor (which dispatches
 * on the exact text of these constants, so the two can never silently drift).
 */
export const TRANSITION_SCRIPTS = {
  claimCommit: CLAIM_COMMIT,
  redeliver: REDELIVER,
  heartbeat: HEARTBEAT,
  advance: ADVANCE,
  finalize: FINALIZE,
  requeue: REQUEUE,
} as const;

export type TransitionScriptName = keyof typeof TRANSITION_SCRIPTS;

/** Join a status set into the comma-delimited form the `STATUS_GUARD` expects. */
export function statusCsv(statuses: readonly JobStatus[]): string {
  return statuses.join(",");
}

/** Map a raw Lua status-code reply to a typed {@link AtomicOutcome}. */
export function outcomeOf(value: RedisValue): AtomicOutcome {
  const code = typeof value === "string" ? value : null;
  switch (code) {
    case "applied":
      return "applied";
    case "invalid":
      return "invalid_state";
    case "stale":
      return "stale_lease";
    case "missing":
      return "missing_job";
    default:
      // An unexpected reply shape is treated as a transient failure, never a
      // silent success — the provider maps it to `unavailable`.
      return "unavailable";
  }
}

/**
 * Run one named transition script over the REST client and return its typed
 * outcome. The script text comes only from {@link TRANSITION_SCRIPTS} (constant),
 * and every dynamic value travels in `keys`/`argv` — never in the program text.
 */
export async function runTransition(
  client: RedisClient,
  name: TransitionScriptName,
  keys: TransitionKeys,
  argv: RedisArg[],
): Promise<AtomicOutcome> {
  const keyList = transitionKeyList(keys);
  const res = await client.command([
    "EVAL",
    TRANSITION_SCRIPTS[name],
    String(keyList.length),
    ...keyList,
    ...argv,
  ]);
  if (!res.ok) return "unavailable";
  return outcomeOf(res.value);
}
