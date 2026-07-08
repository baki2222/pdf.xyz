/**
 * Test-support builders for the release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend closeout index trend closeout
 * INDEX tests (Phase 105).
 *
 * The index ingests `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/1`
 * CLOSEOUT records, so these helpers build REAL, self-consistent closeout records of each closeout verdict — by driving
 * the shipped Phase 104 closeout builder ({@link makeCloseout}) over real Phase 83 primary receipts (and, where a
 * cross-check / posture is exercised, real Phase 80–82 source-chain records, all via the Phase 104 closeout fixtures, which
 * themselves reuse each phase's builders). A closed / incomplete / open / blocked / invalid record re-derives its own
 * closeout coverage rollup, so the index's trust boundary marks it `usable`; {@link tamperCloseoutVerdict} flips a
 * recorded verdict so it no longer re-derives (a recognized-but-inconsistent record the index catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedReceipt,
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
  policyWith as closeoutPolicyWith,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/types";
import type { RelatedInputs } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout/fixtures";
import { ingestCloseout, type IngestedCloseout } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs } from "./args";
import { buildCloseoutIndexResult } from "./build";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexProvider } from "./run";
import {
  DEFAULT_MAX_CLOSEOUTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "./types";

/** A fixed clock the index tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real closeout-record builders (each self-consistent → usable by the index)
 * ------------------------------------------------------------------ */

/** A CLOSED record: a completed primary receipt, no related records. */
export function closedCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt());
}

/** A CLOSED record cross-checked against a coherent plan + trend (exercises coherent cross-check signals). */
export function closedWithCoherent(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { plan: coherentPlan(), trend: coherentTrend() });
}

/** A CLOSED record cross-checked against a coherent trend related record (exercises a coherent cross-check signal). */
export function closedWithSourceChain(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { trend: coherentTrend() });
}

/** An INCOMPLETE record: a clear plan NOT acknowledged (an incomplete primary receipt). */
export function incompleteCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(incompleteReceipt());
}

/** An OPEN record: a monitor plan reviewed but its follow-up not acknowledged (a followup-open primary receipt). */
export function openCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(openReceipt());
}

/** An OPEN record: a followup-open primary receipt whose own verdict is `open` (an advisory follow-up remains open). */
export function sourceAdvisoryCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(openReceipt());
}

/** A BLOCKED record: a block plan not acknowledged as held-blocked (a blocked primary receipt). */
export function blockedCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(blockedReceipt());
}

/** A BLOCKED record via a cross-check contradiction (a plan that disagrees with the receipt's claim). */
export function contradictoryCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { plan: contradictoryPlan() });
}

/** A record carrying a CONTRADICTORY trend related record (a trend that disagrees with the receipt → a blocking cross-check signal). */
export function sourceBlockedCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(completedReceipt(), { trend: contradictoryTrend() });
}

/** An INVALID record: its receipted plan was unreadable, so the receipt's OWN verdict is `invalid`. Self-consistent. */
export function invalidCloseout(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
  return makeCloseout(invalidReceipt());
}

/** Build a real closeout record for the given closeout verdict (a small dispatcher for table-driven tests). */
export function closeoutFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
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

/** Build a closeout record with arbitrary receipt + related inputs + a Phase 104 closeout policy (require / strict-open). */
export function closeoutWith(
  receipt: unknown,
  inputs: RelatedInputs = {},
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutPolicy = closeoutPolicyWith(),
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult {
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
  closeout: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutVerdict,
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

/** Re-export the Phase 104 not-a-receipt decoy (a wrong-schema input for the closeout builder itself, if needed). */
export { notAReceipt };

/* ------------------------------------------------------------------ *
 *  Index input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy {
  return {
    maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
    maxOpen: 0,
    maxIncomplete: 0,
    strictOpen: false,
    requireLatestClosed: false,
    ...over,
  };
}

/** Reduce a list of closeout objects (oldest → newest) to the ingested records the fold consumes. */
export function ingestCloseoutFrom(objs: readonly unknown[]): IngestedCloseout[] {
  return objs.map((obj) => ingestCloseout(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexResult} from a list of closeout objects. */
export function makeIndex(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return buildCloseoutIndexResult(NOW, ingestCloseoutFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied record object by its positional "path" (`closeout-<i>`) or a stdin payload. */
export function makeProvider(
  objs: readonly unknown[],
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexProvider {
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

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs} that reference each record by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
    maxOpen: 0,
    maxIncomplete: 0,
    strictOpen: false,
    requireLatestClosed: false,
    closeoutPaths: objs.map((_, i) => `closeout-${i}`),
    ...over,
  };
}
