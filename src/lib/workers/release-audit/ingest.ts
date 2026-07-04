/**
 * Pure, node-free **bundle ingest** for the release evidence audit (Phase 51) — the trust boundary and the
 * no-leak core.
 *
 * The audit diffs two (or a history of) `pdfxyz.release-ci-bundle/1` bundles. Even though each is already
 * content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, a committed
 * baseline, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded
 * ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a bundle. Every recorded fact
 *    is validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats,
 *    guidance, stamps, archive notes, and any stray extra field are all DROPPED.
 *  - **Re-derive, don't trust.** It reconstructs the bundle's stages + consistency links and RE-RUNS the
 *    Phase 50 {@link computeBundleRollup} over them, then marks the bundle `usable` only if the recorded
 *    rollup (verdict, drivers, decision stage, counts) equals the re-derived one — so a hand-flipped
 *    `rollup.verdict` (smuggling a regression past the gate) is caught as self-inconsistent.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ `bundle-unreadable`,
 *    an insufficient comparison); a recognized-but-inconsistent bundle is `recognized = true, usable =
 *    false` (⇒ `bundle-tampered`, a blocking fail); a coherent bundle yields reduced bounded facts. The
 *    offending content is never echoed.
 */

import {
  RELEASE_CI_BUNDLE_CHECK_IDS,
  RELEASE_CI_BUNDLE_CHECK_STATUSES,
  RELEASE_CI_BUNDLE_DRIVERS,
  RELEASE_CI_BUNDLE_SCHEMA,
  RELEASE_CI_BUNDLE_SEVERITIES,
  RELEASE_CI_BUNDLE_STAGE_IDS,
  RELEASE_CI_BUNDLE_STAGE_SOURCES,
  RELEASE_CI_BUNDLE_VERDICTS,
  type ReleaseCiBundleCheckId,
  type ReleaseCiBundleCheckStatus,
  type ReleaseCiBundleConsistencyCheck,
  type ReleaseCiBundleDriver,
  type ReleaseCiBundleSeverity,
  type ReleaseCiBundleStage,
  type ReleaseCiBundleStageId,
  type ReleaseCiBundleStageSource,
  type ReleaseCiBundleVerdict,
} from "../release-ci-bundle/types";
import { computeBundleRollup } from "../release-ci-bundle/rollup";
import { RELEASE_INDEX_VERDICTS, type ReleaseIndexVerdict } from "../release-index/types";
import type { AuditBundleFacts, AuditStageView, IngestedBundle } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A strict non-negative safe integer, or `undefined`. */
function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** A non-negative integer, or `0` for anything else (a tolerant count with a safe floor). */
function intOr0(value: unknown): number {
  return intOf(value) ?? 0;
}

/** Strictly `true` or `false`, or `undefined`. */
function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-ci-bundle/1`. */
export const UNRECOGNIZED_BUNDLE: IngestedBundle = { recognized: false, usable: false, facts: null };

/** A recognized-but-structurally-broken bundle carrying an (untrusted) claimed verdict, if any. */
function inconsistent(verdict: ReleaseCiBundleVerdict | null): IngestedBundle {
  return {
    recognized: true,
    usable: false,
    facts: verdict === null ? null : brokenFacts(verdict),
  };
}

/** Minimal facts for a recognized-but-not-usable bundle: its claimed verdict only, no trusted detail. */
function brokenFacts(verdict: ReleaseCiBundleVerdict): AuditBundleFacts {
  const stages = {} as Record<ReleaseCiBundleStageId, AuditStageView>;
  for (const id of RELEASE_CI_BUNDLE_STAGE_IDS) stages[id] = { present: false, severity: "unknown" };
  const links = {} as Record<ReleaseCiBundleCheckId, ReleaseCiBundleCheckStatus>;
  for (const id of RELEASE_CI_BUNDLE_CHECK_IDS) links[id] = "skipped";
  return {
    verdict,
    exitCode: null,
    stagesPresent: 0,
    chainComplete: false,
    decisionStage: null,
    inconsistencies: 0,
    stages,
    links,
    warnStages: 0,
    warningSignals: 0,
    archiveVerdict: null,
    policyBlockingViolations: 0,
    policyWarningViolations: 0,
    indexIntegrityFailures: 0,
  };
}

/** The bounded fields of one reduced bundle stage (validated from a `stages[]` entry). */
interface ReducedStage {
  readonly stage: ReleaseCiBundleStageId;
  readonly source: ReleaseCiBundleStageSource;
  readonly present: boolean;
  readonly recognized: boolean;
  readonly verdict: string | null;
  readonly severity: ReleaseCiBundleSeverity;
  /** The stage's bounded facts object (kept only for the index/policy fact extraction; never echoed). */
  readonly facts: Obj | null;
}

/**
 * Validate one `stages[]` entry into a {@link ReducedStage}. Requires a recognized stage id, a valid
 * source/severity, and boolean present/recognized flags; a bad entry returns `undefined` (⇒ the whole
 * bundle is not usable). The `verdict` is kept only as a bounded token (null if off-enum) and the facts
 * object is kept by reference for the numeric extraction below — never rendered.
 */
function reduceStageEntry(entry: unknown, expected: ReleaseCiBundleStageId): ReducedStage | undefined {
  if (!isObject(entry)) return undefined;
  if (entry.stage !== expected) return undefined;
  const source = oneOf(entry.source, RELEASE_CI_BUNDLE_STAGE_SOURCES);
  const severity = oneOf(entry.severity, RELEASE_CI_BUNDLE_SEVERITIES);
  const present = boolOf(entry.present);
  const recognized = boolOf(entry.recognized);
  if (source === undefined || severity === undefined || present === undefined || recognized === undefined) {
    return undefined;
  }
  // The stage's native verdict is a bounded token of some upstream ladder; keep it only as a string or
  // null (we never render it, and the rollup keys on `severity`, not this raw token).
  const verdict = typeof entry.verdict === "string" ? entry.verdict : null;
  return {
    stage: expected,
    source,
    present,
    recognized,
    verdict,
    severity,
    facts: isObject(entry.facts) ? entry.facts : null,
  };
}

/** Reconstruct a typed {@link ReleaseCiBundleStage} for the Phase 50 rollup recompute (facts irrelevant to it). */
function reconStage(r: ReducedStage): ReleaseCiBundleStage {
  const base = {
    source: r.source,
    present: r.present,
    recognized: r.recognized,
    verdict: r.verdict,
    severity: r.severity,
    detail: "",
  };
  switch (r.stage) {
    case "gate":
      return { ...base, stage: "gate", facts: null };
    case "artifact":
      return { ...base, stage: "artifact", facts: null };
    case "index":
      return { ...base, stage: "index", facts: null };
    case "policy":
      return { ...base, stage: "policy", facts: null };
  }
}

/** Validate one `consistency[]` entry into an {id, status} pair, or `undefined` if malformed. */
function reduceLinkEntry(
  entry: unknown,
  expected: ReleaseCiBundleCheckId,
): ReleaseCiBundleCheckStatus | undefined {
  if (!isObject(entry) || entry.id !== expected) return undefined;
  return oneOf(entry.status, RELEASE_CI_BUNDLE_CHECK_STATUSES);
}

/** Compare two driver lists as sets (order-independent, exact membership). */
function sameDrivers(
  a: readonly ReleaseCiBundleDriver[],
  b: readonly ReleaseCiBundleDriver[],
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((d) => set.has(d));
}

/** The recorded rollup fields the recompute must reproduce for a bundle to be `usable`. */
function readRecordedRollup(rollup: Obj):
  | {
      verdict: ReleaseCiBundleVerdict;
      exitCode: number;
      chainComplete: boolean;
      decisionStage: ReleaseCiBundleStageId | null;
      stagesPresent: number;
      inconsistencies: number;
      drivers: ReleaseCiBundleDriver[];
    }
  | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_CI_BUNDLE_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const chainComplete = boolOf(rollup.chainComplete);
  const stagesPresent = intOf(rollup.stagesPresent);
  const inconsistencies = intOf(rollup.inconsistencies);
  const decisionStage =
    rollup.decisionStage === null
      ? null
      : oneOf(rollup.decisionStage, RELEASE_CI_BUNDLE_STAGE_IDS);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    chainComplete === undefined ||
    stagesPresent === undefined ||
    inconsistencies === undefined ||
    decisionStage === undefined
  ) {
    return undefined;
  }
  if (!Array.isArray(rollup.drivers)) return undefined;
  const drivers: ReleaseCiBundleDriver[] = [];
  for (const d of rollup.drivers) {
    const driver = oneOf(d, RELEASE_CI_BUNDLE_DRIVERS);
    if (driver === undefined) return undefined; // an off-enum driver is a corrupt rollup
    drivers.push(driver);
  }
  return { verdict, exitCode, chainComplete, decisionStage, stagesPresent, inconsistencies, drivers };
}

/** Extract the bounded advisory/decision numerics the diff needs from the index + policy stage facts. */
function bundleNumericFacts(stages: readonly ReducedStage[]): {
  archiveVerdict: ReleaseIndexVerdict | null;
  indexWarnArtifacts: number;
  indexIntegrityFailures: number;
  policyWarningViolations: number;
  policyBlockingViolations: number;
} {
  const index = stages.find((s) => s.stage === "index" && s.present);
  const policy = stages.find((s) => s.stage === "policy" && s.present);
  const indexFacts = index?.facts ?? null;
  const policyFacts = policy?.facts ?? null;
  const verdictCounts = isObject(indexFacts?.verdictCounts) ? (indexFacts!.verdictCounts as Obj) : null;
  return {
    archiveVerdict: indexFacts ? (oneOf(indexFacts.archiveVerdict, RELEASE_INDEX_VERDICTS) ?? null) : null,
    indexWarnArtifacts: verdictCounts ? intOr0(verdictCounts.warn) : 0,
    indexIntegrityFailures: indexFacts ? intOr0(indexFacts.integrityFailures) : 0,
    policyWarningViolations: policyFacts ? intOr0(policyFacts.warningViolations) : 0,
    policyBlockingViolations: policyFacts ? intOr0(policyFacts.blockingViolations) : 0,
  };
}

/**
 * Reduce one parsed `pdfxyz.release-ci-bundle/1` `root` to the bounded {@link IngestedBundle}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_BUNDLE}. For a recognized bundle it reconstructs
 * the stages + consistency links, RE-RUNS the Phase 50 rollup over them, and marks the bundle `usable` only
 * if the recorded rollup equals the re-derived one — so a hand-flipped verdict / lied decision stage /
 * hidden inconsistency is caught. Never throws and never echoes the input.
 */
export function ingestBundle(root: unknown): IngestedBundle {
  if (!isObject(root) || root.schema !== RELEASE_CI_BUNDLE_SCHEMA) return UNRECOGNIZED_BUNDLE;

  const rollupObj = isObject(root.rollup) ? root.rollup : undefined;
  const claimedVerdict = rollupObj ? (oneOf(rollupObj.verdict, RELEASE_CI_BUNDLE_VERDICTS) ?? null) : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with
  // the claimed verdict surfaced (untrusted) so the summary can show what the bundle asserted.
  if (rollupObj === undefined) return inconsistent(claimedVerdict);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistent(claimedVerdict);

  const rawStages = Array.isArray(root.stages) ? root.stages : undefined;
  const rawLinks = Array.isArray(root.consistency) ? root.consistency : undefined;
  if (
    rawStages === undefined ||
    rawLinks === undefined ||
    rawStages.length !== RELEASE_CI_BUNDLE_STAGE_IDS.length ||
    rawLinks.length !== RELEASE_CI_BUNDLE_CHECK_IDS.length
  ) {
    return inconsistent(recorded.verdict);
  }

  // The bundle records its stages + links in canonical order; validate each slot against that order.
  const reduced: ReducedStage[] = [];
  for (let i = 0; i < RELEASE_CI_BUNDLE_STAGE_IDS.length; i++) {
    const r = reduceStageEntry(rawStages[i], RELEASE_CI_BUNDLE_STAGE_IDS[i]!);
    if (r === undefined) return inconsistent(recorded.verdict);
    reduced.push(r);
  }
  const linkStatuses = {} as Record<ReleaseCiBundleCheckId, ReleaseCiBundleCheckStatus>;
  const linkList: ReleaseCiBundleConsistencyCheck[] = [];
  for (let i = 0; i < RELEASE_CI_BUNDLE_CHECK_IDS.length; i++) {
    const id = RELEASE_CI_BUNDLE_CHECK_IDS[i]!;
    const status = reduceLinkEntry(rawLinks[i], id);
    if (status === undefined) return inconsistent(recorded.verdict);
    linkStatuses[id] = status;
    linkList.push({ id, severity: "block", status, detail: "" });
  }

  // Re-derive the composite rollup from the bundle's OWN reconstructed stages + links, exactly as the
  // Phase 50 CLI did, and require the recorded rollup to match it in every load-bearing field.
  const rederived = computeBundleRollup(reduced.map(reconStage), linkList);
  const consistent =
    rederived.verdict === recorded.verdict &&
    rederived.exitCode === recorded.exitCode &&
    rederived.chainComplete === recorded.chainComplete &&
    rederived.decisionStage === recorded.decisionStage &&
    rederived.stagesPresent === recorded.stagesPresent &&
    rederived.inconsistencies === recorded.inconsistencies &&
    sameDrivers(rederived.drivers, recorded.drivers);

  if (!consistent) return inconsistent(recorded.verdict);

  // A self-consistent bundle: reduce the bounded facts the diff compares.
  const stageViews = {} as Record<ReleaseCiBundleStageId, AuditStageView>;
  for (const r of reduced) stageViews[r.stage] = { present: r.present, severity: r.severity };
  const warnStages = reduced.filter((s) => s.present && s.severity === "warn").length;
  const num = bundleNumericFacts(reduced);
  const facts: AuditBundleFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    stagesPresent: recorded.stagesPresent,
    chainComplete: recorded.chainComplete,
    decisionStage: recorded.decisionStage,
    inconsistencies: recorded.inconsistencies,
    stages: stageViews,
    links: linkStatuses,
    warnStages,
    warningSignals: warnStages + num.indexWarnArtifacts + num.policyWarningViolations,
    archiveVerdict: num.archiveVerdict,
    policyBlockingViolations: num.policyBlockingViolations,
    policyWarningViolations: num.policyWarningViolations,
    indexIntegrityFailures: num.indexIntegrityFailures,
  };
  return { recognized: true, usable: true, facts };
}
