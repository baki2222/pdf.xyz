/**
 * The production Redis/Upstash-compatible **job-queue** provider.
 *
 * It implements the full {@link ClaimableQueue} contract against a Redis REST
 * broker ({@link RedisClient}): jobs and their execution specs, idempotency
 * records, leases, and the ready/active indexes all live in one shared store, so
 * job state survives a process restart and is visible across replicas — the two
 * things the in-process dev queue can never offer. It is the queue counterpart of
 * the S3 storage provider: the config (which holds the REST token) is captured in
 * this closure and never logged, serialized, or returned.
 *
 * Data model (every key namespaced under the sanitized `keyPrefix`):
 *  - `…:job:{id}`   → the client-facing {@link Job} record (JSON, TTL'd);
 *  - `…:spec:{id}`  → the executor-facing inputs+options (JSON, TTL'd);
 *  - `…:lease:{id}` → `{ leaseExpiresAt, attempts }` for the claim/heartbeat loop;
 *  - `…:idem:{h}`   → jobId, keyed by the SHA-256 of the client idempotency key so
 *                     the raw key never becomes a broker key name;
 *  - `…:ready`      → LIST of claimable jobIds (LPUSH to enqueue, RPOP to claim →
 *                     FIFO); `…:active` → ZSET of in-flight jobIds scored by lease
 *                     expiry, for redelivery.
 *
 * Concurrency (Phase 21 — atomic transitions): the atomic dequeue (`RPOP …:ready`)
 * and the atomic redelivery hand-off (`ZREM …:active`, whose returned count elects
 * a single winner) remain the entry-point mutual-exclusion points, and record
 * creation (`enqueue`/`submit`) still uses MULTI/EXEC so a job never lands
 * half-written. Every *state transition* — the claim commit, heartbeat, advance,
 * complete, fail, cancel, expire, and the redelivery requeue — now runs as a single
 * server-side Lua script (`./redis-scripts.ts`) that re-reads the authoritative
 * job/lease, re-validates the expected status **and** lease ownership (the claim's
 * attempt number), and only then writes. Redis runs a script to completion with no
 * interleaving, so the former read→write window is gone: the check and the write are
 * one atomic compare-and-set. The transition *rules* still live only in the shared
 * state machine (`./state.ts`); the scripts merely enforce them atomically.
 *
 * Honesty: every method returns a typed {@link QueueResult}. A missing job is a
 * clean `not_found`; an illegal transition or a stolen lease is a `conflict`; a
 * broker that errors or is unreachable is a typed `unavailable` — never a fabricated
 * job or status. See docs/WORKER_ARCHITECTURE.md for the exact race guarantees.
 */

import { createHash } from "node:crypto";
import type {
  Job,
  JobArtifact,
  JobDeliveryCap,
  JobError,
  JobResults,
} from "@/lib/jobs";
import { sanitizeJobResults } from "@/lib/jobs";
import {
  canCancel,
  canExpire,
  canRedeliver,
  canTransition,
  sourceStatusesFor,
  RUNNING_STATUSES,
} from "./state";
import type {
  AttemptFingerprint,
  ClaimableQueue,
  ClaimOptions,
  ClaimedJob,
  FailDisposition,
  JobSubmission,
  RunningUpdate,
} from "./claim";
import type { RedisQueueConfig } from "./redis-config";
import { grantedLeaseMs, redisQueueCapability } from "./redis-config";
import {
  createRedisClient,
  type RedisArg,
  type RedisClient,
  type RedisFetch,
  type RedisValue,
} from "./redis-client";
import {
  runTransition,
  statusCsv,
  NO_ATTEMPT,
  type AtomicOutcome,
  type TransitionKeys,
} from "./redis-scripts";
import { queueFail, queueOk, type QueueResult } from "./types";

/** Injectable seams so the provider is fully testable without a real broker. */
export interface RedisQueueDeps {
  /** A ready Redis client; defaults to one built from `config` + `fetchImpl`. */
  client?: RedisClient;
  now?: () => number;
  /** Transport for the default client; ignored when `client` is provided. */
  fetchImpl?: RedisFetch;
}

/** The executor-facing spec stored alongside a queued job. */
interface RedisJobSpec {
  inputs: string[];
  /** Sanitized display names aligned with `inputs` (a JSON value, never a key). */
  inputNames?: string[];
  options: Record<string, unknown>;
  /**
   * What the job may deliver. A plain JSON value like the rest of the spec —
   * and, like the rest of the spec, absent on any record written before the
   * field existed, which reads as unbounded rather than as zero.
   */
  delivery?: JobDeliveryCap;
}

/** A worker's lease record: the deadline plus the attempt count. */
interface RedisLease {
  leaseExpiresAt: number;
  attempts: number;
}

const UNAVAILABLE = <T = never>(): QueueResult<T> =>
  queueFail<T>(
    "unavailable",
    "The job queue is temporarily unavailable. Please retry.",
  );

const NOT_FOUND = <T = never>(): QueueResult<T> =>
  queueFail<T>("not_found", "No such job (it may have expired).", [
    { field: "id", message: "Unknown or expired job id." },
  ]);

/** Parse a JSON string reply into `T`, or `null` when absent/corrupt. */
function parseJson<T>(raw: RedisValue): T | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Build the Redis-backed queue provider from a validated config. The config holds
 * the REST token; it is captured in this closure and never logged or returned.
 */
export function createRedisQueue(
  config: RedisQueueConfig,
  deps: RedisQueueDeps = {},
): ClaimableQueue {
  const now = deps.now ?? (() => Date.now());
  const client =
    deps.client ??
    createRedisClient({
      baseUrl: config.baseUrl,
      token: config.token,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });

  const iso = (ms: number): string => new Date(ms).toISOString();
  const ttl = String(config.jobTtlSeconds);
  const k = (...parts: string[]): string =>
    [config.keyPrefix, ...parts].join(":");
  // Hash the client idempotency key so the raw value never becomes a broker key.
  const idemKey = (key: string): string =>
    k("idem", createHash("sha256").update(key).digest("hex"));

  const putJob = (job: Job): RedisArg[] => [
    "SET",
    k("job", job.jobId),
    JSON.stringify(job),
    "EX",
    ttl,
  ];
  const putSpec = (jobId: string, spec: RedisJobSpec): RedisArg[] => [
    "SET",
    k("spec", jobId),
    JSON.stringify(spec),
    "EX",
    ttl,
  ];

  /** The six keys a transition script declares, for one job. */
  const keysFor = (jobId: string): TransitionKeys => ({
    job: k("job", jobId),
    spec: k("spec", jobId),
    lease: k("lease", jobId),
    ready: k("ready"),
    active: k("active"),
    delayed: k("delayed"),
  });

  /** Render an optional attempt fingerprint into its `ARGV` form (`''` ⇒ skip). */
  const attemptArg = (attempt: AttemptFingerprint | undefined): string =>
    attempt === undefined ? NO_ATTEMPT : String(attempt);

  /**
   * Map an atomic outcome to a typed {@link QueueResult}. On `applied` the caller's
   * precomputed record is authoritative; every rejection is honest and client-safe.
   */
  const applyOutcome = (
    outcome: AtomicOutcome,
    applied: Job,
    conflictMessage: string,
  ): QueueResult<Job> => {
    switch (outcome) {
      case "applied":
        return queueOk(applied);
      case "missing_job":
        return NOT_FOUND();
      case "invalid_state":
        return queueFail("conflict", conflictMessage);
      case "stale_lease":
        // The lease was reclaimed (redelivery/steal) or the job already finished:
        // reject rather than resurrect or overwrite another attempt's work.
        return queueFail(
          "conflict",
          "This job's lease is no longer held; it was reclaimed or the job already finished.",
        );
      case "unavailable":
        return UNAVAILABLE();
    }
  };

  /** Run a MULTI/EXEC transaction, mapping any transport error to `unavailable`. */
  const runTx = async (commands: RedisArg[][]): Promise<QueueResult<void>> => {
    const res = await client.transaction(commands);
    return res.ok ? queueOk(undefined) : UNAVAILABLE();
  };

  const loadJob = async (jobId: string): Promise<QueueResult<Job>> => {
    const res = await client.command(["GET", k("job", jobId)]);
    if (!res.ok) return UNAVAILABLE();
    if (typeof res.value !== "string") return NOT_FOUND();
    const job = parseJson<Job>(res.value);
    return job ? queueOk(job) : UNAVAILABLE();
  };

  const loadSpec = async (
    jobId: string,
  ): Promise<QueueResult<RedisJobSpec | null>> => {
    const res = await client.command(["GET", k("spec", jobId)]);
    if (!res.ok) return UNAVAILABLE();
    return queueOk(parseJson<RedisJobSpec>(res.value));
  };

  const loadLease = async (
    jobId: string,
  ): Promise<QueueResult<RedisLease | null>> => {
    const res = await client.command(["GET", k("lease", jobId)]);
    if (!res.ok) return UNAVAILABLE();
    return queueOk(parseJson<RedisLease>(res.value));
  };

  /** Move a job to a terminal, output-less state, wiping its artifact list. */
  const toTerminal = (job: Job, status: "canceled" | "expired"): Job => {
    const next: Job = { ...job, status, updatedAt: iso(now()) };
    // Outputs are being deleted alongside this transition, so the record must not
    // keep advertising downloadable artifacts (keeps isDownloadReady honest), nor
    // the result metadata that describes those now-deleted outputs.
    delete next.artifacts;
    delete next.results;
    return next;
  };

  /**
   * Fail a job terminally and forget its execution bookkeeping — the broker's own
   * dead-letter / missing-spec path (no worker lease is involved, so no attempt
   * fingerprint). The finalize is guarded on the job still being non-terminal, so a
   * job canceled in the race is left canceled rather than force-failed.
   */
  const terminalFail = async (
    jobId: string,
    job: Job,
    message: string,
  ): Promise<void> => {
    const failed: Job = {
      ...job,
      status: "failed",
      progress: 0,
      error: { code: "internal_error", message, retryable: false },
      updatedAt: iso(now()),
    };
    await runTransition(client, "finalize", keysFor(jobId), [
      JSON.stringify(failed),
      ttl,
      NO_ATTEMPT,
      statusCsv(sourceStatusesFor("failed")),
      jobId,
    ]);
  };

  return {
    id: "redis",

    probe() {
      // The config was validated on construction; connectivity errors surface as
      // a typed `unavailable` on the operation itself, never a silent success.
      return queueOk(undefined);
    },

    async enqueue(job, idempotencyKey) {
      // Base contract: record the job in its initial state (no spec, so it is not
      // claimable — mirrors the in-process provider). Async jobs use `submit`.
      const commands: RedisArg[][] = [putJob(job)];
      if (idempotencyKey) {
        commands.push(["SET", idemKey(idempotencyKey), job.jobId, "EX", ttl]);
      }
      const tx = await runTx(commands);
      if (!tx.ok) return tx;
      return queueOk(job);
    },

    async submit(submission: JobSubmission, idempotencyKey) {
      const { job } = submission;
      const commands: RedisArg[][] = [
        putJob(job),
        putSpec(job.jobId, {
          inputs: submission.inputs,
          ...(submission.inputNames
            ? { inputNames: submission.inputNames }
            : {}),
          options: submission.options,
          ...(submission.delivery ? { delivery: submission.delivery } : {}),
        }),
      ];
      if (idempotencyKey) {
        commands.push(["SET", idemKey(idempotencyKey), job.jobId, "EX", ttl]);
      }
      // LPUSH last and inside the transaction, so a claimer can never observe the
      // id on the ready list before its job+spec exist.
      commands.push(["LPUSH", k("ready"), job.jobId]);
      const tx = await runTx(commands);
      if (!tx.ok) return tx;
      return queueOk(job);
    },

    async lookupIdempotent(key) {
      const res = await client.command(["GET", idemKey(key)]);
      if (!res.ok) return UNAVAILABLE();
      if (typeof res.value !== "string") return queueOk<Job | null>(null);
      const job = await loadJob(res.value);
      if (job.ok) return queueOk<Job | null>(job.value);
      // A dangling mapping (the job record TTL'd out) is a clean null, not an error.
      return job.error.reason === "not_found" ? queueOk<Job | null>(null) : job;
    },

    async status(jobId) {
      return loadJob(jobId);
    },

    async claim(options: ClaimOptions) {
      const nowMs = now();
      const effectiveLeaseMs = grantedLeaseMs(options.leaseMs, config);

      // 1. Redelivery sweep: return jobs whose lease expired to the ready list.
      // ZREM is the atomic hand-off — only the claimer whose ZREM removes the
      // member (count 1) owns the requeue, so two claimers can't both requeue it.
      const expiredRes = await client.command([
        "ZRANGEBYSCORE",
        k("active"),
        "-inf",
        String(nowMs),
      ]);
      if (!expiredRes.ok) return UNAVAILABLE();
      const expired = Array.isArray(expiredRes.value) ? expiredRes.value : [];
      for (const entry of expired) {
        if (typeof entry !== "string") continue;
        const won = await client.command(["ZREM", k("active"), entry]);
        if (!won.ok) return UNAVAILABLE();
        if (Number(won.value) !== 1) continue; // another claimer won it
        const jobRes = await loadJob(entry);
        if (!jobRes.ok) continue; // expired/corrupt — already removed from active
        if (!canRedeliver(jobRes.value.status)) continue; // terminal — just drop it
        const requeued: Job = {
          ...jobRes.value,
          status: "queued",
          progress: 0,
          updatedAt: iso(nowMs),
        };
        // Keep spec + lease: the retry needs the inputs, and the attempt count
        // must carry forward so the dead-letter cap can eventually stop it. The
        // requeue is a CAS on the job still being actively leased, so a job
        // canceled/completed in this window is never resurrected onto the ready list.
        const outcome = await runTransition(
          client,
          "redeliver",
          keysFor(entry),
          [JSON.stringify(requeued), ttl, entry],
        );
        if (outcome === "unavailable") return UNAVAILABLE();
        // invalid_state/missing_job: the job changed under us (already terminal);
        // the ZREM above removed it from `active`, so there is nothing more to do.
      }

      // 1.5. Promotion sweep: move due parked jobs (delayed requeues whose
      // visible-at has passed) onto the ready list. Same atomic hand-off as the
      // redelivery sweep above — only the claimer whose ZREM removes the member
      // owns the promotion, so two claimers can't both list it. A parked job
      // that is NOT yet due simply stays in the ZSET, which is what lets the
      // runnable job behind it be claimed instead.
      const dueRes = await client.command([
        "ZRANGEBYSCORE",
        k("delayed"),
        "-inf",
        String(nowMs),
      ]);
      if (!dueRes.ok) return UNAVAILABLE();
      const due = Array.isArray(dueRes.value) ? dueRes.value : [];
      for (const entry of due) {
        if (typeof entry !== "string") continue;
        const won = await client.command(["ZREM", k("delayed"), entry]);
        if (!won.ok) return UNAVAILABLE();
        if (Number(won.value) !== 1) continue; // another claimer promoted it
        const listed = await client.command(["LPUSH", k("ready"), entry]);
        if (!listed.ok) return UNAVAILABLE();
        // A stale id (job canceled/expired while parked) is harmless here: the
        // claim below loads the record, sees a non-queued status, and drops it.
      }

      // 2. Claim the oldest queued job. RPOP is the atomic dequeue.
      const pop = await client.command(["RPOP", k("ready")]);
      if (!pop.ok) return UNAVAILABLE();
      if (typeof pop.value !== "string")
        return queueOk<ClaimedJob | null>(null);
      const jobId = pop.value;

      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) {
        // The record expired between enqueue and claim; nothing claimable here.
        return jobRes.error.reason === "not_found"
          ? queueOk<ClaimedJob | null>(null)
          : jobRes;
      }
      const job = jobRes.value;
      // A claimable id is always `queued` (submit and redelivery both leave it so).
      // Anything else — a job canceled mid-flight, or a stale duplicate id — is
      // dropped rather than re-terminalized through an illegal transition.
      if (job.status !== "queued") return queueOk<ClaimedJob | null>(null);

      const specRes = await loadSpec(jobId);
      if (!specRes.ok) return specRes;
      if (!specRes.value) {
        // A queued job with no spec cannot run; fail it so it leaves the queue.
        await terminalFail(jobId, job, "Job is missing its execution spec.");
        return queueOk<ClaimedJob | null>(null);
      }

      const leaseRes = await loadLease(jobId);
      if (!leaseRes.ok) return leaseRes;
      const attempt = (leaseRes.value?.attempts ?? 0) + 1;

      // Dead-letter cap: redelivery bypasses the executor's own attempt check, so
      // the broker enforces a hard ceiling against infinite redelivery.
      if (attempt > config.maxAttempts) {
        await terminalFail(
          jobId,
          job,
          "Job exceeded the maximum number of delivery attempts.",
        );
        return queueOk<ClaimedJob | null>(null);
      }

      const leaseExpiresAt = nowMs + effectiveLeaseMs;
      const claimed: Job = {
        ...job,
        status: "scanning",
        updatedAt: iso(nowMs),
      };
      // Commit the claim atomically: the id must STILL be `queued` (no cancel
      // slipped in between RPOP and here), then job+lease+active are written as one.
      const lease: RedisLease = { leaseExpiresAt, attempts: attempt };
      const outcome = await runTransition(
        client,
        "claimCommit",
        keysFor(jobId),
        [
          JSON.stringify(claimed),
          ttl,
          JSON.stringify(lease),
          String(leaseExpiresAt),
          jobId,
        ],
      );
      if (outcome === "unavailable") return UNAVAILABLE();
      if (outcome !== "applied") {
        // Canceled/changed in the race window: the racing writer won and the job is
        // no longer claimable. Deterministic and safe — drop it, claim nothing.
        return queueOk<ClaimedJob | null>(null);
      }
      return queueOk<ClaimedJob | null>({
        job: claimed,
        inputs: specRes.value.inputs,
        ...(specRes.value.inputNames
          ? { inputNames: specRes.value.inputNames }
          : {}),
        options: specRes.value.options,
        ...(specRes.value.delivery ? { delivery: specRes.value.delivery } : {}),
        attempt,
        leaseExpiresAt,
      });
    },

    async heartbeat(jobId, leaseMs, expectedAttempt) {
      // Load only to return the current record and short-circuit an unknown job;
      // the heartbeat script is the authoritative, atomic guard (running status +
      // live lease + attempt ownership) and recomputes the lease server-side.
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const leaseExpiresAt = now() + grantedLeaseMs(leaseMs, config);
      const outcome = await runTransition(client, "heartbeat", keysFor(jobId), [
        String(leaseExpiresAt),
        attemptArg(expectedAttempt),
        ttl,
        jobId,
      ]);
      return applyOutcome(
        outcome,
        jobRes.value,
        "Only a claimed, in-flight job can be heartbeated.",
      );
    },

    async advance(jobId, update: RunningUpdate, expectedAttempt) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const job = jobRes.value;
      if (update.status && !canTransition(job.status, update.status)) {
        // Fast honest rejection when the read already shows the move is illegal;
        // the CAS below is the authoritative guard for the race window.
        return queueFail(
          "conflict",
          `A ${job.status} job cannot advance to ${update.status}.`,
        );
      }
      const next: Job = {
        ...job,
        status: update.status ?? job.status,
        progress: update.progress ?? job.progress,
        updatedAt: iso(now()),
      };
      // Legal source states: those the target status is reachable from, or (for a
      // progress-only advance) the actively-leased states.
      const allowed = update.status
        ? sourceStatusesFor(update.status)
        : RUNNING_STATUSES;
      const outcome = await runTransition(client, "advance", keysFor(jobId), [
        JSON.stringify(next),
        ttl,
        attemptArg(expectedAttempt),
        statusCsv(allowed),
      ]);
      return applyOutcome(
        outcome,
        next,
        `A ${job.status} job cannot advance to ${update.status ?? job.status}.`,
      );
    },

    async complete(
      jobId,
      artifacts: JobArtifact[],
      expectedAttempt,
      results?: JobResults,
    ) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const job = jobRes.value;
      if (!canTransition(job.status, "completed")) {
        return queueFail(
          "conflict",
          `A ${job.status} job cannot be completed.`,
        );
      }
      // Re-bound the structured result metadata before it is serialized into the
      // durable job record, so the broker persists only a schema-stable, safe value
      // regardless of caller; an empty/absent block leaves `results` off the record.
      const safeResults = sanitizeJobResults(results);
      const next: Job = {
        ...job,
        status: "completed",
        progress: 100,
        artifacts,
        ...(safeResults ? { results: safeResults } : {}),
        updatedAt: iso(now()),
      };
      const outcome = await runTransition(client, "finalize", keysFor(jobId), [
        JSON.stringify(next),
        ttl,
        attemptArg(expectedAttempt),
        statusCsv(sourceStatusesFor("completed")),
        jobId,
      ]);
      return applyOutcome(
        outcome,
        next,
        `A ${job.status} job cannot be completed.`,
      );
    },

    async fail(
      jobId,
      error: JobError,
      disposition: FailDisposition,
      expectedAttempt,
    ) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const job = jobRes.value;

      if (disposition.requeue) {
        if (!canTransition(job.status, "queued")) {
          return queueFail(
            "conflict",
            `A ${job.status} job cannot be requeued.`,
          );
        }
        const requeued: Job = {
          ...job,
          status: "queued",
          progress: 0,
          updatedAt: iso(now()),
        };
        // Keep spec (inputs) + lease (attempt count); the requeue script re-lists
        // the job and removes it from `active` atomically under an ownership CAS.
        // A positive delay parks it in the visible-at ZSET instead of the ready
        // list — same guards, different destination — so no claim can see it
        // until the promotion sweep moves it across.
        const delayMs = disposition.delayMs ?? 0;
        const outcome =
          delayMs > 0
            ? await runTransition(client, "requeueDelayed", keysFor(jobId), [
                JSON.stringify(requeued),
                ttl,
                attemptArg(expectedAttempt),
                statusCsv(sourceStatusesFor("queued")),
                jobId,
                String(now() + delayMs),
              ])
            : await runTransition(client, "requeue", keysFor(jobId), [
                JSON.stringify(requeued),
                ttl,
                attemptArg(expectedAttempt),
                statusCsv(sourceStatusesFor("queued")),
                jobId,
              ]);
        return applyOutcome(
          outcome,
          requeued,
          `A ${job.status} job cannot be requeued.`,
        );
      }

      if (!canTransition(job.status, "failed")) {
        return queueFail("conflict", `A ${job.status} job cannot be failed.`);
      }
      const failed: Job = {
        ...job,
        status: "failed",
        progress: 0,
        error,
        updatedAt: iso(now()),
      };
      const outcome = await runTransition(client, "finalize", keysFor(jobId), [
        JSON.stringify(failed),
        ttl,
        attemptArg(expectedAttempt),
        statusCsv(sourceStatusesFor("failed")),
        jobId,
      ]);
      return applyOutcome(
        outcome,
        failed,
        `A ${job.status} job cannot be failed.`,
      );
    },

    async cancel(jobId) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const job = jobRes.value;
      if (!canCancel(job.status)) {
        return queueFail(
          "conflict",
          `A ${job.status} job cannot be canceled; it has already finished.`,
        );
      }
      const canceled = toTerminal(job, "canceled");
      // Cancel carries no worker lease (it is the user's stop button), so it guards
      // on the job still being cancelable (non-terminal) — NO_ATTEMPT — and races a
      // running complete/fail deterministically: whichever script runs first wins.
      const outcome = await runTransition(client, "finalize", keysFor(jobId), [
        JSON.stringify(canceled),
        ttl,
        NO_ATTEMPT,
        statusCsv(sourceStatusesFor("canceled")),
        jobId,
      ]);
      return applyOutcome(
        outcome,
        canceled,
        `A ${job.status} job cannot be canceled; it has already finished.`,
      );
    },

    async expire(jobId) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const job = jobRes.value;
      if (!canExpire(job.status)) {
        return queueFail(
          "conflict",
          `Only a completed job's outputs can be expired; this job is ${job.status}.`,
        );
      }
      const expired = toTerminal(job, "expired");
      const outcome = await runTransition(client, "finalize", keysFor(jobId), [
        JSON.stringify(expired),
        ttl,
        NO_ATTEMPT,
        statusCsv(sourceStatusesFor("expired")),
        jobId,
      ]);
      return applyOutcome(
        outcome,
        expired,
        `Only a completed job's outputs can be expired; this job is ${job.status}.`,
      );
    },

    capability() {
      return redisQueueCapability();
    },
  };
}
