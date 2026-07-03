/**
 * Pure, node-free **composer** for the release CI bundle result (Phase 50).
 *
 * It takes the ingested stages the trust boundary produced ({@link IngestedStages}) and the run's own
 * stamp, and folds them into one stable {@link ReleaseCiBundleResult}: it reduces each stage to a bounded
 * summary (mapping the stage's native verdict onto the common severity ladder), verifies the consistency
 * links (`./verify`), computes the composite rollup (`./rollup`), derives the archive guidance + next
 * action, and flattens the audit receipt (`./receipt`).
 *
 * Determinism: the stages are emitted in canonical order, the consistency links + drivers in canonical
 * order, no field is a raw value from the input, and every fact is a bounded enum / small integer /
 * boolean — so the same ingested state + stamp always produce a byte-identical result. Honesty: a
 * stage's summary reports its own CLAIM, while the consistency links (verified separately) catch a
 * claim that does not cohere — so a tampered stage that looks clean still fails the bundle closed.
 */

import { buildReceipt } from "./receipt";
import { computeBundleRollup } from "./rollup";
import { verifyConsistency } from "./verify";
import type { IngestedStages } from "./ingest";
import {
  RELEASE_ARTIFACT_SCHEMA,
  RELEASE_CI_BUNDLE_CAVEATS,
  RELEASE_CI_BUNDLE_GUIDANCE,
  RELEASE_CI_BUNDLE_NEXT_ACTION,
  RELEASE_CI_BUNDLE_POLICY_ID,
  RELEASE_CI_BUNDLE_POLICY_VERSION,
  RELEASE_CI_BUNDLE_SCHEMA,
  RELEASE_GATE_SCHEMA,
  RELEASE_INDEX_SCHEMA,
  RELEASE_POLICY_SCHEMA,
  type ReleaseCiBundleArchiveGuidance,
  type ReleaseCiBundleMetadata,
  type ReleaseCiBundleResult,
  type ReleaseCiBundleSeverity,
  type ReleaseCiBundleStage,
  type ReleaseCiBundleStageId,
  type ReleaseCiBundleStageSource,
} from "./types";
import type { ReleaseGateVerdict } from "../release-gate/types";
import type { ReleaseArtifactVerdict } from "../release-artifact/types";
import type { ReleaseIndexVerdict } from "../release-index/types";
import type { ReleasePolicyVerdict } from "../release-policy";

/* ------------------------------------------------------------------ *
 *  Native verdict → common bundle severity maps (one per stage's ladder)
 * ------------------------------------------------------------------ */

const GATE_SEVERITY: Record<ReleaseGateVerdict, ReleaseCiBundleSeverity> = {
  pass: "pass",
  warn: "warn",
  fail: "fail",
  unknown: "unknown",
};
const ARTIFACT_SEVERITY: Record<ReleaseArtifactVerdict, ReleaseCiBundleSeverity> = {
  pass: "pass",
  warn: "warn",
  fail: "fail",
  unknown: "unknown",
};
const INDEX_SEVERITY: Record<ReleaseIndexVerdict, ReleaseCiBundleSeverity> = {
  ok: "pass",
  warn: "warn",
  unknown: "unknown",
  invalid: "fail",
};
const POLICY_SEVERITY: Record<ReleasePolicyVerdict, ReleaseCiBundleSeverity> = {
  pass: "pass",
  warn: "warn",
  unknown: "unknown",
  fail: "fail",
};

/** The source of a stage: not-supplied, supplied-but-unreadable, or supplied+recognized. */
function sourceOf(supplied: boolean, recognized: boolean): ReleaseCiBundleStageSource {
  if (!supplied) return "not-supplied";
  return recognized ? "supplied" : "unreadable";
}

/** A one-line, content-free headline authored from the stage id + source + verdict + severity. */
function stageDetail(
  stage: ReleaseCiBundleStageId,
  source: ReleaseCiBundleStageSource,
  verdict: string | null,
  severity: ReleaseCiBundleSeverity,
): string {
  if (source === "not-supplied") return `${stage}: not supplied.`;
  if (source === "unreadable") {
    return `${stage}: supplied, but not a recognized stage output (unreadable — never echoed). It contributes no certified evidence.`;
  }
  return `${stage}: ${verdict ?? "no-verdict"} (bundle severity ${severity}).`;
}

/* ------------------------------------------------------------------ *
 *  Per-stage summary builders
 * ------------------------------------------------------------------ */

function buildGateStage(stages: IngestedStages): ReleaseCiBundleStage {
  const { supplied, ingested } = stages.gate;
  const recognized = ingested.recognized;
  const source = sourceOf(supplied, recognized);
  const present = source === "supplied";
  const severity: ReleaseCiBundleSeverity =
    present && ingested.verdict !== null ? GATE_SEVERITY[ingested.verdict] : "unknown";
  return {
    stage: "gate",
    source,
    present,
    recognized,
    verdict: present ? ingested.verdict : null,
    severity,
    facts: present ? ingested.facts : null,
    detail: stageDetail("gate", source, ingested.verdict, severity),
  };
}

function buildArtifactStage(stages: IngestedStages): ReleaseCiBundleStage {
  const { supplied, ingested } = stages.artifact;
  const recognized = ingested.digestStatus !== "unreadable";
  const source = sourceOf(supplied, recognized);
  const present = source === "supplied";
  const severity: ReleaseCiBundleSeverity =
    present && ingested.verdict !== null ? ARTIFACT_SEVERITY[ingested.verdict] : "unknown";
  return {
    stage: "artifact",
    source,
    present,
    recognized,
    verdict: present ? ingested.verdict : null,
    severity,
    facts: present
      ? {
          digestStatus: ingested.digestStatus,
          gateVerdict: ingested.gateVerdict,
          cleanliness: ingested.cleanliness,
          refClass: ingested.refClass,
          commitPresent: ingested.commitPresent,
          labelClass: ingested.labelClass,
        }
      : null,
    detail: stageDetail("artifact", source, ingested.verdict, severity),
  };
}

function buildIndexStage(stages: IngestedStages): ReleaseCiBundleStage {
  const { supplied, ingested } = stages.index;
  const recognized = ingested.recognized;
  const source = sourceOf(supplied, recognized);
  const present = source === "supplied";
  const severity: ReleaseCiBundleSeverity =
    present && ingested.verdict !== null ? INDEX_SEVERITY[ingested.verdict] : "unknown";
  return {
    stage: "index",
    source,
    present,
    recognized,
    verdict: present ? ingested.verdict : null,
    severity,
    facts: present ? ingested.facts : null,
    detail: stageDetail("index", source, ingested.verdict, severity),
  };
}

function buildPolicyStage(stages: IngestedStages): ReleaseCiBundleStage {
  const { supplied, ingested } = stages.policy;
  const recognized = ingested.recognized;
  const source = sourceOf(supplied, recognized);
  const present = source === "supplied";
  const severity: ReleaseCiBundleSeverity =
    present && ingested.verdict !== null ? POLICY_SEVERITY[ingested.verdict] : "unknown";
  return {
    stage: "policy",
    source,
    present,
    recognized,
    verdict: present ? ingested.verdict : null,
    severity,
    facts: present ? ingested.facts : null,
    detail: stageDetail("policy", source, ingested.verdict, severity),
  };
}

/** Assemble the four stage summaries in canonical order. */
export function buildStages(ingested: IngestedStages): ReleaseCiBundleStage[] {
  return [
    buildGateStage(ingested),
    buildArtifactStage(ingested),
    buildIndexStage(ingested),
    buildPolicyStage(ingested),
  ];
}

/** Assemble the stable identity block (with the pinned upstream stage schemas). */
export function buildMetadata(): ReleaseCiBundleMetadata {
  return {
    schemaVersion: RELEASE_CI_BUNDLE_POLICY_VERSION,
    policyId: RELEASE_CI_BUNDLE_POLICY_ID,
    policyVersion: RELEASE_CI_BUNDLE_POLICY_VERSION,
    gateSchema: RELEASE_GATE_SCHEMA,
    artifactSchema: RELEASE_ARTIFACT_SCHEMA,
    indexSchema: RELEASE_INDEX_SCHEMA,
    policySchema: RELEASE_POLICY_SCHEMA,
  };
}

/** Which content-free stage outputs to archive — the present stage ids + an authored note. */
function buildArchive(stages: readonly ReleaseCiBundleStage[]): ReleaseCiBundleArchiveGuidance {
  const present = stages.filter((s) => s.present).map((s) => s.stage);
  return {
    stages: present,
    note:
      present.length > 0
        ? "Archive each present stage's content-free output above, plus this bundle, as CI artifacts — they are the release evidence record for this build. This bundle never uploads or promotes them."
        : "No stage was usable, so there is nothing to archive; supply at least a release-index or a release-policy result and re-run.",
  };
}

/**
 * Fold the ingested stages + the run stamp into the full {@link ReleaseCiBundleResult}. Pure and
 * deterministic.
 */
export function buildBundleResult(
  generatedAt: string,
  ingested: IngestedStages,
): ReleaseCiBundleResult {
  const stages = buildStages(ingested);
  const consistency = verifyConsistency(ingested);
  const rollup = computeBundleRollup(stages, consistency);
  const archive = buildArchive(stages);

  return {
    schema: RELEASE_CI_BUNDLE_SCHEMA,
    generatedAt,
    metadata: buildMetadata(),
    stages,
    consistency,
    rollup,
    archive,
    nextAction: RELEASE_CI_BUNDLE_NEXT_ACTION[rollup.verdict],
    guidance: RELEASE_CI_BUNDLE_GUIDANCE,
    caveats: RELEASE_CI_BUNDLE_CAVEATS,
    receipt: buildReceipt(generatedAt, rollup),
  };
}
