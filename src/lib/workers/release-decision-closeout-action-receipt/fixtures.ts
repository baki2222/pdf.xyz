/**
 * Test-support builders for the release decision closeout action-plan execution receipt tests (Phase 68).
 *
 * The receipt ingests ONE `pdfxyz.release-decision-closeout-action-plan/1` document, so these helpers build REAL,
 * self-consistent closeout plans of each class — by driving the shipped Phase 67 plan builder ({@link makePlan}) over
 * genuinely coherent Phase 66 closeout-index trends (reusing the release-decision-closeout-action-plan fixtures, which
 * themselves reuse the trend / index / closeout builders). A clear / investigate / monitor / block plan re-derives its
 * own decision, so the receipt's trust boundary marks it `usable`; {@link tamperPlanVerdict} flips a recorded plan
 * verdict so it no longer re-derives, and {@link tamperPlanTopLevel} flips only the top-level headline so it disagrees
 * with the recorded rollup (both recognized-but-inconsistent plans the receipt catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  makePlan,
  notATrend,
  tamperedTrend,
  trendFor,
} from "../release-decision-closeout-action-plan/fixtures";
import type {
  ReleaseDecisionCloseoutActionPlanResult,
  ReleaseDecisionCloseoutActionPlanVerdict,
} from "../release-decision-closeout-action-plan/types";
import { buildCloseoutActionReceiptResult } from "./build";
import { ingestCloseoutPlan, type IngestedCloseoutPlan } from "./ingest";
import type { ReleaseDecisionCloseoutActionReceiptArgs } from "./args";
import type { ReleaseDecisionCloseoutActionReceiptProvider } from "./run";
import type {
  ReleaseDecisionCloseoutActionReceiptAck,
  ReleaseDecisionCloseoutActionReceiptPolicy,
  ReleaseDecisionCloseoutActionReceiptResult,
} from "./types";

/** A fixed clock the receipt tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real plan builders (each self-consistent → usable by the receipt)
 * ------------------------------------------------------------------ */

/** A CLEAR-class plan (a coherent stable closeout-index trend → plan verdict `clear`). */
export function clearPlan(): ReleaseDecisionCloseoutActionPlanResult {
  return makePlan(trendFor("trend-stable"));
}

/** An INVESTIGATE-class plan (a `trend-incomplete` trend → plan verdict `investigate`). */
export function investigatePlan(): ReleaseDecisionCloseoutActionPlanResult {
  return makePlan(trendFor("trend-incomplete"));
}

/** A MONITOR-class plan (a `trend-watch` trend → plan verdict `monitor`). */
export function monitorPlan(): ReleaseDecisionCloseoutActionPlanResult {
  return makePlan(trendFor("trend-watch"));
}

/** A BLOCK-class plan (a `trend-blocked` trend → plan verdict `block-release`, `block-and-reconcile`). */
export function blockedPlan(): ReleaseDecisionCloseoutActionPlanResult {
  return makePlan(trendFor("trend-blocked"));
}

/**
 * A BLOCK-class plan whose SOURCE TREND was untrustworthy (tampered) → the plan's OWN verdict is `block-release`
 * (`reject-input`). The plan document itself re-derives (a valid plan that concluded reject-input), so the receipt marks
 * it `usable` with class `block`.
 */
export function rejectInputPlan(): ReleaseDecisionCloseoutActionPlanResult {
  return makePlan(tamperedTrend());
}

/**
 * A BLOCK-class plan produced by `--strict-watch` escalating a MONITOR plan (a `trend-watch` trend) → plan verdict
 * `block-release` with a recorded strict-watch escalation. The plan re-derives (its escalation position re-derives), so
 * the receipt marks it `usable` with class `block`.
 */
export function strictWatchBlockedPlan(): ReleaseDecisionCloseoutActionPlanResult {
  return makePlan(trendFor("trend-watch"), { strictWatch: true });
}

/** Build a plan of the given class (a small dispatcher for table-driven tests). */
export function planForClass(
  cls: "clear" | "investigate" | "monitor" | "block",
): ReleaseDecisionCloseoutActionPlanResult {
  switch (cls) {
    case "clear":
      return clearPlan();
    case "investigate":
      return investigatePlan();
    case "monitor":
      return monitorPlan();
    case "block":
      return blockedPlan();
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
  plan: ReleaseDecisionCloseoutActionPlanResult,
  to: ReleaseDecisionCloseoutActionPlanVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & {
    verdict: string;
    closeoutActionPlan: { verdict: string };
  };
  clone.verdict = to;
  clone.closeoutActionPlan.verdict = to;
  return clone;
}

/**
 * Flip ONLY the plan's top-level headline verdict, leaving the recorded rollup intact — so the headline disagrees with
 * its own rollup (an internal-consistency tamper the receipt catches before even re-deriving).
 */
export function tamperPlanTopLevel(
  plan: ReleaseDecisionCloseoutActionPlanResult,
  to: ReleaseDecisionCloseoutActionPlanVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & { verdict: string };
  clone.verdict = to;
  return clone;
}

/** A tampered plan (a hand-flipped recorded verdict ⇒ a `tampered` source ⇒ a `blocked` receipt). */
export function tamperedPlan(): Record<string, unknown> {
  return tamperPlanVerdict(clearPlan(), "block-release");
}

/** An input that is NOT a recognized release decision closeout action plan (⇒ an `unreadable` source ⇒ `blocked`). */
export function notAPlan(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout action plan" };
}

/** Reuse the Phase 67 non-trend decoy for a distinct wrong-schema input. */
export { notATrend };

/* ------------------------------------------------------------------ *
 *  Receipt input assembly (what build/reduce fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** Build a bounded acknowledgement set (all false unless overridden). */
export function acks(
  over: Partial<ReleaseDecisionCloseoutActionReceiptAck> = {},
): ReleaseDecisionCloseoutActionReceiptAck {
  return { plan: false, executed: false, monitor: false, investigation: false, block: false, ...over };
}

/** The default policy (no strict-open, no acknowledgements). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutActionReceiptPolicy> = {},
): ReleaseDecisionCloseoutActionReceiptPolicy {
  return { strictOpen: false, ack: acks(), ...over };
}

/** A policy with the given acknowledgements supplied (and optional strict-open). */
export function policyWith(
  ackOver: Partial<ReleaseDecisionCloseoutActionReceiptAck>,
  strictOpen = false,
): ReleaseDecisionCloseoutActionReceiptPolicy {
  return { strictOpen, ack: acks(ackOver) };
}

/** Ingest a plan object through the trust boundary. */
export function ingestPlanObj(obj: unknown): IngestedCloseoutPlan {
  return ingestCloseoutPlan(obj);
}

/** Build a real {@link ReleaseDecisionCloseoutActionReceiptResult} from a plan object + policy. */
export function makeReceipt(
  obj: unknown,
  policy: ReleaseDecisionCloseoutActionReceiptPolicy = defaultPolicy(),
): ReleaseDecisionCloseoutActionReceiptResult {
  return buildCloseoutActionReceiptResult(NOW, ingestCloseoutPlan(obj), policy);
}

/** A provider that serves the supplied plan object by its "path" (`plan-0`) or a stdin payload. */
export function makeProvider(obj: unknown, stdin = ""): ReleaseDecisionCloseoutActionReceiptProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (path !== "plan-0") throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutActionReceiptArgs} that reference the supplied plan by its "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionCloseoutActionReceiptArgs> = {},
): ReleaseDecisionCloseoutActionReceiptArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    ackPlan: false,
    ackExecuted: false,
    ackMonitor: false,
    ackInvestigation: false,
    ackBlock: false,
    strictOpen: false,
    planPath: "plan-0",
    ...over,
  };
}
