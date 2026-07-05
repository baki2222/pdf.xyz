/**
 * Test-support builders for the release decision closeout index trend action plan tests (Phase 67).
 *
 * The plan ingests ONE `pdfxyz.release-decision-closeout-index-trend/1` document, so these helpers build REAL,
 * self-consistent closeout-index trend summaries of each trend verdict — by composing the shipped Phase 66 trend
 * ({@link makeTrend}) over genuinely coherent histories of closeout-index windows (reusing the
 * release-decision-closeout-index-trend fixtures, which themselves reuse each phase's builders). A trend-stable /
 * trend-incomplete / trend-watch / trend-blocked trend re-derives its own verdict + summary, so the plan's trust
 * boundary marks it `usable`; {@link tamperTrendVerdict} flips a recorded trend verdict so it no longer re-derives (a
 * CHECK-B tamper), and {@link tamperTrendSummary} inflates a recorded closeout count so it no longer matches the trend's
 * own posture sequence (a CHECK-A tamper) — both recognized-but-inconsistent trends the plan catches.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedIndex,
  incompleteIndex,
  indexedIndex,
  makeTrend,
  openIndex,
} from "../release-decision-closeout-index-trend/fixtures";
import type {
  ReleaseDecisionCloseoutIndexTrendResult,
  ReleaseDecisionCloseoutIndexTrendVerdict,
} from "../release-decision-closeout-index-trend/types";
import { buildCloseoutActionPlanResult } from "./build";
import { ingestCloseoutTrend, type IngestedCloseoutTrend } from "./ingest";
import type { ReleaseDecisionCloseoutActionPlanArgs } from "./args";
import type { ReleaseDecisionCloseoutActionPlanProvider } from "./run";
import type {
  ReleaseDecisionCloseoutActionPlanPolicy,
  ReleaseDecisionCloseoutActionPlanResult,
} from "./types";

/** A fixed clock the plan tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real trend builders (each self-consistent → usable by the plan)
 * ------------------------------------------------------------------ */

/** A TREND-STABLE trend: a coherent all-indexed history (its trend verdict re-derives as `trend-stable`). */
export function stableTrend(): ReleaseDecisionCloseoutIndexTrendResult {
  return makeTrend([indexedIndex(), indexedIndex(), indexedIndex()]);
}

/** A TREND-INCOMPLETE trend: a flat incomplete history (trend verdict `trend-incomplete`). */
export function incompleteTrend(): ReleaseDecisionCloseoutIndexTrendResult {
  return makeTrend([incompleteIndex(), incompleteIndex()]);
}

/** A TREND-WATCH trend: an indexed window worsening to an open latest (trend verdict `trend-watch`). */
export function watchTrend(): ReleaseDecisionCloseoutIndexTrendResult {
  return makeTrend([indexedIndex(), openIndex()]);
}

/** A TREND-BLOCKED trend: an indexed window followed by a blocked latest (trend verdict `trend-blocked`). */
export function blockedTrend(): ReleaseDecisionCloseoutIndexTrendResult {
  return makeTrend([indexedIndex(), blockedIndex()]);
}

/** Build a real trend for the given trend verdict (a small dispatcher for table-driven tests). */
export function trendFor(
  verdict: ReleaseDecisionCloseoutIndexTrendVerdict,
): ReleaseDecisionCloseoutIndexTrendResult {
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
  trend: ReleaseDecisionCloseoutIndexTrendResult,
  to: ReleaseDecisionCloseoutIndexTrendVerdict,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    closeoutIndexTrend: { verdict: string };
  };
  clone.closeoutIndexTrend.verdict = to;
  return clone;
}

/**
 * Inflate a trend's recorded `summary.totalCloseouts` so it no longer matches the trend's own posture sequence (a
 * CHECK-A tamper) — the trend verdict still re-derives from the summary (`totalCloseouts` is not read by the Phase 66
 * rollup reducer, so the recorded rollup still matches), but the recorded closeout sum disagrees with the sequence that
 * produced it.
 */
export function tamperTrendSummary(
  trend: ReleaseDecisionCloseoutIndexTrendResult,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trend)) as Record<string, unknown> & {
    summary: { totalCloseouts: number };
  };
  clone.summary.totalCloseouts += 5;
  return clone;
}

/** A tampered trend (a hand-flipped recorded verdict ⇒ a `tampered` source). */
export function tamperedTrend(): Record<string, unknown> {
  return tamperTrendVerdict(stableTrend(), "trend-blocked");
}

/** An input that is NOT a recognized release decision closeout index trend (⇒ an `unreadable` source). */
export function notATrend(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout index trend" };
}

/* ------------------------------------------------------------------ *
 *  Plan input assembly (what build/actions fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (no strict-watch). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutActionPlanPolicy> = {},
): ReleaseDecisionCloseoutActionPlanPolicy {
  return { strictWatch: false, ...over };
}

/** Ingest a trend object through the trust boundary. */
export function ingestTrendObj(obj: unknown): IngestedCloseoutTrend {
  return ingestCloseoutTrend(obj);
}

/** Build a real {@link ReleaseDecisionCloseoutActionPlanResult} from a trend object. */
export function makePlan(
  obj: unknown,
  policy: Partial<ReleaseDecisionCloseoutActionPlanPolicy> = {},
): ReleaseDecisionCloseoutActionPlanResult {
  return buildCloseoutActionPlanResult(NOW, ingestCloseoutTrend(obj), defaultPolicy(policy));
}

/** A provider that serves the supplied trend object by its "path" (`trend-0`) or a stdin payload. */
export function makeProvider(obj: unknown, stdin = ""): ReleaseDecisionCloseoutActionPlanProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (path !== "trend-0") throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutActionPlanArgs} that reference the supplied trend by its "path". */
export function makeArgs(
  over: Partial<ReleaseDecisionCloseoutActionPlanArgs> = {},
): ReleaseDecisionCloseoutActionPlanArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    strictWatch: false,
    trendPath: "trend-0",
    ...over,
  };
}
