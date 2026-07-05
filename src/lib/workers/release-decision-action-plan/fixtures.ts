/**
 * Test-support builders for the release decision trend action plan tests (Phase 62).
 *
 * The plan ingests ONE `pdfxyz.release-decision-trend/1` document, so these helpers build REAL, self-consistent trend
 * summaries of each trend verdict — by composing the shipped Phase 61 trend over genuinely coherent histories of
 * decision-index windows (reusing the release-decision-trend fixtures, which themselves reuse the Phase 60 / 59 / 57 /
 * 58 builders). A stable / improving / watch / degrading / insufficient / blocked / invalid trend re-derives its own
 * verdict + summary, so the plan's trust boundary marks it `usable`; {@link tamperTrendVerdict} flips a recorded trend
 * verdict so it no longer re-derives, and {@link tamperTrendSummary} lies about a window-verdict count so it no longer
 * matches the trend's own posture sequence (both recognized-but-inconsistent trends the plan catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedWindow,
  insufficientWindow,
  makeTrend,
  stableWindow,
  tamperedWindow,
  watchWindow,
} from "../release-decision-trend/fixtures";
import type { ReleaseDecisionTrendResult, ReleaseDecisionTrendVerdict } from "../release-decision-trend/types";
import { buildActionPlanResult } from "./build";
import { ingestTrend, type IngestedTrend } from "./ingest";
import type { ReleaseDecisionActionPlanArgs } from "./args";
import type { ReleaseDecisionActionPlanProvider } from "./run";
import {
  DEFAULT_MAX_ACTIONS,
  type ReleaseDecisionActionPlanPolicy,
  type ReleaseDecisionActionPlanResult,
} from "./types";

/** A fixed clock the plan tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real trend builders (each self-consistent → usable by the plan)
 * ------------------------------------------------------------------ */

/** A STABLE trend: a clean history of stable windows (its trend verdict re-derives as `stable`). */
export function stableTrend(): ReleaseDecisionTrendResult {
  return makeTrend([stableWindow(), stableWindow(), stableWindow()]);
}

/** An IMPROVING trend: a watch window recovering to a stable latest window (trend verdict `improving`). */
export function improvingTrend(): ReleaseDecisionTrendResult {
  return makeTrend([watchWindow(), stableWindow()]);
}

/** A WATCH trend: a flat history of watch windows (trend verdict `watch`). */
export function watchTrend(): ReleaseDecisionTrendResult {
  return makeTrend([watchWindow(), watchWindow()]);
}

/** A DEGRADING trend: a stable window worsening to a watch latest window (trend verdict `degrading`). */
export function degradingTrend(): ReleaseDecisionTrendResult {
  return makeTrend([stableWindow(), watchWindow()]);
}

/** An INSUFFICIENT trend: an only-insufficient history (trend verdict `insufficient`). */
export function insufficientTrend(): ReleaseDecisionTrendResult {
  return makeTrend([insufficientWindow(), insufficientWindow()]);
}

/** A BLOCKED trend: a blocked window in the history (trend verdict `blocked`). */
export function blockedTrend(): ReleaseDecisionTrendResult {
  return makeTrend([stableWindow(), blockedWindow()]);
}

/**
 * An INVALID trend: a tampered window in the history makes the TREND's OWN verdict `invalid` (Phase 61 could not trust a
 * window). The trend itself re-derives (a valid trend that concluded `invalid`), so the plan marks it `usable` and
 * plans a `block-release` / `restore-evidence` follow-up.
 */
export function invalidTrend(): ReleaseDecisionTrendResult {
  return makeTrend([stableWindow(), tamperedWindow()]);
}

/** Build a real trend for the given trend verdict (a small dispatcher for table-driven tests). */
export function trendFor(verdict: ReleaseDecisionTrendVerdict): ReleaseDecisionTrendResult {
  switch (verdict) {
    case "stable":
      return stableTrend();
    case "improving":
      return improvingTrend();
    case "watch":
      return watchTrend();
    case "degrading":
      return degradingTrend();
    case "insufficient":
      return insufficientTrend();
    case "blocked":
      return blockedTrend();
    case "invalid":
      return invalidTrend();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers (the trend DOC itself is corrupt)
 * ------------------------------------------------------------------ */

/** Flip a trend's recorded verdict so it no longer re-derives from its own summary (a CHECK-B tamper). */
export function tamperTrendVerdict(
  trend: ReleaseDecisionTrendResult,
  to: ReleaseDecisionTrendVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    trend: { verdict: string };
  };
  clone.trend.verdict = to;
  return clone;
}

/**
 * Inflate a trend's recorded `summary.windowVerdictCounts.stable` so it no longer matches the trend's own posture
 * sequence (a CHECK-A tamper) — the trend verdict still re-derives from the summary (the count change doesn't flip the
 * verdict), but the recorded distribution disagrees with the sequence that produced it.
 */
export function tamperTrendSummary(trend: ReleaseDecisionTrendResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    summary: { windowVerdictCounts: { stable: number } };
  };
  clone.summary.windowVerdictCounts.stable += 5;
  return clone;
}

/** A tampered trend (a hand-flipped recorded verdict ⇒ a `tampered` source). */
export function tamperedTrend(): Record<string, unknown> {
  return tamperTrendVerdict(stableTrend(), "blocked");
}

/** An input that is NOT a recognized release decision trend (⇒ an `unreadable` source). */
export function notATrend(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision trend" };
}

/* ------------------------------------------------------------------ *
 *  Plan input assembly (what build/plan fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (no strict, default action cap). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionActionPlanPolicy> = {},
): ReleaseDecisionActionPlanPolicy {
  return { strict: false, maxActions: DEFAULT_MAX_ACTIONS, ...over };
}

/** Ingest a trend object through the trust boundary. */
export function ingestTrendObj(obj: unknown): IngestedTrend {
  return ingestTrend(obj);
}

/** Build a real {@link ReleaseDecisionActionPlanResult} from a trend object. */
export function makePlan(
  obj: unknown,
  policy: Partial<ReleaseDecisionActionPlanPolicy> = {},
): ReleaseDecisionActionPlanResult {
  return buildActionPlanResult(NOW, ingestTrend(obj), defaultPolicy(policy));
}

/** A provider that serves the supplied trend object by its "path" (`trend-0`) or a stdin payload. */
export function makeProvider(obj: unknown, stdin = ""): ReleaseDecisionActionPlanProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (path !== "trend-0") throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionActionPlanArgs} that reference the supplied trend by its "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionActionPlanArgs> = {},
): ReleaseDecisionActionPlanArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxActions: DEFAULT_MAX_ACTIONS,
    strict: false,
    trendPath: "trend-0",
    ...over,
  };
}
