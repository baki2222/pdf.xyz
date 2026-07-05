/**
 * Test-support builders for the release decision closeout governance finalization bundle tests (Phase 74).
 *
 * The bundle ingests a REQUIRED `pdfxyz.release-decision-closeout-governance-action-receipt/1` primary receipt plus,
 * optionally, the related closeout-governance-chain records, so these helpers build REAL, self-consistent documents of
 * each posture — by driving the shipped Phase 73 receipt builder ({@link makeReceipt}) over genuinely coherent Phase 72
 * plans (reusing the release-decision-closeout-governance-action-receipt fixtures, which themselves reuse the plan /
 * trend / index / governance builders), and by reusing the shipped Phase 70–72 record builders for the related records. A
 * completed / incomplete / followup-open / blocked receipt re-derives its own decision, so the bundle's trust boundary
 * marks it `usable`; {@link tamperReceiptVerdict} flips a recorded receipt verdict so it no longer re-derives (a
 * recognized-but-inconsistent receipt the bundle catches).
 *
 * The coherent chain here is anchored on a CLEAR receipt: a clear plan is built from a `trend-stable` trend, so the
 * receipt records `claimedPlanVerdict = "clear"` and `sourceTrendVerdict = "trend-stable"`. The coherent related plan /
 * trend therefore carry exactly those verdicts (a cross-check match); a `monitor` plan / `trend-watch` trend is a
 * contradiction; and the source-chain index / governance fold their own bounded posture.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedPlan,
  clearPlan,
  investigatePlan,
  makeReceipt,
  monitorPlan,
  policyWith,
} from "../release-decision-closeout-governance-action-receipt/fixtures";
import { trendFor } from "../release-decision-closeout-governance-action-plan/fixtures";
import { windowFor } from "../release-decision-closeout-governance-index-trend/fixtures";
import { governanceFor } from "../release-decision-closeout-governance-index/fixtures";
import type { ReleaseDecisionCloseoutGovernanceActionReceiptResult } from "../release-decision-closeout-governance-action-receipt/types";
import { buildGovernanceFinalizeResult } from "./build";
import {
  absentRecord,
  ingestGovernanceFinalizeReceipt,
  ingestRelated,
  type IngestedGovernanceFinalizeSources,
} from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeArgs } from "./args";
import type { ReleaseDecisionCloseoutGovernanceFinalizeProvider } from "./run";
import type {
  ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
  ReleaseDecisionCloseoutGovernanceFinalizePolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeRecordKind,
  ReleaseDecisionCloseoutGovernanceFinalizeResult,
} from "./types";

/** A fixed clock the finalize tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real primary-receipt builders (each self-consistent → usable by the bundle)
 * ------------------------------------------------------------------ */

/** A COMPLETED receipt: a clear plan reviewed (`--ack-plan`) → receipt verdict `completed`, plan class `clear`. */
export function completedReceipt(): ReleaseDecisionCloseoutGovernanceActionReceiptResult {
  return makeReceipt(clearPlan(), policyWith({ plan: true }));
}

/** An INCOMPLETE receipt: a clear plan NOT reviewed (no acks) → receipt verdict `incomplete`. */
export function incompleteReceipt(): ReleaseDecisionCloseoutGovernanceActionReceiptResult {
  return makeReceipt(clearPlan(), policyWith({}));
}

/** A FOLLOWUP-OPEN receipt: a monitor plan reviewed but its follow-up unacked → receipt verdict `followup-open`. */
export function followupOpenReceipt(): ReleaseDecisionCloseoutGovernanceActionReceiptResult {
  return makeReceipt(monitorPlan(), policyWith({ plan: true }));
}

/** A BLOCKED receipt: a block plan not acknowledged as held-blocked → receipt verdict `blocked`. */
export function blockedReceipt(): ReleaseDecisionCloseoutGovernanceActionReceiptResult {
  return makeReceipt(blockedPlan(), policyWith({ plan: true }));
}

/** A COMPLETED receipt over an INVESTIGATE plan (fully acked) — anchors `claimedPlanVerdict = "investigate"`. */
export function completedInvestigateReceipt(): ReleaseDecisionCloseoutGovernanceActionReceiptResult {
  return makeReceipt(investigatePlan(), policyWith({ plan: true, investigation: true, executed: true }));
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers (the receipt DOC itself is corrupt)
 * ------------------------------------------------------------------ */

/**
 * Flip a receipt's recorded verdict (BOTH the top-level headline and the nested rollup, with a matching exit code) so it
 * no longer re-derives from the receipt's own recorded source facts (a re-derivation tamper).
 */
export function tamperReceiptVerdict(
  receipt: ReleaseDecisionCloseoutGovernanceActionReceiptResult,
  to: ReleaseDecisionCloseoutGovernanceActionReceiptVerdict,
  exitCode: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(receipt)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    governanceActionReceipt: { verdict: string; exitCode: number };
  };
  clone.verdict = to;
  clone.exitCode = exitCode;
  clone.governanceActionReceipt.verdict = to;
  clone.governanceActionReceipt.exitCode = exitCode;
  return clone;
}

/** A tampered receipt (a hand-flipped recorded verdict ⇒ a `tampered` receipt ⇒ a `finalize-blocked` bundle). */
export function tamperedReceipt(): Record<string, unknown> {
  return tamperReceiptVerdict(completedReceipt(), "blocked", 4);
}

/** An input that is NOT a recognized primary receipt (⇒ an `unreadable` receipt ⇒ `finalize-incomplete`). */
export function notAReceipt(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout governance action receipt" };
}

/* ------------------------------------------------------------------ *
 *  Real related records (each self-consistent) — coherent + contradictory + posture variants
 * ------------------------------------------------------------------ */

/** A COHERENT plan for a clear-anchored receipt (verdict `clear`, matches `claimedPlanVerdict`). */
export function coherentPlan(): unknown {
  return clearPlan();
}

/** A CONTRADICTORY plan for a clear-anchored receipt (verdict `monitor` ≠ `clear`). */
export function contradictoryPlan(): unknown {
  return monitorPlan();
}

/** A COHERENT trend for a clear-anchored receipt (verdict `trend-stable`, matches `sourceTrendVerdict`). */
export function coherentTrend(): unknown {
  return trendFor("trend-stable");
}

/** A CONTRADICTORY trend for a clear-anchored receipt (verdict `trend-watch` ≠ `trend-stable`). */
export function contradictoryTrend(): unknown {
  return trendFor("trend-watch");
}

/** A COHERENT (clean-posture) index (verdict `indexed`). */
export function coherentIndex(): unknown {
  return windowFor("indexed");
}

/** An ADVISORY / open index (verdict `index-open`). */
export function openIndex(): unknown {
  return windowFor("index-open");
}

/** A BLOCKING index (verdict `index-blocked` ⇒ a blocked source chain). */
export function blockedIndex(): unknown {
  return windowFor("index-blocked");
}

/** A COHERENT (clean-posture) governance bundle (verdict `closed`). */
export function coherentGovernance(): unknown {
  return governanceFor("closed");
}

/** An ADVISORY / open governance bundle (verdict `governance-open`). */
export function openGovernance(): unknown {
  return governanceFor("governance-open");
}

/** A BLOCKING governance bundle (verdict `governance-blocked` ⇒ a blocked source chain). */
export function blockedGovernance(): unknown {
  return governanceFor("governance-blocked");
}

/* ------------------------------------------------------------------ *
 *  Finalize input assembly (what build/reduce fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The record objects a test supplies to the bundle (the receipt is required; the related records are any subset). */
export interface GovernanceFinalizeObjects {
  receipt: unknown;
  plan?: unknown;
  trend?: unknown;
  index?: unknown;
  governance?: unknown;
}

/** The default policy (no requirements, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizePolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizePolicy {
  return {
    require: { plan: false, trend: false, index: false, governance: false },
    strictOpen: false,
    ...over,
  };
}

/** A policy with the given require flags supplied (and optional strict-open). */
export function policyRequiring(
  require: Partial<Record<ReleaseDecisionCloseoutGovernanceFinalizeRecordKind, boolean>>,
  strictOpen = false,
): ReleaseDecisionCloseoutGovernanceFinalizePolicy {
  return {
    require: { plan: false, trend: false, index: false, governance: false, ...require },
    strictOpen,
  };
}

/** The related-record slot kinds, in canonical order. */
const RELATED_KEYS: readonly ReleaseDecisionCloseoutGovernanceFinalizeRecordKind[] = [
  "plan",
  "trend",
  "index",
  "governance",
];

/** Reduce a subset of record objects to the {@link IngestedGovernanceFinalizeSources} the fold consumes. */
export function ingestGovernanceFinalizeFrom(objs: GovernanceFinalizeObjects): IngestedGovernanceFinalizeSources {
  return {
    receipt: { supplied: true, ingested: ingestGovernanceFinalizeReceipt(objs.receipt) },
    related: RELATED_KEYS.map((kind) => {
      const obj = (objs as unknown as Record<string, unknown>)[kind];
      return obj === undefined ? absentRecord(kind) : ingestRelated(kind, obj);
    }),
  };
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeResult} from a subset of record objects. */
export function makeGovernanceFinalize(
  objs: GovernanceFinalizeObjects,
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizePolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeResult {
  return buildGovernanceFinalizeResult(NOW, ingestGovernanceFinalizeFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied record object by its source-key "path" (used by the run tests). */
export function makeProvider(
  objs: GovernanceFinalizeObjects,
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      const obj = (objs as unknown as Record<string, unknown>)[path];
      if (obj === undefined) throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeArgs} that reference each supplied record by its source-key "path". */
export function makeArgs(
  objs: GovernanceFinalizeObjects,
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    requirePlan: false,
    requireTrend: false,
    requireIndex: false,
    requireGovernance: false,
    strictOpen: false,
    receiptPath: "receipt",
    ...(objs.plan !== undefined ? { planPath: "plan" } : {}),
    ...(objs.trend !== undefined ? { trendPath: "trend" } : {}),
    ...(objs.index !== undefined ? { indexPath: "index" } : {}),
    ...(objs.governance !== undefined ? { governancePath: "governance" } : {}),
    ...over,
  };
}
