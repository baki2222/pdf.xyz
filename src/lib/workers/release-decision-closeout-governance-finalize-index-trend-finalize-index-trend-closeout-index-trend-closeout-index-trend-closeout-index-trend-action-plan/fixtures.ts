/**
 * Test-support builders for the release decision closeout governance finalize index trend finalize index trend closeout
 * index trend action plan tests (Phase 97).
 *
 * The plan ingests ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/1`
 * document, so these helpers build REAL, self-consistent closeout-index trend summaries of each trend verdict — by
 * composing the shipped Phase 96 trend ({@link makeTrend}) over genuinely coherent histories of closeout-index windows
 * (reusing the release-decision-…-closeout-index-trend fixtures, which themselves reuse each phase's builders). A
 * stable / improving / watch / degrading / insufficient / blocked / invalid trend re-derives its own verdict + summary,
 * so the plan's trust boundary marks it `usable`; {@link tamperTrendVerdict} flips a recorded top-level trend verdict so
 * it no longer re-derives (a CHECK-B tamper), and {@link tamperTrendSummary} inflates a recorded closeout count so it no
 * longer matches the trend's own posture sequence (a CHECK-A tamper) — both recognized-but-inconsistent trends the plan
 * catches.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedWindow,
  incompleteWindow,
  allClosedWindow,
  makeTrend,
  openWindow,
  tamperedWindow,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend/types";
import { buildCloseoutIndexTrendActionPlanResult } from "./build";
import { ingestCloseoutIndexTrend, type IngestedCloseoutIndexTrend } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs } from "./args";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanProvider } from "./run";
import { DEFAULT_MAX_ACTIONS } from "./types";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult,
} from "./types";

/** A fixed clock the plan tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real trend builders (each self-consistent → usable by the plan)
 *
 *  Building a REAL trend drives the whole closeout evidence chain (closeout records → closeout index → trend), which is
 *  ~1s of hashing per trend. The plan tests build each trend many times, so each builder is MEMOIZED: the expensive
 *  build runs once per verdict, and every call returns a fresh deep clone of that template (so a caller that mutates its
 *  copy never disturbs another's). The trends are deterministic (a fixed `NOW`), so the cached template is stable.
 * ------------------------------------------------------------------ */

/** Memoize a `() => trend` builder: build once, then return a fresh deep clone each call. */
function memoTrend(
  build: () => ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
): () => ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult {
  let cached: string | undefined;
  return () => {
    if (cached === undefined) cached = JSON.stringify(build());
    return JSON.parse(cached) as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult;
  };
}

/** A STABLE trend: a coherent all-closed history (its trend verdict re-derives as `stable`). */
export const stableTrend = memoTrend(() => makeTrend([allClosedWindow(), allClosedWindow(), allClosedWindow()]));

/** An IMPROVING trend: an open window recovering to an indexed latest (trend verdict `improving`). */
export const improvingTrend = memoTrend(() => makeTrend([openWindow(), allClosedWindow()]));

/** A WATCH trend: an indexed latest over an older open window (mixed arc; trend verdict `watch`). */
export const watchTrend = memoTrend(() => makeTrend([allClosedWindow(), openWindow(), allClosedWindow()]));

/** A DEGRADING trend: an indexed window worsening to an open latest (trend verdict `degrading`). */
export const degradingTrend = memoTrend(() => makeTrend([allClosedWindow(), openWindow()]));

/** An INSUFFICIENT trend: a flat incomplete history (trend verdict `insufficient`). */
export const insufficientTrend = memoTrend(() => makeTrend([incompleteWindow(), incompleteWindow()]));

/** A BLOCKED trend: an indexed window followed by a blocked latest (trend verdict `blocked`). */
export const blockedTrend = memoTrend(() => makeTrend([allClosedWindow(), blockedWindow()]));

/** An INVALID-history trend: an indexed window plus a tampered window (trend verdict `invalid`). */
export const invalidHistoryTrend = memoTrend(() => makeTrend([allClosedWindow(), tamperedWindow()]));

/** Build a real trend for the given trend verdict (a small dispatcher for table-driven tests). */
export function trendFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult {
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
      return invalidHistoryTrend();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers (the trend DOC itself is corrupt)
 * ------------------------------------------------------------------ */

/** Flip a trend's recorded top-level verdict so it no longer re-derives from its own summary (a CHECK-B tamper). */
export function tamperTrendVerdict(
  trend: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & { verdict: string };
  clone.verdict = to;
  return clone;
}

/**
 * Inflate a trend's recorded `closeoutDistribution.totalConsidered` so it no longer matches the trend's own posture
 * sequence (a CHECK-A tamper) — the trend verdict still re-derives from the reconstructed summary (`totalConsidered` is
 * not read by the Phase 96 rollup reducer, so the recorded rollup still matches), but the recorded closeout sum
 * disagrees with the sequence that produced it.
 */
export function tamperTrendSummary(
  trend: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    closeoutDistribution: { totalConsidered: number };
  };
  clone.closeoutDistribution.totalConsidered += 5;
  return clone;
}

/** A tampered trend (a hand-flipped recorded verdict ⇒ a `tampered` source). */
export function tamperedTrend(): Record<string, unknown> {
  return tamperTrendVerdict(stableTrend(), "blocked");
}

/** An input that is NOT a recognized release decision closeout-index trend (⇒ `unreadable`). */
export function notATrend(): Record<string, unknown> {
  return {
    schema: "pdfxyz.something-else/1",
    note: "not a release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend",
  };
}

/* ------------------------------------------------------------------ *
 *  Plan input assembly (what build/actions fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (no --strict, default --max-actions). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy {
  return { strict: false, maxActions: DEFAULT_MAX_ACTIONS, ...over };
}

/** Ingest a trend object through the trust boundary. */
export function ingestTrendObj(obj: unknown): IngestedCloseoutIndexTrend {
  return ingestCloseoutIndexTrend(obj);
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult} from a trend object. */
export function makePlan(
  obj: unknown,
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanResult {
  return buildCloseoutIndexTrendActionPlanResult(NOW, ingestCloseoutIndexTrend(obj), defaultPolicy(policy));
}

/** A provider that serves the supplied trend object by its "path" (`trend-0`) or a stdin payload. */
export function makeProvider(
  obj: unknown,
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (path !== "trend-0") throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs} referencing the trend by its "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexTrendActionPlanArgs {
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
