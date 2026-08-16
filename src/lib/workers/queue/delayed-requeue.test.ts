// @vitest-environment node
/**
 * The QUEUE-LEVEL delayed-requeue property — the check that must exist before a
 * single line of the implementation changes:
 *
 *   **A job requeued with a delay is not claimable before that delay has
 *   elapsed, and is claimable after it.**
 *
 * This is the STRUCTURAL half of the retry-spacing work, and it is deliberately
 * a different check from `daemon/retry-spacing.test.ts`. That one constrains the
 * loop; this one constrains the store. The loop check would pass under a bad
 * implementation that accepted a `delayMs` nothing enforced — only a check that
 * fails a job into the real queue and then tries to CLAIM it can see whether the
 * delay is real.
 *
 * ONE SHARED CORPUS, BOTH IMPLEMENTATIONS. The property is written once and run
 * against the local-dev queue and the Redis provider (over the faithful fake).
 * A fake that diverges from the real store on the one structure that holds jobs
 * is how a green suite ships a lost job — so neither implementation gets its own
 * private version of the truth. The fake's EVAL dispatch-by-script-text is the
 * enforcement mechanism: a transition script whose body changes without a
 * matching twin fails loudly rather than drifting.
 *
 * CAPTURED RED ON THE PRE-CHANGE TREE. `ready` was a Redis LIST (`LPUSH`) and
 * the local-dev claim read "oldest queued by timestamp"; neither had any notion
 * of visible-at, so a delayed requeue was claimable instantly and the first arm
 * failed on both providers. That capture is the proof this test can see the
 * defect it exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job, type JobError } from "@/lib/jobs";
import type { ClaimableQueue } from "./claim";
import { createLocalDevQueue } from "./local-dev";
import { createFakeRedis } from "./redis-fake";
import { createRedisQueue } from "./redis";
import { parseRedisQueueConfig, REDIS_QUEUE_ENV } from "./redis-config";
import { DevWorkerStore } from "../store";

const TOKEN = "AX_tokenEXAMPLEvalue000000000000000000000";
const HOUR_MS = 60 * 60_000;
const LEASE = { leaseMs: 30_000 };
const RETRYABLE: JobError = {
  code: "ai_rate_limited",
  message: "The AI provider asked us to slow down.",
  retryable: true,
};

function queuedJob(jobId: string, nowMs: number): Job {
  return {
    jobId,
    tool: "translate-pdf",
    capability: "secure-worker",
    status: "queued",
    progress: 0,
    createdAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + HOUR_MS).toISOString(),
    retention: DEFAULT_RETENTION,
  };
}

interface Harness {
  q: ClaimableQueue;
  clock: { ms: number };
}

/** The two implementations under one contract. Each gets a private fake clock. */
const IMPLEMENTATIONS: ReadonlyArray<readonly [string, () => Harness]> = [
  [
    "local-dev queue",
    () => {
      const clock = { ms: 1_000 };
      // The STORE gets the same fake clock as the provider. Its default is real
      // Date.now(), which silently expired every 1970-stamped fixture job — the
      // first run of this file failed its own preconditions on a clock skew
      // between two components of its own harness. Rule 4, in miniature.
      const q = createLocalDevQueue({
        store: new DevWorkerStore(() => clock.ms),
        now: () => clock.ms,
      });
      return { q, clock };
    },
  ],
  [
    "redis provider (faithful fake)",
    () => {
      const parsed = parseRedisQueueConfig({
        [REDIS_QUEUE_ENV.provider]: "redis",
        [REDIS_QUEUE_ENV.restUrl]: "https://example.upstash.io",
        [REDIS_QUEUE_ENV.restToken]: TOKEN,
      });
      if (!parsed.ok) throw new Error("invalid test config");
      const clock = { ms: 1_000 };
      const q = createRedisQueue(parsed.config, {
        client: createFakeRedis(),
        now: () => clock.ms,
      });
      return { q, clock };
    },
  ],
];

/** Submit one queued job and claim it, so `fail(...)` has a running job to hit. */
async function submitAndClaim(h: Harness, jobId: string) {
  const job = queuedJob(jobId, h.clock.ms);
  const sub = await h.q.submit({ job, inputs: ["file_1"], options: {} });
  expect(sub.ok, "precondition: submit accepted the job").toBe(true);
  const claimed = await h.q.claim(LEASE);
  if (!claimed.ok || claimed.value === null) {
    throw new Error("precondition: the submitted job was not claimable");
  }
  expect(claimed.value.job.jobId).toBe(jobId);
  return claimed.value;
}

describe.each(IMPLEMENTATIONS)("delayed requeue — %s", (_name, makeHarness) => {
  it("is NOT claimable before the delay, and IS claimable after", async () => {
    const h = makeHarness();
    const first = await submitAndClaim(h, "job_delay000001");

    const failed = await h.q.fail(
      first.job.jobId,
      RETRYABLE,
      { requeue: true, delayMs: 5_000 },
      first.attempt,
    );
    expect(failed.ok, "precondition: the delayed requeue was accepted").toBe(
      true,
    );

    // Before the delay: nothing claimable. THIS is the arm that was red on the
    // LIST — the job came straight back.
    h.clock.ms += 1_000;
    const early = await h.q.claim(LEASE);
    expect(early.ok).toBe(true);
    if (!early.ok) return;
    expect(
      early.value,
      "a job requeued with a 5s delay was claimable after 1s — the delay is " +
        "not enforced by the store, so three retries of a rate-limited call " +
        "fire back to back and the retry machinery cannot do its job",
    ).toBeNull();

    // After the delay: claimable, with the attempt carried forward.
    h.clock.ms += 5_000;
    const late = await h.q.claim(LEASE);
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    expect(
      late.value?.job.jobId,
      "the delayed job never became claimable — a delay must defer work, " +
        "never lose it",
    ).toBe(first.job.jobId);
    expect(
      late.value?.attempt,
      "the attempt counter did not carry across the delayed requeue, so the " +
        "dead-letter cap can never stop a job that keeps failing",
    ).toBe(first.attempt + 1);
  });

  it("CONTROL: an UNDELAYED requeue stays immediately claimable", async () => {
    // Today's behavior, pinned so the delay cannot leak into the path that has
    // no delay. Every existing retryable requeue in the system passes no
    // `delayMs`, and those must be untouched by this change.
    const h = makeHarness();
    const first = await submitAndClaim(h, "job_nodelay00001");

    const failed = await h.q.fail(
      first.job.jobId,
      RETRYABLE,
      { requeue: true },
      first.attempt,
    );
    expect(failed.ok).toBe(true);

    const again = await h.q.claim(LEASE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(
      again.value?.job.jobId,
      "an undelayed requeue became invisible — the delay leaked into the " +
        "default path",
    ).toBe(first.job.jobId);
  });

  it("a delayed job does not block OTHER ready work", async () => {
    // The busy-queue property at the queue level, and the reason the fix could
    // not live in the daemon: one rate-limited job must not delay the job
    // behind it.
    const h = makeHarness();
    const first = await submitAndClaim(h, "job_delay000002");
    const failed = await h.q.fail(
      first.job.jobId,
      RETRYABLE,
      { requeue: true, delayMs: 60_000 },
      first.attempt,
    );
    expect(failed.ok).toBe(true);

    // A second job arrives while the first is parked.
    const other = queuedJob("job_other000001", h.clock.ms);
    const sub = await h.q.submit({
      job: other,
      inputs: ["file_2"],
      options: {},
    });
    expect(sub.ok).toBe(true);

    h.clock.ms += 1_000; // far inside the first job's delay
    const claimed = await h.q.claim(LEASE);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(
      claimed.value?.job.jobId,
      "a parked job blocked the runnable one behind it — the delay is " +
        "punishing the wrong job",
    ).toBe("job_other000001");
  });

  it("a delay of zero (or absent) means NOW — no off-by-one at the boundary", async () => {
    const h = makeHarness();
    const first = await submitAndClaim(h, "job_zero0000001");
    const failed = await h.q.fail(
      first.job.jobId,
      RETRYABLE,
      { requeue: true, delayMs: 0 },
      first.attempt,
    );
    expect(failed.ok).toBe(true);
    const again = await h.q.claim(LEASE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value?.job.jobId).toBe(first.job.jobId);
  });

  it("a canceled job is not resurrected by its own pending delay", async () => {
    // The loss/duplication guard this whole change is dangerous for: a delayed
    // job that gets canceled while parked must stay canceled when the delay
    // expires — a delay is a visibility fact, never a second copy of the job.
    const h = makeHarness();
    const first = await submitAndClaim(h, "job_cancel00001");
    const failed = await h.q.fail(
      first.job.jobId,
      RETRYABLE,
      { requeue: true, delayMs: 5_000 },
      first.attempt,
    );
    expect(failed.ok).toBe(true);

    const canceled = await h.q.cancel(first.job.jobId);
    expect(canceled.ok, "precondition: a parked job can be canceled").toBe(
      true,
    );

    h.clock.ms += 10_000; // the delay expires after the cancel
    const claimed = await h.q.claim(LEASE);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(
      claimed.value,
      "a canceled job came back to life when its requeue delay expired",
    ).toBeNull();
  });
});
