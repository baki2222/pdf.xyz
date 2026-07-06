/**
 * Test-support builders for the release decision closeout governance finalize index trend finalize INDEX tests (Phase
 * 80).
 *
 * The index ingests `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` FINALIZATION records,
 * so these helpers build REAL, self-consistent finalization records of each finalization verdict — by driving the
 * shipped Phase 79 finalize builder ({@link makeFinalize}) over real Phase 78 primary receipts (and, where a cross-check
 * / posture is exercised, real Phase 74–77 source-chain records, all via the Phase 79 finalize fixtures, which
 * themselves reuse each phase's builders). A finalized / incomplete / open / blocked / invalid record re-derives its own
 * finalization rollup, so the index's trust boundary marks it `usable`; {@link tamperFinalizeVerdict} flips a recorded
 * verdict so it no longer re-derives (a recognized-but-inconsistent record the index catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  advisoryPlan,
  blockedFinalization,
  blockedReceipt,
  coherentFinalization,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  defaultPolicy as finalizeDefaultPolicy,
  incompleteReceipt,
  makeFinalize,
  notAReceipt,
  openFinalization,
  type FinalizeInputs,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize/fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult } from "../release-decision-closeout-governance-finalize-index-trend-finalize/types";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy } from "../release-decision-closeout-governance-finalize-index-trend-finalize/types";
import { ingestFinalize, type IngestedFinalize } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs } from "./args";
import { buildFinalizeIndexResult } from "./build";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexProvider } from "./run";
import {
  DEFAULT_MAX_FINALIZATIONS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
} from "./types";

/** A fixed clock the index tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real finalization-record builders (each self-consistent → usable by the index)
 * ------------------------------------------------------------------ */

/** A FINALIZED record: a completed primary receipt, no source-chain records. */
export function finalizedFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(completedReceipt());
}

/** A FINALIZED record cross-checked against a coherent plan + trend (exercises coherent cross-check signals). */
export function finalizedWithCoherent(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(completedReceipt(), { plan: coherentPlan(), trend: coherentTrend() });
}

/** A FINALIZED record with a coherent index + finalization source chain (exercises source-chain-coherent signals). */
export function finalizedWithSourceChain(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(completedReceipt(), { index: coherentIndex(), finalization: coherentFinalization() });
}

/** A FINALIZE-INCOMPLETE record: a monitor plan reviewed but its acknowledgement absent (an incomplete primary receipt). */
export function incompleteFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(incompleteReceipt());
}

/** A FINALIZE-OPEN record: a completed receipt with an advisory (finalize-open) source-chain record folds `open`. */
export function openFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(completedReceipt(), { finalization: openFinalization() });
}

/** A FINALIZE-BLOCKED record: a block-release plan acknowledged as held (a blocked primary receipt). */
export function blockedFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(blockedReceipt());
}

/** A FINALIZE-BLOCKED record via a cross-check contradiction (a plan that disagrees with the receipt's claim). */
export function contradictoryFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(completedReceipt(), { plan: advisoryPlan() });
}

/** A FINALIZE-BLOCKED record via a blocked source chain (a blocked finalization upstream). */
export function sourceBlockedFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(completedReceipt(), { finalization: blockedFinalization() });
}

/** A FINALIZE-OPEN record via an advisory source chain (an advisory finalization upstream). */
export function sourceAdvisoryFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(completedReceipt(), { finalization: openFinalization() });
}

/** A FINALIZE-INVALID record: an unreadable primary receipt (nothing trustworthy to finalize). Self-consistent. */
export function invalidFinalize(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return makeFinalize(notAReceipt());
}

/** Build a real finalization record for the given finalization verdict (a small dispatcher for table-driven tests). */
export function finalizeFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  switch (verdict) {
    case "finalized":
      return finalizedFinalize();
    case "finalize-incomplete":
      return incompleteFinalize();
    case "finalize-open":
      return openFinalize();
    case "finalize-blocked":
      return blockedFinalize();
    case "finalize-invalid":
      return invalidFinalize();
  }
}

/** The receipt + source-chain inputs a finalization record is built from (a bundle for cross-check + require tests). */
export interface FinalizeObjs extends FinalizeInputs {
  readonly receipt: unknown;
}

/** Build a finalization record with arbitrary receipt + source-chain inputs / policy (for cross-check + require + strict tests). */
export function finalizeWith(
  objs: FinalizeObjs,
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  const { receipt, plan, trend, index, finalization } = objs;
  return makeFinalize(receipt, { plan, trend, index, finalization }, finalizeDefaultPolicy(policy));
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a finalization record's recorded verdict (the top-level headline + the nested `finalize` rollup + the mirrored
 * exit codes) so it no longer re-derives from the record's own recorded primary-receipt source + related-record signals
 * (a re-derivation tamper).
 */
export function tamperFinalizeVerdict(
  finalize: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(finalize)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    finalize: { verdict: string; exitCode: number };
  };
  clone.verdict = to;
  clone.exitCode = exit;
  clone.finalize.verdict = to;
  clone.finalize.exitCode = exit;
  return clone;
}

/** A tampered finalization record (a hand-flipped finalized→blocked ⇒ a `tampered` point). */
export function tamperedFinalize(): Record<string, unknown> {
  return tamperFinalizeVerdict(finalizedFinalize(), "finalize-blocked", 4);
}

/** An input that is NOT a recognized release decision closeout governance finalize record (⇒ an `unreadable` point). */
export function notAFinalize(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout governance finalize record" };
}

/* ------------------------------------------------------------------ *
 *  Index input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no require-latest, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy {
  return {
    maxFinalizations: DEFAULT_MAX_FINALIZATIONS,
    maxOpen: 0,
    maxIncomplete: 0,
    requireLatestFinalized: false,
    strictOpen: false,
    ...over,
  };
}

/** Reduce a list of finalization objects (oldest → newest) to the ingested records the fold consumes. */
export function ingestFinalizeFrom(objs: readonly unknown[]): IngestedFinalize[] {
  return objs.map((obj) => ingestFinalize(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexResult} from a list of finalization objects. */
export function makeIndex(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexResult {
  return buildFinalizeIndexResult(NOW, ingestFinalizeFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied record object by its positional "path" (`finalize-<i>`) or a stdin payload. */
export function makeProvider(
  objs: readonly unknown[],
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexProvider {
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

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs} that reference each record by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexArgs {
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
