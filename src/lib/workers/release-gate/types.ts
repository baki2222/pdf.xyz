/**
 * The bounded, content-free vocabulary for the secure-worker **release readiness gate** (Phase 46).
 *
 * Phases 30–45 gave an operator a family of content-free, offline signals about the secure worker:
 * the deployment-example validator (`pnpm deploy:examples:check`), the no-config honesty smoke and
 * native-engine preflight (`pnpm worker:smoke` / `pnpm worker:engines`), the operations
 * snapshot/healthcheck (`pnpm worker:ops-check`), the one-command cleanup evidence pipeline
 * (`pnpm worker:cleanup-pipeline`), the operations evidence bundle (`pnpm worker:ops-bundle`), and
 * the offline lifecycle policy/verify commands. Each already exits with a stable, documented code.
 * This phase closes the *promotion* loop: it RUNS those already-safe checks as subprocesses,
 * captures ONLY each one's bounded exit code (never its raw output), and folds them into ONE local,
 * offline PASS/WARN/FAIL release-readiness report that answers a single question —
 *
 *    "From the evidence available on this build/host, is the worker stack ready to promote?"
 *
 * — and fails closed when it cannot honestly say yes.
 *
 * This module is the closed vocabulary the gate produces. It obeys the same honesty contract as the
 * rest of the worker layer, and is in fact structurally MORE content-free than the tools it
 * composes: it never parses a subprocess's stdout/stderr at all — it reads only the process exit
 * code (a small integer) and discards every byte of output — so there is no path for a locator,
 * secret, or document byte to enter a report.
 *  - Every load-bearing token here is a low-cardinality, redaction-stable enum — never a filename,
 *    object key, bucket, URL, endpoint, region, id, token, size, instant, path, byte, or a raw
 *    command line. The fixture paths each check runs over live in the internal check catalog
 *    ({@link ReleaseCheckSpec} in `./checks`) and are NEVER serialized into a report.
 *  - It never fabricates readiness: a check that cannot be run to a verdict (a spawn failure, a
 *    timeout, an unexpected crash) is honestly `unknown` (which blocks a `pass`), never a false
 *    `pass`; a run with no checks included is `unknown`, never `pass`.
 *
 * It is deliberately NOT a new evidence rung and NOT a cloud action. The gate proves nothing the
 * composed checks do not already prove; it RUNS and EVALUATES existing content-free checks for a
 * promotion decision. Its authored caveats (see {@link RELEASE_GATE_CAVEATS}) say so out loud: it is
 * a pre-deploy EVIDENCE gate — not deletion proof, not malware scanning, not live cloud validation,
 * not bucket lifecycle correctness, and not the promotion itself.
 */

/** The schema tag every release-gate report carries, so tooling can pin the shape it parses. */
export const RELEASE_GATE_SCHEMA = "pdfxyz.worker-release-gate/1" as const;

/** Stable identity of the release-gate policy — for docs / receipts / audit. */
export const RELEASE_GATE_POLICY_ID = "pdfxyz-worker-release-readiness-gate";
/** Bump when the report schema, the check set, or the rollup semantics change. */
export const RELEASE_GATE_POLICY_VERSION = 1;

/**
 * The single readiness verdict an operator/CI keys on — a promotion decision, not an ops severity:
 *  - `pass`    — every included check passed; ready to promote from the evidence here;
 *  - `warn`    — no check failed or was indeterminate, but an advisory check flagged a concern;
 *  - `fail`    — a blocking check failed (it ran and did not meet its expected contract);
 *  - `unknown` — a check could not be run to a verdict, or NO check was included; the gate cannot
 *                say `pass` and will not certify a promotion it could not verify.
 *
 * These are the exact bounded values the run-level {@link WorkerMetricName} `worker_release_gate_total`
 * carries as its `verdict` label; all four are low-cardinality, redaction-stable tokens.
 */
export const RELEASE_GATE_VERDICTS = [
  "pass",
  "warn",
  "fail",
  "unknown",
] as const;
export type ReleaseGateVerdict = (typeof RELEASE_GATE_VERDICTS)[number];

/**
 * The exit-code ladder a scheduler/CI job routes on — the union of the composed tools' ladders, so
 * a promotion gate speaks the same language as `worker:ops-check` / `worker:ops-bundle`:
 *  - `0` PASS    — promote-able from the evidence here;
 *  - `1` USAGE   — the gate CLI was misused (a bad flag / unknown scope id); fail closed. This band
 *                  is owned entirely by the CLI entry — a gate RUN never resolves to it;
 *  - `2` UNKNOWN — a check was indeterminate, no check was included, or an internal fault occurred;
 *  - `3` WARN    — an advisory check flagged a concern;
 *  - `4` FAIL    — a blocking check failed.
 * Monotonic — a higher code is always a stronger "do not promote".
 */
export const RELEASE_GATE_EXIT = {
  PASS: 0,
  USAGE: 1,
  UNKNOWN: 2,
  WARN: 3,
  FAIL: 4,
} as const;
export type ReleaseGateExitCode =
  (typeof RELEASE_GATE_EXIT)[keyof typeof RELEASE_GATE_EXIT];

/**
 * The per-check status the gate records for each composed check:
 *  - `pass`    — the check ran and its exit code matched the expected contract;
 *  - `warn`    — the check ran, its exit code did NOT match, and the check is advisory (a mismatch
 *                is a concern to note, not a hard blocker — e.g. an engine preflight whose host may
 *                differ from the deployed worker image);
 *  - `fail`    — the check ran, its exit code did NOT match, and the check is blocking;
 *  - `unknown` — the check could not be run to a verdict (a spawn failure, a timeout, or a crash);
 *  - `skip`    — the check was deliberately excluded by a scope flag (`--skip` / `--only`).
 */
export const RELEASE_CHECK_STATUSES = [
  "pass",
  "warn",
  "fail",
  "unknown",
  "skip",
] as const;
export type ReleaseCheckStatus = (typeof RELEASE_CHECK_STATUSES)[number];

/**
 * How a check escalates a mismatch — its blocking level. `fail` checks prove a load-bearing
 * contract (a mismatch blocks promotion); `warn` checks are advisory (a mismatch is a concern to
 * note, never a hard block).
 */
export const RELEASE_CHECK_SEVERITIES = ["fail", "warn"] as const;
export type ReleaseCheckSeverity = (typeof RELEASE_CHECK_SEVERITIES)[number];

/**
 * The bounded ids of the checks the gate can run — the stable keys a reader routes on (e.g. to list
 * the blockers that drove a `fail`, or to pass to `--skip`/`--only`). Never a path, a raw command
 * line, or a free-text label. Kept in sync with the catalog in `./checks` by a test.
 */
export const RELEASE_CHECK_IDS = [
  "deploy-examples",
  "worker-smoke",
  "worker-engines",
  "ops-check-healthy",
  "ops-check-critical",
  "ops-bundle-healthy",
  "ops-bundle-critical",
  "cleanup-pipeline-unknown",
  "cleanup-pipeline-breach",
  "lifecycle-verify",
  "lifecycle-drift",
] as const;
export type ReleaseCheckId = (typeof RELEASE_CHECK_IDS)[number];

/** True when `value` is a recognized bounded check id (for validating `--skip`/`--only`). */
export function isReleaseCheckId(value: unknown): value is ReleaseCheckId {
  return (
    typeof value === "string" &&
    (RELEASE_CHECK_IDS as readonly string[]).includes(value)
  );
}

/**
 * The bounded outcome of one composed check. It carries ONLY content-free values: the check's
 * bounded id, its resolved status, its blocking severity, the two small exit-code integers
 * (`expectedExit` — authored; `observedExit` — the process's actual code, or `null` if it never
 * exited), and the app-authored one-line `summary` + `remediation`. It NEVER carries the check's
 * command line, its arguments/fixture paths, or a single byte of its stdout/stderr.
 */
export interface ReleaseCheckOutcome {
  readonly id: ReleaseCheckId;
  readonly status: ReleaseCheckStatus;
  readonly severity: ReleaseCheckSeverity;
  /** The exit code this check must return to pass (authored in the catalog). */
  readonly expectedExit: number;
  /** The exit code the process actually returned, or `null` if it was killed / never exited. */
  readonly observedExit: number | null;
  /** A one-line, content-free headline authored from the check id + resolved status. */
  readonly summary: string;
  /** Content-free, app-authored next-step text — never derived from the check's output. */
  readonly remediation: string;
}

/** The composite rollup — the single verdict + exit code an operator/scheduler acts on. */
export interface ReleaseGateRollup {
  readonly verdict: ReleaseGateVerdict;
  readonly exitCode: ReleaseGateExitCode;
  /** True iff `verdict === "pass"`. */
  readonly ready: boolean;
  /** The worst per-check status that drove the verdict (`pass` when nothing was worse). */
  readonly worst: ReleaseCheckStatus;
  /** The bounded ids of the checks that did not pass and were not skipped (what to fix). */
  readonly blockers: readonly ReleaseCheckId[];
  /** How many checks actually ran (were not skipped). */
  readonly includedChecks: number;
  /** How many included checks passed. */
  readonly passedChecks: number;
  /** How many checks were skipped by a scope flag. */
  readonly skippedChecks: number;
  readonly detail: string;
}

/**
 * The content-free audit receipt one gate run rides alongside its report — the answer to "what did
 * this promotion gate resolve to, over how many checks" for a SIEM. Bounded enums + small integers
 * + a stable policy id only; safe to log or forward verbatim.
 */
export interface ReleaseGateReceipt {
  readonly category: "worker-release-gate";
  readonly policyId: typeof RELEASE_GATE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_GATE_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseGateVerdict;
  readonly exitCode: ReleaseGateExitCode;
  /** How many checks ran (were not skipped). */
  readonly includedChecks: number;
  /** How many included checks passed. */
  readonly passedChecks: number;
}

/** The stable, content-free release gate report an operator runs before promoting a worker build. */
export interface ReleaseGateResult {
  readonly schema: typeof RELEASE_GATE_SCHEMA;
  readonly policyId: typeof RELEASE_GATE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_GATE_POLICY_VERSION;
  readonly generatedAt: string;
  readonly rollup: ReleaseGateRollup;
  /** One bounded outcome per check in the catalog (skipped checks included, marked `skip`). */
  readonly checks: readonly ReleaseCheckOutcome[];
  readonly receipt: ReleaseGateReceipt;
  /** Bounded, app-authored operator reminders (out-of-scope steps this gate does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any check's output. */
  readonly caveats: readonly string[];
}

/** The process exit code for a gate result. */
export function releaseGateExitCode(result: ReleaseGateResult): number {
  return result.rollup.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from a check's output)
 * ------------------------------------------------------------------ */

/** The one-line rollup headline per verdict. Authored here, keyed by the enum. */
export const RELEASE_GATE_VERDICT_SUMMARY: Record<ReleaseGateVerdict, string> =
  {
    pass: "READY to promote: every included release-readiness check passed on this build/host.",
    warn: "READY with a caveat: no check failed, but an advisory check flagged a concern to review before promoting.",
    fail: "NOT READY to promote: a blocking release-readiness check failed. Resolve it before promoting.",
    unknown:
      "READINESS UNKNOWN: a check could not be run to a verdict, or no check was included. The gate will not certify a promotion it could not verify.",
  };

/**
 * The honesty caveats every report carries and every text render prints. The gate RUNS existing
 * content-free checks and folds their exit codes for a promotion decision; it must never be read as
 * more than that.
 */
export const RELEASE_GATE_CAVEATS: readonly string[] = [
  "This is a PRE-DEPLOY EVIDENCE gate: it RUNS existing content-free worker checks and folds their exit codes into one promotion verdict. It is not itself a new proof, and it does not perform the promotion.",
  "It is local, offline, and read-only: it makes no network call and reads no provider export, secret, bucket, or object. It cannot validate real cloud state, bucket lifecycle correctness, deletion of bytes, or CDN state.",
  "It reads only each check's process exit code and discards every byte of the check's output, so no locator, secret, or document content can enter a report — but that also means a report proves only what an exit code proves.",
  "A `pass` verdict means the evidence gathered HERE shows no blocker — not that every out-of-band concern (real load, data migration, legal retention, provider quotas, secrets management) is resolved. Those remain operator-owned.",
  "It is not malware scanning, sanitization, authentication, or authorization of any request, and it deletes, uploads, or mutates nothing.",
];

/**
 * Operator reminders the gate carries but does NOT itself perform — the honest edges of an offline
 * exit-code gate. Authored, bounded, content-free; never derived from a check.
 */
export const RELEASE_GATE_GUIDANCE: readonly string[] = [
  "Run the changed-file no-secret / no-NUL scan separately before promoting: this gate does not diff your working tree for credential-shaped literals or stray NUL bytes (the committed deployment blueprints are secret-scanned by the deploy-examples check, but your uncommitted changes are not).",
  "Validate real cloud state out of band: bucket lifecycle rules, object deletion, queue/broker health, and CDN state are not observable from this offline gate.",
  "Run this gate on the same build artifact you intend to promote; a `pass` certifies the evidence on THIS build/host, not a later rebuild.",
];
