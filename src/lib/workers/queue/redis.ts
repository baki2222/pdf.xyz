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
 * Concurrency: the atomic dequeue (`RPOP …:ready`) and the atomic redelivery
 * hand-off (`ZREM …:active`, whose returned count elects a single winner) are the
 * mutual-exclusion points, so two workers can never claim or requeue the same job.
 * Each multi-key transition is a MULTI/EXEC transaction, so a job never lands in a
 * half-updated state. Read-then-write transitions (status/cancel/complete) are
 * last-writer-wins within the tiny read→write window and are always guarded by the
 * shared state machine — an illegal move observed at write time is a `conflict`,
 * never a corrupt job. See docs/WORKER_ARCHITECTURE.md for the honest limits.
 *
 * Honesty: every method returns a typed {@link QueueResult}. A missing job is a
 * clean `not_found`; an illegal transition is a `conflict`; a broker that errors
 * or is unreachable is a typed `unavailable` — never a fabricated job or status.
 */

import { createHash } from "node:crypto";
import type { Job, JobArtifact, JobError } from "@/lib/jobs";
import { isTerminalStatus } from "@/lib/jobs";
import { canCancel, canExpire, canRedeliver, canTransition } from "./state";
import type {
  ClaimableQueue,
  ClaimOptions,
  ClaimedJob,
  FailDisposition,
  JobSubmission,
  RunningUpdate,
} from "./claim";
import type { RedisQueueConfig } from "./redis-config";
import { redisQueueCapability } from "./redis-config";
import {
  createRedisClient,
  type RedisArg,
  type RedisClient,
  type RedisFetch,
  type RedisValue,
} from "./redis-client";
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
  const k = (...parts: string[]): string => [config.keyPrefix, ...parts].join(":");
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
  const putLease = (jobId: string, lease: RedisLease): RedisArg[] => [
    "SET",
    k("lease", jobId),
    JSON.stringify(lease),
    "EX",
    ttl,
  ];

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
    // keep advertising downloadable artifacts (keeps isDownloadReady honest).
    delete next.artifacts;
    return next;
  };

  /** Fail a job terminally and forget its execution bookkeeping. */
  const terminalFail = async (jobId: string, job: Job, message: string): Promise<void> => {
    const failed: Job = {
      ...job,
      status: "failed",
      progress: 0,
      error: { code: "internal_error", message, retryable: false },
      updatedAt: iso(now()),
    };
    await runTx([
      putJob(failed),
      ["DEL", k("spec", jobId)],
      ["DEL", k("lease", jobId)],
      ["ZREM", k("active"), jobId],
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
          ...(submission.inputNames ? { inputNames: submission.inputNames } : {}),
          options: submission.options,
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
      const effectiveLeaseMs = Math.min(options.leaseMs, config.leaseCeilingMs);

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
        // must carry forward so the dead-letter cap can eventually stop it.
        const tx = await runTx([putJob(requeued), ["LPUSH", k("ready"), entry]]);
        if (!tx.ok) return tx;
      }

      // 2. Claim the oldest queued job. RPOP is the atomic dequeue.
      const pop = await client.command(["RPOP", k("ready")]);
      if (!pop.ok) return UNAVAILABLE();
      if (typeof pop.value !== "string") return queueOk<ClaimedJob | null>(null);
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
      const claimed: Job = { ...job, status: "scanning", updatedAt: iso(nowMs) };
      const tx = await runTx([
        putJob(claimed),
        putLease(jobId, { leaseExpiresAt, attempts: attempt }),
        ["ZADD", k("active"), String(leaseExpiresAt), jobId],
      ]);
      if (!tx.ok) return tx;
      return queueOk<ClaimedJob | null>({
        job: claimed,
        inputs: specRes.value.inputs,
        ...(specRes.value.inputNames
          ? { inputNames: specRes.value.inputNames }
          : {}),
        options: specRes.value.options,
        attempt,
        leaseExpiresAt,
      });
    },

    async heartbeat(jobId, leaseMs) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const leaseRes = await loadLease(jobId);
      if (!leaseRes.ok) return leaseRes;
      if (!leaseRes.value || isTerminalStatus(jobRes.value.status)) {
        return queueFail(
          "conflict",
          "Only a claimed, in-flight job can be heartbeated.",
        );
      }
      const leaseExpiresAt = now() + Math.min(leaseMs, config.leaseCeilingMs);
      const tx = await runTx([
        putLease(jobId, { ...leaseRes.value, leaseExpiresAt }),
        ["ZADD", k("active"), String(leaseExpiresAt), jobId],
      ]);
      if (!tx.ok) return tx;
      return queueOk(jobRes.value);
    },

    async advance(jobId, update: RunningUpdate) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const job = jobRes.value;
      if (update.status && !canTransition(job.status, update.status)) {
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
      const res = await client.command(putJob(next));
      if (!res.ok) return UNAVAILABLE();
      return queueOk(next);
    },

    async complete(jobId, artifacts: JobArtifact[]) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const job = jobRes.value;
      if (!canTransition(job.status, "completed")) {
        return queueFail("conflict", `A ${job.status} job cannot be completed.`);
      }
      const next: Job = {
        ...job,
        status: "completed",
        progress: 100,
        artifacts,
        updatedAt: iso(now()),
      };
      const tx = await runTx([
        putJob(next),
        ["DEL", k("spec", jobId)],
        ["DEL", k("lease", jobId)],
        ["ZREM", k("active"), jobId],
      ]);
      if (!tx.ok) return tx;
      return queueOk(next);
    },

    async fail(jobId, error: JobError, disposition: FailDisposition) {
      const jobRes = await loadJob(jobId);
      if (!jobRes.ok) return jobRes;
      const job = jobRes.value;

      if (disposition.requeue) {
        if (!canTransition(job.status, "queued")) {
          return queueFail("conflict", `A ${job.status} job cannot be requeued.`);
        }
        const requeued: Job = {
          ...job,
          status: "queued",
          progress: 0,
          updatedAt: iso(now()),
        };
        // Keep spec (inputs) + lease (attempt count); leave `active` so the sweep
        // doesn't also redeliver a job that is already back on the ready list.
        const tx = await runTx([
          putJob(requeued),
          ["LPUSH", k("ready"), jobId],
          ["ZREM", k("active"), jobId],
        ]);
        if (!tx.ok) return tx;
        return queueOk(requeued);
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
      const tx = await runTx([
        putJob(failed),
        ["DEL", k("spec", jobId)],
        ["DEL", k("lease", jobId)],
        ["ZREM", k("active"), jobId],
      ]);
      if (!tx.ok) return tx;
      return queueOk(failed);
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
      const tx = await runTx([
        putJob(canceled),
        ["DEL", k("spec", jobId)],
        ["DEL", k("lease", jobId)],
        ["LREM", k("ready"), "0", jobId],
        ["ZREM", k("active"), jobId],
      ]);
      if (!tx.ok) return tx;
      return queueOk(canceled);
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
      const tx = await runTx([
        putJob(expired),
        ["DEL", k("spec", jobId)],
        ["DEL", k("lease", jobId)],
        ["ZREM", k("active"), jobId],
      ]);
      if (!tx.ok) return tx;
      return queueOk(expired);
    },

    capability() {
      return redisQueueCapability();
    },
  };
}
