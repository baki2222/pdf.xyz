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
 *  - It fails fast with exit `4` when the deployment configuration is dangerous or
 *    invalid (a guardrail violation), before claiming any work.
 *  - It logs only content-free structured JSON: run mode, tick counters, opaque
 *    job ids, attempts, error *codes*, presence-only readiness, and typed guardrail
 *    codes/messages — never a filename, byte, object key, URL, option value,
 *    environment-variable name, or secret. Provider config values are never read
 *    here.
 *
 * Run it in worker infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:daemon --drain             # process the backlog once and exit
 *   pnpm worker:daemon --once              # smoke-test a single job
 *   pnpm worker:daemon --dry-run-status    # report readiness + posture, claim nothing
 *   pnpm worker:daemon --check             # evaluate deployment guardrails, claim nothing
 *   pnpm worker:daemon --lifecycle-policy --provider=aws-s3   # print a lifecycle policy
 *   pnpm worker:daemon                     # long-running: drain, then poll
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
import type { GuardrailReport } from "@/lib/workers/deploy";
import {
  buildLifecyclePolicy,
  parseRetentionSettings,
  renderLifecyclePolicy,
  resolveLifecycleReadiness,
  validateLifecyclePolicy,
} from "@/lib/workers/lifecycle";

/** Exit codes — mirrored in {@link DAEMON_USAGE}. */
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_NOT_CONFIGURED = 2;
const EXIT_RUNTIME_ERROR = 3;
const EXIT_GUARDRAIL = 4;

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
  // The malware-scan gate's presence-only capability: `active: true` only when a
  // real scanner (ClamAV) is configured with a usable endpoint, else the honest
  // no-op (`active: false`), distinguishing `disabled` / `not-configured` /
  // `unavailable`. Content-free — no variable name, endpoint, host, port, or value.
  emit({ src: "daemon", event: "scanner_health", ...runtime.scanner });
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

/**
 * Report the composed, presence-only deployment readiness (Phase 19): the overall
 * posture plus every facet (storage, queue, engine, lifecycle backstop, and the
 * honest not-implemented malware-scan/OCR facets). Content-free — no variable name,
 * value, path, object key, or signed URL — so it is safe to ship to any log sink.
 */
function reportDeployment(runtime: WorkerRuntime): void {
  const d = runtime.deployment;
  emit({
    src: "daemon",
    event: "deployment_readiness",
    posture: d.posture,
    drainable: d.drainable,
    detail: d.detail,
  });
  for (const facet of d.facets) {
    emit({
      src: "daemon",
      event: "facet",
      id: facet.id,
      state: facet.state,
      detail: facet.detail,
    });
  }
}

/**
 * Report the production guardrail result. Emits a summary plus one line per
 * violation — the typed `code`, `severity`, and content-free `message` only. The
 * offending variable *names* (`violation.fields`) are deliberately NOT printed, so
 * the daemon's entire output stays free of environment-variable names and values.
 */
function reportGuardrails(report: GuardrailReport): void {
  const errors = report.violations.filter((v) => v.severity === "error").length;
  emit({
    src: "daemon",
    event: "guardrails",
    ok: report.ok,
    strict: report.strict,
    errors,
    warnings: report.violations.length - errors,
  });
  for (const v of report.violations) {
    emit({
      src: "daemon",
      event: "guardrail",
      code: v.code,
      severity: v.severity,
      message: v.message,
    });
  }
}

/**
 * `--lifecycle-policy`: generate and print a lifecycle/retention policy for the
 * configured retention settings and exit. Pure generation — it never contacts a
 * cloud API, builds a runtime, or probes the host. Refuses (exit 1) when a retention
 * override is malformed rather than silently generating from defaults. The rendered
 * document is content-free (structural prefixes + day counts only) and names no
 * bucket, endpoint, or credential.
 */
function runLifecyclePolicy(args: DaemonArgs): number {
  const parsed = parseRetentionSettings(process.env);
  if (!parsed.ok) {
    // Content-free: the reason, never the offending value. Server-side field-level
    // diagnostics remain available via `parseRetentionSettings`.
    emit({
      src: "daemon",
      event: "lifecycle_policy_error",
      reason: "retention_invalid",
    });
    return EXIT_USAGE;
  }

  // Provider/versioned default to any operator declaration in the environment, so
  // `--lifecycle-policy` alone honors `PDFXYZ_LIFECYCLE_*`; explicit flags win.
  const declared = resolveLifecycleReadiness(process.env);
  const provider = args.lifecycleProvider ?? declared.provider ?? "generic";
  const versioned = args.versioned ?? declared.versioned ?? false;

  const policy = buildLifecyclePolicy(parsed.config, {
    ...(args.keyPrefix !== undefined ? { keyPrefix: args.keyPrefix } : {}),
    versioned,
  });
  const validation = validateLifecyclePolicy(policy);
  if (!validation.ok) {
    emit({
      src: "daemon",
      event: "lifecycle_policy_error",
      reason: "policy_invalid",
    });
    return EXIT_USAGE;
  }

  const rendered = renderLifecyclePolicy(policy, provider);
  emit({
    src: "daemon",
    event: "lifecycle_policy",
    provider: rendered.provider,
    versioned,
    filename: rendered.filename,
    applyHint: rendered.applyHint,
    derivedFrom: policy.derivedFrom,
    ruleCount: policy.rules.length,
    notes: rendered.notes,
    document: rendered.document,
  });
  return EXIT_OK;
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

  // `--lifecycle-policy`: pure, offline generation. Handled before building the
  // runtime so it never probes the host or touches a provider.
  if (args.mode === "lifecycle-policy") {
    return runLifecyclePolicy(args);
  }

  const runtime = resolveWorkerRuntime(process.env, {
    ...(args.leaseMs !== undefined ? { leaseMs: args.leaseMs } : {}),
    log: (event: ExecutorLogEvent) => emit({ src: "executor", ...event }),
  });

  // `--check`: evaluate deployment guardrails only. Exit 0 when clean, 4 when a
  // dangerous/invalid configuration is found. Never claims a job.
  if (args.mode === "check") {
    reportReadiness(runtime);
    reportDeployment(runtime);
    reportGuardrails(runtime.guardrails);
    return runtime.guardrails.ok ? EXIT_OK : EXIT_GUARDRAIL;
  }

  // `--dry-run-status`: report readiness + deployment posture + guardrail summary
  // and exit. A guardrail error fails fast (4); otherwise the exit code doubles as
  // a smoke signal — 0 when a worker could drain here, 2 when it could not.
  if (args.mode === "dry-run-status") {
    reportReadiness(runtime);
    reportDeployment(runtime);
    reportGuardrails(runtime.guardrails);
    if (!runtime.guardrails.ok) return EXIT_GUARDRAIL;
    return runtime.readiness.drainable ? EXIT_OK : EXIT_NOT_CONFIGURED;
  }

  reportReadiness(runtime);
  reportDeployment(runtime);

  // Fail fast before claiming anything: a dangerous or invalid deployment
  // configuration is a guardrail error, not something to run through.
  if (!runtime.guardrails.ok) {
    reportGuardrails(runtime.guardrails);
    emit({ src: "daemon", event: "guardrail_blocked" });
    return EXIT_GUARDRAIL;
  }

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
