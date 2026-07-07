/**
 * Test-support builders for the release decision closeout governance finalize index trend finalize index trend closeout index trend
 * action-plan execution receipt tests (Phase 88).
 *
 * The receipt ingests ONE
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1` document, so these
 * helpers build REAL, self-consistent finalize-index-trend action plans of each class — by driving the shipped Phase 87
 * plan builder ({@link makePlan}) over genuinely coherent Phase 86 finalize-index trends (reusing the
 * release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan fixtures, which themselves
 * reuse the trend / index / finalize builders). A clear / monitor / investigate / block-release / invalid plan re-derives
 * its own decision, so the receipt's trust boundary marks it `usable`; {@link tamperPlanVerdict} flips a recorded plan
 * verdict so it no longer re-derives, and {@link tamperPlanTopLevel} flips only the top-level headline so it disagrees
 * with the recorded rollup (both recognized-but-inconsistent plans the receipt catches → `invalid`).
 *
 * Building a REAL plan drives the whole Phase 79→80→81→82 evidence chain (~1s of hashing per underlying trend), so each
 * plan builder is MEMOIZED: the expensive build runs once per class, and every call returns a fresh deep clone of that
 * template (so a caller that mutates its copy never disturbs another's). The plans are deterministic (a fixed `NOW`), so
 * the cached template is stable.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  makePlan,
  notATrend,
  tamperedTrend,
  trendFor,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/types";
import { buildFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptResult } from "./build";
import {
  ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan,
  type IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan,
} from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptArgs } from "./args";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptProvider } from "./run";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptResult,
} from "./types";

/** A fixed clock the receipt tests stamp with (deterministic). */
export const NOW = "2026-07-06T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real plan builders (each self-consistent → usable by the receipt)
 * ------------------------------------------------------------------ */

/** Memoize a `() => plan` builder: build once, then return a fresh deep clone each call. */
function memoPlan(
  build: () => ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
): () => ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult {
  let cached: string | undefined;
  return () => {
    if (cached === undefined) cached = JSON.stringify(build());
    return JSON.parse(cached) as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult;
  };
}

/** A CLEAR-class plan (a coherent stable finalize-index trend → plan verdict `clear`). */
export const clearPlan = memoPlan(() => makePlan(trendFor("stable")));

/** A MONITOR-class plan (a `watch` trend → plan verdict `monitor`). */
export const monitorPlan = memoPlan(() => makePlan(trendFor("watch")));

/** An INVESTIGATE-class plan (an `insufficient` trend → plan verdict `investigate`). */
export const investigatePlan = memoPlan(() => makePlan(trendFor("insufficient")));

/** A BLOCK-class plan (a `blocked` trend → plan verdict `block-release`, `block-and-reconcile`). */
export const blockPlan = memoPlan(() => makePlan(trendFor("blocked")));

/**
 * A plan whose OWN verdict is `invalid` — its source-trend INPUT was unreadable, so the Phase 87 plan rejected it
 * (`reject-input`). The plan document itself re-derives (a valid plan that concluded invalid), so the receipt marks it
 * `usable` with the `block` class (the release stays held) — NOT an `invalid` receipt, which is reserved for an
 * untrustworthy plan DOCUMENT.
 */
export const invalidPlan = memoPlan(() => makePlan(notATrend()));

/**
 * A plan whose OWN verdict is `invalid` because its source-trend input was TAMPERED (recognized but self-inconsistent).
 * Distinct code path from {@link invalidPlan} (source.state=tampered vs unreadable); both are usable `block`-class plans.
 */
export const invalidPlanFromTampered = memoPlan(() => makePlan(tamperedTrend()));

/**
 * A BLOCK-class plan produced by `--strict` escalating a MONITOR plan (a `watch` trend) → plan verdict
 * `block-release` with a recorded strict escalation. The plan re-derives (its escalation position re-derives), so
 * the receipt marks it `usable` with class `block`.
 */
export const strictWatchBlockPlan = memoPlan(() => makePlan(trendFor("watch"), { strict: true }));

/**
 * A BLOCK-class plan produced by `--strict` escalating an INVESTIGATE plan (an `insufficient` trend) → plan
 * verdict `block-release`. The plan re-derives, so the receipt marks it `usable` with class `block`.
 */
export const requireCleanBlockPlan = memoPlan(() => makePlan(trendFor("insufficient"), { strict: true }));

/** Build a plan of the given closeable class (a small dispatcher for table-driven tests). */
export function planForClass(
  cls: "clear" | "monitor" | "investigate" | "block",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult {
  switch (cls) {
    case "clear":
      return clearPlan();
    case "monitor":
      return monitorPlan();
    case "investigate":
      return investigatePlan();
    case "block":
      return blockPlan();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers (the plan DOC itself is corrupt)
 * ------------------------------------------------------------------ */

/**
 * Flip a plan's recorded verdict (BOTH the top-level headline and the nested rollup) so it no longer re-derives from the
 * plan's own recorded source facts (a re-derivation tamper).
 */
export function tamperPlanVerdict(
  plan: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & {
    verdict: string;
    actionPlan: { verdict: string };
  };
  clone.verdict = to;
  clone.actionPlan.verdict = to;
  return clone;
}

/**
 * Flip ONLY the plan's top-level headline verdict, leaving the recorded rollup intact — so the headline disagrees with
 * its own rollup (an internal-consistency tamper the receipt catches before even re-deriving).
 */
export function tamperPlanTopLevel(
  plan: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & { verdict: string };
  clone.verdict = to;
  return clone;
}

/** A tampered plan (a hand-flipped recorded verdict ⇒ a `tampered` source ⇒ an `invalid` receipt). */
export function tamperedPlan(): Record<string, unknown> {
  return tamperPlanVerdict(clearPlan(), "monitor");
}

/** An input that is NOT a recognized release decision closeout governance finalize index trend finalize index trend closeout index trend action plan (⇒ `unreadable` ⇒ `invalid`). */
export function notAPlan(): Record<string, unknown> {
  return {
    schema: "pdfxyz.something-else/1",
    note: "not a release decision closeout governance finalize index trend finalize index trend closeout index trend action plan",
  };
}

/** Reuse the Phase 87 non-trend decoy for a distinct wrong-schema input. */
export { notATrend };

/* ------------------------------------------------------------------ *
 *  Receipt input assembly (what build/reduce fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** Build a bounded acknowledgement set (all false unless overridden). */
export function acks(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck {
  return {
    plan: false,
    clear: false,
    monitor: false,
    investigation: false,
    block: false,
    ...over,
  };
}

/** The default policy (no strict-open, no acknowledgements). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy {
  return { strictOpen: false, ack: acks(), ...over };
}

/** A policy with the given acknowledgements supplied (and optional strict-open). */
export function policyWith(
  ackOver: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptAck>,
  strictOpen = false,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy {
  return { strictOpen, ack: acks(ackOver) };
}

/** Ingest a plan object through the trust boundary. */
export function ingestPlanObj(obj: unknown): IngestedFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan {
  return ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(obj);
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptResult} from a plan object + policy. */
export function makeReceipt(
  obj: unknown,
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptPolicy = defaultPolicy(),
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptResult {
  return buildFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptResult(
    NOW,
    ingestFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlan(obj),
    policy,
  );
}

/** A provider that serves the supplied plan object by its "path" (`plan-0`) or a stdin payload. */
export function makeProvider(
  obj: unknown,
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (path !== "plan-0") throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptArgs} that reference the supplied plan by its "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionReceiptArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    ackPlan: false,
    ackClear: false,
    ackMonitor: false,
    ackInvestigation: false,
    ackBlock: false,
    strictOpen: false,
    planPath: "plan-0",
    ...over,
  };
}
