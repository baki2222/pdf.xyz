/**
 * Pure, node-free **policy evaluation** for the release policy CLI (Phase 49).
 *
 * Given the bounded {@link ReleasePolicyFacts} the trust boundary produced and the operator's parsed
 * {@link ReleasePolicyInputs}, this produces the closed list of {@link ReleasePolicyViolation}s — one
 * per configured assertion that did not hold, plus the always-on fail-closed integrity check that a
 * VALID index reporting a tampered artifact cannot pass any policy.
 *
 * Every comparison is a bounded, deterministic function of the facts: a verdict enum equality, a small
 * integer threshold, or an ordered age-bucket comparison. No assertion reads a raw value from the
 * input, and each violation records only a bounded `observed`/`limit` token + an app-authored
 * remediation string. The list is emitted in the stable {@link RELEASE_POLICY_VIOLATIONS} order so the
 * result is deterministic regardless of flag order.
 */

import {
  RELEASE_POLICY_AGE_BOUNDS,
  RELEASE_POLICY_VIOLATION_DETAIL,
  RELEASE_POLICY_VIOLATION_SEVERITY,
  RELEASE_POLICY_VIOLATIONS,
  type ReleaseIndexAgeBucket,
  type ReleasePolicyAgeBound,
  type ReleasePolicyAssertionId,
  type ReleasePolicyFacts,
  type ReleasePolicyInputs,
  type ReleasePolicyViolation,
  type ReleasePolicyViolationId,
} from "./types";

/**
 * The rank of each ordered age bucket for the `--max-age-bucket` comparison — lower is younger. Only
 * the ordered buckets are ranked; `future` and `unknown` are deliberately absent (see
 * {@link ageWithin}).
 */
const AGE_RANK: Record<ReleasePolicyAgeBound, number> = {
  "<1h": 0,
  "1-24h": 1,
  "1-7d": 2,
  "7-30d": 3,
  "30-90d": 4,
  "90d+": 5,
};

/**
 * True iff an observed newest-artifact age is no older than the operator's `bound` bucket. A `future`
 * or `unknown` observed age is NOT within any bound: it cannot confirm freshness, so it fails closed.
 */
export function ageWithin(observed: ReleaseIndexAgeBucket, bound: ReleasePolicyAgeBound): boolean {
  if (!(RELEASE_POLICY_AGE_BOUNDS as readonly string[]).includes(observed)) return false;
  return AGE_RANK[observed as ReleasePolicyAgeBound] <= AGE_RANK[bound];
}

/** Build one bounded violation record, stamping its fixed severity + authored remediation. */
function violation(
  id: ReleasePolicyViolationId,
  observed: number | string,
  limit: number | string | null,
): ReleasePolicyViolation {
  return {
    id,
    severity: RELEASE_POLICY_VIOLATION_SEVERITY[id],
    observed,
    limit,
    detail: RELEASE_POLICY_VIOLATION_DETAIL[id],
  };
}

/**
 * Which assertions the operator actually configured, in the stable {@link ReleasePolicyAssertionId}
 * order — echoed in the result so a reader sees exactly what was asserted (independent of what failed).
 */
export function configuredAssertions(policy: ReleasePolicyInputs): ReleasePolicyAssertionId[] {
  const out: ReleasePolicyAssertionId[] = [];
  if (policy.requireClean) out.push("require-clean");
  if (policy.requireLatestOk) out.push("require-latest-ok");
  if (policy.maxInvalid !== null) out.push("max-invalid");
  if (policy.maxFail !== null) out.push("max-fail");
  if (policy.minArtifacts !== null) out.push("min-artifacts");
  if (policy.maxArtifacts !== null) out.push("max-artifacts");
  if (policy.maxAgeBucket !== null) out.push("max-age-bucket");
  if (policy.maxWarn !== null) out.push("max-warn");
  if (policy.maxSkipped !== null) out.push("max-skipped");
  if (policy.forbidOverRetention) out.push("forbid-over-retention");
  return out;
}

/**
 * Evaluate every configured assertion (plus the always-on integrity check) against `facts`, returning
 * the violations in stable order. Assumes `facts` is from a USABLE index (the malformed/inconsistent
 * cases are handled by the rollup, not here).
 */
export function evaluatePolicy(
  facts: ReleasePolicyFacts,
  policy: ReleasePolicyInputs,
): ReleasePolicyViolation[] {
  const found = new Map<ReleasePolicyViolationId, ReleasePolicyViolation>();
  const add = (id: ReleasePolicyViolationId, observed: number | string, limit: number | string | null) => {
    found.set(id, violation(id, observed, limit));
  };

  // Always-on, fail-closed: a valid index that honestly reports a tampered artifact inside the archive
  // (its archive-health is `invalid`) can never pass a policy, regardless of which flags were set.
  if (facts.archiveVerdict === "invalid") {
    add("index-tampered", "invalid", null);
  }

  // ── Blocking assertions ──
  if (policy.requireClean && facts.archiveVerdict !== "ok") {
    add("index-not-clean", facts.archiveVerdict, "ok");
  }
  if (policy.requireLatestOk && facts.latestVerdict !== "pass") {
    add("latest-not-ok", facts.latestVerdict ?? "none", "pass");
  }
  if (policy.maxInvalid !== null && facts.integrityFailures > policy.maxInvalid) {
    add("too-many-invalid", facts.integrityFailures, policy.maxInvalid);
  }
  if (policy.maxFail !== null && facts.verdictCounts.fail > policy.maxFail) {
    add("too-many-fail", facts.verdictCounts.fail, policy.maxFail);
  }
  if (policy.minArtifacts !== null && facts.indexedArtifacts < policy.minArtifacts) {
    add("too-few-artifacts", facts.indexedArtifacts, policy.minArtifacts);
  }
  if (policy.maxArtifacts !== null && facts.indexedArtifacts > policy.maxArtifacts) {
    add("too-many-artifacts", facts.indexedArtifacts, policy.maxArtifacts);
  }
  if (policy.maxAgeBucket !== null && !ageWithin(facts.newestAgeBucket, policy.maxAgeBucket)) {
    add("archive-stale", facts.newestAgeBucket, policy.maxAgeBucket);
  }

  // ── Warning-only assertions ──
  if (policy.maxWarn !== null && facts.verdictCounts.warn > policy.maxWarn) {
    add("too-many-warn", facts.verdictCounts.warn, policy.maxWarn);
  }
  if (policy.maxSkipped !== null && facts.skippedInputs > policy.maxSkipped) {
    add("too-many-skipped", facts.skippedInputs, policy.maxSkipped);
  }
  if (policy.forbidOverRetention && facts.overRetentionCount > 0) {
    add("over-retention", facts.overRetentionCount, 0);
  }

  // Emit in the canonical violation order for a deterministic result.
  return RELEASE_POLICY_VIOLATIONS.filter((id) => found.has(id)).map((id) => found.get(id)!);
}
