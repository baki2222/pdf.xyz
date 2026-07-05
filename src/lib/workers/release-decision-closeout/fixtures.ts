/**
 * Test-support builders for the release decision closeout bundle tests (Phase 64).
 *
 * The closeout ingests ONE primary `pdfxyz.release-decision-action-receipt/1` receipt plus OPTIONAL related records, so
 * these helpers build REAL, self-consistent records by driving the shipped phase builders: a real Phase 63 receipt over a
 * real Phase 62 plan (reusing the release-decision-action-receipt fixtures), a real Phase 61 trend / Phase 60 index window
 * / Phase 59 decision record (reusing each phase's fixtures). Every built record re-derives its own decision, so the
 * closeout's trust boundary marks it `usable`; the tamper helpers flip a recorded field so a record no longer re-derives.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import { buildActionReceiptResult } from "../release-decision-action-receipt/build";
import { ingestPlan } from "../release-decision-action-receipt/ingest";
import {
  blockedPlan,
  clearPlan,
  investigatePlan,
  watchMonitorPlan,
} from "../release-decision-action-receipt/fixtures";
import type {
  ReleaseDecisionActionReceiptAck,
  ReleaseDecisionActionReceiptResult,
} from "../release-decision-action-receipt/types";
import { stableTrend, trendFor, notATrend, tamperedTrend } from "../release-decision-action-plan/fixtures";
import { windowFor, tamperedWindow, notADecisionIndex } from "../release-decision-trend/fixtures";
import { decisionFor, tamperedDecision, notADecision } from "../release-decision-index/fixtures";
import { buildCloseoutResult } from "./build";
import { absentRecord, ingestReceipt, ingestRelated, type IngestedRelatedRecord } from "./ingest";
import type { ReleaseDecisionCloseoutArgs } from "./args";
import type { ReleaseDecisionCloseoutProvider } from "./run";
import type {
  ReleaseDecisionCloseoutPolicy,
  ReleaseDecisionCloseoutRecordKind,
  ReleaseDecisionCloseoutResult,
} from "./types";

/** A fixed clock the closeout tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real primary receipts (each self-consistent → usable by the closeout)
 * ------------------------------------------------------------------ */

/** Build a bounded acknowledgement set (all false unless overridden). */
function acks(over: Partial<ReleaseDecisionActionReceiptAck> = {}): ReleaseDecisionActionReceiptAck {
  return { plan: false, followups: false, monitor: false, investigation: false, block: false, ...over };
}

/** Build a real Phase 63 receipt over a real Phase 62 plan document, with the given acknowledgements. */
export function receiptFor(
  plan: unknown,
  ackOver: Partial<ReleaseDecisionActionReceiptAck> = {},
): ReleaseDecisionActionReceiptResult {
  return buildActionReceiptResult("2026-07-04T12:00:00.000Z", ingestPlan(plan), {
    strictOpen: false,
    ack: acks(ackOver),
  });
}

/** A `completed` receipt: a clear plan acknowledged as reviewed. */
export function completedReceipt(): ReleaseDecisionActionReceiptResult {
  return receiptFor(clearPlan(), { plan: true });
}

/** An `incomplete` receipt: a clear plan NOT acknowledged as reviewed. */
export function incompleteReceipt(): ReleaseDecisionActionReceiptResult {
  return receiptFor(clearPlan());
}

/** A `followup-open` receipt: a monitor plan reviewed but its follow-up not acknowledged. */
export function openReceipt(): ReleaseDecisionActionReceiptResult {
  return receiptFor(watchMonitorPlan(), { plan: true });
}

/** A `blocked` receipt: a block plan not acknowledged as held-blocked. */
export function blockedReceipt(): ReleaseDecisionActionReceiptResult {
  return receiptFor(blockedPlan());
}

/** An investigate plan (used for a completed investigate receipt). */
export function completedInvestigateReceipt(): ReleaseDecisionActionReceiptResult {
  return receiptFor(investigatePlan(), { plan: true, investigation: true, followups: true });
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers (the receipt DOC itself is corrupt)
 * ------------------------------------------------------------------ */

/**
 * Flip a receipt's recorded verdict (the top-level headline, the nested `actionReceipt` rollup, and the mirrored exit
 * codes) so it no longer re-derives from the receipt's own recorded source facets (a re-derivation tamper).
 */
export function tamperReceiptVerdict(
  receipt: ReleaseDecisionActionReceiptResult,
  to: "completed" | "incomplete" | "followup-open" | "blocked",
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

/** A tampered receipt (a hand-flipped completed→blocked ⇒ a `tampered` source ⇒ a `closeout-blocked`). */
export function tamperedReceipt(): Record<string, unknown> {
  return tamperReceiptVerdict(completedReceipt(), "blocked", 4);
}

/** An input that is NOT a recognized release decision action receipt (⇒ `unreadable` ⇒ `closeout-incomplete`). */
export function notAReceipt(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision action receipt" };
}

/* ------------------------------------------------------------------ *
 *  Related-record builders (coherent, tampered, and decoy per kind)
 * ------------------------------------------------------------------ */

/** The COHERENT plan for a `completedReceipt` (the same clear plan the receipt receipted). */
export function coherentPlan(): unknown {
  return clearPlan();
}
/** A plan that CONTRADICTS a `completedReceipt` (a different class / verdict). */
export function contradictoryPlan(): unknown {
  return blockedPlan();
}
/** The COHERENT trend for a `completedReceipt` (a `stable` trend, matching its recorded source-trend verdict). */
export function coherentTrend(): unknown {
  return stableTrend();
}
/** A trend that CONTRADICTS a `completedReceipt` (a `degrading` trend ≠ `stable`). */
export function contradictoryTrend(): unknown {
  return trendFor("degrading");
}

/** Re-export the tamper + decoy helpers of each related kind for direct use in tests. */
export { tamperedPlan, notAPlan } from "../release-decision-action-receipt/fixtures";
export { tamperedTrend, notATrend, trendFor };
export { windowFor, tamperedWindow, notADecisionIndex };
export { decisionFor, tamperedDecision, notADecision };

/* ------------------------------------------------------------------ *
 *  Closeout input assembly (what build/reduce fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (no strict-open, nothing required). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutPolicy> = {},
): ReleaseDecisionCloseoutPolicy {
  return {
    strictOpen: false,
    require: { plan: false, trend: false, decision: false, index: false },
    ...over,
  };
}

/** A policy with the given require flags and optional strict-open. */
export function policyWith(
  requireOver: Partial<ReleaseDecisionCloseoutPolicy["require"]> = {},
  strictOpen = false,
): ReleaseDecisionCloseoutPolicy {
  return {
    strictOpen,
    require: { plan: false, trend: false, decision: false, index: false, ...requireOver },
  };
}

/** The optional related records to compose (each an already-parsed object; omit for `absent`). */
export interface RelatedInputs {
  plan?: unknown;
  trend?: unknown;
  decision?: unknown;
  index?: unknown;
}

/** Ingest the four related records from `RelatedInputs` (absent kinds become `absent`). */
export function ingestRelatedInputs(inputs: RelatedInputs = {}): IngestedRelatedRecord[] {
  const kinds: ReleaseDecisionCloseoutRecordKind[] = ["plan", "trend", "decision", "index"];
  return kinds.map((kind) =>
    inputs[kind] === undefined ? absentRecord(kind) : ingestRelated(kind, inputs[kind]),
  );
}

/** Build a real {@link ReleaseDecisionCloseoutResult} from a receipt object + related inputs + policy. */
export function makeCloseout(
  receipt: unknown,
  inputs: RelatedInputs = {},
  policy: ReleaseDecisionCloseoutPolicy = defaultPolicy(),
): ReleaseDecisionCloseoutResult {
  return buildCloseoutResult(NOW, ingestReceipt(receipt), ingestRelatedInputs(inputs), policy);
}

/**
 * A provider that serves the supplied receipt object by its "path" (`receipt-0`), each related record by its kind path
 * (`plan-0` / `trend-0` / `decision-0` / `index-0`), or a stdin payload for the primary receipt.
 */
export function makeProvider(
  files: { receipt?: unknown } & RelatedInputs,
  stdin = "",
): ReleaseDecisionCloseoutProvider {
  const serve = (obj: unknown): string => (typeof obj === "string" ? obj : JSON.stringify(obj));
  const byPath: Record<string, unknown> = {
    "receipt-0": files.receipt,
    "plan-0": files.plan,
    "trend-0": files.trend,
    "decision-0": files.decision,
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

/** Build {@link ReleaseDecisionCloseoutArgs} that reference the supplied files by their "path". */
export function makeArgs(over: Partial<ReleaseDecisionCloseoutArgs> = {}): ReleaseDecisionCloseoutArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    requirePlan: false,
    requireTrend: false,
    requireDecision: false,
    requireIndex: false,
    strictOpen: false,
    receiptPath: "receipt-0",
    ...over,
  };
}
