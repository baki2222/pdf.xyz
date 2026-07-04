/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence audit / diff** (Phase 51).
 *
 * Phases 46–50 built the release-evidence chain, one rung per phase, and Phase 50 (`release-ci-bundle`)
 * folds a single release job's gate → artifact → index → policy stage outputs into ONE stable, content-
 * free `pdfxyz.release-ci-bundle/1` result. This phase closes the loop OVER TIME: it INGESTS two (or a
 * history of) `pdfxyz.release-ci-bundle/1` bundles — a BASELINE and a CURRENT — re-validates each bundle
 * against ITSELF (reusing the Phase 50 rollup so a hand-flipped bundle verdict is caught), diffs the two
 * bounded postures, and folds the differences into ONE content-free audit result that answers a single
 * question a CI regression gate / operator handoff needs —
 *
 *    "Did this release's evidence posture REGRESS compared with a baseline/history, and what bounded next
 *     action should the operator take?"
 *
 * — and fails closed when a bundle cannot be trusted or the posture regressed in a blocking way.
 *
 * It obeys the same honesty contract as the rest of the worker layer and is as content-free as the
 * bundles it compares:
 *  - Every load-bearing token here is a bounded enum — a mode, a verdict, a bundle stage id, a consistency
 *    link id + status, a regression id + severity + status — never a filename, path, object key, bucket,
 *    URL, endpoint, region, id, token, size, byte, raw ref, raw label, commit URL, or digest. The only
 *    non-enum values are small integer counts/deltas, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested bundle (each bundle — even one Phase 50 produced
 *    — is UNTRUSTED input here); it reduces every fact to a bounded enum, a small integer, or a boolean,
 *    and it never echoes an input file path, even on an error.
 *  - It never fabricates a "no regression": a missing / unreadable / not-recognized bundle is honestly
 *    `unknown` (insufficient — never a vacuous pass); a recognized-but-self-inconsistent bundle (a tamper)
 *    is `fail` (fail-closed); a blocking posture regression is `fail`; and every comparison reduces to a
 *    bounded, deterministic diff over the bundles' already content-free facts.
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage-retention ENFORCEMENT, NOT
 * cloud validation, and NOT deployment promotion. It PROVES nothing the compared bundles do not already
 * prove; it DIFFS their content-free postures, RE-VALIDATES each bundle's self-consistency, and rolls the
 * differences up into one regression verdict + next-action guidance. Its authored caveats (see
 * {@link RELEASE_AUDIT_CAVEATS}) say so out loud: it is local content-free audit/diff over evidence — not
 * signing, authentication, cloud validation, storage retention enforcement, or deployment promotion.
 */

import {
  RELEASE_CI_BUNDLE_CHECK_IDS,
  RELEASE_CI_BUNDLE_SCHEMA,
  RELEASE_CI_BUNDLE_STAGE_IDS,
  type ReleaseCiBundleCheckId,
  type ReleaseCiBundleCheckStatus,
  type ReleaseCiBundleSeverity,
  type ReleaseCiBundleStageId,
  type ReleaseCiBundleVerdict,
} from "../release-ci-bundle/types";
import type { ReleaseIndexVerdict } from "../release-index/types";

/** The schema tag every release-audit result carries, so tooling can pin the shape it parses. */
export const RELEASE_AUDIT_SCHEMA = "pdfxyz.release-audit/1" as const;

/** The upstream bundle schema the audit ingests. Re-exported so the result can pin its input shape. */
export { RELEASE_CI_BUNDLE_SCHEMA };

/** Stable identity of the release-audit — for docs / receipts / audit. */
export const RELEASE_AUDIT_POLICY_ID = "pdfxyz-worker-release-audit";
/** Bump when the audit surface, the verdict ladder, the regression set, or the schema changes. */
export const RELEASE_AUDIT_POLICY_VERSION = 1;

/**
 * How the audit was invoked:
 *  - `pair`    — one BASELINE bundle vs one CURRENT bundle (the primary regression-gate mode);
 *  - `history` — a chronological list of bundles; the LAST is the current release and the one before it is
 *                the baseline, plus a bounded trend distribution over the whole list.
 */
export const RELEASE_AUDIT_MODES = ["pair", "history"] as const;
export type ReleaseAuditMode = (typeof RELEASE_AUDIT_MODES)[number];

/**
 * The single audit verdict a CI/operator keys on — about the DIFF between the baseline and current
 * postures, not a re-judgement of either bundle (each already carries its own verdict):
 *  - `pass`    — no regression: the current evidence posture is at least as strong as the baseline, every
 *                required consistency link that held still holds, no coverage was dropped, and no new
 *                advisory pressure crossed the configured threshold;
 *  - `warn`    — a NON-blocking drift: the posture softened (e.g. a clean pass became an advisory warn or
 *                an uncertified unknown), coverage or a link weakened, or advisory pressure rose past the
 *                threshold — review, then decide;
 *  - `unknown` — the audit could not be performed: a supplied bundle was unreadable / not a recognized
 *                `pdfxyz.release-ci-bundle/1`, or history had fewer than two comparable bundles; fail-
 *                closed (insufficient), never a "no regression";
 *  - `fail`    — a BLOCKING regression: the current bundle FAILED (or its posture dropped to fail), a
 *                consistency link that held now MISMATCHES, the archive decision worsened to a blocking
 *                state, OR a supplied bundle is recognized but self-inconsistent (a tamper). It dominates.
 *
 * These are the exact bounded values the run-level `worker_release_audit_total` metric carries as its
 * `verdict` label; all four are low-cardinality, redaction-stable tokens shared with the rest of the
 * release-evidence suite so the whole chain speaks one language.
 */
export const RELEASE_AUDIT_VERDICTS = ["pass", "warn", "unknown", "fail"] as const;
export type ReleaseAuditVerdict = (typeof RELEASE_AUDIT_VERDICTS)[number];

/**
 * The exit-code ladder a CI/release job routes on — the same shape as the gate/artifact/index/policy/
 * ci-bundle ladders so the whole worker suite speaks one language:
 *  - `0` PASS    — no regression under the bundles + policy supplied;
 *  - `1` USAGE   — the CLI was misused (a bad flag, missing/duplicated inputs, or an unwritable output).
 *                  CLI-owned; an audit RUN never resolves to it;
 *  - `2` UNKNOWN — the audit could not be performed (an unreadable bundle, or too little history);
 *  - `3` WARN    — a non-blocking regression / advisory drift was detected;
 *  - `4` FAIL    — a blocking regression, or a recognized-but-self-inconsistent (tampered) bundle.
 * Monotonic — a higher code is always a stronger "do not promote on this comparison".
 */
export const RELEASE_AUDIT_EXIT = {
  PASS: 0,
  USAGE: 1,
  UNKNOWN: 2,
  WARN: 3,
  FAIL: 4,
} as const;
export type ReleaseAuditExitCode = (typeof RELEASE_AUDIT_EXIT)[keyof typeof RELEASE_AUDIT_EXIT];

/**
 * The **posture rank** of a bundle verdict — the ordering the audit uses to decide whether the current
 * posture WORSENED relative to the baseline. A higher rank is a WORSE release-evidence posture:
 *  - `pass` (0)    — a coherent, promote-able bundle (best);
 *  - `warn` (1)    — a CERTIFIED coherent bundle carrying an advisory concern;
 *  - `unknown` (2) — a bundle that could NOT be certified (an unreadable/decision-less chain);
 *  - `fail` (3)    — a failed / self-inconsistent bundle (worst).
 *
 * This is DELIBERATELY distinct from the bundle's own exit-code order (where `unknown` = 2 sits below
 * `warn` = 3): losing certification (a `warn` softening to an `unknown`) is a posture REGRESSION, so the
 * audit ranks `unknown` as worse than `warn`. The exit codes remain what CI routes on per bundle; this
 * rank is only the audit's internal "did it get worse" comparison, and never appears in the output.
 */
export const RELEASE_AUDIT_POSTURE_RANK: Record<ReleaseCiBundleVerdict, number> = {
  pass: 0,
  warn: 1,
  unknown: 2,
  fail: 3,
};

/**
 * The bounded ids of the regression checks the audit evaluates — a closed set a reader routes on without
 * parsing prose. Each reduces to a bounded, deterministic comparison over the two bundles' already
 * content-free facts, emitted in this stable order:
 *  - `bundle-tampered`          — a supplied bundle is a recognized `pdfxyz.release-ci-bundle/1` whose
 *                                 recorded rollup does NOT re-derive from its own stages + links (a tamper
 *                                 / corruption). BLOCKING (⇒ `fail`); never compared further;
 *  - `bundle-unreadable`        — a supplied bundle is not a recognized bundle at all (wrong schema /
 *                                 unparseable), so no comparison is possible. INSUFFICIENT (⇒ `unknown`);
 *  - `verdict-worsened`         — the current bundle's posture rank is worse than the baseline's
 *                                 (`pass`→`warn`/`unknown`/`fail`, etc.). BLOCKING iff the current posture
 *                                 is `fail` (or `unknown` under `--fail-on-unknown`); else advisory;
 *  - `consistency-broke`        — a consistency link that HELD (`ok`) in the baseline now MISMATCHES in the
 *                                 current bundle, or the count of inconsistencies rose. BLOCKING;
 *  - `consistency-weakened`     — a consistency link that HELD (`ok`) in the baseline is now `skipped` in
 *                                 the current bundle (a stage dropped, so the link can no longer certify).
 *                                 Advisory;
 *  - `coverage-dropped`         — a stage that was present + recognized in the baseline is absent in the
 *                                 current bundle (fewer stages certify the release). Advisory;
 *  - `archive-decision-worsened`— the archive-decision posture (the policy/index stage's severity) got
 *                                 worse, or the decision stage was lost. BLOCKING iff it dropped to `fail`
 *                                 (an `invalid` index / `fail` policy, or `unknown` under
 *                                 `--fail-on-unknown`); else advisory;
 *  - `warnings-increased`       — the current bundle carries more advisory pressure (warn-severity stages +
 *                                 index warn artifacts + policy warning violations) than the baseline plus
 *                                 the `--max-new-warnings` allowance. Advisory.
 */
export const RELEASE_AUDIT_REGRESSIONS = [
  "bundle-tampered",
  "bundle-unreadable",
  "verdict-worsened",
  "consistency-broke",
  "consistency-weakened",
  "coverage-dropped",
  "archive-decision-worsened",
  "warnings-increased",
] as const;
export type ReleaseAuditRegressionId = (typeof RELEASE_AUDIT_REGRESSIONS)[number];

/**
 * The resolved severity of one regression check:
 *  - `block` — a blocking regression / a tampered bundle ⇒ `fail`;
 *  - `unknown` — an input that makes the audit impossible (an unreadable bundle) ⇒ `unknown`;
 *  - `warn` — a non-blocking advisory drift ⇒ `warn`;
 *  - `none` — the check evaluated and did NOT fire (or could not be evaluated).
 */
export const RELEASE_AUDIT_SEVERITIES = ["block", "unknown", "warn", "none"] as const;
export type ReleaseAuditSeverity = (typeof RELEASE_AUDIT_SEVERITIES)[number];

/**
 * The bounded outcome of one regression check:
 *  - `regressed` — the check FIRED (a regression of its kind was detected);
 *  - `ok`        — the check was evaluated over two comparable bundles and did NOT fire;
 *  - `skipped`   — the check could not be evaluated (a bundle was not usable / not supplied), so it is
 *                  neither a pass nor a regression — never a silent "no regression".
 */
export const RELEASE_AUDIT_FINDING_STATUSES = ["regressed", "ok", "skipped"] as const;
export type ReleaseAuditFindingStatus = (typeof RELEASE_AUDIT_FINDING_STATUSES)[number];

/* ------------------------------------------------------------------ *
 *  Per-bundle bounded reduction (all enums / small ints / booleans)
 * ------------------------------------------------------------------ */

/** One bundle stage reduced to just what the diff needs: was it certifying, and at what severity. */
export interface AuditStageView {
  /** True iff the stage was supplied + recognized in the bundle (a certifying stage). */
  readonly present: boolean;
  /** The stage's severity on the common bundle ladder (`unknown` when not present). */
  readonly severity: ReleaseCiBundleSeverity;
}

/** The bounded facts reduced from ONE `pdfxyz.release-ci-bundle/1` bundle (its rollup re-derived here). */
export interface AuditBundleFacts {
  /** The bundle's recorded rollup verdict (its CLAIM; trusted only when `usable`). */
  readonly verdict: ReleaseCiBundleVerdict | null;
  /** The bundle's recorded exit code, or `null`. */
  readonly exitCode: number | null;
  readonly stagesPresent: number;
  readonly chainComplete: boolean;
  readonly decisionStage: ReleaseCiBundleStageId | null;
  readonly inconsistencies: number;
  /** Each bundle stage reduced to {present, severity}, in canonical stage order. */
  readonly stages: Readonly<Record<ReleaseCiBundleStageId, AuditStageView>>;
  /** Each consistency link's status, in canonical link order. */
  readonly links: Readonly<Record<ReleaseCiBundleCheckId, ReleaseCiBundleCheckStatus>>;
  /** How many present stages sit at `warn` severity. */
  readonly warnStages: number;
  /** Total advisory pressure: `warnStages` + index warn artifacts + policy warning violations. */
  readonly warningSignals: number;
  /** The index stage's archive-health verdict, or `null` if no index stage was present. */
  readonly archiveVerdict: ReleaseIndexVerdict | null;
  readonly policyBlockingViolations: number;
  readonly policyWarningViolations: number;
  readonly indexIntegrityFailures: number;
}

/** The trust-boundary outcome of ingesting one bundle root (never throws, never echoes the input). */
export interface IngestedBundle {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-ci-bundle/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded rollup RE-DERIVES from its own stages + links (self-consistent). */
  readonly usable: boolean;
  /** The bounded reduced facts (present even for a not-usable bundle, as its untrusted CLAIM; `null` if unrecognized/structurally broken). */
  readonly facts: AuditBundleFacts | null;
}

/**
 * The bounded, content-free summary of ONE bundle slot (baseline / current / a history member) the result
 * records. Every field is an enum, a small integer, a boolean, or `null` — never a raw value.
 */
export interface AuditBundleSummary {
  /** True iff a bundle was supplied for this slot. */
  readonly present: boolean;
  readonly recognized: boolean;
  readonly usable: boolean;
  readonly verdict: ReleaseCiBundleVerdict | null;
  /** The bundle's posture rank (see {@link RELEASE_AUDIT_POSTURE_RANK}), or `null` if it has no verdict. */
  readonly postureRank: number | null;
  readonly exitCode: number | null;
  readonly stagesPresent: number;
  readonly chainComplete: boolean;
  readonly decisionStage: ReleaseCiBundleStageId | null;
  readonly inconsistencies: number;
  readonly warnStages: number;
  readonly warningSignals: number;
  readonly archiveVerdict: ReleaseIndexVerdict | null;
  readonly stages: Readonly<Record<ReleaseCiBundleStageId, AuditStageView>>;
  readonly links: Readonly<Record<ReleaseCiBundleCheckId, ReleaseCiBundleCheckStatus>>;
  /** A one-line, content-free headline authored from the slot + recognized/usable + verdict. */
  readonly detail: string;
}

/** The bounded distribution of postures across a history list (history mode only). */
export interface AuditHistorySummary {
  /** How many bundles were supplied in the history list. */
  readonly count: number;
  /** How many of them were usable (recognized + self-consistent). */
  readonly usable: number;
  /** The count of each posture across the whole list (an at-a-glance trend). */
  readonly verdictCounts: {
    readonly pass: number;
    readonly warn: number;
    readonly unknown: number;
    readonly fail: number;
    /** Supplied bundles that were unreadable / not recognized. */
    readonly unreadable: number;
  };
}

/** One evaluated regression check — a bounded record of one diff comparison. */
export interface AuditRegressionFinding {
  readonly id: ReleaseAuditRegressionId;
  readonly status: ReleaseAuditFindingStatus;
  /** The resolved severity (only meaningful when `status === "regressed"`; `none` otherwise). */
  readonly severity: ReleaseAuditSeverity;
  /** Bounded, app-authored explanation (keyed by id + status). Never derived from an input. */
  readonly detail: string;
}

/** The bounded, signed deltas the diff surfaces (all small ints / booleans; content-free). */
export interface AuditComparisonFacts {
  /** `current.postureRank − baseline.postureRank` (a positive value is a regression), or `null` if not comparable. */
  readonly postureRankDelta: number | null;
  /** `current.stagesPresent − baseline.stagesPresent`. */
  readonly stagesPresentDelta: number;
  /** `current.inconsistencies − baseline.inconsistencies`. */
  readonly inconsistenciesDelta: number;
  /** `max(0, current.warningSignals − baseline.warningSignals)`. */
  readonly newWarnings: number;
  /** How many consistency links went `ok` → `mismatch` (a blocking break). */
  readonly brokenLinks: number;
  /** How many consistency links went `ok` → `skipped` (a weakening). */
  readonly weakenedLinks: number;
  /** How many stages present in the baseline are absent in the current bundle. */
  readonly droppedStages: number;
  /** True iff the current posture is strictly BETTER than the baseline (an improvement, never a regression). */
  readonly improved: boolean;
}

/** The applied policy knobs (the small bounded flags the operator supplied). */
export interface AuditPolicy {
  /** `--allow-warn-regression`: report warn-level regressions but do NOT let them drive a non-pass verdict. */
  readonly allowWarnRegression: boolean;
  /** `--max-new-warnings=N`: tolerate up to N new advisory signals before `warnings-increased` fires. */
  readonly maxNewWarnings: number;
  /** `--fail-on-unknown`: escalate a certification-loss drift (a worsening whose endpoint is `unknown`) to blocking. */
  readonly failOnUnknown: boolean;
}

/** The composite rollup — the single verdict + exit code an operator/CI acts on. */
export interface AuditRollup {
  readonly verdict: ReleaseAuditVerdict;
  readonly exitCode: ReleaseAuditExitCode;
  /** True iff `verdict !== "pass"` (a regression / drift / insufficiency was reported). */
  readonly regressed: boolean;
  /** The ids of the regression checks that FIRED, in canonical {@link RELEASE_AUDIT_REGRESSIONS} order. */
  readonly drivers: readonly ReleaseAuditRegressionId[];
  /** How many fired findings were blocking. */
  readonly blockingRegressions: number;
  /** How many fired findings were advisory (warn), counted even when `--allow-warn-regression` softens them. */
  readonly warningRegressions: number;
  /** True iff BOTH bundles were usable and a real diff was performed. */
  readonly comparable: boolean;
  readonly detail: string;
}

/** The stable identity block the result records (with the pinned upstream bundle schema). */
export interface ReleaseAuditMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_AUDIT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_AUDIT_POLICY_VERSION;
  readonly bundleSchema: typeof RELEASE_CI_BUNDLE_SCHEMA;
}

/**
 * The stable, content-free release evidence audit an operator or CI gates on. Every field is a bounded
 * enum, a small integer/delta, an ISO stamp, or app-authored prose — so it carries no locator,
 * identifier, size, path, or byte, even from a hostile bundle.
 */
export interface ReleaseAuditResult {
  readonly schema: typeof RELEASE_AUDIT_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseAuditMetadata;
  readonly mode: ReleaseAuditMode;
  readonly policy: AuditPolicy;
  readonly baseline: AuditBundleSummary;
  readonly current: AuditBundleSummary;
  /** The bounded posture distribution over the whole history list (history mode only; `null` in pair mode). */
  readonly history: AuditHistorySummary | null;
  readonly comparison: AuditComparisonFacts;
  /** Every regression check, in canonical {@link RELEASE_AUDIT_REGRESSIONS} order. */
  readonly regressions: readonly AuditRegressionFinding[];
  readonly rollup: AuditRollup;
  /** The bounded, app-authored next SAFE operator action (keyed by verdict). Never derived from an input. */
  readonly nextAction: string;
  /** Bounded, app-authored guidance (out-of-scope steps this audit does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested bundle. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log/forward verbatim). */
  readonly receipt: ReleaseAuditReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to "what
 * did this release audit resolve to, in what mode, over a comparable pair or not, with how many blocking
 * vs warning regressions" for a SIEM / release record. Bounded enums + small integers + a stable policy id
 * + the run's own stamp only; safe to log or forward verbatim.
 */
export interface ReleaseAuditReceipt {
  readonly category: "worker-release-audit";
  readonly policyId: typeof RELEASE_AUDIT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_AUDIT_POLICY_VERSION;
  readonly at: string;
  readonly mode: ReleaseAuditMode;
  readonly verdict: ReleaseAuditVerdict;
  readonly exitCode: ReleaseAuditExitCode;
  /** True iff a real baseline↔current diff was performed. */
  readonly comparable: boolean;
  readonly blockingRegressions: number;
  readonly warningRegressions: number;
}

/** The process exit code for an audit result. */
export function releaseAuditExitCode(result: ReleaseAuditResult): number {
  return result.rollup.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested bundle)
 * ------------------------------------------------------------------ */

/** The one-line rollup headline per verdict. Authored here, keyed by the enum. */
export const RELEASE_AUDIT_VERDICT_SUMMARY: Record<ReleaseAuditVerdict, string> = {
  pass: "AUDIT PASS: no regression — the current release evidence posture is at least as strong as the baseline, every consistency link that held still holds, no coverage was dropped, and advisory pressure stayed within the configured allowance.",
  warn: "AUDIT DRIFT: a NON-blocking regression — the posture softened, a consistency link or a stage weakened, or advisory pressure rose past the threshold. No blocking regression and no tampered bundle. Review, then decide.",
  unknown:
    "AUDIT NOT PERFORMED: the comparison could not be made — a supplied bundle was unreadable / not a recognized release CI bundle, or the history had fewer than two comparable bundles. This is not a 'no regression'.",
  fail: "AUDIT FAIL: a BLOCKING regression — the current bundle failed or its posture dropped to fail, a consistency link that held now mismatches, the archive decision worsened to a blocking state, OR a supplied bundle is recognized but self-inconsistent (a tamper). Do not promote on this comparison.",
};

/** The next-action headline per verdict — the "next safe operator action". Authored, keyed by the enum. */
export const RELEASE_AUDIT_NEXT_ACTION: Record<ReleaseAuditVerdict, string> = {
  pass: "No regression detected. Proceed with your out-of-band promotion process for the current release (this audit authorizes nothing on its own), and keep BOTH bundles as the before/after evidence record. Note: the audit only diffs — gate the current bundle itself separately if it is not a clean pass.",
  warn: "Review the drift: a softened posture, a weakened consistency link, a dropped stage, or increased advisory pressure. Decide whether to proceed; if the drift is expected, re-run with `--allow-warn-regression` (or raise `--max-new-warnings`) to record the accepted baseline. Archive the audit either way as the record of that decision.",
  unknown:
    "Treat this as a setup problem, not a pass: supply two READABLE `pdfxyz.release-ci-bundle/1` bundles (a baseline and a current), or at least two comparable history bundles, and re-run the audit. Do not promote on a comparison that could not be made.",
  fail: "Do not promote. A blocking regression or a tampered bundle was detected: recover the untampered bundles from your CI archive, investigate the failed / disagreeing stage or the worsened archive decision, regenerate the release evidence chain, and re-audit against the baseline you trust.",
};

/** Per-regression authored detail, keyed by id + status. */
export const RELEASE_AUDIT_REGRESSION_DETAIL: Record<
  ReleaseAuditRegressionId,
  { readonly regressed: string; readonly ok: string; readonly skipped: string }
> = {
  "bundle-tampered": {
    regressed:
      "A supplied release CI bundle is a recognized `pdfxyz.release-ci-bundle/1` whose recorded rollup verdict does NOT re-derive from its own stages + consistency links — a hand-edited or corrupt bundle. Recover the untampered bundle from your CI archive; a tampered input cannot be audited.",
    ok: "Every supplied bundle re-derived its own rollup from its own stages + links (self-consistent).",
    skipped: "No bundle was available to check for tampering.",
  },
  "bundle-unreadable": {
    regressed:
      "A supplied bundle is not a recognized `pdfxyz.release-ci-bundle/1` (wrong schema or unparseable — never echoed), so the comparison could not be made. Supply a readable bundle produced by `worker:release-ci-bundle` and re-run.",
    ok: "Every supplied bundle parsed as a recognized release CI bundle.",
    skipped: "No bundle was supplied to read.",
  },
  "verdict-worsened": {
    regressed:
      "The current bundle's evidence posture is WORSE than the baseline's (a clean pass softened to an advisory warn, an uncertified unknown, or an outright fail). A softening is a drift; a drop to fail is blocking.",
    ok: "The current bundle's posture is at least as strong as the baseline's.",
    skipped: "Both a usable baseline and a usable current bundle are required to compare their postures.",
  },
  "consistency-broke": {
    regressed:
      "A cross-stage consistency link that HELD in the baseline now MISMATCHES in the current bundle (two stages describe different evidence — a tamper or a stale/mixed input), or the count of inconsistencies rose. Blocking.",
    ok: "No consistency link that held in the baseline mismatches in the current bundle.",
    skipped: "Both a usable baseline and a usable current bundle are required to compare their consistency links.",
  },
  "consistency-weakened": {
    regressed:
      "A consistency link that HELD in the baseline is now `skipped` in the current bundle — a stage it needed was dropped, so the link can no longer certify agreement. Not blocking, but less evidence certifies this release.",
    ok: "No consistency link that held in the baseline was weakened to `skipped` in the current bundle.",
    skipped: "Both a usable baseline and a usable current bundle are required to compare their consistency links.",
  },
  "coverage-dropped": {
    regressed:
      "A release-evidence stage that was present + recognized in the baseline is absent in the current bundle — fewer stages certify this release than certified the baseline. Supply the missing stage(s) before promoting.",
    ok: "The current bundle certifies with at least the same stages as the baseline.",
    skipped: "Both a usable baseline and a usable current bundle are required to compare their stage coverage.",
  },
  "archive-decision-worsened": {
    regressed:
      "The archive-decision posture (the policy/index stage's severity) got WORSE, or the decision stage was lost. A drop to a blocking state (an `invalid` index or a `fail` policy) is blocking; a softer decline is a drift.",
    ok: "The current bundle's archive-decision posture is at least as strong as the baseline's.",
    skipped: "Both a usable baseline and a usable current bundle are required to compare their archive decisions.",
  },
  "warnings-increased": {
    regressed:
      "The current bundle carries more advisory pressure (warn-severity stages, index warn artifacts, and policy warning violations) than the baseline plus the configured `--max-new-warnings` allowance. Review the new advisories.",
    ok: "The current bundle's advisory pressure is within the baseline plus the configured allowance.",
    skipped: "Both a usable baseline and a usable current bundle are required to compare their advisory pressure.",
  },
};

/**
 * The honesty caveats every result carries and every text render prints. The audit DIFFS the chain's
 * already content-free bundle postures and RE-VALIDATES each bundle's self-consistency; it must never be
 * read as more than that.
 */
export const RELEASE_AUDIT_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE AUDIT / DIFF: it INGESTS two (or a history of) content-free `pdfxyz.release-ci-bundle/1` bundles, RE-VALIDATES each bundle against ITSELF, and DIFFS a baseline against a current posture to answer whether the release evidence REGRESSED. It is local content-free audit/diff over evidence — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, or deployment promotion.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no release stage or bundle itself, and NEVER deletes, prunes, uploads, promotes, or mutates any bundle, artifact, index, policy, object, or deployment. A `pass` authorizes nothing; it only reports that the current bundle did not regress versus the baseline supplied on THIS host.",
  "It re-derives each bundle's rollup from the bundle's OWN stages + consistency links and FAILS CLOSED on disagreement: a recognized bundle whose recorded verdict does not re-derive is treated as tampered (`fail`), and an unreadable bundle makes the comparison `unknown` (never a silent 'no regression'). This re-derivation is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity.",
  "It emits only bounded enums, small counts/deltas, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job/user id, IP, token, raw ref, raw label, commit URL, size, byte, digest, or document content, even from a hostile bundle input, and it never echoes an input file path, even on an error.",
  "It only DIFFS: a `pass` means the current bundle did not regress versus the baseline, NOT that the current bundle is itself acceptable — gate the current bundle on its own with `worker:release-ci-bundle` / `worker:release-policy` too. A baseline and current that are BOTH failing shows 'no regression' here; that is honest scope, not an endorsement.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, or mutates nothing.",
];

/**
 * Out-of-band reminders the audit carries but does NOT itself perform — the honest edges of an offline
 * differ. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_AUDIT_GUIDANCE: readonly string[] = [
  "Wire this as an OPTIONAL regression gate in a release CI job, AFTER `worker:release-ci-bundle`: keep the previous release's bundle as the baseline (a committed artifact or a restored CI artifact), pass it plus the current build's bundle, fail the pipeline on exit 4 (a blocking regression or a tampered bundle), surface exit 3 (a non-blocking drift) for review, and treat exit 2 (an unreadable bundle or too little history) as a setup error, not a pass.",
  "The audit DIFFS; it does not GATE the current bundle on its own. Run `worker:release-ci-bundle` (and `worker:release-policy`) over the current build too, so a bundle that is itself failing is caught even when the baseline was also failing (which the diff honestly reports as 'no regression').",
  "Record the accepted baseline deliberately: an EXPECTED drift (a new advisory, a stage you dropped on purpose) is a `warn` here — re-run with `--allow-warn-regression` or a raised `--max-new-warnings` to accept it, and archive the audit as the record of that decision. Do not silently ignore exit 3.",
  "Enforce promotion out of band: this audit REPORTS whether the evidence posture regressed, but signing a release, provisioning, and promoting a deployment are operator/CI actions this offline differ never performs.",
];

/** The canonical stage + link id orders, re-exported so renderers/reducers iterate without re-deriving. */
export { RELEASE_CI_BUNDLE_STAGE_IDS, RELEASE_CI_BUNDLE_CHECK_IDS };
