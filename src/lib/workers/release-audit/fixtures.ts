/**
 * Test-support builders for the release evidence audit tests (Phase 51).
 *
 * The audit ingests `pdfxyz.release-ci-bundle/1` bundles, so these helpers build REAL, self-consistent
 * bundles of each posture — by composing the Phase 50 bundle over a genuinely coherent gate → artifact →
 * index → policy chain (reusing the shipped release-ci-bundle fixtures + composer). A `pass`/`warn`/`fail`
 * bundle re-derives its own rollup, so the audit's trust boundary marks it `usable`; {@link tamper} flips a
 * recorded verdict so it no longer re-derives (a recognized-but-inconsistent bundle the audit catches).
 *
 * It also exposes SYNTHETIC bounded-facts builders ({@link makeFacts}/{@link usable}/{@link summary}) so the
 * diff/reduce/rollup unit tests can pin one field (a single link `ok → mismatch`, a dropped stage, a
 * warning delta) without threading a whole coherent chain.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`)
 * and is never imported by any runtime module.
 */

import { buildBundleResult } from "../release-ci-bundle/build";
import {
  ingestStagesFrom,
  makeChain,
  makePolicyResult,
  type StageObjects,
} from "../release-ci-bundle/fixtures";
import {
  RELEASE_CI_BUNDLE_CHECK_IDS,
  RELEASE_CI_BUNDLE_STAGE_IDS,
  type ReleaseCiBundleCheckId,
  type ReleaseCiBundleCheckStatus,
  type ReleaseCiBundleResult,
  type ReleaseCiBundleStageId,
  type ReleaseCiBundleVerdict,
} from "../release-ci-bundle/types";
import type { ReleaseIndexVerdict } from "../release-index/types";
import { reduceBundle, type AuditSlot } from "./reduce";
import type {
  AuditBundleFacts,
  AuditBundleSummary,
  AuditPolicy,
  AuditStageView,
  IngestedBundle,
} from "./types";
import type { ReleaseAuditArgs } from "./args";
import type { ReleaseAuditProvider } from "./run";

/** A fixed clock the audit tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real bundle builders (each self-consistent → usable by the audit)
 * ------------------------------------------------------------------ */

/** Build a real, self-consistent `pdfxyz.release-ci-bundle/1` from a subset of coherent stage objects. */
export function makeBundle(objs: StageObjects): ReleaseCiBundleResult {
  return buildBundleResult(NOW, ingestStagesFrom(objs));
}

/** A coherent PASS bundle: index + policy over one clean artifact (verdict `pass`, decision stage policy). */
export function passBundle(): ReleaseCiBundleResult {
  const chain = makeChain();
  return makeBundle({ index: chain.index, policy: chain.policy });
}

/** A coherent PASS bundle over the FULL four-stage chain (used as a coverage baseline). */
export function fullPassBundle(): ReleaseCiBundleResult {
  return makeBundle(makeChain());
}

/** A coherent WARN bundle: a policy that raises a warning-only violation over a warn artifact. */
export function warnBundle(): ReleaseCiBundleResult {
  const chain = makeChain({ generatedAt: NOW, verdict: "warn", gateVerdict: "warn" });
  const warnPolicy = makePolicyResult(chain.index, {
    requireClean: false,
    requireLatestOk: false,
    maxInvalid: null,
    maxFail: null,
    minArtifacts: null,
    maxArtifacts: null,
    maxAgeBucket: null,
    maxWarn: 0, // the archive holds a warn artifact → a warning-only violation
    maxSkipped: null,
    forbidOverRetention: false,
  });
  return makeBundle({ index: chain.index, policy: warnPolicy });
}

/** A coherent FAIL bundle: a policy that fails a blocking assertion the archive cannot meet. */
export function failBundle(): ReleaseCiBundleResult {
  const chain = makeChain();
  const failPolicy = makePolicyResult(chain.index, {
    requireClean: true,
    requireLatestOk: false,
    maxInvalid: null,
    maxFail: null,
    minArtifacts: 99, // more than the archive holds → a blocking violation
    maxArtifacts: null,
    maxAgeBucket: null,
    maxWarn: null,
    maxSkipped: null,
    forbidOverRetention: false,
  });
  return makeBundle({ index: chain.index, policy: failPolicy });
}

/** A coherent UNKNOWN bundle: gate + artifact only, so no archive-decision stage certifies the release. */
export function unknownBundle(): ReleaseCiBundleResult {
  const chain = makeChain();
  return makeBundle({ gate: chain.gate, artifact: chain.artifact });
}

/** An input that is NOT a recognized `pdfxyz.release-ci-bundle/1` (⇒ `bundle-unreadable`, unknown). */
export function notABundle(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release CI bundle" };
}

/**
 * Flip a bundle's recorded rollup verdict so it no longer re-derives from its own stages + links — a
 * recognized-but-self-inconsistent (tampered) bundle the audit catches (⇒ `bundle-tampered`, fail). Returns
 * a plain object (the audit ingests untrusted `unknown` roots).
 */
export function tamper(bundle: ReleaseCiBundleResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(bundle)) as Record<string, unknown> & {
    rollup: { verdict: ReleaseCiBundleVerdict };
  };
  clone.rollup.verdict = bundle.rollup.verdict === "pass" ? "warn" : "pass";
  return clone;
}

/* ------------------------------------------------------------------ *
 *  Synthetic bounded facts (precise control for diff/reduce/rollup)
 * ------------------------------------------------------------------ */

/** Overrides for {@link makeFacts}; every field defaults to a coherent, four-stage PASS bundle. */
export interface FactsOverride {
  verdict?: ReleaseCiBundleVerdict;
  exitCode?: number | null;
  stagesPresent?: number;
  chainComplete?: boolean;
  decisionStage?: ReleaseCiBundleStageId | null;
  inconsistencies?: number;
  warnStages?: number;
  warningSignals?: number;
  archiveVerdict?: ReleaseIndexVerdict | null;
  stages?: Partial<Record<ReleaseCiBundleStageId, AuditStageView>>;
  links?: Partial<Record<ReleaseCiBundleCheckId, ReleaseCiBundleCheckStatus>>;
  policyBlockingViolations?: number;
  policyWarningViolations?: number;
  indexIntegrityFailures?: number;
}

/** Build a bounded {@link AuditBundleFacts} — a coherent four-stage PASS by default, tweaked by `over`. */
export function makeFacts(over: FactsOverride = {}): AuditBundleFacts {
  const stages = {} as Record<ReleaseCiBundleStageId, AuditStageView>;
  for (const id of RELEASE_CI_BUNDLE_STAGE_IDS) stages[id] = { present: true, severity: "pass" };
  Object.assign(stages, over.stages ?? {});
  const links = {} as Record<ReleaseCiBundleCheckId, ReleaseCiBundleCheckStatus>;
  for (const id of RELEASE_CI_BUNDLE_CHECK_IDS) links[id] = "ok";
  Object.assign(links, over.links ?? {});
  const present = RELEASE_CI_BUNDLE_STAGE_IDS.filter((id) => stages[id].present).length;
  return {
    verdict: over.verdict ?? "pass",
    exitCode: over.exitCode !== undefined ? over.exitCode : 0,
    stagesPresent: over.stagesPresent ?? present,
    chainComplete: over.chainComplete ?? present === RELEASE_CI_BUNDLE_STAGE_IDS.length,
    decisionStage: over.decisionStage !== undefined ? over.decisionStage : "policy",
    inconsistencies: over.inconsistencies ?? 0,
    stages,
    links,
    warnStages: over.warnStages ?? 0,
    warningSignals: over.warningSignals ?? 0,
    archiveVerdict: over.archiveVerdict !== undefined ? over.archiveVerdict : "ok",
    policyBlockingViolations: over.policyBlockingViolations ?? 0,
    policyWarningViolations: over.policyWarningViolations ?? 0,
    indexIntegrityFailures: over.indexIntegrityFailures ?? 0,
  };
}

/** A usable (recognized + self-consistent) ingested bundle carrying `over` facts. */
export function usable(over: FactsOverride = {}): IngestedBundle {
  return { recognized: true, usable: true, facts: makeFacts(over) };
}

/** A not-recognized ingested bundle (unreadable). */
export const UNREADABLE: IngestedBundle = { recognized: false, usable: false, facts: null };

/** A recognized-but-self-inconsistent (tampered) ingested bundle carrying its untrusted claimed verdict. */
export function tampered(verdict: ReleaseCiBundleVerdict = "pass"): IngestedBundle {
  return { recognized: true, usable: false, facts: makeFacts({ verdict, stagesPresent: 0 }) };
}

/** Reduce synthetic `over` facts to a bounded {@link AuditBundleSummary} for `slot` (a supplied bundle). */
export function summary(slot: AuditSlot, over: FactsOverride = {}): AuditBundleSummary {
  return reduceBundle(slot, true, usable(over));
}

/* ------------------------------------------------------------------ *
 *  Policy + CLI seams
 * ------------------------------------------------------------------ */

/** The default (strict) audit policy: no warn tolerance, unknown drift stays advisory. */
export const STRICT_POLICY: AuditPolicy = {
  allowWarnRegression: false,
  maxNewWarnings: 0,
  failOnUnknown: false,
};

/** Build an {@link AuditPolicy} from the strict default plus `over`. */
export function policy(over: Partial<AuditPolicy> = {}): AuditPolicy {
  return { ...STRICT_POLICY, ...over };
}

/** Build validated {@link ReleaseAuditArgs} with sensible defaults, overridden by `over`. */
export function makeAuditArgs(over: Partial<ReleaseAuditArgs> & Pick<ReleaseAuditArgs, "mode">): ReleaseAuditArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    allowWarnRegression: false,
    maxNewWarnings: 0,
    failOnUnknown: false,
    ...over,
  };
}

/** Pair-mode args referencing the baseline + current bundles by their provider "path" keys. */
export function pairArgs(over: Partial<ReleaseAuditArgs> = {}): ReleaseAuditArgs {
  return makeAuditArgs({ mode: "pair", baselinePath: "baseline", currentPath: "current", ...over });
}

/**
 * A provider that serves each bundle object by its "path" key (a stringified bundle), and a fixed stdin
 * payload for history `--stdin` mode. A path not in `map` throws (⇒ that bundle is unreadable).
 */
export function makeAuditProvider(map: Record<string, unknown>, stdin = ""): ReleaseAuditProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (!(path in map)) throw new Error("enoent");
      const value = map[path];
      return typeof value === "string" ? value : JSON.stringify(value);
    },
    readStdin: async () => stdin,
  };
}
