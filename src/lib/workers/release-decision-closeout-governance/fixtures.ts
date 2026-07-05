/**
 * Test-support builders for the release decision closeout governance bundle tests (Phase 69).
 *
 * The bundle ingests a REQUIRED `pdfxyz.release-decision-closeout-action-receipt/1` primary receipt plus, optionally, the
 * related closeout-chain records, so these helpers build REAL, self-consistent documents of each posture — by driving the
 * shipped Phase 68 receipt builder ({@link makeReceipt}) over genuinely coherent Phase 67 plans (reusing the
 * release-decision-closeout-action-receipt fixtures, which themselves reuse the plan / trend / index / closeout builders),
 * and by reusing the shipped Phase 65–67 record builders for the related records. A completed / incomplete / followup-open
 * / blocked receipt re-derives its own decision, so the bundle's trust boundary marks it `usable`;
 * {@link tamperReceiptVerdict} flips a recorded receipt verdict so it no longer re-derives (a recognized-but-inconsistent
 * receipt the bundle catches).
 *
 * The coherent chain here is anchored on a CLEAR receipt: a clear plan is built from a `trend-stable` trend, so the
 * receipt records `claimedPlanVerdict = "clear"` and `sourceTrendVerdict = "trend-stable"`. The coherent related plan /
 * trend therefore carry exactly those verdicts (a cross-check match); a `monitor` plan / `trend-watch` trend is a
 * contradiction; and the source-chain index / closeout fold their own bounded posture.
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
} from "../release-decision-closeout-action-receipt/fixtures";
import { trendFor } from "../release-decision-closeout-action-plan/fixtures";
import { indexFor } from "../release-decision-closeout-index-trend/fixtures";
import { closeoutFor } from "../release-decision-closeout-index/fixtures";
import type { ReleaseDecisionCloseoutActionReceiptResult } from "../release-decision-closeout-action-receipt/types";
import { buildGovernanceResult } from "./build";
import {
  absentRecord,
  ingestCloseoutGovernanceReceipt,
  ingestRelated,
  type IngestedGovernanceSources,
} from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceArgs } from "./args";
import type { ReleaseDecisionCloseoutGovernanceProvider } from "./run";
import type {
  ReleaseDecisionCloseoutActionReceiptVerdict,
  ReleaseDecisionCloseoutGovernancePolicy,
  ReleaseDecisionCloseoutGovernanceRecordKind,
  ReleaseDecisionCloseoutGovernanceResult,
} from "./types";

/** A fixed clock the governance tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real primary-receipt builders (each self-consistent → usable by the bundle)
 * ------------------------------------------------------------------ */

/** A COMPLETED receipt: a clear plan reviewed (`--ack-plan`) → receipt verdict `completed`, plan class `clear`. */
export function completedReceipt(): ReleaseDecisionCloseoutActionReceiptResult {
  return makeReceipt(clearPlan(), policyWith({ plan: true }));
}

/** An INCOMPLETE receipt: a clear plan NOT reviewed (no acks) → receipt verdict `incomplete`. */
export function incompleteReceipt(): ReleaseDecisionCloseoutActionReceiptResult {
  return makeReceipt(clearPlan(), policyWith({}));
}

/** A FOLLOWUP-OPEN receipt: a monitor plan reviewed but its follow-up unacked → receipt verdict `followup-open`. */
export function followupOpenReceipt(): ReleaseDecisionCloseoutActionReceiptResult {
  return makeReceipt(monitorPlan(), policyWith({ plan: true }));
}

/** A BLOCKED receipt: a block plan not acknowledged as held-blocked → receipt verdict `blocked`. */
export function blockedReceipt(): ReleaseDecisionCloseoutActionReceiptResult {
  return makeReceipt(blockedPlan(), policyWith({ plan: true }));
}

/** A COMPLETED receipt over an INVESTIGATE plan (fully acked) — anchors `claimedPlanVerdict = "investigate"`. */
export function completedInvestigateReceipt(): ReleaseDecisionCloseoutActionReceiptResult {
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
  receipt: ReleaseDecisionCloseoutActionReceiptResult,
  to: ReleaseDecisionCloseoutActionReceiptVerdict,
  exitCode: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(receipt)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    closeoutActionReceipt: { verdict: string; exitCode: number };
  };
  clone.verdict = to;
  clone.exitCode = exitCode;
  clone.closeoutActionReceipt.verdict = to;
  clone.closeoutActionReceipt.exitCode = exitCode;
  return clone;
}

/** A tampered receipt (a hand-flipped recorded verdict ⇒ a `tampered` receipt ⇒ a `governance-blocked` bundle). */
export function tamperedReceipt(): Record<string, unknown> {
  return tamperReceiptVerdict(completedReceipt(), "blocked", 4);
}

/** An input that is NOT a recognized primary receipt (⇒ an `unreadable` receipt ⇒ `governance-incomplete`). */
export function notAReceipt(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout action receipt" };
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
  return indexFor("indexed");
}

/** An ADVISORY / open index (verdict `index-open`). */
export function openIndex(): unknown {
  return indexFor("index-open");
}

/** A BLOCKING index (verdict `index-blocked` ⇒ a blocked source chain). */
export function blockedIndex(): unknown {
  return indexFor("index-blocked");
}

/** A COHERENT (clean-posture) closeout (verdict `closed`). */
export function coherentCloseout(): unknown {
  return closeoutFor("closed");
}

/** An ADVISORY / open closeout (verdict `closeout-open`). */
export function openCloseout(): unknown {
  return closeoutFor("closeout-open");
}

/** A BLOCKING closeout (verdict `closeout-blocked` ⇒ a blocked source chain). */
export function blockedCloseout(): unknown {
  return closeoutFor("closeout-blocked");
}

/* ------------------------------------------------------------------ *
 *  Governance input assembly (what build/reduce fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The record objects a test supplies to the bundle (the receipt is required; the related records are any subset). */
export interface GovernanceObjects {
  receipt: unknown;
  plan?: unknown;
  trend?: unknown;
  index?: unknown;
  closeout?: unknown;
}

/** The default policy (no requirements, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernancePolicy> = {},
): ReleaseDecisionCloseoutGovernancePolicy {
  return {
    require: { plan: false, trend: false, index: false, closeout: false },
    strictOpen: false,
    ...over,
  };
}

/** A policy with the given require flags supplied (and optional strict-open). */
export function policyRequiring(
  require: Partial<Record<ReleaseDecisionCloseoutGovernanceRecordKind, boolean>>,
  strictOpen = false,
): ReleaseDecisionCloseoutGovernancePolicy {
  return {
    require: { plan: false, trend: false, index: false, closeout: false, ...require },
    strictOpen,
  };
}

/** The related-record slot kinds, in canonical order. */
const RELATED_KEYS: readonly ReleaseDecisionCloseoutGovernanceRecordKind[] = ["plan", "trend", "index", "closeout"];

/** Reduce a subset of record objects to the {@link IngestedGovernanceSources} the fold consumes. */
export function ingestGovernanceFrom(objs: GovernanceObjects): IngestedGovernanceSources {
  return {
    receipt: { supplied: true, ingested: ingestCloseoutGovernanceReceipt(objs.receipt) },
    related: RELATED_KEYS.map((kind) => {
      const obj = (objs as unknown as Record<string, unknown>)[kind];
      return obj === undefined ? absentRecord(kind) : ingestRelated(kind, obj);
    }),
  };
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceResult} from a subset of record objects. */
export function makeGovernance(
  objs: GovernanceObjects,
  policy: Partial<ReleaseDecisionCloseoutGovernancePolicy> = {},
): ReleaseDecisionCloseoutGovernanceResult {
  return buildGovernanceResult(NOW, ingestGovernanceFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied record object by its source-key "path" (used by the run tests). */
export function makeProvider(objs: GovernanceObjects, stdin = ""): ReleaseDecisionCloseoutGovernanceProvider {
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

/** Build {@link ReleaseDecisionCloseoutGovernanceArgs} that reference each supplied record by its source-key "path". */
export function makeArgs(
  objs: GovernanceObjects,
  over: Partial<ReleaseDecisionCloseoutGovernanceArgs> = {},
): ReleaseDecisionCloseoutGovernanceArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    requirePlan: false,
    requireTrend: false,
    requireIndex: false,
    requireCloseout: false,
    strictOpen: false,
    receiptPath: "receipt",
    ...(objs.plan !== undefined ? { planPath: "plan" } : {}),
    ...(objs.trend !== undefined ? { trendPath: "trend" } : {}),
    ...(objs.index !== undefined ? { indexPath: "index" } : {}),
    ...(objs.closeout !== undefined ? { closeoutPath: "closeout" } : {}),
    ...over,
  };
}
