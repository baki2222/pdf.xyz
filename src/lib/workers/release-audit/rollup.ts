/**
 * Pure, node-free **rollup** for the release evidence audit (Phase 51).
 *
 * Folds the regression findings + the applied policy into the ONE composite {@link ReleaseAuditVerdict} +
 * exit code a CI/operator acts on. The ladder is fail-closed on anything it cannot trust or certify:
 *
 *  - `fail` (worst) — a BLOCKING regression fired (the current bundle dropped to fail, a held consistency
 *    link now mismatches, the archive decision worsened to a blocking state) OR a supplied bundle is
 *    recognized but self-inconsistent (a tamper). A blocking regression or a tampered input dominates.
 *  - `unknown`      — the audit could not be performed: a supplied bundle was UNREADABLE (not a recognized
 *    `pdfxyz.release-ci-bundle/1`) ANYWHERE in the supplied set, OR the compared pair was not BOTH usable
 *    (a not-supplied baseline / too little comparable history — `!comparable`). Checked after fail so a
 *    real blocking regression / tamper is never masked, but before warn so an un-performable audit never
 *    masquerades as a mere advisory (and never as a vacuous `pass`).
 *  - `warn`         — no blocking regression and no unreadable input, but a non-blocking drift fired (a
 *    softened posture, a weakened link, dropped coverage, or increased advisory pressure). Softened to
 *    `pass` when `--allow-warn-regression` is set (the drift is still REPORTED in `drivers`).
 *  - `pass` (best)  — no regression, or only warn-level drift the operator explicitly accepted.
 *
 * Monotonic on the shared `0 pass / 2 unknown / 3 warn / 4 fail` exit ladder. Drivers are the fired
 * findings in the stable {@link RELEASE_AUDIT_REGRESSIONS} order — a superset view, so a reader sees every
 * regression that applied, not only the winning one (including a warn-level drift accepted under
 * `--allow-warn-regression`).
 */

import {
  RELEASE_AUDIT_EXIT,
  RELEASE_AUDIT_REGRESSIONS,
  RELEASE_AUDIT_VERDICT_SUMMARY,
  type AuditPolicy,
  type AuditRegressionFinding,
  type AuditRollup,
  type ReleaseAuditExitCode,
  type ReleaseAuditRegressionId,
  type ReleaseAuditVerdict,
} from "./types";

/** The authoritative verdict → exit code map. */
export const RELEASE_AUDIT_EXIT_FOR_VERDICT: Record<ReleaseAuditVerdict, ReleaseAuditExitCode> = {
  pass: RELEASE_AUDIT_EXIT.PASS,
  unknown: RELEASE_AUDIT_EXIT.UNKNOWN,
  warn: RELEASE_AUDIT_EXIT.WARN,
  fail: RELEASE_AUDIT_EXIT.FAIL,
};

/**
 * Compute the composite audit rollup from the regression findings + the policy.
 *
 * Fail-closed precedence: a blocking regression / tamper ⇒ `fail`; else an unreadable bundle OR a diff that
 * could not run (`!comparable`: a not-supplied baseline / too little history) ⇒ `unknown`; else a warn-level
 * drift (unless softened by `--allow-warn-regression`) ⇒ `warn`; else `pass`. `comparable` records whether
 * both compared bundles were usable and a real diff ran — a `pass`/`warn` is impossible without it.
 */
export function computeAuditRollup(
  findings: readonly AuditRegressionFinding[],
  policy: AuditPolicy,
  comparable: boolean,
): AuditRollup {
  const fired = findings.filter((f) => f.status === "regressed");
  const blockingRegressions = fired.filter((f) => f.severity === "block").length;
  const warningRegressions = fired.filter((f) => f.severity === "warn").length;
  const anyUnreadable = fired.some((f) => f.severity === "unknown");

  // Fail-closed: a `pass`/`warn` requires a real diff over two usable bundles. If the comparison could not
  // run (`!comparable`: a not-supplied baseline, or a history with fewer than two comparable bundles) it is
  // an INSUFFICIENT audit (`unknown`), never a vacuous "no regression" — even when nothing fired.
  let verdict: ReleaseAuditVerdict;
  if (blockingRegressions > 0) verdict = "fail";
  else if (anyUnreadable || !comparable) verdict = "unknown";
  else if (warningRegressions > 0 && !policy.allowWarnRegression) verdict = "warn";
  else verdict = "pass";

  // Drivers: every fired finding, in canonical order (a superset — includes a warn drift accepted under
  // --allow-warn-regression, so an accepted regression is still on the record).
  const firedIds = new Set<ReleaseAuditRegressionId>(fired.map((f) => f.id));
  const drivers: ReleaseAuditRegressionId[] = RELEASE_AUDIT_REGRESSIONS.filter((id) => firedIds.has(id));

  return {
    verdict,
    exitCode: RELEASE_AUDIT_EXIT_FOR_VERDICT[verdict],
    regressed: verdict !== "pass",
    drivers,
    blockingRegressions,
    warningRegressions,
    comparable,
    detail: RELEASE_AUDIT_VERDICT_SUMMARY[verdict],
  };
}
