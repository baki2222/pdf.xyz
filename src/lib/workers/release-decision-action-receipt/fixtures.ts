/**
 * Test-support builders for the release decision action-plan execution receipt tests (Phase 63).
 *
 * The receipt ingests ONE `pdfxyz.release-decision-action-plan/1` document, so these helpers build REAL, self-consistent
 * plans of each class — by driving the shipped Phase 62 plan builder over genuinely coherent Phase 61 trends (reusing
 * the release-decision-action-plan fixtures, which themselves reuse the trend / index / decision builders). A clear /
 * monitor / investigate / block plan re-derives its own decision, so the receipt's trust boundary marks it `usable`;
 * {@link tamperPlanVerdict} flips a recorded plan verdict so it no longer re-derives, and {@link tamperPlanTopLevel}
 * flips only the top-level headline so it disagrees with the recorded rollup (both recognized-but-inconsistent plans the
 * receipt catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import { buildActionPlanResult } from "../release-decision-action-plan/build";
import {
  defaultPolicy as planPolicy,
  notATrend,
  tamperedTrend,
  trendFor,
} from "../release-decision-action-plan/fixtures";
import { ingestTrend } from "../release-decision-action-plan/ingest";
import type {
  ReleaseDecisionActionPlanResult,
  ReleaseDecisionActionPlanVerdict,
  ReleaseDecisionTrendVerdict,
} from "../release-decision-action-plan/types";
import { buildActionReceiptResult } from "./build";
import { ingestPlan, type IngestedPlan } from "./ingest";
import type { ReleaseDecisionActionReceiptArgs } from "./args";
import type { ReleaseDecisionActionReceiptProvider } from "./run";
import type { ReleaseDecisionActionReceiptAck, ReleaseDecisionActionReceiptPolicy, ReleaseDecisionActionReceiptResult } from "./types";

/** A fixed clock the receipt tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real plan builders (each self-consistent → usable by the receipt)
 * ------------------------------------------------------------------ */

/** Build a real Phase 62 plan over a real trend of the given trend verdict. */
export function planForTrend(trendVerdict: ReleaseDecisionTrendVerdict): ReleaseDecisionActionPlanResult {
  return buildActionPlanResult("2026-07-04T00:00:00.000Z", ingestTrend(trendFor(trendVerdict)), planPolicy());
}

/** A CLEAR-class plan (a clean stable trend → plan verdict `clear`). */
export function clearPlan(): ReleaseDecisionActionPlanResult {
  return planForTrend("stable");
}

/** A BENIGN MONITOR-class plan (an improving trend → plan verdict `monitor`, the plan's own exit 0). */
export function benignMonitorPlan(): ReleaseDecisionActionPlanResult {
  return planForTrend("improving");
}

/** A follow-up MONITOR-class plan (a watch trend → plan verdict `monitor`, the plan's own exit 3). */
export function watchMonitorPlan(): ReleaseDecisionActionPlanResult {
  return planForTrend("watch");
}

/** A follow-up MONITOR-class plan (a degrading trend → plan verdict `monitor`, the plan's own exit 3). */
export function degradingMonitorPlan(): ReleaseDecisionActionPlanResult {
  return planForTrend("degrading");
}

/** An INVESTIGATE-class plan (an insufficient trend → plan verdict `investigate`). */
export function investigatePlan(): ReleaseDecisionActionPlanResult {
  return planForTrend("insufficient");
}

/** A BLOCK-class plan (a blocked trend → plan verdict `block-release`). */
export function blockedPlan(): ReleaseDecisionActionPlanResult {
  return planForTrend("blocked");
}

/** A BLOCK-class plan via a trend whose own verdict is `invalid` (→ plan verdict `block-release`). */
export function invalidTrendPlan(): ReleaseDecisionActionPlanResult {
  return planForTrend("invalid");
}

/**
 * A BLOCK-class plan whose SOURCE TREND was untrustworthy (tampered) → the plan's OWN verdict is `invalid`
 * (`reject-input`). The plan document itself re-derives (a valid plan that concluded `invalid`), so the receipt marks it
 * `usable` with class `block`.
 */
export function untrustedTrendPlan(): ReleaseDecisionActionPlanResult {
  return buildActionPlanResult("2026-07-04T00:00:00.000Z", ingestTrend(tamperedTrend()), planPolicy());
}

/** Build a plan of the given class (a small dispatcher for table-driven tests). */
export function planForClass(cls: "clear" | "monitor" | "investigate" | "block"): ReleaseDecisionActionPlanResult {
  switch (cls) {
    case "clear":
      return clearPlan();
    case "monitor":
      return watchMonitorPlan();
    case "investigate":
      return investigatePlan();
    case "block":
      return blockedPlan();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers (the plan DOC itself is corrupt)
 * ------------------------------------------------------------------ */

/**
 * Flip a plan's recorded verdict (BOTH the top-level headline and the nested rollup) so it no longer re-derives from
 * the plan's own recorded source facts (a re-derivation tamper).
 */
export function tamperPlanVerdict(
  plan: ReleaseDecisionActionPlanResult,
  to: ReleaseDecisionActionPlanVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & {
    verdict: string;
    plan: { verdict: string };
  };
  clone.verdict = to;
  clone.plan.verdict = to;
  return clone;
}

/**
 * Flip ONLY the plan's top-level headline verdict, leaving the recorded rollup intact — so the headline disagrees with
 * its own rollup (an internal-consistency tamper the receipt catches before even re-deriving).
 */
export function tamperPlanTopLevel(
  plan: ReleaseDecisionActionPlanResult,
  to: ReleaseDecisionActionPlanVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & { verdict: string };
  clone.verdict = to;
  return clone;
}

/** A tampered plan (a hand-flipped recorded verdict ⇒ a `tampered` source ⇒ a `blocked` receipt). */
export function tamperedPlan(): Record<string, unknown> {
  return tamperPlanVerdict(clearPlan(), "block-release");
}

/** An input that is NOT a recognized release decision action plan (⇒ an `unreadable` source ⇒ an `incomplete` receipt). */
export function notAPlan(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision action plan" };
}

/** Reuse the Phase 62 non-trend decoy for a distinct wrong-schema input. */
export { notATrend };

/* ------------------------------------------------------------------ *
 *  Receipt input assembly (what build/reduce fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** Build a bounded acknowledgement set (all false unless overridden). */
export function acks(over: Partial<ReleaseDecisionActionReceiptAck> = {}): ReleaseDecisionActionReceiptAck {
  return { plan: false, followups: false, monitor: false, investigation: false, block: false, ...over };
}

/** The default policy (no strict-open, no acknowledgements). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionActionReceiptPolicy> = {},
): ReleaseDecisionActionReceiptPolicy {
  return { strictOpen: false, ack: acks(), ...over };
}

/** A policy with the given acknowledgements supplied (and optional strict-open). */
export function policyWith(
  ackOver: Partial<ReleaseDecisionActionReceiptAck>,
  strictOpen = false,
): ReleaseDecisionActionReceiptPolicy {
  return { strictOpen, ack: acks(ackOver) };
}

/** Ingest a plan object through the trust boundary. */
export function ingestPlanObj(obj: unknown): IngestedPlan {
  return ingestPlan(obj);
}

/** Build a real {@link ReleaseDecisionActionReceiptResult} from a plan object + policy. */
export function makeReceipt(
  obj: unknown,
  policy: ReleaseDecisionActionReceiptPolicy = defaultPolicy(),
): ReleaseDecisionActionReceiptResult {
  return buildActionReceiptResult(NOW, ingestPlan(obj), policy);
}

/** A provider that serves the supplied plan object by its "path" (`plan-0`) or a stdin payload. */
export function makeProvider(obj: unknown, stdin = ""): ReleaseDecisionActionReceiptProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (path !== "plan-0") throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionActionReceiptArgs} that reference the supplied plan by its "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionActionReceiptArgs> = {},
): ReleaseDecisionActionReceiptArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    ackPlan: false,
    ackFollowups: false,
    ackMonitor: false,
    ackInvestigation: false,
    ackBlock: false,
    strictOpen: false,
    planPath: "plan-0",
    ...over,
  };
}
