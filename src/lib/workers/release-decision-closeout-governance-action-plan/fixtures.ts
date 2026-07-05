/**
 * Test-support builders for the release decision closeout governance index trend action plan tests (Phase 72).
 *
 * The plan ingests ONE `pdfxyz.release-decision-closeout-governance-index-trend/1` document, so these helpers build
 * REAL, self-consistent governance-index trend summaries of each trend verdict — by composing the shipped Phase 71 trend
 * ({@link makeTrend}) over genuinely coherent histories of governance-index windows (reusing the
 * release-decision-closeout-governance-index-trend fixtures, which themselves reuse each phase's builders). A
 * trend-stable / trend-incomplete / trend-watch / trend-blocked trend re-derives its own verdict + summary, so the
 * plan's trust boundary marks it `usable`; {@link tamperTrendVerdict} flips a recorded trend verdict so it no longer
 * re-derives (a CHECK-B tamper), and {@link tamperTrendSummary} inflates a recorded governance count so it no longer
 * matches the trend's own posture sequence (a CHECK-A tamper) — both recognized-but-inconsistent trends the plan
 * catches.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedWindow,
  incompleteWindow,
  indexedWindow,
  makeTrend,
  watchWindow,
} from "../release-decision-closeout-governance-index-trend/fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceIndexTrendResult,
  ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
} from "../release-decision-closeout-governance-index-trend/types";
import { buildGovernanceActionPlanResult } from "./build";
import { ingestGovernanceTrend, type IngestedGovernanceTrend } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceActionPlanArgs } from "./args";
import type { ReleaseDecisionCloseoutGovernanceActionPlanProvider } from "./run";
import type {
  ReleaseDecisionCloseoutGovernanceActionPlanPolicy,
  ReleaseDecisionCloseoutGovernanceActionPlanResult,
} from "./types";

/** A fixed clock the plan tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real trend builders (each self-consistent → usable by the plan)
 * ------------------------------------------------------------------ */

/** A TREND-STABLE trend: a coherent all-indexed history (its trend verdict re-derives as `trend-stable`). */
export function stableTrend(): ReleaseDecisionCloseoutGovernanceIndexTrendResult {
  return makeTrend([indexedWindow(), indexedWindow(), indexedWindow()]);
}

/** A TREND-INCOMPLETE trend: a flat incomplete history (trend verdict `trend-incomplete`). */
export function incompleteTrend(): ReleaseDecisionCloseoutGovernanceIndexTrendResult {
  return makeTrend([incompleteWindow(), incompleteWindow()]);
}

/** A TREND-WATCH trend: an indexed window worsening to an open latest (trend verdict `trend-watch`). */
export function watchTrend(): ReleaseDecisionCloseoutGovernanceIndexTrendResult {
  return makeTrend([indexedWindow(), watchWindow()]);
}

/** A TREND-BLOCKED trend: an indexed window followed by a blocked latest (trend verdict `trend-blocked`). */
export function blockedTrend(): ReleaseDecisionCloseoutGovernanceIndexTrendResult {
  return makeTrend([indexedWindow(), blockedWindow()]);
}

/** Build a real trend for the given trend verdict (a small dispatcher for table-driven tests). */
export function trendFor(
  verdict: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
): ReleaseDecisionCloseoutGovernanceIndexTrendResult {
  switch (verdict) {
    case "trend-stable":
      return stableTrend();
    case "trend-incomplete":
      return incompleteTrend();
    case "trend-watch":
      return watchTrend();
    case "trend-blocked":
      return blockedTrend();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers (the trend DOC itself is corrupt)
 * ------------------------------------------------------------------ */

/** Flip a trend's recorded verdict so it no longer re-derives from its own summary (a CHECK-B tamper). */
export function tamperTrendVerdict(
  trend: ReleaseDecisionCloseoutGovernanceIndexTrendResult,
  to: ReleaseDecisionCloseoutGovernanceIndexTrendVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    governanceIndexTrend: { verdict: string };
  };
  clone.governanceIndexTrend.verdict = to;
  return clone;
}

/**
 * Inflate a trend's recorded `summary.totalGovernance` so it no longer matches the trend's own posture sequence (a
 * CHECK-A tamper) — the trend verdict still re-derives from the summary (`totalGovernance` is not read by the Phase 71
 * rollup reducer, so the recorded rollup still matches), but the recorded governance sum disagrees with the sequence
 * that produced it.
 */
export function tamperTrendSummary(
  trend: ReleaseDecisionCloseoutGovernanceIndexTrendResult,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    summary: { totalGovernance: number };
  };
  clone.summary.totalGovernance += 5;
  return clone;
}

/** A tampered trend (a hand-flipped recorded verdict ⇒ a `tampered` source). */
export function tamperedTrend(): Record<string, unknown> {
  return tamperTrendVerdict(stableTrend(), "trend-blocked");
}

/** An input that is NOT a recognized release decision closeout governance index trend (⇒ an `unreadable` source). */
export function notATrend(): Record<string, unknown> {
  return {
    schema: "pdfxyz.something-else/1",
    note: "not a release decision closeout governance index trend",
  };
}

/* ------------------------------------------------------------------ *
 *  Plan input assembly (what build/actions fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (no strict-watch). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceActionPlanPolicy> = {},
): ReleaseDecisionCloseoutGovernanceActionPlanPolicy {
  return { strictWatch: false, ...over };
}

/** Ingest a trend object through the trust boundary. */
export function ingestTrendObj(obj: unknown): IngestedGovernanceTrend {
  return ingestGovernanceTrend(obj);
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceActionPlanResult} from a trend object. */
export function makePlan(
  obj: unknown,
  policy: Partial<ReleaseDecisionCloseoutGovernanceActionPlanPolicy> = {},
): ReleaseDecisionCloseoutGovernanceActionPlanResult {
  return buildGovernanceActionPlanResult(NOW, ingestGovernanceTrend(obj), defaultPolicy(policy));
}

/** A provider that serves the supplied trend object by its "path" (`trend-0`) or a stdin payload. */
export function makeProvider(
  obj: unknown,
  stdin = "",
): ReleaseDecisionCloseoutGovernanceActionPlanProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (path !== "trend-0") throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutGovernanceActionPlanArgs} that reference the supplied trend by its "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionCloseoutGovernanceActionPlanArgs> = {},
): ReleaseDecisionCloseoutGovernanceActionPlanArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    strictWatch: false,
    trendPath: "trend-0",
    ...over,
  };
}
