/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence CI bundle**
 * (Phase 50).
 *
 * Phases 46–49 built the promotion → archival → retention → policy evidence chain, one rung per phase:
 * the release readiness gate (`pnpm worker:release-gate`) folds the content-free worker checks into ONE
 * PASS/WARN/FAIL verdict; the release evidence artifact (`pnpm worker:release-artifact`) stamps that
 * result with bounded provenance + an integrity digest into a tamper-evident `pdfxyz.release-artifact/1`;
 * the release evidence index (`pnpm worker:release-index`) re-verifies MANY of those artifacts' digests
 * and folds them into ONE `pdfxyz.release-index/1` retention manifest; and the release evidence policy
 * (`pnpm worker:release-policy`) asserts bounded operator thresholds over that manifest and FAILS CLOSED.
 * This phase closes the *handoff* loop over the WHOLE chain: it INGESTS whichever of those already-
 * content-free stage outputs a release job produced, RE-VERIFIES their internal + cross-stage
 * consistency, and folds them into ONE stable, content-free `pdfxyz.release-ci-bundle/1` result that
 * answers a single question a CI job / operator handoff needs —
 *
 *    "What did the release evidence chain decide end-to-end, do the stages AGREE with each other, what
 *     content-free artifacts should be archived, and what is the next SAFE operator action?"
 *
 * — and fails closed when the stages disagree or a stage cannot be trusted.
 *
 * This module is the closed vocabulary the bundle produces. It obeys the same honesty contract as the
 * rest of the worker layer and is as content-free as the stages it composes:
 *  - Every load-bearing token here is a bounded enum — a stage id, a source, a verdict, a consistency
 *    check id + status, a driver — never a filename, path, object key, bucket, URL, endpoint, region,
 *    id, token, size, byte, raw ref, raw label, commit URL, or digest. The only non-enum values are
 *    small integer counts, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested stage (each stage output — even one this
 *    suite produced — is UNTRUSTED input here); it reduces every fact to a bounded enum, a small
 *    integer, or a boolean, and it never echoes an input file path, even on an error.
 *  - It never fabricates a pass: a missing / unreadable / not-recognized stage is honestly `unknown`
 *    (never a vacuous pass); a chain with no archive-decision stage (index/policy) is `unknown`; a
 *    stage that FAILED, or two stages that DISAGREE (a cross-stage inconsistency / tamper), is `fail`
 *    (fail-closed); and every consistency link is checked with a bounded, deterministic comparison.
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage-retention ENFORCEMENT, NOT
 * cloud validation, and NOT deployment promotion. It PROVES nothing the composed stages do not already
 * prove; it COMPOSES their content-free outputs, RE-VERIFIES their consistency, and rolls them up into
 * one handoff bundle + next-action guidance. Its authored caveats (see {@link RELEASE_CI_BUNDLE_CAVEATS})
 * say so out loud: it is local content-free bundling + consistency checking over evidence — not signing,
 * authentication, cloud validation, storage retention enforcement, or deployment promotion.
 */

import { RELEASE_GATE_SCHEMA, type ReleaseGateVerdict } from "../release-gate/types";
import {
  RELEASE_ARTIFACT_SCHEMA,
  type GitCleanliness,
  type RefClass,
  type ReleaseArtifactVerdict,
} from "../release-artifact/types";
import {
  RELEASE_INDEX_SCHEMA,
  type ReleaseIndexAgeBucket,
  type ReleaseIndexVerdict,
  type ReleaseLabelClass,
} from "../release-index/types";
import { RELEASE_POLICY_SCHEMA } from "../release-policy/types";
import type { ReleaseIndexDigestStatus } from "../release-index/types";

/** The schema tag every release-ci-bundle result carries, so tooling can pin the shape it parses. */
export const RELEASE_CI_BUNDLE_SCHEMA = "pdfxyz.release-ci-bundle/1" as const;

/** Stable identity of the release-ci-bundle — for docs / receipts / audit. */
export const RELEASE_CI_BUNDLE_POLICY_ID = "pdfxyz-worker-release-ci-bundle";
/** Bump when the bundle surface, the verdict ladder, the stage/consistency sets, or the schema changes. */
export const RELEASE_CI_BUNDLE_POLICY_VERSION = 1;

/** The upstream stage schemas the bundle ingests. Re-exported so the result can pin each input shape. */
export { RELEASE_GATE_SCHEMA, RELEASE_ARTIFACT_SCHEMA, RELEASE_INDEX_SCHEMA, RELEASE_POLICY_SCHEMA };

/**
 * The bounded ids of the four release-evidence stages the bundle composes — the stable keys a reader
 * routes on, in the chain's own promotion → archival → retention → policy order:
 *  - `gate`     — the `pdfxyz.worker-release-gate/1` promotion verdict;
 *  - `artifact` — the `pdfxyz.release-artifact/1` archived evidence + integrity digest;
 *  - `index`    — the `pdfxyz.release-index/1` retention manifest;
 *  - `policy`   — the `pdfxyz.release-policy/1` acceptability decision (the chain's terminal gate).
 */
export const RELEASE_CI_BUNDLE_STAGE_IDS = ["gate", "artifact", "index", "policy"] as const;
export type ReleaseCiBundleStageId = (typeof RELEASE_CI_BUNDLE_STAGE_IDS)[number];

/**
 * The two stages that speak to the ARCHIVE decision (not a single build): a bundle that includes at
 * least one of these has a genuine chain decision to roll up. A bundle with only build-level stages
 * (gate/artifact) is `unknown` — a single build's signal is not an end-to-end chain decision.
 */
export const RELEASE_CI_BUNDLE_DECISION_STAGES = ["index", "policy"] as const;

/**
 * Where a stage came from:
 *  - `supplied`     — a file was provided for this stage AND it carried the expected schema tag;
 *  - `not-supplied` — no file was provided for this stage (the honest default, never a fault);
 *  - `unreadable`   — a file was provided but could not be read / parsed / recognized (never echoed).
 */
export const RELEASE_CI_BUNDLE_STAGE_SOURCES = ["supplied", "not-supplied", "unreadable"] as const;
export type ReleaseCiBundleStageSource = (typeof RELEASE_CI_BUNDLE_STAGE_SOURCES)[number];

/**
 * The single bundle verdict a CI/operator keys on — about the WHOLE chain's decision + coherence, not
 * a re-judgement of any one stage (each stage already carries its own):
 *  - `pass`    — every supplied stage passed/ok, every consistency link held, and the chain included an
 *                archive-decision stage (index/policy); a coherent, promote-able evidence bundle;
 *  - `warn`    — no blocker, but an advisory stage verdict was raised (a stage warned) with no
 *                inconsistency; review, then decide;
 *  - `unknown` — the chain could not be certified: a supplied stage was unreadable, a stage was
 *                indeterminate/empty, or NO archive-decision stage was supplied; fail-closed, not a pass;
 *  - `fail`    — a stage FAILED (gate/artifact/policy `fail`, or index `invalid`), OR two stages
 *                DISAGREE (a cross-stage inconsistency / tamper). The strongest signal; it dominates.
 *
 * These are the exact bounded values the run-level {@link import("../observability/metrics").WorkerMetricName}
 * `worker_release_ci_bundle_total` carries as its `verdict` label; all four are low-cardinality,
 * redaction-stable tokens shared with the gate/artifact/policy ladders so the whole suite speaks one
 * language.
 */
export const RELEASE_CI_BUNDLE_VERDICTS = ["pass", "warn", "unknown", "fail"] as const;
export type ReleaseCiBundleVerdict = (typeof RELEASE_CI_BUNDLE_VERDICTS)[number];

/**
 * The exit-code ladder a CI/release job routes on — the same shape as the gate/artifact/index/policy
 * ladders so the whole worker suite speaks one language:
 *  - `0` PASS    — the bundle is coherent and promote-able under the evidence supplied;
 *  - `1` USAGE   — the CLI was misused (a bad flag, no stage file supplied, or an unwritable output).
 *                  CLI-owned; a bundle RUN never resolves to it;
 *  - `2` UNKNOWN — the chain could not be certified (an unreadable/indeterminate stage, or no
 *                  archive-decision stage);
 *  - `3` WARN    — an advisory stage verdict was raised (a non-blocking concern);
 *  - `4` FAIL    — a stage failed, or two stages disagree (a blocking inconsistency / tamper).
 * Monotonic — a higher code is always a stronger "do not promote on this bundle".
 */
export const RELEASE_CI_BUNDLE_EXIT = {
  PASS: 0,
  USAGE: 1,
  UNKNOWN: 2,
  WARN: 3,
  FAIL: 4,
} as const;
export type ReleaseCiBundleExitCode =
  (typeof RELEASE_CI_BUNDLE_EXIT)[keyof typeof RELEASE_CI_BUNDLE_EXIT];

/**
 * The common severity each stage's native verdict maps onto so the bundle can fold four different
 * ladders (gate/artifact `pass|warn|fail|unknown`, index `ok|warn|unknown|invalid`, policy
 * `pass|warn|unknown|fail`) into one. A stage that is not present maps to `unknown` (no evidence).
 */
export const RELEASE_CI_BUNDLE_SEVERITIES = ["pass", "warn", "unknown", "fail"] as const;
export type ReleaseCiBundleSeverity = (typeof RELEASE_CI_BUNDLE_SEVERITIES)[number];

/**
 * The bounded ids of the cross-stage + self-consistency links the bundle verifies — a closed set a
 * reader routes on without parsing prose. Each reduces to a bounded, deterministic comparison over the
 * stages' already content-free facts; a `mismatch` on any is a BLOCKING inconsistency (⇒ `fail`):
 *  - `artifact-digest`          — the supplied artifact re-verifies its own integrity digest in-process
 *                                 (a `mismatch`/`malformed` digest is a tampered / corrupt artifact);
 *  - `index-self-consistent`    — the supplied index verifies against itself (its counts add up and its
 *                                 archive-health verdict recomputes from those counts — a hand-edited /
 *                                 tampered manifest fails);
 *  - `policy-self-consistent`   — the supplied policy result recomputes: its rollup verdict follows from
 *                                 its OWN recorded facts + assertions (defeats a flipped `rollup.verdict`
 *                                 smuggling a tampered archive past the gate);
 *  - `gate-artifact-agreement`  — the artifact's ARCHIVED gate verdict equals the standalone gate's
 *                                 verdict (the artifact archived the SAME gate decision, not a different one);
 *  - `artifact-index-inclusion` — the artifact's recomputed integrity-digest prefix appears among the
 *                                 index's VERIFIED entries with the same artifact verdict (the index
 *                                 actually indexed THIS artifact and it re-verified there too);
 *  - `index-policy-agreement`   — the policy's effective archive verdict + indexed-artifact count equal
 *                                 the index's rollup verdict + indexed count (the policy was evaluated
 *                                 over the SAME index, not a different one).
 */
export const RELEASE_CI_BUNDLE_CHECK_IDS = [
  "artifact-digest",
  "index-self-consistent",
  "policy-self-consistent",
  "gate-artifact-agreement",
  "artifact-index-inclusion",
  "index-policy-agreement",
] as const;
export type ReleaseCiBundleCheckId = (typeof RELEASE_CI_BUNDLE_CHECK_IDS)[number];

/**
 * The bounded outcome of one consistency link:
 *  - `ok`       — the link held (both sides present and equal);
 *  - `mismatch` — the link was evaluable but the two sides DISAGREE (a blocking inconsistency / tamper);
 *  - `skipped`  — a stage the link needs was not supplied / not usable, so the link could not be
 *                 evaluated (never a silent pass — an un-evaluable link cannot certify agreement).
 */
export const RELEASE_CI_BUNDLE_CHECK_STATUSES = ["ok", "mismatch", "skipped"] as const;
export type ReleaseCiBundleCheckStatus = (typeof RELEASE_CI_BUNDLE_CHECK_STATUSES)[number];

/**
 * The bounded reasons the rollup left `pass` — a closed set, emitted in this stable order so the driver
 * set is deterministic:
 *  - `stage-failed`      — a supplied stage's verdict mapped to `fail` ⇒ `fail`;
 *  - `chain-inconsistent`— a blocking consistency link mismatched (two stages disagree) ⇒ `fail`;
 *  - `stage-unreadable`  — a supplied stage file could not be read / recognized ⇒ `unknown`;
 *  - `stage-unknown`     — a supplied stage's verdict was indeterminate / an empty archive ⇒ `unknown`;
 *  - `incomplete-chain`  — no archive-decision stage (index/policy) was supplied ⇒ `unknown`;
 *  - `stage-warned`      — a supplied stage's verdict mapped to `warn` (advisory) ⇒ `warn`.
 */
export const RELEASE_CI_BUNDLE_DRIVERS = [
  "stage-failed",
  "chain-inconsistent",
  "stage-unreadable",
  "stage-unknown",
  "incomplete-chain",
  "stage-warned",
] as const;
export type ReleaseCiBundleDriver = (typeof RELEASE_CI_BUNDLE_DRIVERS)[number];

/* ------------------------------------------------------------------ *
 *  Per-stage bounded facts (one shape per stage; all enums / small ints / booleans)
 * ------------------------------------------------------------------ */

/** The bounded facts reduced from a `pdfxyz.worker-release-gate/1` report. */
export interface GateStageFacts {
  readonly includedChecks: number;
  readonly passedChecks: number;
  readonly skippedChecks: number;
  /** How many checks did not pass and were not skipped (the gate's blocker count; never their ids' text). */
  readonly blockers: number;
}

/** The bounded facts reduced from a `pdfxyz.release-artifact/1` file (its digest re-verified in-process). */
export interface ArtifactStageFacts {
  /** The digest-verification status of the artifact, re-hashed HERE (`verified` iff untampered). */
  readonly digestStatus: ReleaseIndexDigestStatus;
  /** The artifact's ARCHIVED release-gate verdict, or `null` if it carried none. */
  readonly gateVerdict: ReleaseGateVerdict | null;
  /** The build's working-tree cleanliness, or `null`. */
  readonly cleanliness: GitCleanliness | null;
  /** The build's bounded ref class, or `null`. */
  readonly refClass: RefClass | null;
  /** Whether a bounded git commit hash was recorded (never the hash itself). */
  readonly commitPresent: boolean;
  /** The bounded class of the operator release label (`absent` if none). */
  readonly labelClass: ReleaseLabelClass;
}

/** The bounded facts reduced from a `pdfxyz.release-index/1` manifest (recomputed against itself). */
export interface IndexStageFacts {
  /** The archive-health verdict RECOMPUTED from the index's own counts (equal to its self-report iff usable). */
  readonly archiveVerdict: ReleaseIndexVerdict;
  readonly indexedArtifacts: number;
  readonly skippedInputs: number;
  /** How many indexed artifacts FAILED digest integrity (mismatch + malformed). */
  readonly integrityFailures: number;
  readonly overRetentionCount: number;
  readonly verdictCounts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly unknown: number;
  };
  /** The coarse age of the NEWEST indexed artifact. */
  readonly newestAgeBucket: ReleaseIndexAgeBucket;
  /** The newest recognized artifact's verdict, or `null`. */
  readonly latestVerdict: ReleaseArtifactVerdict | null;
}

/** The bounded facts reduced from a `pdfxyz.release-policy/1` result (recomputed against itself). */
export interface PolicyStageFacts {
  /** The index archive-health verdict the policy recorded as effective, or `null` if the index was unusable. */
  readonly effectiveVerdict: ReleaseIndexVerdict | null;
  /** Whether the policy evaluated a usable, consistent index. */
  readonly indexUsable: boolean;
  /** How many artifacts the policy's evaluated index counted. */
  readonly indexedArtifacts: number;
  readonly assertionsEvaluated: number;
  readonly blockingViolations: number;
  readonly warningViolations: number;
}

/** The common bounded fields every reduced stage carries. */
interface ReleaseCiBundleStageBase {
  readonly source: ReleaseCiBundleStageSource;
  /** True iff the stage file was supplied AND carried the expected schema tag (usable evidence). */
  readonly present: boolean;
  /** True iff the parsed input carried the expected stage schema tag. */
  readonly recognized: boolean;
  /** The stage's own native verdict token (a bounded enum), or `null` if not present / no valid verdict. */
  readonly verdict: string | null;
  /** The stage's native verdict mapped onto the common bundle severity ladder (`unknown` if not present). */
  readonly severity: ReleaseCiBundleSeverity;
  /** A one-line, content-free headline authored from the stage id + source + severity. */
  readonly detail: string;
}

/**
 * One reduced stage in the bundle — a discriminated union on {@link ReleaseCiBundleStageId} so each
 * stage's `facts` are strongly typed. Every field is a bounded enum, a small integer, or a boolean;
 * never a raw value from the input.
 */
export type ReleaseCiBundleStage =
  | (ReleaseCiBundleStageBase & { readonly stage: "gate"; readonly facts: GateStageFacts | null })
  | (ReleaseCiBundleStageBase & { readonly stage: "artifact"; readonly facts: ArtifactStageFacts | null })
  | (ReleaseCiBundleStageBase & { readonly stage: "index"; readonly facts: IndexStageFacts | null })
  | (ReleaseCiBundleStageBase & { readonly stage: "policy"; readonly facts: PolicyStageFacts | null });

/** One evaluated consistency link — a bounded record of one cross-stage / self-consistency comparison. */
export interface ReleaseCiBundleConsistencyCheck {
  readonly id: ReleaseCiBundleCheckId;
  /** Every consistency link is blocking: a `mismatch` fails the bundle closed. */
  readonly severity: "block";
  readonly status: ReleaseCiBundleCheckStatus;
  /** Bounded, app-authored explanation (keyed by {@link ReleaseCiBundleCheckId} + status). */
  readonly detail: string;
}

/** The composite rollup — the single verdict + exit code an operator/CI acts on. */
export interface ReleaseCiBundleRollup {
  readonly verdict: ReleaseCiBundleVerdict;
  readonly exitCode: ReleaseCiBundleExitCode;
  /** True iff `verdict === "pass"`. */
  readonly ready: boolean;
  /** The bounded reasons the rollup left `pass` (empty on a clean pass). */
  readonly drivers: readonly ReleaseCiBundleDriver[];
  /** True iff all four stages were supplied AND recognized. */
  readonly chainComplete: boolean;
  /** The most authoritative present stage (policy > index > artifact > gate), or `null` if none present. */
  readonly decisionStage: ReleaseCiBundleStageId | null;
  /** How many stages were supplied AND recognized. */
  readonly stagesPresent: number;
  /** How many consistency links mismatched (blocking inconsistencies). */
  readonly inconsistencies: number;
  readonly detail: string;
}

/** The bounded archive guidance — which content-free stage outputs an operator should archive. */
export interface ReleaseCiBundleArchiveGuidance {
  /** The present (supplied + recognized) stage ids whose outputs are the content-free files to archive. */
  readonly stages: readonly ReleaseCiBundleStageId[];
  /** Bounded, app-authored archive note. Never derived from an input. */
  readonly note: string;
}

/** The stable identity block the result records (with the pinned upstream stage schemas). */
export interface ReleaseCiBundleMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_CI_BUNDLE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_CI_BUNDLE_POLICY_VERSION;
  readonly gateSchema: string;
  readonly artifactSchema: string;
  readonly indexSchema: string;
  readonly policySchema: string;
}

/**
 * The stable, content-free release CI bundle an operator or CI archives / gates on. Every field is a
 * bounded enum, a small integer, an ISO stamp, or app-authored prose — so it carries no locator,
 * identifier, size, path, or byte, even from a hostile input.
 */
export interface ReleaseCiBundleResult {
  readonly schema: typeof RELEASE_CI_BUNDLE_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleaseCiBundleMetadata;
  /** One reduced summary per stage, in canonical {@link RELEASE_CI_BUNDLE_STAGE_IDS} order. */
  readonly stages: readonly ReleaseCiBundleStage[];
  /** Every consistency link, in canonical {@link RELEASE_CI_BUNDLE_CHECK_IDS} order. */
  readonly consistency: readonly ReleaseCiBundleConsistencyCheck[];
  readonly rollup: ReleaseCiBundleRollup;
  /** Which content-free stage outputs to archive as CI artifacts. */
  readonly archive: ReleaseCiBundleArchiveGuidance;
  /** The bounded, app-authored next SAFE operator action (keyed by verdict). Never derived from an input. */
  readonly nextAction: string;
  /** Bounded, app-authored guidance (out-of-scope steps this bundle does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested stage. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log/forward verbatim). */
  readonly receipt: ReleaseCiBundleReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to
 * "what did this release CI bundle resolve to, over how many stages, with how many inconsistencies" for
 * a SIEM / release record. Bounded enums + small integers + a stable policy id + the run's own stamp
 * only; safe to log or forward verbatim.
 */
export interface ReleaseCiBundleReceipt {
  readonly category: "worker-release-ci-bundle";
  readonly policyId: typeof RELEASE_CI_BUNDLE_POLICY_ID;
  readonly policyVersion: typeof RELEASE_CI_BUNDLE_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseCiBundleVerdict;
  readonly exitCode: ReleaseCiBundleExitCode;
  /** How many stages were supplied + recognized. */
  readonly stagesPresent: number;
  /** True iff all four stages were present. */
  readonly chainComplete: boolean;
  /** The most authoritative present stage, or `null`. */
  readonly decisionStage: ReleaseCiBundleStageId | null;
  /** How many consistency links mismatched. */
  readonly inconsistencies: number;
}

/** The process exit code for a bundle result. */
export function releaseCiBundleExitCode(result: ReleaseCiBundleResult): number {
  return result.rollup.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested stage)
 * ------------------------------------------------------------------ */

/** The one-line rollup headline per verdict. Authored here, keyed by the enum. */
export const RELEASE_CI_BUNDLE_VERDICT_SUMMARY: Record<ReleaseCiBundleVerdict, string> = {
  pass: "BUNDLE PASS: every supplied release-evidence stage passed, the stages AGREE with each other, and the chain included an archive-decision stage. A coherent, content-free evidence bundle for handoff.",
  warn: "BUNDLE CONCERN: no stage failed and the stages agree, but a supplied stage raised an advisory verdict (a warn). Review the flagged stage, then decide.",
  unknown:
    "BUNDLE NOT CERTIFIED: the chain could not be certified — a supplied stage was unreadable or indeterminate, or NO archive-decision stage (index/policy) was supplied. This is not a pass.",
  fail: "BUNDLE FAIL: a supplied stage FAILED, or two stages DISAGREE (a cross-stage inconsistency / tamper). Do not promote on this bundle until the failure or disagreement is resolved.",
};

/** The next-action headline per verdict — the "next safe operator action". Authored, keyed by the enum. */
export const RELEASE_CI_BUNDLE_NEXT_ACTION: Record<ReleaseCiBundleVerdict, string> = {
  pass: "Archive the bundled content-free stage outputs as CI artifacts alongside this bundle, then proceed with your out-of-band promotion process (this bundle authorizes nothing on its own).",
  warn: "Review the advisory stage (a dirty tree, a retention concern, or a warning-only policy assertion), decide whether to proceed, and archive the bundle either way as the record of that decision.",
  unknown:
    "Treat this as a setup problem, not a pass: supply the missing / unreadable stage (at minimum an index or policy result) and re-run the bundle. Do not promote on an uncertified chain.",
  fail: "Do not promote. Recover the failed / disagreeing stage from your CI archive: a stage `fail` means a real blocker, a consistency `mismatch` means two stages describe different evidence (a tamper or a stale/mixed input). Regenerate the chain and re-bundle.",
};

/** Per-consistency-check authored detail, keyed by id + status. `n/a` (skipped) has one shared line per id. */
export const RELEASE_CI_BUNDLE_CHECK_DETAIL: Record<
  ReleaseCiBundleCheckId,
  { readonly ok: string; readonly mismatch: string; readonly skipped: string }
> = {
  "artifact-digest": {
    ok: "The supplied release artifact re-verified its integrity digest in-process — its archived body was not altered.",
    mismatch:
      "The supplied release artifact FAILED digest re-verification (its recomputed digest did not match its archived one, or the archived digest was malformed): a tampered or corrupt artifact. Recover the untampered artifact from your CI archive.",
    skipped: "No release artifact was supplied, so its integrity digest could not be re-verified.",
  },
  "index-self-consistent": {
    ok: "The supplied release index verified against itself — its counts add up and its archive-health verdict recomputes from those counts.",
    mismatch:
      "The supplied release index does NOT verify against itself (its counts / rollup contradict each other, or it reports a tampered artifact relabeled clean): a hand-edited or tampered manifest. Regenerate the index over the artifacts you trust.",
    skipped: "No release index was supplied, so its internal consistency could not be checked.",
  },
  "policy-self-consistent": {
    ok: "The supplied release policy result recomputed cleanly — its rollup verdict follows from its own recorded facts and assertions.",
    mismatch:
      "The supplied release policy result does NOT recompute — its recorded rollup verdict disagrees with what its own facts + assertions produce (a flipped verdict smuggling a tampered archive past the gate). Regenerate the policy result.",
    skipped: "No release policy result was supplied, so its internal consistency could not be checked.",
  },
  "gate-artifact-agreement": {
    ok: "The release artifact's archived gate verdict matches the standalone release gate's verdict — the artifact archived the same gate decision.",
    mismatch:
      "The release artifact's ARCHIVED gate verdict disagrees with the standalone release gate's verdict — the artifact archived a DIFFERENT gate run than the one supplied. Do not bundle mismatched evidence; regenerate the artifact from the gate you are promoting on.",
    skipped: "Both a release gate and a release artifact are required to compare their gate verdicts; at least one was not supplied.",
  },
  "artifact-index-inclusion": {
    ok: "The supplied release artifact appears among the index's VERIFIED entries with the same verdict — the index actually indexed this artifact and it re-verified there.",
    mismatch:
      "The supplied release artifact is NOT represented among the index's verified entries (its recomputed digest prefix + verdict do not match any verified index entry) — the index does not reflect this artifact. Re-index the artifact you are bundling.",
    skipped: "Both a release artifact and a release index are required to check inclusion; at least one was not supplied / usable.",
  },
  "index-policy-agreement": {
    ok: "The release policy's effective archive verdict + indexed-artifact count match the release index — the policy was evaluated over the same index.",
    mismatch:
      "The release policy's effective archive verdict / indexed-artifact count disagree with the supplied release index — the policy was evaluated over a DIFFERENT index than the one bundled. Re-evaluate the policy over the index you are bundling.",
    skipped: "Both a release index and a release policy result are required to compare them; at least one was not supplied / usable.",
  },
};

/**
 * The honesty caveats every result carries and every text render prints. The bundle COMPOSES the
 * chain's already content-free stage outputs, RE-VERIFIES their consistency, and rolls them up; it must
 * never be read as more than that.
 */
export const RELEASE_CI_BUNDLE_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE CI BUNDLE: it INGESTS whichever of the content-free release-evidence stage outputs (a `pdfxyz.worker-release-gate/1`, `pdfxyz.release-artifact/1`, `pdfxyz.release-index/1`, and/or `pdfxyz.release-policy/1`) a release job produced, RE-VERIFIES their internal + cross-stage consistency, and folds them into ONE handoff result. It is local content-free bundling + consistency checking over evidence — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, or deployment promotion.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, RUNS no stage itself, and NEVER deletes, prunes, uploads, promotes, or mutates any artifact, index, policy, object, or deployment. A `pass` authorizes nothing; it only reports that the stages supplied on THIS host were coherent.",
  "It re-verifies the artifact's integrity digest in-process and recomputes each index/policy stage against itself, and it FAILS CLOSED on disagreement: a stage that failed, a tampered artifact/index/policy, or two stages that describe different evidence forces `fail`. A digest re-verification is TAMPER-EVIDENCE over content-free data, NOT a cryptographic signature — there is no signing key and no attested identity.",
  "It emits only bounded enums, small counts, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job/user id, IP, token, raw ref, raw label, commit URL, size, byte, digest, or document content, even from a hostile stage input, and it never echoes an input file path, even on an error.",
  "A `pass` means the stages supplied MET each other and their own gates on THIS host — not that every archived build passed (the stage verdicts report that separately), that any out-of-band concern (real cloud retention, legal hold, signing, provisioning) is resolved, or that a deployment is approved. Those remain operator-owned.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, or mutates nothing.",
];

/**
 * Out-of-band reminders the bundle carries but does NOT itself perform — the honest edges of an offline
 * composer. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_CI_BUNDLE_GUIDANCE: readonly string[] = [
  "Wire this as the FINAL step of a release CI job, AFTER `worker:release-gate` → `worker:release-artifact` → `worker:release-index` → `worker:release-policy`: run each stage to a file, hand those files to this bundle, fail the pipeline on exit 4 (a stage failure or a cross-stage inconsistency), surface exit 3 (an advisory concern) for review, and treat exit 2 (an unreadable/indeterminate stage, or no archive-decision stage) as a setup error, not a pass.",
  "Supply the stages you actually produced; an unset stage is not a fault, but a bundle with only a gate/artifact (no index or policy) is `unknown` — a single build's signal is not an end-to-end chain decision. For a certifiable bundle, include at least a release-index or a release-policy result.",
  "Archive the bundled content-free stage outputs — plus this bundle — as CI artifacts; the bundle is a content-free handoff record, not a substitute for the stage outputs themselves or for your storage-side retention, signing, and release-approval processes.",
  "Enforce promotion out of band: this bundle REPORTS whether the evidence chain is coherent, but signing a release, provisioning, and promoting a deployment are operator/CI actions this offline composer never performs.",
];
