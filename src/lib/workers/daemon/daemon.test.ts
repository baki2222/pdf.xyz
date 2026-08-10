// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { WorkerExecutor } from "../executor/executor";
import type { ExecutorTick } from "../executor/types";
import {
  createWorkerDaemon,
  type DaemonLogEvent,
  type DaemonRunMode,
} from "./daemon";

/**
 * A fake executor that replays a scripted sequence of ticks. Once the script is
 * exhausted it repeats its last tick, so a capped `loop` keeps getting work. A
 * `throw` sentinel exercises the daemon's transient-failure containment.
 */
function scriptedExecutor(script: Array<ExecutorTick | "throw">): {
  executor: WorkerExecutor;
  calls: () => number;
} {
  let i = 0;
  let calls = 0;
  const executor: WorkerExecutor = {
    async runOnce() {
      calls += 1;
      const step = script[Math.min(i, script.length - 1)] ?? {
        outcome: "idle",
      };
      i += 1;
      if (step === "throw") throw new Error("SECRET boom /tmp/x.pdf");
      return step;
    },
    async drain() {
      throw new Error("the daemon must drive runOnce, not drain");
    },
  };
  return { executor, calls: () => calls };
}

const tick = (
  outcome: ExecutorTick["outcome"],
  extra: Partial<ExecutorTick> = {},
): ExecutorTick => ({
  outcome,
  ...extra,
});

/** A recording log sink plus a synchronous, instant fake sleep. */
function harness() {
  const events: DaemonLogEvent[] = [];
  const sleeps: number[] = [];
  const log = (e: DaemonLogEvent) => events.push(e);
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { events, sleeps, log, sleep };
}

describe("createWorkerDaemon — once", () => {
  it("runs exactly one tick and stops with reason 'once'", async () => {
    const { executor, calls } = scriptedExecutor([
      tick("completed", { jobId: "job_a", attempt: 1 }),
    ]);
    const { events, log } = harness();
    const summary = await createWorkerDaemon({ executor, log }).run({
      mode: "once",
    });

    expect(calls()).toBe(1);
    expect(summary).toMatchObject({
      mode: "once",
      ticks: 1,
      completed: 1,
      reason: "once",
    });
    expect(events.map((e) => e.event)).toEqual(["start", "tick", "stop"]);
  });

  it("does not tick when asked to stop before starting", async () => {
    const { executor, calls } = scriptedExecutor([tick("completed")]);
    const summary = await createWorkerDaemon({
      executor,
      shouldStop: () => true,
    }).run({
      mode: "once",
    });
    expect(calls()).toBe(0);
    expect(summary).toMatchObject({ ticks: 0, reason: "stopped" });
  });
});

describe("createWorkerDaemon — drain", () => {
  it("runs until the queue is idle, then stops with reason 'drained'", async () => {
    const { executor } = scriptedExecutor([
      tick("completed", { jobId: "job_a", attempt: 1 }),
      tick("failed", {
        jobId: "job_b",
        attempt: 1,
        error: { code: "unprocessable_entity", message: "x", retryable: false },
      }),
      tick("idle"),
    ]);
    const summary = await createWorkerDaemon({ executor }).run({
      mode: "drain",
    });
    expect(summary).toMatchObject({
      mode: "drain",
      ticks: 3,
      completed: 1,
      failed: 1,
      idle: 1,
      reason: "drained",
    });
  });

  it("stops with 'queue_error' when the queue itself errors", async () => {
    const { executor } = scriptedExecutor([tick("error")]);
    const summary = await createWorkerDaemon({ executor }).run({
      mode: "drain",
    });
    expect(summary).toMatchObject({ errors: 1, reason: "queue_error" });
  });

  it("contains a thrown tick as an error rather than crashing", async () => {
    const { executor, calls } = scriptedExecutor(["throw"]);
    const summary = await createWorkerDaemon({ executor }).run({
      mode: "drain",
    });
    expect(calls()).toBe(1);
    expect(summary).toMatchObject({ errors: 1, reason: "queue_error" });
  });

  it("honors an explicit --max-ticks cap over a never-idle queue", async () => {
    const { executor, calls } = scriptedExecutor([
      tick("completed", { jobId: "job_a", attempt: 1 }),
    ]);
    const summary = await createWorkerDaemon({ executor }).run({
      mode: "drain",
      maxTicks: 4,
    });
    expect(calls()).toBe(4);
    expect(summary).toMatchObject({
      ticks: 4,
      completed: 4,
      reason: "max_ticks",
    });
  });
});

describe("createWorkerDaemon — loop", () => {
  it("sleeps on an idle tick and keeps polling until the tick cap", async () => {
    // completed, idle, completed → cap of 3 stops it; one idle ⇒ one sleep.
    const { executor } = scriptedExecutor([
      tick("completed", { jobId: "job_a", attempt: 1 }),
      tick("idle"),
      tick("completed", { jobId: "job_b", attempt: 1 }),
    ]);
    const { sleeps, log } = harness();
    const summary = await createWorkerDaemon({
      executor,
      log,
      sleep: async (ms) => void sleeps.push(ms),
    }).run({
      mode: "loop",
      maxTicks: 3,
      idleSleepMs: 250,
    });
    expect(summary).toMatchObject({
      ticks: 3,
      completed: 2,
      idle: 1,
      reason: "max_ticks",
    });
    expect(sleeps).toEqual([250]); // slept once, after the idle tick, at the configured interval
  });

  it("backs off on a transient error instead of exiting", async () => {
    const { executor } = scriptedExecutor([
      tick("error"),
      tick("completed", { jobId: "job_a", attempt: 1 }),
    ]);
    const { sleeps } = harness();
    const summary = await createWorkerDaemon({
      executor,
      sleep: async (ms) => void sleeps.push(ms),
    }).run({
      mode: "loop",
      maxTicks: 2,
      idleSleepMs: 100,
    });
    expect(summary).toMatchObject({
      ticks: 2,
      errors: 1,
      completed: 1,
      reason: "max_ticks",
    });
    expect(sleeps).toEqual([100]); // backed off once after the error
  });

  it("stops promptly when the stop signal fires", async () => {
    let ticks = 0;
    const executor: WorkerExecutor = {
      async runOnce() {
        ticks += 1;
        return { outcome: "completed", jobId: "job_a", attempt: 1 };
      },
      async drain() {
        return [];
      },
    };
    // Stop after two productive ticks have been recorded.
    const summary = await createWorkerDaemon({
      executor,
      shouldStop: () => ticks >= 2,
    }).run({
      mode: "loop",
    });
    expect(summary).toMatchObject({ reason: "stopped" });
    expect(summary.ticks).toBeLessThanOrEqual(2);
  });
});

describe("createWorkerDaemon — content-free logging", () => {
  it("logs a failed tick's error code but never its message or paths", async () => {
    const { executor } = scriptedExecutor([
      tick("failed", {
        jobId: "job_secret",
        attempt: 2,
        error: {
          code: "internal_error",
          message: "boom at /var/secret/input.pdf",
          retryable: true,
        },
      }),
      tick("idle"),
    ]);
    const events: DaemonLogEvent[] = [];
    await createWorkerDaemon({ executor, log: (e) => events.push(e) }).run({
      mode: "drain",
    });

    const serialized = JSON.stringify(events);
    expect(serialized).toContain("internal_error"); // the code is safe to log
    expect(serialized).toContain("job_secret"); // an opaque id is safe to log
    expect(serialized).not.toContain("boom"); // the raw message is not
    expect(serialized).not.toContain("/var/secret"); // and neither is a path

    // Every event key is on the known content-free allowlist.
    const allowed = new Set([
      "event",
      "mode",
      "tick",
      "outcome",
      "jobId",
      "attempt",
      "errorCode",
      "sleepMs",
      "reason",
    ]);
    for (const e of events) {
      for (const key of Object.keys(e)) expect(allowed.has(key)).toBe(true);
    }
  });

  it("emits the same event names for every run mode", async () => {
    const modes: DaemonRunMode[] = ["once", "drain"];
    for (const mode of modes) {
      const { executor } = scriptedExecutor([tick("idle")]);
      const events: DaemonLogEvent[] = [];
      await createWorkerDaemon({ executor, log: (e) => events.push(e) }).run({
        mode,
      });
      expect(events[0]?.event).toBe("start");
      expect(events.at(-1)?.event).toBe("stop");
    }
  });
});

describe("createWorkerDaemon — heartbeat (Phase 30)", () => {
  it("beats once at start in `once` mode", async () => {
    const { executor } = scriptedExecutor([
      tick("completed", { jobId: "job_a", attempt: 1 }),
    ]);
    let beats = 0;
    const summary = await createWorkerDaemon({
      executor,
      heartbeat: () => {
        beats += 1;
      },
    }).run({ mode: "once" });
    expect(beats).toBe(1); // the start beat only; `once` runs a single tick
    expect(summary).toMatchObject({ mode: "once", ticks: 1, completed: 1 });
  });

  it("beats at start and before each poll iteration in `drain`", async () => {
    const { executor } = scriptedExecutor([
      tick("completed", { jobId: "job_a", attempt: 1 }),
      tick("idle"),
    ]);
    let beats = 0;
    const summary = await createWorkerDaemon({
      executor,
      heartbeat: () => {
        beats += 1;
      },
    }).run({ mode: "drain" });
    // 1 start beat + 1 per iteration (completed → productive, then idle → drained).
    expect(beats).toBe(3);
    expect(summary).toMatchObject({
      ticks: 2,
      completed: 1,
      idle: 1,
      reason: "drained",
    });
  });

  it("swallows a throwing heartbeat so a beat outage never disrupts draining", async () => {
    const { executor, calls } = scriptedExecutor([
      tick("completed", { jobId: "j", attempt: 1 }),
    ]);
    const summary = await createWorkerDaemon({
      executor,
      heartbeat: () => {
        throw new Error("SECRET broker down /tmp/x");
      },
    }).run({ mode: "once" });
    // The run completes normally; the heartbeat throw is contained (and its message,
    // which could carry a secret/path, never surfaces).
    expect(calls()).toBe(1);
    expect(summary).toMatchObject({ ticks: 1, completed: 1, reason: "once" });
  });

  it("tolerates an async heartbeat that rejects, per iteration, without corrupting the run", async () => {
    const { executor } = scriptedExecutor([
      tick("completed", { jobId: "j", attempt: 1 }),
      tick("idle"),
    ]);
    let beats = 0;
    const summary = await createWorkerDaemon({
      executor,
      heartbeat: async () => {
        beats += 1;
        throw new Error("SECRET async outage");
      },
    }).run({ mode: "drain" });
    expect(beats).toBe(3);
    expect(summary).toMatchObject({ completed: 1, idle: 1, reason: "drained" });
  });

  it("leaves the content-free log unchanged when no heartbeat hook is wired", async () => {
    const { executor } = scriptedExecutor([tick("idle")]);
    const events: DaemonLogEvent[] = [];
    const summary = await createWorkerDaemon({
      executor,
      log: (e) => events.push(e),
    }).run({ mode: "drain" });
    // The heartbeat adds NO log events; the loop is byte-for-byte unchanged.
    expect(events.map((e) => e.event)).toEqual(["start", "tick", "stop"]);
    expect(summary.reason).toBe("drained");
  });
});
