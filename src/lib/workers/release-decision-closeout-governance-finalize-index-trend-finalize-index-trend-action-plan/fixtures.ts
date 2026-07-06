/**
 * Test-support builders for the release decision closeout governance finalize index trend finalize index trend action plan tests (Phase 82).
 *
 * The plan ingests ONE `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/1` document, so these helpers
 * build REAL, self-consistent finalize-index trend summaries of each trend verdict — by composing the shipped Phase 81
 * trend ({@link makeTrend}) over genuinely coherent histories of finalize-index windows (reusing the
 * release-decision-closeout-governance-finalize-index-trend-finalize-index-trend fixtures, which themselves reuse each phase's builders). A
 * stable / improving / watch / degrading / insufficient / blocked / invalid trend re-derives its own verdict + summary,
 * so the plan's trust boundary marks it `usable`; {@link tamperTrendVerdict} flips a recorded top-level trend verdict so
 * it no longer re-derives (a CHECK-B tamper), and {@link tamperTrendSummary} inflates a recorded finalization count so it
 * no longer matches the trend's own posture sequence (a CHECK-A tamper) — both recognized-but-inconsistent trends the
 * plan catches.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedWindow,
  incompleteWindow,
  indexedWindow,
  makeTrend,
  openWindow,
  tamperedWindow,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/fixtures";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend/types";
import { buildFinalizeIndexTrendActionPlanResult } from "./build";
import { ingestFinalizeIndexTrend, type IngestedFinalizeIndexTrend } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanArgs } from "./args";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanProvider } from "./run";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanPolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanResult,
} from "./types";

/** A fixed clock the plan tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real trend builders (each self-consistent → usable by the plan)
 *
 *  Building a REAL trend drives the whole Phase 79→75→76 evidence chain (finalization bundles → finalize index →
 *  trend), which is ~1s of hashing per trend. The plan tests build each trend many times, so each builder is MEMOIZED:
 *  the expensive build runs once per verdict, and every call returns a fresh deep clone of that template (so a caller
 *  that mutates its copy never disturbs another's). The trends are deterministic (a fixed `NOW`), so the cached
 *  template is stable.
 * ------------------------------------------------------------------ */

/** Memoize a `() => trend` builder: build once, then return a fresh deep clone each call. */
function memoTrend(
  build: () => ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult,
): () => ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult {
  let cached: string | undefined;
  return () => {
    if (cached === undefined) cached = JSON.stringify(build());
    return JSON.parse(cached) as ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult;
  };
}

/** A STABLE trend: a coherent all-indexed history (its trend verdict re-derives as `stable`). */
export const stableTrend = memoTrend(() => makeTrend([indexedWindow(), indexedWindow(), indexedWindow()]));

/** An IMPROVING trend: an open window recovering to an indexed latest (trend verdict `improving`). */
export const improvingTrend = memoTrend(() => makeTrend([openWindow(), indexedWindow()]));

/** A WATCH trend: an indexed latest over an older open window (mixed arc; trend verdict `watch`). */
export const watchTrend = memoTrend(() => makeTrend([indexedWindow(), openWindow(), indexedWindow()]));

/** A DEGRADING trend: an indexed window worsening to an open latest (trend verdict `degrading`). */
export const degradingTrend = memoTrend(() => makeTrend([indexedWindow(), openWindow()]));

/** An INSUFFICIENT trend: a flat incomplete history (trend verdict `insufficient`). */
export const insufficientTrend = memoTrend(() => makeTrend([incompleteWindow(), incompleteWindow()]));

/** A BLOCKED trend: an indexed window followed by a blocked latest (trend verdict `blocked`). */
export const blockedTrend = memoTrend(() => makeTrend([indexedWindow(), blockedWindow()]));

/** An INVALID-history trend: an indexed window plus a tampered window (trend verdict `invalid`). */
export const invalidHistoryTrend = memoTrend(() => makeTrend([indexedWindow(), tamperedWindow()]));

/** Build a real trend for the given trend verdict (a small dispatcher for table-driven tests). */
export function trendFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult {
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
  trend: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & { verdict: string };
  clone.verdict = to;
  return clone;
}

/**
 * Inflate a trend's recorded `finalizationDistribution.totalConsidered` so it no longer matches the trend's own posture
 * sequence (a CHECK-A tamper) — the trend verdict still re-derives from the reconstructed summary (`totalConsidered` is
 * not read by the Phase 81 rollup reducer, so the recorded rollup still matches), but the recorded finalization sum
 * disagrees with the sequence that produced it.
 */
export function tamperTrendSummary(
  trend: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendResult,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    finalizationDistribution: { totalConsidered: number };
  };
  clone.finalizationDistribution.totalConsidered += 5;
  return clone;
}

/** A tampered trend (a hand-flipped recorded verdict ⇒ a `tampered` source). */
export function tamperedTrend(): Record<string, unknown> {
  return tamperTrendVerdict(stableTrend(), "blocked");
}

/** An input that is NOT a recognized release decision closeout governance finalize index trend finalize index trend (⇒ `unreadable`). */
export function notATrend(): Record<string, unknown> {
  return {
    schema: "pdfxyz.something-else/1",
    note: "not a release decision closeout governance finalize index trend finalize index trend",
  };
}

/* ------------------------------------------------------------------ *
 *  Plan input assembly (what build/actions fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (no strict-watch, no require-clean). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanPolicy {
  return { strictWatch: false, requireClean: false, ...over };
}

/** Ingest a trend object through the trust boundary. */
export function ingestTrendObj(obj: unknown): IngestedFinalizeIndexTrend {
  return ingestFinalizeIndexTrend(obj);
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanResult} from a trend object. */
export function makePlan(
  obj: unknown,
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanResult {
  return buildFinalizeIndexTrendActionPlanResult(NOW, ingestFinalizeIndexTrend(obj), defaultPolicy(policy));
}

/** A provider that serves the supplied trend object by its "path" (`trend-0`) or a stdin payload. */
export function makeProvider(
  obj: unknown,
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (path !== "trend-0") throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanArgs} referencing the trend by its "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendActionPlanArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    strictWatch: false,
    requireClean: false,
    trendPath: "trend-0",
    ...over,
  };
}
