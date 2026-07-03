/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence policy assertions**
 * (Phase 49).
 *
 * Phases 46–48 built the *promotion → archival → retention* evidence chain: the release readiness gate
 * (`pnpm worker:release-gate`) folds the content-free worker checks into ONE PASS/WARN/FAIL verdict;
 * the release evidence artifact (`pnpm worker:release-artifact`) stamps that result with bounded
 * provenance + an integrity digest into a tamper-evident `pdfxyz.release-artifact/1`; and the release
 * evidence index (`pnpm worker:release-index`) re-verifies MANY of those artifacts' digests and folds
 * them into ONE content-free `pdfxyz.release-index/1` retention manifest. This phase closes the *gate*
 * loop over that manifest: it lets CI/operators answer a policy question the index alone does not —
 *
 *    "Is this release evidence archive ACCEPTABLE under our explicit, bounded release policy? Is it
 *     clean, is the latest build ok, are there few enough failed/warned builds, is it neither too
 *     small nor too large, and is the newest artifact fresh enough — and if not, FAIL CLOSED."
 *
 * — by evaluating a small, explicit set of operator-supplied thresholds against the index's already
 * content-free bounded facts and emitting one stable `pdfxyz.release-policy/1` result + exit code.
 *
 * This module is the closed vocabulary the policy result produces. It obeys the same honesty contract
 * as the rest of the worker layer and is deliberately as content-free as the index it reads:
 *  - Every load-bearing token here is a bounded enum — a verdict, a violation id, a driver, a severity,
 *    an age bucket — never a filename, path, object key, bucket, URL, endpoint, region, id, token,
 *    size, byte, raw ref, raw label, or commit URL. The only non-enum values are small integer counts
 *    / bounds, an ISO stamp, and app-authored prose.
 *  - It never copies a free-text field out of an ingested index (even a "release-index" is UNTRUSTED
 *    input); it reduces every fact to a bounded enum, a small integer, or a coarse age bucket, and it
 *    never echoes an input file path, even on an error.
 *  - It never fabricates a pass: an unreadable / not-a-release-index input is honestly `unknown` (never
 *    a vacuous pass), an empty archive is `unknown`, an index that is malformed / internally
 *    inconsistent / reports a tampered artifact is `fail` (fail-closed), and every configured assertion
 *    is evaluated with a bounded, deterministic comparison.
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, NOT storage-retention ENFORCEMENT, NOT
 * cloud validation, and NOT deployment promotion. It PROVES nothing the index does not already prove;
 * it EVALUATES bounded operator thresholds over the index's content-free facts and re-checks the
 * index's own internal consistency. Its authored caveats (see {@link RELEASE_POLICY_CAVEATS}) say so
 * out loud: it is local bounded policy evaluation over content-free evidence — not signing,
 * authentication, cloud validation, storage retention enforcement, or deployment promotion.
 */

import {
  RELEASE_INDEX_AGE_BUCKETS,
  RELEASE_INDEX_VERDICTS,
  type ReleaseIndexAgeBucket,
  type ReleaseIndexVerdict,
} from "../release-index/types";
import type { ReleaseArtifactVerdict } from "../release-artifact/types";

/** The schema tag every release-policy result carries, so tooling can pin the shape it parses. */
export const RELEASE_POLICY_SCHEMA = "pdfxyz.release-policy/1" as const;

/** Stable identity of the release-policy — for docs / receipts / audit. */
export const RELEASE_POLICY_POLICY_ID = "pdfxyz-worker-release-policy";
/** Bump when the policy surface, the verdict ladder, the violation set, or the result schema changes. */
export const RELEASE_POLICY_POLICY_VERSION = 1;

/** The `pdfxyz.release-index/1` schema the policy evaluates. Re-exported so the result pins its input. */
export { RELEASE_INDEX_SCHEMA } from "../release-index/types";

/**
 * The single policy verdict a CI/operator keys on — about whether the release evidence archive is
 * ACCEPTABLE under the operator's explicit policy, NOT a re-judgement of any build (the artifacts and
 * the index already carry those):
 *  - `pass`    — the input was a valid, internally-consistent `pdfxyz.release-index/1`, its archive is
 *                trustworthy (not tampered), and EVERY configured policy assertion held;
 *  - `warn`    — no blocking assertion failed, but a WARNING-only assertion was violated (a
 *                non-blocking policy concern the operator asked to be told about, not to fail on);
 *  - `unknown` — the policy could not be evaluated: no readable release-index was provided, or the
 *                archive is EMPTY (no indexed artifacts), so there is nothing to assert a policy over;
 *  - `fail`    — a BLOCKING assertion was violated, OR the index is invalid / internally inconsistent /
 *                reports a tampered artifact. The strongest signal; it dominates every other.
 *
 * These are the exact bounded values the run-level {@link import("../observability/metrics").WorkerMetricName}
 * `worker_release_policy_total` carries as its `verdict` label; all four are low-cardinality,
 * redaction-stable tokens shared with the gate/artifact ladders so the whole suite speaks one language.
 */
export const RELEASE_POLICY_VERDICTS = ["pass", "warn", "unknown", "fail"] as const;
export type ReleasePolicyVerdict = (typeof RELEASE_POLICY_VERDICTS)[number];

/**
 * The exit-code ladder a CI/release job routes on — the same shape as the gate/artifact/index ladders:
 *  - `0` PASS    — the archive is acceptable under the policy;
 *  - `1` USAGE   — the CLI was misused (a bad flag, a non-numeric/negative bound, an invalid age
 *                  bucket, both `--index` and `--artifact`, or an unwritable output). CLI-owned;
 *  - `2` UNKNOWN — the policy could not be evaluated (no readable index, or an empty archive);
 *  - `3` WARN    — a warning-only assertion was violated (a non-blocking policy concern);
 *  - `4` FAIL    — a blocking assertion was violated, or the index is invalid / tampered.
 * Monotonic — a higher code is always a stronger "do not promote on this evidence".
 */
export const RELEASE_POLICY_EXIT = {
  PASS: 0,
  USAGE: 1,
  UNKNOWN: 2,
  WARN: 3,
  FAIL: 4,
} as const;
export type ReleasePolicyExitCode = (typeof RELEASE_POLICY_EXIT)[keyof typeof RELEASE_POLICY_EXIT];

/**
 * Where the evaluated index facts came from:
 *  - `index`     — a pre-built `pdfxyz.release-index/1` manifest (from `--index` or stdin) was ingested
 *                  and its self-reported bounded facts + internal consistency were evaluated;
 *  - `artifacts` — one or more raw `pdfxyz.release-artifact/1` files (from `--artifact`) were indexed
 *                  IN-PROCESS (re-verifying each digest via `node:crypto`) into a trusted index, then
 *                  the policy was evaluated over that. The strongest mode: digests are re-hashed here.
 */
export const RELEASE_POLICY_SOURCES = ["index", "artifacts"] as const;
export type ReleasePolicySource = (typeof RELEASE_POLICY_SOURCES)[number];

/**
 * The bounded set of operator ASSERTIONS the policy can evaluate — each gated by an explicit CLI flag
 * (an unset flag asserts nothing). Kept small, explicit, and documented; every one reduces to a
 * bounded comparison over the index's content-free facts. Blocking assertions escalate to `fail`;
 * warning-only assertions escalate at most to `warn`.
 *  - `require-clean`         (block) — the archive's rollup verdict must be `ok`;
 *  - `require-latest-ok`     (block) — the newest indexed artifact's verdict must be `pass`;
 *  - `max-invalid`           (block) — at most N artifacts may have FAILED digest integrity;
 *  - `max-fail`              (block) — at most N indexed artifacts may carry a `fail` verdict;
 *  - `min-artifacts`         (block) — at least N artifacts must be indexed;
 *  - `max-artifacts`         (block) — at most N artifacts may be indexed;
 *  - `max-age-bucket`        (block) — the newest artifact must be no older than a given age bucket;
 *  - `max-warn`              (warn)  — at most N indexed artifacts may carry a `warn` verdict;
 *  - `max-skipped`           (warn)  — at most N inputs may have been skipped as unreadable;
 *  - `forbid-over-retention` (warn)  — no artifact may be flagged over the index's retention bounds.
 */
export const RELEASE_POLICY_ASSERTIONS = [
  "require-clean",
  "require-latest-ok",
  "max-invalid",
  "max-fail",
  "min-artifacts",
  "max-artifacts",
  "max-age-bucket",
  "max-warn",
  "max-skipped",
  "forbid-over-retention",
] as const;
export type ReleasePolicyAssertionId = (typeof RELEASE_POLICY_ASSERTIONS)[number];

/** The severity of a violated assertion. `block` ⇒ `fail`; `warn` ⇒ at most `warn`. */
export const RELEASE_POLICY_SEVERITIES = ["block", "warn"] as const;
export type ReleasePolicySeverity = (typeof RELEASE_POLICY_SEVERITIES)[number];

/**
 * The bounded ids of every policy VIOLATION the result can carry — a closed set a reader routes on
 * without parsing prose. Two are structural (fired by the fail-closed integrity check, not by a flag);
 * the rest each correspond to one violated {@link ReleasePolicyAssertionId}:
 *  - `index-invalid`       (block) — the input claimed to be a release-index but is malformed or
 *                                    internally inconsistent (its counts/rollup contradict): tampered;
 *  - `index-tampered`      (block) — a VALID index reports a tampered/corrupt artifact inside the
 *                                    archive (its archive-health is `invalid`); fail-closed regardless
 *                                    of flags — you cannot pass policy over an archive you cannot trust;
 *  - `index-not-clean`     (block) — `--require-clean`: the archive rollup verdict is not `ok`;
 *  - `latest-not-ok`       (block) — `--require-latest-ok`: the newest artifact's verdict is not `pass`;
 *  - `too-many-invalid`    (block) — `--max-invalid`: more integrity failures than allowed;
 *  - `too-many-fail`       (block) — `--max-fail`: more `fail`-verdict artifacts than allowed;
 *  - `too-few-artifacts`   (block) — `--min-artifacts`: fewer artifacts indexed than required;
 *  - `too-many-artifacts`  (block) — `--max-artifacts`: more artifacts indexed than allowed;
 *  - `archive-stale`       (block) — `--max-age-bucket`: the newest artifact is older than the bound
 *                                    (or its age is `future`/`unknown`, which cannot confirm freshness);
 *  - `too-many-warn`       (warn)  — `--max-warn`: more `warn`-verdict artifacts than allowed;
 *  - `too-many-skipped`    (warn)  — `--max-skipped`: more skipped/unreadable inputs than allowed;
 *  - `over-retention`      (warn)  — `--forbid-over-retention`: an artifact is over the index's bounds.
 */
export const RELEASE_POLICY_VIOLATIONS = [
  "index-invalid",
  "index-tampered",
  "index-not-clean",
  "latest-not-ok",
  "too-many-invalid",
  "too-many-fail",
  "too-few-artifacts",
  "too-many-artifacts",
  "archive-stale",
  "too-many-warn",
  "too-many-skipped",
  "over-retention",
] as const;
export type ReleasePolicyViolationId = (typeof RELEASE_POLICY_VIOLATIONS)[number];

/** The fixed severity of each violation id (drives the rollup: any `block` ⇒ `fail`). */
export const RELEASE_POLICY_VIOLATION_SEVERITY: Record<ReleasePolicyViolationId, ReleasePolicySeverity> = {
  "index-invalid": "block",
  "index-tampered": "block",
  "index-not-clean": "block",
  "latest-not-ok": "block",
  "too-many-invalid": "block",
  "too-many-fail": "block",
  "too-few-artifacts": "block",
  "too-many-artifacts": "block",
  "archive-stale": "block",
  "too-many-warn": "warn",
  "too-many-skipped": "warn",
  "over-retention": "warn",
};

/**
 * The bounded reasons the rollup resolved to a non-`pass` verdict — a closed set, emitted in this
 * stable order so the reason set is deterministic:
 *  - `no-index`           — no readable release-index was provided ⇒ `unknown`;
 *  - `invalid-index`      — the index is malformed / inconsistent / reports a tampered artifact ⇒ `fail`;
 *  - `blocking-violation` — at least one blocking assertion failed ⇒ `fail`;
 *  - `empty-archive`      — a usable index indexed ZERO artifacts ⇒ `unknown` (nothing to assert);
 *  - `warning-violation`  — at least one warning-only assertion failed ⇒ `warn`.
 */
export const RELEASE_POLICY_DRIVERS = [
  "no-index",
  "invalid-index",
  "blocking-violation",
  "empty-archive",
  "warning-violation",
] as const;
export type ReleasePolicyDriver = (typeof RELEASE_POLICY_DRIVERS)[number];

/**
 * The age buckets that are meaningful as a `--max-age-bucket` freshness THRESHOLD — the ordered subset
 * of {@link ReleaseIndexAgeBucket}, oldest-allowed first. `future` and `unknown` are excluded: they are
 * not an ordered age and so cannot bound "no older than". An observed `future`/`unknown` newest age is
 * treated as failing any threshold (it cannot confirm freshness).
 */
export const RELEASE_POLICY_AGE_BOUNDS = [
  "<1h",
  "1-24h",
  "1-7d",
  "7-30d",
  "30-90d",
  "90d+",
] as const;
export type ReleasePolicyAgeBound = (typeof RELEASE_POLICY_AGE_BOUNDS)[number];

/**
 * The parsed, bounded policy the CLI evaluated — echoed verbatim in the result so a reader knows
 * exactly what was asserted. Each field is `null`/`false` when its flag was not supplied; the numeric
 * bounds are non-negative integers; `maxAgeBucket` is a bounded ordered age. Content-free by
 * construction (no path, no locator).
 */
export interface ReleasePolicyInputs {
  readonly requireClean: boolean;
  readonly requireLatestOk: boolean;
  readonly maxInvalid: number | null;
  readonly maxFail: number | null;
  readonly minArtifacts: number | null;
  readonly maxArtifacts: number | null;
  readonly maxAgeBucket: ReleasePolicyAgeBound | null;
  readonly maxWarn: number | null;
  readonly maxSkipped: number | null;
  readonly forbidOverRetention: boolean;
}

/**
 * The bounded, content-free facts the policy evaluates — reduced from the ingested index (or the
 * in-process build of the supplied artifacts). Every field is a bounded enum, a small integer, or a
 * coarse age bucket; never a filename, path, locator, size, byte, raw ref, or raw label.
 */
export interface ReleasePolicyFacts {
  /** The archive-health verdict of the index (recomputed from its own counts; equal to its self-report). */
  readonly archiveVerdict: ReleaseIndexVerdict;
  /** How many recognized `pdfxyz.release-artifact/1` artifacts the index counted. */
  readonly indexedArtifacts: number;
  /** How many inputs the index skipped as unreadable / not-an-artifact. */
  readonly skippedInputs: number;
  /** How many inputs the index saw in total (recognized artifacts + skipped inputs). */
  readonly totalInputs: number;
  /** How many indexed artifacts FAILED digest integrity (mismatch + malformed). */
  readonly integrityFailures: number;
  /** Per-artifact-verdict counts over the recognized artifacts. */
  readonly verdictCounts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly unknown: number;
  };
  /** How many indexed artifacts the index flagged as over its retention bounds (prune candidates). */
  readonly overRetentionCount: number;
  /** The index's retention posture (as it reported). */
  readonly overCount: boolean;
  readonly overAge: boolean;
  readonly stale: boolean;
  /** The coarse age of the NEWEST indexed artifact (`unknown` if none / unsafe stamp). */
  readonly newestAgeBucket: ReleaseIndexAgeBucket;
  /** The coarse age of the OLDEST indexed artifact (`unknown` if none / unsafe stamp). */
  readonly oldestAgeBucket: ReleaseIndexAgeBucket;
  /** The newest recognized artifact's verdict, or `null` if none was indexed / it carried no verdict. */
  readonly latestVerdict: ReleaseArtifactVerdict | null;
}

/**
 * One evaluated policy VIOLATION — a bounded record of a single assertion that failed. Every field is a
 * bounded enum or a small integer / bounded age token; never a raw value from the input.
 */
export interface ReleasePolicyViolation {
  readonly id: ReleasePolicyViolationId;
  readonly severity: ReleasePolicySeverity;
  /** What the archive actually showed — a small integer count, or a bounded enum / age-bucket token. */
  readonly observed: number | string;
  /** The operator's bound — a small integer, a bounded enum / age token, or `null` for a boolean assertion. */
  readonly limit: number | string | null;
  /** Bounded, app-authored remediation guidance (keyed by {@link ReleasePolicyViolationId}). */
  readonly detail: string;
}

/** The composite rollup — the single verdict + exit code an operator/CI acts on. */
export interface ReleasePolicyRollup {
  readonly verdict: ReleasePolicyVerdict;
  readonly exitCode: ReleasePolicyExitCode;
  /** True iff `verdict === "pass"`. */
  readonly ready: boolean;
  /** The bounded reasons the rollup left `pass` (empty on a clean pass). */
  readonly drivers: readonly ReleasePolicyDriver[];
  /** How many blocking assertions were violated. */
  readonly blockingViolations: number;
  /** How many warning-only assertions were violated. */
  readonly warningViolations: number;
  readonly detail: string;
}

/** The stable identity block the result records. */
export interface ReleasePolicyMetadata {
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_POLICY_POLICY_ID;
  readonly policyVersion: typeof RELEASE_POLICY_POLICY_VERSION;
  /** The `pdfxyz.release-index/1` schema the policy evaluated. */
  readonly indexSchema: string;
}

/**
 * The stable, content-free release policy result an operator or CI archives / gates on. Every field is
 * a bounded enum, a small integer, a coarse age bucket, an ISO stamp, or app-authored prose — so it
 * carries no locator, identifier, size, path, or byte, even from a hostile input.
 */
export interface ReleasePolicyResult {
  readonly schema: typeof RELEASE_POLICY_SCHEMA;
  readonly generatedAt: string;
  readonly metadata: ReleasePolicyMetadata;
  /** Where the evaluated facts came from (`index` manifest vs in-process `artifacts` build). */
  readonly source: ReleasePolicySource;
  /** True iff the input carried the `pdfxyz.release-index/1` schema tag (always true for `artifacts`). */
  readonly indexRecognized: boolean;
  /** True iff the recognized index was structurally valid AND internally consistent. */
  readonly indexUsable: boolean;
  /** The index's SELF-REPORTED archive-health verdict, or `null` if it was unreadable. */
  readonly reportedVerdict: ReleaseIndexVerdict | null;
  /** The archive-health verdict RECOMPUTED from the index's own counts, or `null` if unusable. */
  readonly effectiveVerdict: ReleaseIndexVerdict | null;
  /** The evaluated bounded policy flags. */
  readonly policy: ReleasePolicyInputs;
  /** Which assertions were configured (in stable {@link RELEASE_POLICY_ASSERTIONS} order). */
  readonly assertions: readonly ReleasePolicyAssertionId[];
  /** The bounded index facts the policy evaluated, or `null` if the index was unusable. */
  readonly facts: ReleasePolicyFacts | null;
  readonly rollup: ReleasePolicyRollup;
  /** Every violated assertion, in stable {@link RELEASE_POLICY_VIOLATIONS} order (empty on a pass). */
  readonly violations: readonly ReleasePolicyViolation[];
  /** Bounded, app-authored guidance (out-of-scope steps this policy does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested index. */
  readonly caveats: readonly string[];
  /** The flattened audit receipt (safe to log/forward verbatim). */
  readonly receipt: ReleasePolicyReceipt;
}

/**
 * The content-free **audit receipt** the result rides alongside its body — the flattened answer to
 * "what did this policy evaluation resolve to, over what evidence, under how many assertions" for a
 * SIEM / release record. Bounded enums + small integers + a stable policy id + the run's own stamp
 * only; safe to log or forward verbatim.
 */
export interface ReleasePolicyReceipt {
  readonly category: "worker-release-policy";
  readonly policyId: typeof RELEASE_POLICY_POLICY_ID;
  readonly policyVersion: typeof RELEASE_POLICY_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleasePolicyVerdict;
  readonly exitCode: ReleasePolicyExitCode;
  readonly source: ReleasePolicySource;
  /** True iff a usable, consistent index was evaluated. */
  readonly indexUsable: boolean;
  /** The recomputed archive-health verdict, or `null` if the index was unusable. */
  readonly effectiveVerdict: ReleaseIndexVerdict | null;
  /** How many assertions the operator configured. */
  readonly assertionsEvaluated: number;
  /** How many blocking assertions were violated. */
  readonly blockingViolations: number;
  /** How many warning-only assertions were violated. */
  readonly warningViolations: number;
}

/** The process exit code for a policy result. */
export function releasePolicyExitCode(result: ReleasePolicyResult): number {
  return result.rollup.exitCode;
}

/* ------------------------------------------------------------------ *
 *  Re-exports of the input vocabulary (for consumers that only import this module)
 * ------------------------------------------------------------------ */

export {
  RELEASE_INDEX_AGE_BUCKETS,
  RELEASE_INDEX_VERDICTS,
  type ReleaseIndexAgeBucket,
  type ReleaseIndexVerdict,
};

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested index)
 * ------------------------------------------------------------------ */

/** The one-line rollup headline per verdict. Authored here, keyed by the enum. */
export const RELEASE_POLICY_VERDICT_SUMMARY: Record<ReleasePolicyVerdict, string> = {
  pass: "POLICY PASS: the release evidence archive is a valid, internally-consistent, untampered index, and every configured policy assertion held. Acceptable to promote on under this policy.",
  warn: "POLICY CONCERN: no blocking assertion failed, but a warning-only assertion was violated (a non-blocking concern the operator chose to be told about, not to fail on). Review, then decide.",
  unknown:
    "POLICY NOT EVALUATED: no readable `pdfxyz.release-index/1` was provided, or the archive is empty (no indexed artifacts). There is nothing to assert a release policy over; this is not a pass.",
  fail: "POLICY FAIL: a blocking assertion was violated, or the index is invalid / internally inconsistent / reports a tampered artifact. Do not promote on this evidence until the violation is resolved.",
};

/**
 * Per-violation remediation guidance — authored here, keyed by the violation id, never derived from an
 * input. Each is a bounded, content-free instruction an operator acts on.
 */
export const RELEASE_POLICY_VIOLATION_DETAIL: Record<ReleasePolicyViolationId, string> = {
  "index-invalid":
    "The input claimed to be a `pdfxyz.release-index/1` but is malformed or its own counts/rollup contradict each other — a corrupt or hand-edited manifest. Re-generate the index with `pnpm worker:release-index` over the artifacts you trust; do not gate on a manifest that does not verify against itself.",
  "index-tampered":
    "The index is well-formed but reports a tampered/corrupt artifact inside the archive (its archive-health is `invalid`). Recover the untampered artifact from your CI archive and re-run `pnpm worker:release-index`; do not promote on an archive that contains a tampered artifact.",
  "index-not-clean":
    "`--require-clean` requires the archive rollup verdict to be `ok`, but it is not. Resolve the index's own concern (a tampered artifact ⇒ `invalid`, retention drift ⇒ `warn`, an empty archive ⇒ `unknown`) before promoting.",
  "latest-not-ok":
    "`--require-latest-ok` requires the newest indexed artifact's verdict to be `pass`, but it is not. Ship from a build whose release-gate passed, or drop the requirement if a warn/fail latest is expected.",
  "too-many-invalid":
    "More indexed artifacts failed digest integrity than `--max-invalid` allows. Recover the untampered artifacts from your CI archive and re-index; each integrity failure is a tampered or corrupt archived artifact.",
  "too-many-fail":
    "More indexed artifacts carry a `fail` verdict than `--max-fail` allows. This counts faithfully-archived failed builds in history; prune old failed artifacts from the archive or raise the bound if that history is expected.",
  "too-few-artifacts":
    "Fewer artifacts were indexed than `--min-artifacts` requires. Point the index at the full set of archived release artifacts, or lower the requirement; a near-empty archive may mean an incomplete CI upload.",
  "too-many-artifacts":
    "More artifacts were indexed than `--max-artifacts` allows — a retention-count drift. Prune the oldest archived artifacts out of band (this tool never deletes), or raise the bound.",
  "archive-stale":
    "The newest indexed artifact is older than `--max-age-bucket` allows (or its age is `future`/`unknown`, which cannot confirm freshness). Archive a fresh release artifact, or widen the freshness window.",
  "too-many-warn":
    "More indexed artifacts carry a `warn` verdict than `--max-warn` allows. Investigate the warned builds (a dirty tree, a soft gate concern); this is a warning-only concern, not a hard block.",
  "too-many-skipped":
    "More inputs were skipped as unreadable / not-a-release-artifact than `--max-skipped` allows. Check the archive for stray or corrupt files; this is a warning-only concern.",
  "over-retention":
    "`--forbid-over-retention` requires no artifact to be flagged over the index's retention bounds, but at least one is. Prune the over-retention artifacts out of band, or re-index with looser `--max-artifacts`/`--max-age-days`; this is a warning-only concern.",
};

/**
 * The honesty caveats every result carries and every text render prints. The policy EVALUATES bounded
 * operator thresholds over the index's content-free facts and re-checks the index's internal
 * consistency; it must never be read as more than that.
 */
export const RELEASE_POLICY_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE POLICY EVALUATION: it checks a small, explicit set of operator-supplied thresholds against the bounded, content-free facts of a `pdfxyz.release-index/1` manifest (or an in-process index of `pdfxyz.release-artifact/1` files). It is local bounded policy evaluation over content-free evidence — NOT signing, authentication, cloud validation, storage retention ENFORCEMENT, or deployment promotion.",
  "It is offline and READ-ONLY: it makes NO network call, reads NO secret, bucket, or object, and NEVER deletes, prunes, uploads, expires, promotes, or mutates any artifact, index, object, or deployment. A `pass` authorizes nothing; it only reports that the archive met the policy on THIS host.",
  "It evaluates bounded facts, not raw evidence. In `--index` mode it TRUSTS the index's self-reported bounded counts, but it FAILS CLOSED on an index that does not verify against itself: it recomputes the archive-health verdict from the index's own counts and rejects one whose counts or rollup are inconsistent, and it rejects a valid index that reports a tampered artifact. To re-hash the artifacts themselves, run in `--artifact` mode, which builds the index in-process and re-verifies every digest.",
  "It emits only bounded enums, small counts, coarse age buckets, an ISO stamp, and app-authored prose — so it carries no filename, path, object key, bucket, URL, endpoint, region, job/user id, IP, token, raw ref, raw label, commit URL, size, byte, or document content, even from a hostile input, and it never echoes an input file path, even on an error.",
  "A `pass` means the archive met YOUR explicit policy — not that every archived build passed (the per-verdict counts report that separately), that any out-of-band concern (real cloud retention, legal hold, storage cost, signing, provisioning) is resolved, or that a deployment is approved. Those remain operator-owned.",
  "It is not malware scanning, sanitization, authorization, cloud validation, or deletion proof of any request or object, and it deletes, uploads, promotes, or mutates nothing.",
];

/**
 * Out-of-band reminders the policy carries but does NOT itself perform — the honest edges of an offline
 * policy gate. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_POLICY_GUIDANCE: readonly string[] = [
  "Wire this as a CI GATE after `worker:release-artifact` → `worker:release-index`: fail the pipeline on exit 4 (a blocking violation or a tampered index), surface exit 3 (a warning concern) for review, and treat exit 2 (no readable index / empty archive) as a setup error, not a pass.",
  "Keep the policy EXPLICIT and in version control: set only the assertions you mean (`--require-clean`, `--min-artifacts`, `--max-fail`, `--max-age-bucket`, …). An unset flag asserts nothing; running with no assertions checks only the index's structural integrity.",
  "Enforce retention and promotion out of band: this gate FLAGS an over-large / stale / non-clean archive, but pruning artifacts, signing a release, and promoting a deployment are operator/CI actions this offline policy never performs.",
  "Archive this result as a CI artifact alongside the index it evaluated; it is a content-free policy record, not a substitute for the artifacts, the index, or your storage-side retention and release-approval processes.",
];
