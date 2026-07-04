/**
 * Pure, node-free **composer** for the release evidence audit result (Phase 51).
 *
 * It takes the ingested bundle slots the trust boundary produced, the run's stamp + mode + policy, and
 * folds them into one stable {@link ReleaseAuditResult}: it reduces each bundle to a bounded summary
 * (`./reduce`), computes the trust state across ALL supplied bundles, diffs the baseline against the
 * current (`./compare`), rolls the findings up into the composite verdict (`./rollup`), summarizes the
 * history distribution (history mode), and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the summaries, findings, and drivers are emitted in canonical order, no field is a raw
 * value from the input, and every fact is a bounded enum / small integer / boolean — so the same ingested
 * state + stamp always produce a byte-identical result. Honesty: a bundle summary reports its own CLAIM,
 * while the trust state + comparison (evaluated separately) catch a claim that cannot be trusted or a
 * posture that regressed — so a tampered or regressed input still fails the audit closed.
 */

import { bundleTrust, compareBundles, mergeTrust, type AuditTrust } from "./compare";
import { buildAuditReceipt } from "./receipt";
import { reduceBundle, summarizeHistory } from "./reduce";
import { computeAuditRollup } from "./rollup";
import {
  RELEASE_AUDIT_CAVEATS,
  RELEASE_AUDIT_GUIDANCE,
  RELEASE_AUDIT_NEXT_ACTION,
  RELEASE_AUDIT_POLICY_ID,
  RELEASE_AUDIT_POLICY_VERSION,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_CI_BUNDLE_SCHEMA,
  type AuditPolicy,
  type IngestedBundle,
  type ReleaseAuditMetadata,
  type ReleaseAuditMode,
  type ReleaseAuditResult,
} from "./types";

/** One ingested bundle slot: whether a file was supplied for it, and its ingest. */
export interface AuditBundleSlot {
  /** True iff a bundle file was provided for this slot (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  readonly ingested: IngestedBundle;
}

/** The composer's input: the run's stamp + mode + policy, the two compared slots, and (history mode) the list. */
export interface BuildAuditInput {
  readonly generatedAt: string;
  readonly mode: ReleaseAuditMode;
  readonly policy: AuditPolicy;
  readonly baseline: AuditBundleSlot;
  readonly current: AuditBundleSlot;
  /** Every supplied history member (history mode) — used for the trust fold + the distribution. */
  readonly history?: readonly IngestedBundle[];
}

/** Assemble the stable identity block (with the pinned upstream bundle schema). */
export function buildAuditMetadata(): ReleaseAuditMetadata {
  return {
    schemaVersion: RELEASE_AUDIT_POLICY_VERSION,
    policyId: RELEASE_AUDIT_POLICY_ID,
    policyVersion: RELEASE_AUDIT_POLICY_VERSION,
    bundleSchema: RELEASE_CI_BUNDLE_SCHEMA,
  };
}

/** The trust state of one ingested (supplied) bundle. */
function ingestedTrust(ingested: IngestedBundle): AuditTrust {
  return {
    tampered: ingested.recognized && !ingested.usable,
    unreadable: !ingested.recognized,
  };
}

/**
 * Fold the ingested bundle slots + the run stamp/mode/policy into the full {@link ReleaseAuditResult}.
 * Pure and deterministic.
 */
export function buildAuditResult(input: BuildAuditInput): ReleaseAuditResult {
  const baseline = reduceBundle("baseline", input.baseline.supplied, input.baseline.ingested);
  const current = reduceBundle("current", input.current.supplied, input.current.ingested);

  // Trust spans every supplied bundle: in history mode a tampered / unreadable member that is NOT the
  // compared pair must still fail the audit closed. In pair mode the set is just baseline + current.
  const trust =
    input.mode === "history" && input.history
      ? mergeTrust(input.history.map(ingestedTrust))
      : mergeTrust([bundleTrust(baseline), bundleTrust(current)]);

  const { findings, facts } = compareBundles(baseline, current, input.policy, trust);
  const comparable = baseline.usable && current.usable;
  const rollup = computeAuditRollup(findings, input.policy, comparable);
  const history = input.mode === "history" && input.history ? summarizeHistory(input.history) : null;

  return {
    schema: RELEASE_AUDIT_SCHEMA,
    generatedAt: input.generatedAt,
    metadata: buildAuditMetadata(),
    mode: input.mode,
    policy: input.policy,
    baseline,
    current,
    history,
    comparison: facts,
    regressions: findings,
    rollup,
    nextAction: RELEASE_AUDIT_NEXT_ACTION[rollup.verdict],
    guidance: RELEASE_AUDIT_GUIDANCE,
    caveats: RELEASE_AUDIT_CAVEATS,
    receipt: buildAuditReceipt(input.generatedAt, input.mode, rollup),
  };
}
