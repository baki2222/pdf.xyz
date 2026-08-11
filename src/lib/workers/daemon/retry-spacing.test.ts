// @vitest-environment node
/**
 * A retryable failure must not be re-attempted IMMEDIATELY.
 *
 * `rate_limited` is in `RETRYABLE_AI_FAILURES`, so the system claims to retry
 * it. `executor.ts` requeues while `attempt < maxAttempts` (default 3), and the
 * daemon treats `requeued` as a productive outcome — it resets the idle counter
 * and claims again with no sleep, which its own comment states out loud:
 *
 *     "A productive outcome (completed/failed/requeued/canceled) loops straight
 *      into the next claim with no sleep, so a busy queue drains at full speed."
 *
 * That is right for `completed`. For a retryable failure it means **three
 * provider calls inside a few milliseconds**, and a provider's rate-limit window
 * is seconds to minutes — so all three fail for the same reason and the user
 * gets a terminal error that a two-second wait would have avoided. The retry
 * machinery exists, is tested, and cannot work for the one failure kind that
 * most needs spacing.
 *
 * THE ASSERTION IS ABOUT THE PROPERTY, NOT THE MECHANISM, deliberately. It does
 * not say "the daemon sleeps" — that is one of two possible fixes, and naming it
 * would bless that one. The property is *time passes between successive attempts
 * of the same work*, which is satisfied either by a delayed requeue (the queue
 * makes the job invisible until later, and the daemon simply goes idle) or by
 * the daemon spacing its own re-claim. A guard that named the mechanism here
 * would license the wrong design, which is this codebase's rule 2.
 */
import { describe, expect, it } from "vitest";
import type { WorkerExecutor } from "../executor/executor";
import type { ExecutorTick } from "../executor/types";
import { createWorkerDaemon } from "./daemon";

/**
 * A worker whose every tick is a retryable requeue, on a fake clock that only
 * advances when something actually waits.
 */
function retryingWorker() {
  let now = 0;
  /** The fake-clock instant of each attempt. */
  const attempts: number[] = [];
  const executor: WorkerExecutor = {
    async runOnce(): Promise<ExecutorTick> {
      attempts.push(now);
      return { outcome: "requeued" };
    },
    async drain() {
      throw new Error("the daemon must drive runOnce, not drain");
    },
  };
  // The ONLY thing that moves the clock. If nothing waits, every attempt lands
  // at the same instant — which is precisely the defect being measured.
  const sleep = async (ms: number): Promise<void> => {
    now += ms;
  };
  return { executor, sleep, attempts: () => attempts };
}

describe("a retryable requeue is not re-attempted immediately", () => {
  it("leaves time between successive attempts of the same work", async () => {
    const { executor, sleep, attempts } = retryingWorker();
    const daemon = createWorkerDaemon({ executor, sleep });

    await daemon.run({ mode: "loop", maxTicks: 3, idleSleepMs: 1_000 });

    const at = attempts();
    expect(at.length, "precondition: the loop really ran three attempts").toBe(
      3,
    );

    const gaps = at.slice(1).map((t, i) => t - at[i]!);
    expect(
      gaps.every((g) => g > 0),
      `successive attempts of a RETRYABLE failure were ${gaps.join("/")}ms ` +
        "apart. Three provider calls inside one millisecond is functionally " +
        "identical to not retrying at all: a rate-limit window is seconds to " +
        "minutes, so every attempt fails for the same reason and the caller " +
        "gets a terminal error a short wait would have avoided.",
    ).toBe(true);
  });

  it("still drains a BUSY queue at full speed — the property must not cost that", async () => {
    // The control, and the reason this cannot be fixed by sleeping after every
    // tick. A completed job is evidence more work is waiting; spacing those
    // would turn a throughput optimisation into a throttle.
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
});
