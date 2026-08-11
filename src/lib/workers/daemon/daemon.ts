/**
 * The worker daemon loop: the long-running process shape that drives the pure
 * {@link WorkerExecutor} against a real broker + bucket. It is the out-of-band
 * counterpart the app runtime deliberately never becomes — importing it starts
 * nothing; only an explicit `run()` call ticks the executor.
 *
 * It adds exactly what a service (not a pure loop) needs on top of the executor:
 *  - run modes — `once` (one tick), `drain` (until idle/cap), and `loop` (poll
 *    forever, sleeping when the queue is idle);
 *  - a cooperative stop signal, checked before every tick, so a SIGINT/SIGTERM
 *    drains cleanly instead of killing an in-flight job;
 *  - transient-failure containment — a thrown tick (e.g. storage unreachable
 *    mid-read) is caught and reported as an `error` tick, so the job is left for
 *    at-least-once redelivery instead of crashing the process;
 *  - content-free structured logging — every {@link DaemonLogEvent} carries only a
 *    run mode, a tick counter, an outcome, an opaque job id/attempt, and an error
 *    *code*. Never a filename, byte, object key, URL, option value, or secret.
 *
 * It is dependency-injected and node-free (the clock/sleep/stop and the executor
 * are all injected), so every mode is unit-tested deterministically with no real
 * timers, queue, or storage.
 */

import type { WorkerExecutor } from "../executor/executor";
import type { ExecutorOutcome, ExecutorTick } from "../executor/types";
import {
  claimMetric,
  runMetric,
  tickMetric,
  type ClaimResult,
} from "../observability/metrics";
import type { WorkerMetricSink } from "../observability/collector";
import { DEFAULT_MAX_IDLE_SLEEP_MS, idleBackoffMs } from "./backoff";

/** A run mode the daemon loop can execute (readiness-only `dry-run-status` is CLI-side). */
export type DaemonRunMode = "once" | "drain" | "loop";

/** Why a run finished — a content-free, client-safe terminal reason. */
export type DaemonStopReason =
  | "once" // `once` mode ran its single tick
  | "drained" // `drain`/`loop` observed an idle queue and stopped
  | "max_ticks" // the tick cap was reached
  | "stopped" // the cooperative stop signal fired
  | "queue_error"; // `drain` hit a queue error it will not retry

/**
 * A content-free structured log event. It NEVER carries a filename, byte length,
 * object key, URL, option value, or secret — only run/loop bookkeeping and the
 * executor's already-content-free tick fields.
 */
export interface DaemonLogEvent {
  event: "start" | "tick" | "sleep" | "stop";
  mode: DaemonRunMode;
  /** 1-based tick number (`tick`) or the total tick count (`stop`). */
  tick?: number;
  /** The executor outcome for a `tick`. */
  outcome?: ExecutorOutcome;
  /** Opaque job id of a claimed job (`tick`). */
  jobId?: string;
  /** 1-based delivery attempt of a claimed job (`tick`). */
  attempt?: number;
  /** Typed error *code* for a failed/requeued tick (`tick`). Never a message. */
  errorCode?: string;
  /** Milliseconds about to be slept (`sleep`). */
  sleepMs?: number;
  /** Why the run ended (`stop`). */
  reason?: DaemonStopReason;
}

/** Everything the daemon needs, all injectable for deterministic tests. */
export interface WorkerDaemonDeps {
  /** The pre-constructed executor to tick (built by the runtime from real providers). */
  executor: WorkerExecutor;
  /** Content-free structured log sink. */
  log?: (event: DaemonLogEvent) => void;
  /** Sleep between polls in `loop` mode; injected so tests advance time instantly. */
  sleep?: (ms: number) => Promise<void>;
  /** Cooperative stop, checked before every tick (SIGINT/SIGTERM in the CLI). */
  shouldStop?: () => boolean;
  /**
   * Optional content-free metrics sink (Phase 28). When present, the loop emits a
   * `worker_tick_total` + `worker_claim_total` sample per tick and a `worker_run_total`
   * sample per run. Absent (the default) ⇒ nothing is emitted; the loop is unchanged.
   */
  metrics?: WorkerMetricSink;
  /**
   * Optional liveness heartbeat (Phase 30), invoked once at start and before each
   * poll iteration in `drain`/`loop` (and once at the start of `once`). The publisher
   * it wraps is self-throttling, so a hot loop still beats only on the configured
   * cadence; the loop additionally swallows any throw, so a heartbeat outage can never
   * disrupt draining or corrupt a job. Absent (the default) ⇒ nothing is published and
   * the loop is byte-for-byte unchanged.
   */
  heartbeat?: () => void | Promise<void>;
  /**
   * Optional shared-bucket spend probe, invoked on exactly the same schedule as
   * {@link heartbeat} — once at start and before each poll iteration — and
   * self-throttling in the same way, so a hot loop still writes on its cadence.
   *
   * ITS OWN DEP RATHER THAN A LINE INSIDE `heartbeat`, deliberately. The
   * heartbeat is doubly gated (an explicit feature flag AND a compatible
   * broker); folding the probe into it would mean an operator turning liveness
   * off silently blinds the AI spend posture, which would then report
   * "the two tiers cannot be shown to share one budget" with no way to tell
   * that from a real fault. A cost control must not acquire a hidden dependency
   * on an observability toggle.
   *
   * Absent (the default) ⇒ nothing is written and the loop is unchanged.
   */
  spendProbe?: () => void | Promise<void>;
}

/** Map a tick outcome to the bounded queue-claim result it implies. */
function claimResultForOutcome(outcome: ExecutorOutcome): ClaimResult {
  if (outcome === "idle") return "empty";
  if (outcome === "error") return "error";
  return "claimed";
}

/** Options for a single {@link WorkerDaemon.run} invocation. */
export interface DaemonRunOptions {
  mode: DaemonRunMode;
  /** Hard tick cap. `loop`: unbounded when unset. `drain`: defaults to the cap below. */
  maxTicks?: number;
  /** `loop`: ms to sleep after an idle/error tick before re-polling. */
  idleSleepMs?: number;
  /**
   * `loop`: ceiling for the backed-off idle wait. The base cadence holds while
   * work is plausibly still coming, then grows towards this — so a worker left
   * alone stops billing the broker for silence. See `./backoff`.
   */
  maxIdleSleepMs?: number;
}

/** Content-free counters describing what a run did. Safe to log and return. */
export interface DaemonRunSummary {
  mode: DaemonRunMode;
  ticks: number;
  completed: number;
  failed: number;
  requeued: number;
  canceled: number;
  idle: number;
  errors: number;
  reason: DaemonStopReason;
}

export interface WorkerDaemon {
  run(options: DaemonRunOptions): Promise<DaemonRunSummary>;
}

const DEFAULT_DRAIN_CAP = 1000;
const DEFAULT_IDLE_SLEEP_MS = 1_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createWorkerDaemon(deps: WorkerDaemonDeps): WorkerDaemon {
  const { executor } = deps;
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? defaultSleep;
  const shouldStop = deps.shouldStop ?? (() => false);
  const metrics = deps.metrics;
  const heartbeat = deps.heartbeat;
  const spendProbe = deps.spendProbe;

  /**
   * Publish a liveness heartbeat, if wired, swallowing any failure. A heartbeat
   * outage (broker blip) must NEVER disrupt draining or leave a job half-processed,
   * so this is strictly best-effort — exactly like the executor's own transient
   * containment. The wrapped publisher self-throttles, so calling this every tick is
   * cheap (a timestamp compare) and touches the broker only on the cadence.
   */
  const beat = async (): Promise<void> => {
    if (!heartbeat) return;
    try {
      await heartbeat();
    } catch {
      // Intentionally ignored: liveness is observability, never a correctness gate.
    }
  };

  /**
   * Write the shared-bucket spend probe, if wired, swallowing any failure — the
   * same containment as {@link beat} and for the same reason: a store blip must
   * never disrupt draining or leave a job half-processed.
   *
   * It is called from the same two places as the heartbeat rather than from the
   * spend hook in the executor, because a worker that has processed no AI jobs
   * is still a worker whose bucket the web tier should be able to see. Waiting
   * for traffic would leave a freshly-deployed, perfectly healthy worker
   * reporting "unproven" for hours, which is the amber-that-looks-like-a-fault
   * this whole posture exists to avoid.
   */
  const probeSpend = async (): Promise<void> => {
    if (!spendProbe) return;
    try {
      await spendProbe();
    } catch {
      // Intentionally ignored: the probe is observability, never a gate.
    }
  };

  /**
   * Run one executor tick, containing any throw as an `error` outcome. A thrown
   * tick means a transient/unexpected failure (storage unreachable mid-read, a
   * bug); the job is untouched and its lease expires for redelivery. The raw error
   * is swallowed — it may carry a message we must never log.
   */
  async function safeTick(): Promise<ExecutorTick> {
    try {
      return await executor.runOnce();
    } catch {
      return { outcome: "error" };
    }
  }

  async function run(options: DaemonRunOptions): Promise<DaemonRunSummary> {
    const { mode } = options;
    const idleSleepMs = options.idleSleepMs ?? DEFAULT_IDLE_SLEEP_MS;
    const maxIdleSleepMs = options.maxIdleSleepMs ?? DEFAULT_MAX_IDLE_SLEEP_MS;
    // Consecutive idle/error ticks, for the backoff. Reset by any real work.
    let consecutiveIdle = 0;
    // `loop` is unbounded unless capped; `drain` always has a safety cap.
    const cap =
      mode === "drain"
        ? (options.maxTicks ?? DEFAULT_DRAIN_CAP)
        : options.maxTicks;

    const summary: DaemonRunSummary = {
      mode,
      ticks: 0,
      completed: 0,
      failed: 0,
      requeued: 0,
      canceled: 0,
      idle: 0,
      errors: 0,
      reason: "stopped",
    };

    const record = (tick: ExecutorTick): void => {
      summary.ticks += 1;
      switch (tick.outcome) {
        case "completed":
          summary.completed += 1;
          break;
        case "failed":
          summary.failed += 1;
          break;
        case "requeued":
          summary.requeued += 1;
          break;
        case "canceled":
          summary.canceled += 1;
          break;
        case "idle":
          summary.idle += 1;
          break;
        case "error":
          summary.errors += 1;
          break;
      }
      log({
        event: "tick",
        mode,
        tick: summary.ticks,
        outcome: tick.outcome,
        ...(tick.jobId ? { jobId: tick.jobId } : {}),
        ...(tick.attempt !== undefined ? { attempt: tick.attempt } : {}),
        ...(tick.error ? { errorCode: tick.error.code } : {}),
      });
      if (metrics) {
        // Per-tick outcome + the queue-claim result it implies (claimed/empty/error).
        // The executor emits the finer processor/scan/terminal metrics for a claim.
        metrics(tickMetric(mode, tick.outcome));
        metrics(claimMetric(claimResultForOutcome(tick.outcome)));
      }
    };

    const finish = (reason: DaemonStopReason): DaemonRunSummary => {
      summary.reason = reason;
      log({ event: "stop", mode, tick: summary.ticks, reason });
      if (metrics) metrics(runMetric(mode, reason));
      return summary;
    };

    log({ event: "start", mode });
    // An initial beat announces liveness the moment a run begins, before the first
    // claim — so even a `once`/`drain` that finds an idle queue still reports a live
    // worker. Subsequent beats happen per iteration below (self-throttled).
    await beat();
    // The probe on the same schedule, for the same reason one line up: a worker
    // that has claimed nothing yet is still a worker whose bucket the reading
    // tier must be able to see.
    await probeSpend();

    if (mode === "once") {
      if (shouldStop()) return finish("stopped");
      record(await safeTick());
      return finish("once");
    }

    for (;;) {
      if (shouldStop()) return finish("stopped");
      if (cap !== undefined && summary.ticks >= cap) return finish("max_ticks");
      await beat();
      await probeSpend();

      const tick = await safeTick();
      record(tick);

      if (tick.outcome === "idle" || tick.outcome === "error") {
        if (mode === "drain") {
          return finish(tick.outcome === "idle" ? "drained" : "queue_error");
        }
        // `loop`: an idle or transiently-erroring queue is a reason to back off,
        // not to exit — a long-running worker survives broker blips.
        consecutiveIdle += 1;
        const sleepMs = idleBackoffMs(
          idleSleepMs,
          maxIdleSleepMs,
          consecutiveIdle,
        );
        log({ event: "sleep", mode, sleepMs });
        await sleep(sleepMs);
      } else {
        // Work arrived: drop back to the fast cadence, because more is likely.
        consecutiveIdle = 0;
      }
      // A productive outcome (completed/failed/requeued/canceled) loops straight
      // into the next claim with no sleep, so a busy queue drains at full speed.
    }
  }

  return { run };
}
