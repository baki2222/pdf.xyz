/**
 * The node-free **orchestrator** for the release readiness gate CLI (Phase 46).
 *
 * It is the whole of the CLI's behavior expressed over an injected seam, so the real Node entry
 * (`scripts/worker-release-gate.ts`) is a thin shell: it resolves argv and provides a `runCheck`
 * capability that actually spawns a subprocess. That keeps every branch — the per-check reduction,
 * the rollup, the receipt, and every output format — unit-testable without spawning a process.
 *
 * This module is where the gate's no-leak guarantee lives and is proven. The seam hands back a
 * {@link ProbeResult} that INCLUDES the check's raw stdout/stderr (so a hostile test can poison it),
 * and {@link reduceCheck} deliberately reads ONLY the process's exit code from it — never a byte of
 * output — when it builds the content-free {@link ReleaseCheckOutcome}. Output is discarded here, at
 * the trust boundary, so it can never reach a report. Honesty flows straight through: a check that
 * cannot be run (a spawn failure, a timeout, or a thrown seam) is `unknown` (which blocks a `pass`),
 * never a false `pass`.
 */

import { RELEASE_CHECKS, type ReleaseCheckSpec } from "./checks";
import { computeRollup } from "./rollup";
import { buildReceipt } from "./receipt";
import { recordReleaseGate } from "./metrics";
import { renderReleaseGate } from "./render";
import {
  RELEASE_GATE_CAVEATS,
  RELEASE_GATE_GUIDANCE,
  RELEASE_GATE_POLICY_ID,
  RELEASE_GATE_POLICY_VERSION,
  RELEASE_GATE_SCHEMA,
  releaseGateExitCode,
  type ReleaseCheckOutcome,
  type ReleaseCheckStatus,
  type ReleaseGateResult,
} from "./types";
import type { ReleaseGateArgs } from "./args";

/**
 * The raw result of running one check's subprocess, handed back by the seam. It carries the check's
 * stdout/stderr ON PURPOSE — so the no-leak tests can poison them — but {@link reduceCheck} reads
 * ONLY `exitCode` from it. Everything else is dropped at the boundary and never serialized.
 */
export interface ProbeResult {
  /** The process exit code, or `null` if it was killed by a signal / never exited. */
  readonly exitCode: number | null;
  /** Raw stdout — NEVER copied into an outcome. Present only so tests can prove it is dropped. */
  readonly stdout: string;
  /** Raw stderr — NEVER copied into an outcome. Present only so tests can prove it is dropped. */
  readonly stderr: string;
  /** True if the process exceeded its time budget (surfaced as an indeterminate `unknown`). */
  readonly timedOut: boolean;
  /** True if the process could not be spawned at all (surfaced as an indeterminate `unknown`). */
  readonly spawnError: boolean;
}

/** The capability the runner needs, injected by the Node entry (and faked in tests). */
export interface ReleaseGateProvider {
  /** Run one check's command and return its bounded probe result. Should not throw; if it does, the check is `unknown`. */
  runCheck(spec: ReleaseCheckSpec): Promise<ProbeResult>;
  /** Stamp the report (a wall clock, kept behind a seam so tests are deterministic). */
  now(): string;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ReleaseGateRun {
  readonly exitCode: number;
  readonly output: string;
  readonly outcome: ReleaseGateResult;
}

/**
 * Reduce one check's spec + raw probe result to a content-free {@link ReleaseCheckOutcome}. This is
 * the trust boundary: it reads `probe.exitCode` (a small integer) and NOTHING else from the probe —
 * the raw stdout/stderr are never touched — and authors `summary`/`remediation` from the spec's
 * app-owned prose, so no byte of subprocess output can reach the outcome.
 */
export function reduceCheck(
  spec: ReleaseCheckSpec,
  probe: ProbeResult,
): ReleaseCheckOutcome {
  const indeterminate =
    probe.spawnError || probe.timedOut || probe.exitCode === null;
  const observedExit = probe.exitCode;

  let status: ReleaseCheckStatus;
  if (indeterminate) {
    status = "unknown";
  } else if (observedExit === spec.expectedExit) {
    status = "pass";
  } else {
    status = spec.severity; // "fail" or "warn"
  }

  return {
    id: spec.id,
    status,
    severity: spec.severity,
    expectedExit: spec.expectedExit,
    // Keep the observed code only if it is a small, finite, non-negative integer; otherwise null.
    observedExit:
      typeof observedExit === "number" &&
      Number.isInteger(observedExit) &&
      observedExit >= 0 &&
      observedExit <= 255
        ? observedExit
        : null,
    summary: status === "pass" ? spec.passSummary : spec.remediation,
    remediation: spec.remediation,
  };
}

/** A skipped check's placeholder outcome — recorded so the report lists the full catalog. */
function skippedOutcome(spec: ReleaseCheckSpec): ReleaseCheckOutcome {
  return {
    id: spec.id,
    status: "skip",
    severity: spec.severity,
    expectedExit: spec.expectedExit,
    observedExit: null,
    summary:
      "Skipped by scope flag; not run and not counted toward the verdict.",
    remediation: spec.remediation,
  };
}

/** True iff `spec` should actually run under the args' scope (`--only` / `--skip`). */
function isIncluded(spec: ReleaseCheckSpec, args: ReleaseGateArgs): boolean {
  if (args.only && args.only.length > 0) return args.only.includes(spec.id);
  return !args.skip.includes(spec.id);
}

/**
 * Run the gate for validated `args` using the injected `provider`. Never throws on a check problem —
 * a spawn failure or a thrown seam becomes an `unknown` check; only a genuine internal fault in the
 * rollup/render (which are pure) could propagate, to be caught by the entry's top-level handler.
 *
 * Checks run SEQUENTIALLY: the composed commands each spin up a subprocess, and a promotion gate
 * favors a deterministic, resource-friendly run over a fast one.
 */
export async function runReleaseGate(
  args: ReleaseGateArgs,
  provider: ReleaseGateProvider,
): Promise<ReleaseGateRun> {
  const generatedAt = provider.now();

  const checks: ReleaseCheckOutcome[] = [];
  for (const spec of RELEASE_CHECKS) {
    if (!isIncluded(spec, args)) {
      checks.push(skippedOutcome(spec));
      continue;
    }
    let probe: ProbeResult;
    try {
      probe = await provider.runCheck(spec);
    } catch {
      // A thrown seam is an indeterminate check — we could not learn its exit code. Fail closed to
      // `unknown` (which blocks a `pass`); never echo the thrown error.
      probe = {
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        spawnError: true,
      };
    }
    checks.push(reduceCheck(spec, probe));
  }

  const rollup = computeRollup(checks);
  const outcome: ReleaseGateResult = {
    schema: RELEASE_GATE_SCHEMA,
    policyId: RELEASE_GATE_POLICY_ID,
    policyVersion: RELEASE_GATE_POLICY_VERSION,
    generatedAt,
    rollup,
    checks,
    receipt: buildReceipt(generatedAt, rollup),
    guidance: RELEASE_GATE_GUIDANCE,
    caveats: RELEASE_GATE_CAVEATS,
  };

  // A metrics sink must never break the CLI; swallow anything it throws.
  try {
    recordReleaseGate(rollup.verdict);
  } catch {
    /* ignore */
  }

  return {
    exitCode: releaseGateExitCode(outcome),
    output: renderReleaseGate(outcome, args.format, args.pretty),
    outcome,
  };
}
