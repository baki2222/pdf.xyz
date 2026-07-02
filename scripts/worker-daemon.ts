/**
 * pdf.xyz secure-worker daemon — the out-of-band CLI entry point.
 *
 * This is the ONE place the worker foundation becomes a real process: it reads
 * `process.argv`/`process.env`, resolves the real providers via
 * {@link resolveWorkerRuntime}, and drives the {@link createWorkerDaemon} loop. It
 * is deliberately a thin shell over unit-tested modules — all the parsing, wiring,
 * and loop logic live under `src/lib/workers/daemon/` and are injectable, so this
 * file has no untested behavior of its own.
 *
 * It is NEVER imported by the web app (it lives outside `src/` and is invoked only
 * as `pnpm worker:daemon`), so importing the app never starts a background worker.
 *
 * Honesty & privacy:
 *  - It exits `2` when the environment is not configured to run (no drainable
 *    queue + storage) instead of pretending to process; it never fabricates a job.
 *  - It logs only content-free structured JSON: run mode, tick counters, opaque
 *    job ids, attempts, and error *codes* — never a filename, byte, object key,
 *    URL, option value, or secret. Provider config values are never read here.
 *
 * Run it in worker infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:daemon --drain        # process the backlog once and exit
 *   pnpm worker:daemon --once         # smoke-test a single job
 *   pnpm worker:daemon --dry-run-status   # report readiness only, claim nothing
 *   pnpm worker:daemon                # long-running: drain, then poll
 */

import {
  createWorkerDaemon,
  parseDaemonArgs,
  DAEMON_USAGE,
  type DaemonArgs,
  type DaemonLogEvent,
} from "@/lib/workers/daemon";
import type { ExecutorLogEvent } from "@/lib/workers/executor";
import {
  resolveWorkerRuntime,
  type WorkerRuntime,
} from "@/lib/workers/daemon/runtime";

/** Exit codes — mirrored in {@link DAEMON_USAGE}. */
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_NOT_CONFIGURED = 2;
const EXIT_RUNTIME_ERROR = 3;

/** Emit one content-free structured JSON line. Never receives a secret or bytes. */
function emit(line: Record<string, unknown>): void {
  // This CLI's stdout IS its structured log; console is the intended sink.
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`);
}

/** Report presence-only readiness + processor capabilities. Content-free. */
function reportReadiness(runtime: WorkerRuntime): void {
  emit({ src: "daemon", event: "readiness", ...runtime.readiness });
  // The compression-engine health is distinct from daemon drainability: a worker
  // can be drainable yet lossless-only. Surfacing `deep`/`engines` lets a deploy
  // smoke-check whether THIS image will actually do deep compression. Content-free
  // (booleans + engine binary names), so it ships to the log sink verbatim.
  emit({ src: "daemon", event: "compression_health", ...runtime.compression });
  for (const cap of runtime.processors) {
    emit({
      src: "daemon",
      event: "processor",
      id: cap.id,
      tools: cap.tools,
      ready: cap.ready,
      detail: cap.detail,
    });
  }
}

async function main(): Promise<number> {
  const parsed = parseDaemonArgs(process.argv.slice(2));
  if (!parsed.ok) {
    emit({ src: "daemon", event: "usage_error", message: parsed.message });
    process.stderr.write(`${DAEMON_USAGE}\n`);
    return EXIT_USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${DAEMON_USAGE}\n`);
    return EXIT_OK;
  }

  const args: DaemonArgs = parsed.args;
  const runtime = resolveWorkerRuntime(process.env, {
    ...(args.leaseMs !== undefined ? { leaseMs: args.leaseMs } : {}),
    log: (event: ExecutorLogEvent) => emit({ src: "executor", ...event }),
  });

  // `--dry-run-status`: report readiness and exit. Exit code doubles as a smoke
  // signal — 0 when a worker could drain here, 2 when it could not.
  if (args.mode === "dry-run-status") {
    reportReadiness(runtime);
    return runtime.readiness.drainable ? EXIT_OK : EXIT_NOT_CONFIGURED;
  }

  reportReadiness(runtime);

  if (!runtime.executor) {
    // Honest refusal: nothing is drainable/writable here, so we do NOT claim,
    // fabricate, or complete anything. The reason is content-free.
    emit({
      src: "daemon",
      event: "not_configured",
      reason: runtime.blocked ?? "not_configured",
    });
    return EXIT_NOT_CONFIGURED;
  }

  // Cooperative shutdown: the first SIGINT/SIGTERM lets the current tick finish
  // and the loop exit cleanly; a second forces an immediate stop.
  let stopping = false;
  const requestStop = (signal: string): void => {
    if (stopping) process.exit(130);
    stopping = true;
    emit({ src: "daemon", event: "shutdown", signal });
  };
  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));

  const daemon = createWorkerDaemon({
    executor: runtime.executor,
    log: (event: DaemonLogEvent) => emit({ src: "daemon", ...event }),
    shouldStop: () => stopping,
  });

  const summary = await daemon.run({
    mode: args.mode,
    ...(args.maxTicks !== undefined ? { maxTicks: args.maxTicks } : {}),
    idleSleepMs: args.idleSleepMs,
  });
  emit({ src: "daemon", event: "summary", ...summary });

  // A drain that stopped on a queue error is a runtime failure worth a non-zero
  // exit; every other clean stop (drained/once/max_ticks/stopped) is success.
  return summary.reason === "queue_error" ? EXIT_RUNTIME_ERROR : EXIT_OK;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log.
    emit({ src: "daemon", event: "crash" });
    process.exit(EXIT_RUNTIME_ERROR);
  });
