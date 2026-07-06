/**
 * Test-support builders for the release decision closeout governance finalize index trend finalize index trend closeout
 * bundle tests (Phase 84).
 *
 * The closeout ingests ONE primary
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/1` receipt plus
 * OPTIONAL related records, so these helpers build REAL, self-consistent records by driving the shipped phase builders: a
 * real Phase 83 receipt over a real Phase 82 plan (reusing the action-receipt fixtures), a real Phase 81 trend / Phase 80
 * finalization-index window (reusing each phase's fixtures). Every built record re-derives its own decision, so the
 * closeout's trust boundary marks it `usable`; the tamper helpers flip a recorded field so a record no longer re-derives.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockPlan,
  clearPlan,
  investigatePlan,
  makeReceipt,
  monitorPlan,
  notAPlan,
  policyWith as receiptPolicyWith,
  tamperedPlan,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-receipt/types";
import {
  degradingTrend,
  notATrend,
  stableTrend,
  tamperedTrend,
  trendFor,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-action-plan/fixtures";
import {
  blockedWindow,
  incompleteWindow,
  indexedWindow,
  invalidWindow,
  notAWindow,
  openWindow,
  tamperedWindow,
  windowFor,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/fixtures";
import { buildCloseoutResult } from "./build";
import {
  absentRecord,
  ingestReceipt,
  ingestRelated,
  type IngestedRelatedRecord,
} from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutArgs } from "./args";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutProvider } from "./run";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutRecordKind,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutResult,
} from "./types";

/** A fixed clock the closeout tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real primary receipts (each self-consistent → usable by the closeout)
 * ------------------------------------------------------------------ */

/** A `completed` receipt: a clear plan acknowledged as reviewed. */
export function completedReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(clearPlan(), receiptPolicyWith({ plan: true }));
}

/** An `incomplete` receipt: a clear plan NOT acknowledged as reviewed. */
export function incompleteReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(clearPlan());
}

/** A `followup-open` receipt: a monitor plan reviewed but its follow-up not acknowledged. */
export function openReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(monitorPlan(), receiptPolicyWith({ plan: true }));
}

/** A `blocked` receipt: a block plan not acknowledged as held-blocked. */
export function blockedReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(blockPlan());
}

/** An `invalid` receipt: its receipted plan was unreadable, so the receipt's OWN verdict is `invalid`. */
export function invalidReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(notAPlan());
}

/** A `completed` investigate receipt: an investigate plan reviewed + its follow-up / investigation acknowledged. */
export function completedInvestigateReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(investigatePlan(), receiptPolicyWith({ plan: true, investigation: true, followups: true }));
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers (the receipt DOC itself is corrupt)
 * ------------------------------------------------------------------ */

/**
 * Flip a receipt's recorded verdict (the top-level headline, the nested `actionReceipt` rollup, and the mirrored exit
 * codes) so it no longer re-derives from the receipt's own recorded source facets (a re-derivation tamper).
 */
export function tamperReceiptVerdict(
  receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionReceiptResult,
  to: "completed" | "incomplete" | "followup-open" | "blocked" | "invalid",
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(receipt)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    actionReceipt: { verdict: string; exitCode: number };
  };
  clone.verdict = to;
  clone.exitCode = exit;
  clone.actionReceipt.verdict = to;
  clone.actionReceipt.exitCode = exit;
  return clone;
}

/** A tampered receipt (a hand-flipped completed→blocked ⇒ a `tampered` source ⇒ an `invalid` closeout). */
export function tamperedReceipt(): Record<string, unknown> {
  return tamperReceiptVerdict(completedReceipt(), "blocked", 4);
}

/** An input that is NOT a recognized release decision action receipt (⇒ `unreadable` ⇒ an `invalid` closeout). */
export function notAReceipt(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision action receipt" };
}

/* ------------------------------------------------------------------ *
 *  Related-record builders (coherent, contradictory, and decoy per kind)
 * ------------------------------------------------------------------ */

/** The COHERENT plan for a `completedReceipt` (the same clear plan the receipt receipted). */
export function coherentPlan(): unknown {
  return clearPlan();
}
/** A plan that CONTRADICTS a `completedReceipt` (a different class / verdict). */
export function contradictoryPlan(): unknown {
  return blockPlan();
}
/** The COHERENT trend for a `completedReceipt` (a `stable` trend, matching its recorded source-trend verdict). */
export function coherentTrend(): unknown {
  return stableTrend();
}
/** A trend that CONTRADICTS a `completedReceipt` (a `degrading` trend ≠ `stable`). */
export function contradictoryTrend(): unknown {
  return degradingTrend();
}
/** The COHERENT finalization-index window (an `indexed` window ⇒ a clean source-chain posture). */
export function coherentIndex(): unknown {
  return indexedWindow();
}

/** Re-export the tamper + decoy helpers of each related kind for direct use in tests. */
export { tamperedPlan, notAPlan };
export { tamperedTrend, notATrend, trendFor };
export { blockedWindow, incompleteWindow, invalidWindow, openWindow, tamperedWindow, notAWindow, windowFor };

/* ------------------------------------------------------------------ *
 *  Closeout input assembly (what build/reduce fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (no strict-open, nothing required). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPolicy {
  return {
    strictOpen: false,
    require: { plan: false, trend: false, index: false },
    ...over,
  };
}

/** A policy with the given require flags and optional strict-open. */
export function policyWith(
  requireOver: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPolicy["require"]> = {},
  strictOpen = false,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPolicy {
  return {
    strictOpen,
    require: { plan: false, trend: false, index: false, ...requireOver },
  };
}

/** The optional related records to compose (each an already-parsed object; omit for `absent`). */
export interface RelatedInputs {
  plan?: unknown;
  trend?: unknown;
  index?: unknown;
}

/** Ingest the three related records from `RelatedInputs` (absent kinds become `absent`). */
export function ingestRelatedInputs(inputs: RelatedInputs = {}): IngestedRelatedRecord[] {
  const kinds: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutRecordKind[] = [
    "plan",
    "trend",
    "index",
  ];
  return kinds.map((kind) =>
    inputs[kind] === undefined ? absentRecord(kind) : ingestRelated(kind, inputs[kind]),
  );
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutResult} from a receipt object + related inputs + policy. */
export function makeCloseout(
  receipt: unknown,
  inputs: RelatedInputs = {},
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutPolicy = defaultPolicy(),
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutResult {
  return buildCloseoutResult(NOW, ingestReceipt(receipt), ingestRelatedInputs(inputs), policy);
}

/**
 * A provider that serves the supplied receipt object by its "path" (`receipt-0`), each related record by its kind path
 * (`plan-0` / `trend-0` / `index-0`), or a stdin payload for the primary receipt.
 */
export function makeProvider(
  files: { receipt?: unknown } & RelatedInputs,
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutProvider {
  const serve = (obj: unknown): string => (typeof obj === "string" ? obj : JSON.stringify(obj));
  const byPath: Record<string, unknown> = {
    "receipt-0": files.receipt,
    "plan-0": files.plan,
    "trend-0": files.trend,
    "index-0": files.index,
  };
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (!(path in byPath) || byPath[path] === undefined) throw new Error("enoent");
      return serve(byPath[path]);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutArgs} that reference the supplied files by their "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    requirePlan: false,
    requireTrend: false,
    requireIndex: false,
    strictOpen: false,
    receiptPath: "receipt-0",
    ...over,
  };
}
