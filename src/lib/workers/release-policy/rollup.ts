/**
 * Pure, node-free **rollup** for the release policy CLI (Phase 49).
 *
 * Folds the ingest tri-state ({@link IngestedIndex}) + the evaluated {@link ReleasePolicyViolation}s
 * into the ONE composite {@link ReleasePolicyVerdict} + exit code a CI/operator acts on. The ladder is
 * about POLICY ACCEPTABILITY — fail-closed on anything it cannot trust or evaluate:
 *
 *  - `fail` (worst) — a BLOCKING assertion was violated, OR the index is malformed / internally
 *    inconsistent (`index-invalid`) OR reports a tampered artifact (`index-tampered`). A tampered or
 *    unmeetable archive dominates: you cannot promote on evidence you cannot trust.
 *  - `unknown`      — the policy could not be evaluated: no readable index at all, or a usable index
 *    with ZERO artifacts (an empty archive — nothing to assert). Checked so it never masquerades as a
 *    pass, but ONLY after blocking violations (an explicit `--min-artifacts`/`--require-latest-ok`
 *    against an empty archive is a real `fail`, not an `unknown`).
 *  - `warn`         — no blocking violation, but a WARNING-only assertion was violated. A non-blocking
 *    concern the operator asked to be told about.
 *  - `pass` (best)  — a valid, consistent, untampered, non-empty index met every configured assertion.
 *
 * Monotonic on the shared `0 pass / 2 unknown / 3 warn / 4 fail` exit ladder, and fail-closed: absent /
 * unreadable / empty evidence never yields `pass`, and any integrity failure or blocking violation
 * forces `fail`.
 */

import type { IngestedIndex } from "./ingest";
import {
  RELEASE_POLICY_EXIT,
  RELEASE_POLICY_VERDICT_SUMMARY,
  type ReleasePolicyDriver,
  type ReleasePolicyExitCode,
  type ReleasePolicyRollup,
  type ReleasePolicyVerdict,
  type ReleasePolicyViolation,
} from "./types";

/** The authoritative verdict → exit code map. */
export const RELEASE_POLICY_EXIT_FOR_VERDICT: Record<ReleasePolicyVerdict, ReleasePolicyExitCode> = {
  pass: RELEASE_POLICY_EXIT.PASS,
  unknown: RELEASE_POLICY_EXIT.UNKNOWN,
  warn: RELEASE_POLICY_EXIT.WARN,
  fail: RELEASE_POLICY_EXIT.FAIL,
};

/**
 * Compute the composite rollup from the ingest tri-state + the evaluated violations.
 *
 * Order of resolution (fail-closed): an UNRECOGNIZED input is `unknown` (no index to evaluate); a
 * recognized-but-unusable input is `fail` (`index-invalid` — malformed / inconsistent); otherwise, over
 * a usable index, a blocking violation is `fail`, then an EMPTY archive is `unknown`, then a warning
 * violation is `warn`, else a clean `pass`. Drivers are emitted in the stable
 * {@link ReleasePolicyDriver} order.
 */
export function computePolicyRollup(
  ingested: IngestedIndex,
  violations: readonly ReleasePolicyViolation[],
): ReleasePolicyRollup {
  const drivers: ReleasePolicyDriver[] = [];
  const blockingViolations = violations.filter((v) => v.severity === "block").length;
  const warningViolations = violations.filter((v) => v.severity === "warn").length;

  let verdict: ReleasePolicyVerdict;

  if (!ingested.recognized) {
    // No `pdfxyz.release-index/1` was read — there is nothing to assert a policy over.
    drivers.push("no-index");
    verdict = "unknown";
  } else if (!ingested.usable || ingested.facts === null) {
    // It claimed to be an index but is malformed / internally inconsistent — a tampered manifest.
    drivers.push("invalid-index");
    verdict = "fail";
  } else if (blockingViolations > 0) {
    // A blocking assertion failed (this includes `index-tampered` for a valid-but-invalid archive).
    if (ingested.effectiveVerdict === "invalid") drivers.push("invalid-index");
    drivers.push("blocking-violation");
    verdict = "fail";
  } else if (ingested.facts.indexedArtifacts <= 0) {
    // A usable index with zero artifacts — an empty archive is insufficient to assert a policy over.
    drivers.push("empty-archive");
    verdict = "unknown";
  } else if (warningViolations > 0) {
    drivers.push("warning-violation");
    verdict = "warn";
  } else {
    verdict = "pass";
  }

  return {
    verdict,
    exitCode: RELEASE_POLICY_EXIT_FOR_VERDICT[verdict],
    ready: verdict === "pass",
    drivers,
    blockingViolations,
    warningViolations,
    detail: RELEASE_POLICY_VERDICT_SUMMARY[verdict],
  };
}
