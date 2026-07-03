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
 *   pnpm worker:daemon --lifecycle-verify --observed=cfg.json # verify it vs an exported config
 *   pnpm worker:daemon                     # long-running: drain, then poll
 */

import {
  createWorkerDaemon,
  parseDaemonArgs,
  DAEMON_USAGE,
  type DaemonArgs,
  type DaemonLogEvent,
  type DaemonMode,
  type DaemonRunSummary,
} from "@/lib/workers/daemon";
import {
  coarseRelease,
  createHeartbeatPublisher,
  type HeartbeatMode,
  type HeartbeatPublisher,
} from "@/lib/workers/heartbeat";
import { queueSupportsAtomicTransitions } from "@/lib/workers/queue/redis-config";
import {
  collectRuntimeOperationsSnapshot,
  createWorkerMetricsCollector,
  deriveLifecycleMetrics,
  deriveRuntimeMetrics,
  evaluateSlos,
  type LifecycleMetricVerdict,
  type WorkerMetricsCollector,
} from "@/lib/workers/observability";
import type { ExecutorLogEvent } from "@/lib/workers/executor";
import {
  resolveWorkerRuntime,
  type WorkerRuntime,
} from "@/lib/workers/daemon/runtime";
import type { GuardrailReport } from "@/lib/workers/deploy";
import {
  buildLifecyclePolicy,
  parseObservedLifecycle,
  parseRetentionSettings,
  renderLifecyclePolicy,
  resolveLifecycleReadiness,
  validateLifecyclePolicy,
  verifyLifecyclePolicy,
} from "@/lib/workers/lifecycle";
import { readFileSync, statSync } from "node:fs";

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

/** Map a run mode to the coarse heartbeat mode it publishes. */
function heartbeatModeFor(mode: DaemonMode): HeartbeatMode {
  switch (mode) {
    case "loop":
      return "loop";
    case "drain":
      return "drain";
    case "once":
      return "once";
    case "check":
      return "check";
    case "dry-run-status":
      return "dry-run";
    default:
      // lifecycle-policy/lifecycle-verify are handled before a runtime is built, so
      // they never publish a heartbeat; this fallback is unreachable in practice.
      return "starting";
  }
}

/**
 * Build the liveness heartbeat publisher (Phase 30) from the resolved runtime. It is
 * a disabled no-op unless `PDFXYZ_WORKER_HEARTBEAT` is enabled AND a compatible
 * broker is configured, so it publishes nothing in a no-config or backend-less
 * environment. The capability summary it beats is derived from the SAME probed
 * runtime health the readiness readout uses, so the two can never disagree. Every
 * field is a bounded enum/boolean — never a host, path, key, or value.
 */
function buildHeartbeatPublisher(runtime: WorkerRuntime, mode: DaemonMode): HeartbeatPublisher {
  const release = coarseRelease(process.env.npm_package_version);
  return createHeartbeatPublisher(process.env, {
    mode: heartbeatModeFor(mode),
    capabilities: {
      deepCompression: runtime.compression.deep,
      ocr: runtime.ocr.ready,
      malwareScan: runtime.scanner.active,
      atomicQueue: queueSupportsAtomicTransitions(process.env),
    },
    ...(release !== undefined ? { release } : {}),
  });
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
  // The OCR backend's presence-only health (Phase 23): `enabled` (opted into via
  // config) fused with `ready` (a real engine is installed here), so an operator can
  // tell `disabled`/`not-configured` from `unavailable` (opted in, engine missing)
  // from `ready`. Content-free — engine *family* name + prose only, never a path,
  // binary, language, variable name, or value.
  emit({ src: "daemon", event: "ocr_health", ...runtime.ocr });
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
 * Emit the Phase 28 observability lines for a resolved runtime: the composed
 * operations snapshot (overall health + the one recommended action), the aggregated
 * content-free metric series, and the SLO evaluation. All three are content-free —
 * bounded enums, coarse buckets, small counts, and generic prose only. Called once
 * per invocation after the work (or the readiness readout) completes.
 */
function reportObservability(
  metrics: WorkerMetricsCollector,
  runtime: WorkerRuntime,
  extras: { lastLoop?: DaemonRunSummary } = {},
): void {
  emit({
    src: "daemon",
    event: "operations",
    ...collectRuntimeOperationsSnapshot(runtime, extras),
  });
  // Fold the resolved readiness posture (facets + engine/gate capabilities) into the
  // collector just before snapshotting, so even a readiness-only run reports content-free
  // gauges. Idempotent: these are gauges (last-write-wins), so a repeat call is a no-op.
  for (const sample of deriveRuntimeMetrics(runtime)) metrics.record(sample);
  const snapshot = metrics.snapshot();
  emit({ src: "daemon", event: "metrics", series: snapshot.series });
  const slo = evaluateSlos(snapshot);
  emit({ src: "daemon", event: "slo", worst: slo.worst, slos: slo.slos });
}

/**
 * Emit the content-free lifecycle metric series for a `--lifecycle-verify` verdict.
 * Self-contained (its own collector), so it needs no runtime — the verify command is
 * pure/offline and never builds one. `driftedRules` is a bounded count of the app's
 * OWN `pdfxyz-*` rules, never an observed rule id or value.
 */
function emitLifecycleMetrics(
  verdict: LifecycleMetricVerdict,
  driftedRules = 0,
): void {
  const collector = createWorkerMetricsCollector();
  for (const sample of deriveLifecycleMetrics({ verdict, driftedRules })) {
    collector.record(sample);
  }
  emit({ src: "daemon", event: "metrics", series: collector.snapshot().series });
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

/** Hard cap on the observed document a `--lifecycle-verify` read will accept. */
const MAX_OBSERVED_FILE_BYTES = 1_048_576; // 1 MiB — a lifecycle config is tiny.

/**
 * `--lifecycle-verify`: verify the policy the app WOULD generate against an observed
 * lifecycle configuration the operator exported out-of-band (e.g. via
 * `aws s3api get-bucket-lifecycle-configuration`). Pure and offline — it NEVER calls a
 * cloud API or builds a runtime; the operator does the privileged read themselves and
 * hands this a content-free document. Honest states:
 *  - no `--observed`  → nothing to verify against → `unknown` (exit 2, not-configured);
 *  - verified         → every generated backstop is enforced ≥ as strongly (exit 0);
 *  - drift / malformed → the backstop does not hold, or the document is unreadable/bad
 *    (exit 4, invalid).
 * Output is content-free: our own `pdfxyz-*` rule ids, status/action enums, counts,
 * and prose — never the observed document's ids, prefixes, values, or the file path.
 */
function runLifecycleVerify(args: DaemonArgs): number {
  const parsed = parseRetentionSettings(process.env);
  if (!parsed.ok) {
    emit({ src: "daemon", event: "lifecycle_verify_error", reason: "retention_invalid" });
    return EXIT_USAGE;
  }

  const declared = resolveLifecycleReadiness(process.env);
  const provider = args.lifecycleProvider ?? declared.provider ?? "generic";
  const versioned = args.versioned ?? declared.versioned ?? false;

  const expected = buildLifecyclePolicy(parsed.config, {
    ...(args.keyPrefix !== undefined ? { keyPrefix: args.keyPrefix } : {}),
    versioned,
  });
  if (!validateLifecyclePolicy(expected).ok) {
    emit({ src: "daemon", event: "lifecycle_verify_error", reason: "policy_invalid" });
    return EXIT_USAGE;
  }

  // No observed document ⇒ there is nothing to verify against. The app never reads
  // the bucket itself, so this is an honest `unknown`, never a pass. We still surface
  // the operator's own env-declared readiness so `validated` (a bare assertion) can be
  // told apart from `verified` (checked evidence).
  if (args.observedPath === undefined) {
    emit({
      src: "daemon",
      event: "lifecycle_verify",
      configured: false,
      verdict: "unknown",
      provider,
      versioned,
      declaredReadiness: declared.state,
      detail:
        "No observed lifecycle document was supplied, so the generated backstop could not be checked against the bucket. Export it out-of-band (the app never reads the bucket) and pass --observed. The operator's env-declared readiness is reported as declaredReadiness.",
    });
    emitLifecycleMetrics("unknown");
    return EXIT_NOT_CONFIGURED;
  }

  // Read the operator's exported document defensively: bound the size before reading,
  // and on ANY read failure emit a fixed, content-free reason — never the OS error or
  // the path, which could carry a filename.
  let text: string;
  try {
    if (statSync(args.observedPath).size > MAX_OBSERVED_FILE_BYTES) {
      emit({ src: "daemon", event: "lifecycle_verify_error", reason: "observed_too_large" });
      return EXIT_GUARDRAIL;
    }
    text = readFileSync(args.observedPath, "utf8");
  } catch {
    emit({ src: "daemon", event: "lifecycle_verify_error", reason: "observed_unreadable" });
    return EXIT_GUARDRAIL;
  }

  const observed = parseObservedLifecycle(text);
  if (!observed.ok) {
    // Content-free: the parse issue codes, never the document contents.
    emit({
      src: "daemon",
      event: "lifecycle_verify_error",
      reason: "observed_malformed",
      issues: observed.issues.map((i) => i.code),
    });
    emitLifecycleMetrics("malformed");
    return EXIT_GUARDRAIL;
  }

  const result = verifyLifecyclePolicy(expected, observed.observed);
  // A content-free lifecycle metric: the verdict plus the count of the app's OWN rules
  // found drifted (missing/weaker/disabled) — never an observed rule id, prefix, or value.
  emitLifecycleMetrics(
    result.verdict,
    result.checks.filter(
      (c) =>
        c.status === "missing" || c.status === "weaker" || c.status === "disabled",
    ).length,
  );
  // Versioned foot-gun safety net: verifying without `--versioned` omits the
  // noncurrent-version and delete-marker backstops from the expected policy, so they
  // go unchecked. If the observed config itself carries version-cleanup rules, the
  // bucket is almost certainly versioned — surface a content-free advisory (it does
  // NOT change the verdict) so a `verified` here can't hide unchecked version rules.
  const versionedRulesUnchecked =
    !versioned &&
    observed.observed.rules.some(
      (r) =>
        r.noncurrentVersionExpireAfterDays !== undefined ||
        r.expiredObjectDeleteMarker === true,
    );
  emit({
    src: "daemon",
    event: "lifecycle_verify",
    configured: true,
    verdict: result.verdict,
    provider,
    versioned,
    declaredReadiness: declared.state,
    checks: result.checks,
    plan: result.plan.filter((p) => p.action !== "none"),
    unmatchedObservedRules: result.unmatchedObservedRules,
    summary: result.summary,
    ...(versionedRulesUnchecked
      ? {
          note: "The observed config has version-cleanup rules, but --versioned was not set, so noncurrent-version and delete-marker backstops were not checked. Re-run with --versioned on a versioning-enabled bucket.",
        }
      : {}),
  });
  // Verified ⇒ 0; drift ⇒ 4 (the backstop does not actually hold — an invalid state).
  return result.verdict === "verified" ? EXIT_OK : EXIT_GUARDRAIL;
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

  // `--lifecycle-verify`: pure, offline comparison of the generated policy against an
  // operator-exported observed document. Handled before the runtime so it never probes
  // the host, touches a provider, or calls a cloud API.
  if (args.mode === "lifecycle-verify") {
    return runLifecycleVerify(args);
  }

  // The content-free metrics collector for this invocation. It is the sink the runtime
  // (→ executor storage/scan/processor/terminal) and the daemon loop (→ tick/claim/run)
  // emit into; `--dry-run-status`/`--check` still report the readiness gauges + SLOs.
  const metrics = createWorkerMetricsCollector();
  const runtime = resolveWorkerRuntime(process.env, {
    ...(args.leaseMs !== undefined ? { leaseMs: args.leaseMs } : {}),
    log: (event: ExecutorLogEvent) => emit({ src: "executor", ...event }),
    metrics: metrics.sink,
  });
  // `reportObservability` folds the readiness gauges into the collector just before it
  // snapshots (in every mode that emits), so there is no separate recording step here.

  // The liveness heartbeat publisher (Phase 30): a disabled no-op unless explicitly
  // enabled AND a compatible broker is configured. Its capability is content-free, so
  // it is safe to log verbatim; a beat is published in the readiness modes below and,
  // for a run, once at start and per iteration by the daemon loop.
  const heartbeat = buildHeartbeatPublisher(runtime, args.mode);
  emit({ src: "daemon", event: "heartbeat_capability", ...heartbeat.capability });

  // `--check`: evaluate deployment guardrails only. Exit 0 when clean, 4 when a
  // dangerous/invalid configuration is found. Never claims a job.
  if (args.mode === "check") {
    reportReadiness(runtime);
    reportDeployment(runtime);
    reportGuardrails(runtime.guardrails);
    reportObservability(metrics, runtime);
    // A readiness beat (mode: check) — a no-op unless liveness is enabled + configured.
    emit({ src: "daemon", event: "heartbeat", ...(await heartbeat.beat()) });
    return runtime.guardrails.ok ? EXIT_OK : EXIT_GUARDRAIL;
  }

  // `--dry-run-status`: report readiness + deployment posture + guardrail summary
  // and exit. A guardrail error fails fast (4); otherwise the exit code doubles as
  // a smoke signal — 0 when a worker could drain here, 2 when it could not.
  if (args.mode === "dry-run-status") {
    reportReadiness(runtime);
    reportDeployment(runtime);
    reportGuardrails(runtime.guardrails);
    reportObservability(metrics, runtime);
    // A readiness beat (mode: dry-run) — a no-op unless liveness is enabled + configured.
    emit({ src: "daemon", event: "heartbeat", ...(await heartbeat.beat()) });
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
    reportObservability(metrics, runtime);
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
    reportObservability(metrics, runtime);
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
    metrics: metrics.sink,
    // Publish liveness once at start and per poll iteration; the publisher self-
    // throttles to the configured cadence and swallows outages, so this never
    // disrupts draining. A disabled publisher makes this a cheap no-op.
    heartbeat: async () => {
      await heartbeat.beat();
    },
  });

  const summary = await daemon.run({
    mode: args.mode,
    ...(args.maxTicks !== undefined ? { maxTicks: args.maxTicks } : {}),
    idleSleepMs: args.idleSleepMs,
  });
  emit({ src: "daemon", event: "summary", ...summary });
  // The Phase 28 observability readout: the composed operations snapshot (with this
  // run's loop outcome), the aggregated content-free metric series, and the SLO
  // evaluation over the work just processed.
  reportObservability(metrics, runtime, { lastLoop: summary });

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
