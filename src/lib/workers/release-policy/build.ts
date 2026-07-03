/**
 * Pure, node-free **composer** for the release policy result (Phase 49).
 *
 * It takes the ingest tri-state ({@link IngestedIndex}) the trust boundary produced, the operator's
 * parsed {@link ReleasePolicyInputs}, the evidence `source`, and the run's own stamp, and folds them
 * into one stable {@link ReleasePolicyResult}: it evaluates the configured assertions (`./evaluate`),
 * computes the composite rollup (`./rollup`), records which assertions were configured, and flattens
 * the audit receipt (`./receipt`).
 *
 * Determinism: the violations and drivers are emitted in canonical order, no field is a raw value from
 * the input, and every fact is a bounded enum / small integer / coarse age bucket — so the same
 * ingested state + policy + stamp always produce a byte-identical result. Honesty: an unusable index
 * is `fail` (never evaluated for a false pass), an empty archive is `unknown`, and every violation
 * carries only a bounded observed/limit token + authored remediation.
 */

import { configuredAssertions, evaluatePolicy } from "./evaluate";
import type { IngestedIndex } from "./ingest";
import { buildReceipt } from "./receipt";
import { computePolicyRollup } from "./rollup";
import {
  RELEASE_INDEX_SCHEMA,
  RELEASE_POLICY_CAVEATS,
  RELEASE_POLICY_GUIDANCE,
  RELEASE_POLICY_POLICY_ID,
  RELEASE_POLICY_POLICY_VERSION,
  RELEASE_POLICY_SCHEMA,
  type ReleasePolicyInputs,
  type ReleasePolicyMetadata,
  type ReleasePolicyResult,
  type ReleasePolicySource,
  type ReleasePolicyViolation,
} from "./types";

/** Assemble the stable identity block (with the pinned release-index input schema). */
export function buildMetadata(): ReleasePolicyMetadata {
  return {
    schemaVersion: RELEASE_POLICY_POLICY_VERSION,
    policyId: RELEASE_POLICY_POLICY_ID,
    policyVersion: RELEASE_POLICY_POLICY_VERSION,
    indexSchema: RELEASE_INDEX_SCHEMA,
  };
}

/**
 * Fold the ingested index + the operator's policy + the evidence source + the run stamp into the full
 * {@link ReleasePolicyResult}. Pure and deterministic.
 */
export function buildPolicyResult(
  generatedAt: string,
  source: ReleasePolicySource,
  ingested: IngestedIndex,
  policy: ReleasePolicyInputs,
): ReleasePolicyResult {
  const assertions = configuredAssertions(policy);

  // Assertions are only meaningful over a usable index; an unrecognized/unusable index is resolved by
  // the rollup alone (unknown / fail), with no per-assertion evaluation.
  const violations: ReleasePolicyViolation[] =
    ingested.usable && ingested.facts !== null ? evaluatePolicy(ingested.facts, policy) : [];

  const rollup = computePolicyRollup(ingested, violations);

  return {
    schema: RELEASE_POLICY_SCHEMA,
    generatedAt,
    metadata: buildMetadata(),
    source,
    indexRecognized: ingested.recognized,
    indexUsable: ingested.usable,
    reportedVerdict: ingested.reportedVerdict,
    effectiveVerdict: ingested.effectiveVerdict,
    policy,
    assertions,
    facts: ingested.facts,
    rollup,
    violations,
    guidance: RELEASE_POLICY_GUIDANCE,
    caveats: RELEASE_POLICY_CAVEATS,
    receipt: buildReceipt(
      generatedAt,
      rollup,
      source,
      ingested.usable,
      ingested.effectiveVerdict,
      assertions.length,
    ),
  };
}
