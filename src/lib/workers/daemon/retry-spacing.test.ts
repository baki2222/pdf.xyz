// @vitest-environment node
/**
 * A retryable failure must not be re-attempted IMMEDIATELY.
 *
 * `rate_limited` is in `RETRYABLE_AI_FAILURES`, so the system claims to retry
 * it — and before the delayed requeue existed, "retry" meant three provider
 * calls inside a few milliseconds: a provider's rate-limit window is seconds to
 * minutes, so every attempt failed for the same reason and the user got a
 * terminal error a short wait would have avoided.
 *
 * THIS FILE'S FIRST VERSION MEASURED THE WRONG LAYER, and the history is kept
 * because the mistake is the instructive part. It drove the daemon with a fake
 * executor that returned `requeued` on every tick and asserted the DAEMON
 * spaced its calls. But a stream of back-to-back requeues of the same job is a
 * state the fixed system cannot produce — under a delayed requeue the job is
 * simply not claimable, so the daemon's next tick is `idle`, and the daemon's
 * behavior after `requeued` (claim again immediately) is CORRECT: another job
 * may be ready, and sleeping there would throttle the queue behind one
 * rate-limited job. The property — *time passes between successive attempts of
 * the same work* — belongs to the QUEUE, and a test pinning it on the daemon
 * was naming a mechanism, not a property: it would have forced the design the
 * ruling rejected. Rule 2, caught in this suite's own author.
 *
 * So the spacing case is now a COMPOSED-CHAIN test: the real daemon loop
 * driving a real local-dev queue through a thin claim-and-fail executor, on one
 * shared fake clock. The queue parks the job; the daemon goes idle and sleeps;
 * the clock advances; the job comes back. Spacing emerges from the pieces
 * working together, which is the only place it exists.
 *
 * The queue-level property itself (not claimable before the delay, claimable
 * after) is pinned separately in `../queue/delayed-requeue.test.ts`, against
 * BOTH queue implementations.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, type Job, type JobError } from "@/lib/jobs";
import type { WorkerExecutor } from "../executor/executor";
import { retryRequeueDelayMs } from "../executor/executor";
import type { ExecutorTick } from "../executor/types";
import { createLocalDevQueue } from "../queue/local-dev";
import { DevWorkerStore } from "../store";
import { createWorkerDaemon } from "./daemon";

const HOUR_MS = 60 * 60_000;
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

describe("a retryable requeue is not re-attempted immediately", () => {
  it("the composed chain spaces successive attempts of the same job", async () => {
    // One clock shared by the queue, the store and the daemon's sleep — the
    // seam where the first version of this test cheated by not having a queue
    // at all.
    const clock = { ms: 1_000 };
    const queue = createLocalDevQueue({
      store: new DevWorkerStore(() => clock.ms),
      now: () => clock.ms,
    });

    const job = queuedJob("job_spacing0001", clock.ms);
    const submitted = await queue.submit({
      job,
      inputs: ["file_1"],
      options: {},
    });
    expect(submitted.ok, "precondition: submit accepted the job").toBe(true);

    /** Fake-clock instants at which the JOB was actually claimed (attempted). */
    const attempts: number[] = [];

    // A thin executor over the REAL queue: claim; if nothing is claimable the
    // tick is idle (which is what the daemon backs off on); otherwise record
    // the attempt and fail it retryably — the path a rate-limited AI call takes.
    const executor: WorkerExecutor = {
      async runOnce(): Promise<ExecutorTick> {
        const claim = await queue.claim({ leaseMs: 30_000 });
        if (!claim.ok) return { outcome: "error" };
        if (claim.value === null) return { outcome: "idle" };
        attempts.push(clock.ms);
        const { job: claimed, attempt } = claim.value;
        await queue.fail(
          claimed.jobId,
          RETRYABLE,
          { requeue: true, delayMs: retryRequeueDelayMs(attempt) },
          attempt,
        );
        return { outcome: "requeued", jobId: claimed.jobId, attempt };
      },
      async drain() {
        throw new Error("the daemon must drive runOnce, not drain");
      },
    };

    const daemon = createWorkerDaemon({
      executor,
      sleep: async (ms) => {
        clock.ms += ms;
      },
    });

    // Enough ticks for three attempts plus the idle ticks between them.
    await daemon.run({ mode: "loop", maxTicks: 40, idleSleepMs: 500 });

    expect(
      attempts.length,
      "precondition: the job was attempted at least twice through the chain",
    ).toBeGreaterThanOrEqual(2);

    const gaps = attempts.slice(1).map((t, i) => t - attempts[i]!);
    for (const [i, gap] of gaps.entries()) {
      expect(
        gap,
        `attempts ${i + 1} and ${i + 2} of the same job were ${gap}ms apart — ` +
          "less than the retry delay the executor asked for. Either the queue " +
          "did not enforce the park or the daemon found a way around it; " +
          "either way three instant retries of a rate-limited call are " +
          "functionally identical to not retrying at all",
      ).toBeGreaterThanOrEqual(retryRequeueDelayMs(i + 1));
    }
  });

  it("still drains a BUSY queue at full speed — the property must not cost that", async () => {
    // The control, and the reason the fix could not be "sleep after every
    // tick": a completed job is evidence more work is waiting, and spacing
    // those would turn a throughput optimisation into a throttle. Unchanged
    // from the first version of this file — it was green before the fix and
    // must stay green after, which is what gives the fix something to lose.
    let now = 0;
    const attempts: number[] = [];
    const executor: WorkerExecutor = {
      async runOnce(): Promise<ExecutorTick> {
        attempts.push(now);
        return { outcome: "completed" };
      },
      async drain() {
        throw new Error("unused");
      },
    };
    const daemon = createWorkerDaemon({
      executor,
      sleep: async (ms: number) => {
        now += ms;
      },
    });

    await daemon.run({ mode: "loop", maxTicks: 3, idleSleepMs: 1_000 });

    const gaps = attempts.slice(1).map((t, i) => t - attempts[i]!);
    expect(attempts.length, "precondition: the loop really ran").toBe(3);
    expect(
      gaps.every((g) => g === 0),
      "a productive, non-retry outcome was spaced out — that is a throttle on " +
        "a healthy queue, not a backoff",
    ).toBe(true);
  });

  it("the retry schedule is monotone, bounded, and never instant", () => {
    // Health checks on the one invented factor. The numbers are a judgement;
    // these pin the SHAPE the judgement must keep: a later attempt never waits
    // less, nothing is instant, and a raised attempt cap cannot park a job for
    // hours.
    expect(retryRequeueDelayMs(1)).toBeGreaterThan(0);
    for (let a = 1; a < 8; a++) {
      expect(retryRequeueDelayMs(a + 1)).toBeGreaterThanOrEqual(
        retryRequeueDelayMs(a),
      );
    }
    expect(retryRequeueDelayMs(100)).toBeLessThanOrEqual(60_000);
    // And the first delay is long enough to mean something against a provider
    // window measured in seconds.
    expect(retryRequeueDelayMs(1)).toBeGreaterThanOrEqual(1_000);
  });
});
