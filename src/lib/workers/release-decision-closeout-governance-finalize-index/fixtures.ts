/**
 * Test-support builders for the release decision closeout governance finalize index tests (Phase 75).
 *
 * The index ingests `pdfxyz.release-decision-closeout-governance-finalize/1` records, so these helpers build REAL,
 * self-consistent finalization bundles of each finalization verdict — by driving the shipped Phase 74 finalize builder
 * ({@link makeGovernanceFinalize}) over real Phase 73 primary receipts (and, where a cross-check / posture is exercised,
 * real Phase 70–72 related records, all via the finalize fixtures, which themselves reuse each phase's builders). A
 * finalized / incomplete / open / blocked bundle re-derives its own finalization rollup, so the index's trust boundary
 * marks it `usable`; {@link tamperFinalizeVerdict} flips a recorded verdict so it no longer re-derives (a
 * recognized-but-inconsistent record the index catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedIndex,
  blockedReceipt,
  coherentGovernance,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  followupOpenReceipt,
  incompleteReceipt,
  makeGovernanceFinalize,
  openIndex,
  type GovernanceFinalizeObjects,
} from "../release-decision-closeout-governance-finalize/fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizePolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeResult,
} from "../release-decision-closeout-governance-finalize/types";
import { ingestFinalize, type IngestedFinalize } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs } from "./args";
import { buildFinalizeIndexResult } from "./build";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexProvider } from "./run";
import {
  DEFAULT_MAX_FINALIZATIONS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
} from "./types";

/** A fixed clock the index tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real finalization-bundle builders (each self-consistent → usable by the index)
 * ------------------------------------------------------------------ */

/** A FINALIZED bundle: a completed primary receipt, no related records. */
export function finalizedFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: completedReceipt() });
}

/** A FINALIZED bundle cross-checked against a coherent plan + trend (exercises coherent cross-check signals). */
export function finalizedWithCoherent(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: completedReceipt(), plan: coherentPlan(), trend: coherentTrend() });
}

/** A FINALIZED bundle with a coherent index + governance source chain (exercises source-chain-coherent signals). */
export function finalizedWithSourceChain(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: completedReceipt(), index: coherentIndex(), governance: coherentGovernance() });
}

/** A FINALIZE-INCOMPLETE bundle: a clear plan NOT acknowledged as reviewed (an incomplete primary receipt). */
export function incompleteFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: incompleteReceipt() });
}

/** A FINALIZE-OPEN bundle: a monitor plan reviewed but its follow-up not acknowledged (a followup-open receipt). */
export function openFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: followupOpenReceipt() });
}

/** A FINALIZE-BLOCKED bundle: a block plan not acknowledged as held-blocked (a blocked primary receipt). */
export function blockedFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: blockedReceipt() });
}

/** A FINALIZE-BLOCKED bundle via a cross-check contradiction (a plan that disagrees with the receipt). */
export function contradictoryFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: completedReceipt(), plan: contradictoryPlan() });
}

/** A FINALIZE-BLOCKED bundle via a blocked source chain (a blocked governance index upstream). */
export function sourceBlockedFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: completedReceipt(), index: blockedIndex() });
}

/** A FINALIZE-OPEN bundle via an advisory source chain (an open governance index upstream). */
export function sourceAdvisoryFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize({ receipt: completedReceipt(), index: openIndex() });
}

/** Build a real finalization bundle for the given finalization verdict (a small dispatcher for table-driven tests). */
export function finalizeFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  switch (verdict) {
    case "finalized":
      return finalizedFinalize();
    case "finalize-incomplete":
      return incompleteFinalize();
    case "finalize-open":
      return openFinalize();
    case "finalize-blocked":
      return blockedFinalize();
  }
}

/** Build a finalization bundle with arbitrary related inputs / policy (for cross-check + require + strict tests). */
export function finalizeWith(
  objs: GovernanceFinalizeObjects,
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizePolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return makeGovernanceFinalize(objs, policy);
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a finalization bundle's recorded verdict (the top-level headline + the nested `governanceFinalize` rollup + the
 * mirrored exit codes) so it no longer re-derives from the bundle's own recorded primary-receipt source + related-record
 * signals (a re-derivation tamper).
 */
export function tamperFinalizeVerdict(
  finalize: ReleaseDecisionCloseoutGovernanceFinalizeResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(finalize)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    governanceFinalize: { verdict: string; exitCode: number };
  };
  clone.verdict = to;
  clone.exitCode = exit;
  clone.governanceFinalize.verdict = to;
  clone.governanceFinalize.exitCode = exit;
  return clone;
}

/** A tampered finalization bundle (a hand-flipped finalized→blocked ⇒ a `tampered` point). */
export function tamperedFinalize(): Record<string, unknown> {
  return tamperFinalizeVerdict(finalizedFinalize(), "finalize-blocked", 4);
}

/** An input that is NOT a recognized release decision closeout governance finalize bundle (⇒ an `unreadable` point). */
export function notAFinalize(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout governance finalize record" };
}

/* ------------------------------------------------------------------ *
 *  Index input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no require-latest, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy {
  return {
    maxFinalizations: DEFAULT_MAX_FINALIZATIONS,
    maxOpen: 0,
    maxIncomplete: 0,
    requireLatestFinalized: false,
    strictOpen: false,
    ...over,
  };
}

/** Reduce a list of finalization objects (oldest → newest) to the ingested bundles the fold consumes. */
export function ingestFinalizeFrom(objs: readonly unknown[]): IngestedFinalize[] {
  return objs.map((obj) => ingestFinalize(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexResult} from a list of finalization objects. */
export function makeIndex(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  return buildFinalizeIndexResult(NOW, ingestFinalizeFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied bundle object by its positional "path" (`finalize-<i>`) or a stdin payload. */
export function makeProvider(
  objs: readonly unknown[],
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexProvider {
  const byPath = new Map<string, unknown>();
  objs.forEach((obj, i) => byPath.set(`finalize-${i}`, obj));
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (!byPath.has(path)) throw new Error("enoent");
      const obj = byPath.get(path);
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs} that reference each bundle by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxFinalizations: DEFAULT_MAX_FINALIZATIONS,
    maxOpen: 0,
    maxIncomplete: 0,
    requireLatestFinalized: false,
    strictOpen: false,
    finalizationPaths: objs.map((_, i) => `finalize-${i}`),
    ...over,
  };
}
