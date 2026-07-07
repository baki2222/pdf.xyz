/**
 * Test-support builders for the release decision closeout governance finalize index trend finalize index trend closeout index trend closeout
 * INDEX tests (Phase 90).
 *
 * The index ingests `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout/1`
 * CLOSEOUT records, so these helpers build REAL, self-consistent closeout records of each closeout verdict — by driving
 * the shipped Phase 89 closeout builder ({@link makeCloseout}) over real Phase 83 primary receipts (and, where a
 * cross-check / posture is exercised, real Phase 80–82 source-chain records, all via the Phase 89 closeout fixtures, which
 * themselves reuse each phase's builders). A closed / incomplete / open / blocked / invalid record re-derives its own
 * closeout coverage rollup, so the index's trust boundary marks it `usable`; {@link tamperCloseoutVerdict} flips a
 * recorded verdict so it no longer re-derives (a recognized-but-inconsistent record the index catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedReceipt,
  blockedWindow,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  contradictoryTrend,
  incompleteReceipt,
  invalidReceipt,
  makeCloseout,
  notAReceipt,
  openReceipt,
  openWindow,
  policyWith as closeoutPolicyWith,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout/fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout/types";
import type { RelatedInputs } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout/fixtures";
import { ingestCloseout, type IngestedCloseout } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexArgs } from "./args";
import { buildCloseoutIndexResult } from "./build";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexProvider } from "./run";
import {
  DEFAULT_MAX_CLOSEOUTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "./types";

/** A fixed clock the index tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real closeout-record builders (each self-consistent → usable by the index)
 * ------------------------------------------------------------------ */

/** A CLOSED record: a completed primary receipt, no related records. */
export function closedCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt());
}

/** A CLOSED record cross-checked against a coherent plan + trend (exercises coherent cross-check signals). */
export function closedWithCoherent(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { plan: coherentPlan(), trend: coherentTrend() });
}

/** A CLOSED record with a coherent source-chain index window (exercises source-chain-coherent). */
export function closedWithSourceChain(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { index: coherentIndex() });
}

/** An INCOMPLETE record: a clear plan NOT acknowledged (an incomplete primary receipt). */
export function incompleteCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(incompleteReceipt());
}

/** An OPEN record: a monitor plan reviewed but its follow-up not acknowledged (a followup-open primary receipt). */
export function openCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(openReceipt());
}

/** An OPEN record via an advisory source chain (a completed receipt + an index-open window). */
export function sourceAdvisoryCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { index: openWindow() });
}

/** A BLOCKED record: a block plan not acknowledged as held-blocked (a blocked primary receipt). */
export function blockedCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(blockedReceipt());
}

/** A BLOCKED record via a cross-check contradiction (a plan that disagrees with the receipt's claim). */
export function contradictoryCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { plan: contradictoryPlan() });
}

/** A BLOCKED record via a blocked source chain (a completed receipt + an index-blocked window). */
export function sourceBlockedCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { index: blockedWindow() });
}

/** An INVALID record: its receipted plan was unreadable, so the receipt's OWN verdict is `invalid`. Self-consistent. */
export function invalidCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(invalidReceipt());
}

/** Build a real closeout record for the given closeout verdict (a small dispatcher for table-driven tests). */
export function closeoutFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  switch (verdict) {
    case "closed":
      return closedCloseout();
    case "incomplete":
      return incompleteCloseout();
    case "open":
      return openCloseout();
    case "blocked":
      return blockedCloseout();
    case "invalid":
      return invalidCloseout();
  }
}

/** Build a closeout record with arbitrary receipt + related inputs + a Phase 89 closeout policy (require / strict-open). */
export function closeoutWith(
  receipt: unknown,
  inputs: RelatedInputs = {},
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutPolicy = closeoutPolicyWith(),
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(receipt, inputs, policy);
}

/** Re-export the real primary-receipt builders + cross-check / source-chain + closeout-policy helpers for tests. */
export {
  completedReceipt,
  incompleteReceipt,
  openReceipt,
  blockedReceipt,
  invalidReceipt,
  contradictoryTrend,
  coherentPlan,
  coherentTrend,
  coherentIndex,
  openWindow,
  blockedWindow,
  closeoutPolicyWith,
};

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a closeout record's recorded verdict (the top-level headline + the nested `coverage` rollup + the mirrored exit
 * codes) so it no longer re-derives from the record's own recorded primary-receipt + related-record signals (a
 * re-derivation tamper).
 */
export function tamperCloseoutVerdict(
  closeout: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(closeout)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    coverage: { verdict: string; exitCode: number };
  };
  clone.verdict = to;
  clone.exitCode = exit;
  clone.coverage.verdict = to;
  clone.coverage.exitCode = exit;
  return clone;
}

/** A tampered closeout record (a hand-flipped closed→blocked ⇒ a `tampered` point). */
export function tamperedCloseout(): Record<string, unknown> {
  return tamperCloseoutVerdict(closedCloseout(), "blocked", 4);
}

/** An input that is NOT a recognized release decision closeout record (⇒ an `unreadable` point). */
export function notACloseout(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout record" };
}

/** Re-export the Phase 89 not-a-receipt decoy (a wrong-schema input for the closeout builder itself, if needed). */
export { notAReceipt };

/* ------------------------------------------------------------------ *
 *  Index input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexPolicy {
  return {
    maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
    maxOpen: 0,
    maxIncomplete: 0,
    strictOpen: false,
    ...over,
  };
}

/** Reduce a list of closeout objects (oldest → newest) to the ingested records the fold consumes. */
export function ingestCloseoutFrom(objs: readonly unknown[]): IngestedCloseout[] {
  return objs.map((obj) => ingestCloseout(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult} from a list of closeout objects. */
export function makeIndex(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return buildCloseoutIndexResult(NOW, ingestCloseoutFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied record object by its positional "path" (`closeout-<i>`) or a stdin payload. */
export function makeProvider(
  objs: readonly unknown[],
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexProvider {
  const byPath = new Map<string, unknown>();
  objs.forEach((obj, i) => byPath.set(`closeout-${i}`, obj));
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

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexArgs} that reference each record by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
    maxOpen: 0,
    maxIncomplete: 0,
    strictOpen: false,
    closeoutPaths: objs.map((_, i) => `closeout-${i}`),
    ...over,
  };
}
