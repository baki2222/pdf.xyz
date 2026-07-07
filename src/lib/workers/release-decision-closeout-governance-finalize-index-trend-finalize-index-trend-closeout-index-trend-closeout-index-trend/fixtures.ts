/**
 * Test-support builders for the release decision closeout governance finalize index trend finalize index trend closeout index trend closeout
 * index trend tests (Phase 86).
 *
 * The trend ingests `…-closeout-index/1` windows, so these helpers build REAL, self-consistent closeout-index windows of each
 * index verdict — by driving the shipped Phase 85 closeout-index builder ({@link makeCloseoutIndex}) over real Phase 84
 * closeout records (via the closeout-index fixtures, which themselves reuse each phase's builders). An `all-closed` / `open`
 * / `incomplete` / `blocked` / `invalid` window re-derives its own index rollup + coverage + distribution,
 * so the trend's trust boundary marks it `usable`; {@link tamperCloseoutIndexVerdict} flips a recorded verdict so it no
 * longer re-derives (a recognized-but-inconsistent window the trend catches as a tamper).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedCloseout,
  closedCloseout,
  incompleteCloseout,
  invalidCloseout,
  makeIndex as makeCloseoutIndex,
  openCloseout,
  tamperedCloseout,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index/fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index/types";
import { ingestCloseoutIndex, type IngestedCloseoutIndex } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs } from "./args";
import { buildTrendResult } from "./build";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendProvider } from "./run";
import {
  DEFAULT_MAX_INDEXES,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
} from "./types";

/** A fixed clock the trend tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real closeout-index-window builders (each self-consistent → usable by the trend)
 * ------------------------------------------------------------------ */

/** An INDEXED window: a single-record index whose latest closeout record is CLOSED (a coherent history). */
export function allClosedWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return makeCloseoutIndex([closedCloseout()]);
}

/** An INDEXED window over a multi-record coherent history (exercises a wider closeout distribution). */
export function allClosedHistory(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return makeCloseoutIndex([closedCloseout(), closedCloseout(), closedCloseout()]);
}

/** An INDEX-OPEN window: a single-record index whose latest record is OPEN (an open follow-up). */
export function openWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return makeCloseoutIndex([openCloseout()]);
}

/** An INDEX-INCOMPLETE window: a single-record index whose latest record is INCOMPLETE (a coverage gap). */
export function incompleteWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return makeCloseoutIndex([incompleteCloseout()]);
}

/** An INDEX-BLOCKED window: a single-record index whose latest record is BLOCKED (a blocked history). */
export function blockedWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return makeCloseoutIndex([blockedCloseout()]);
}

/**
 * An INDEX-INVALID window: a single-record index over a TAMPERED closeout record. The window itself is self-consistent (it
 * correctly indexed a tampered record as `invalid`), so the trend marks it `usable` — its OWN verdict `invalid`
 * is a BLOCKING trend outcome (distinct from a tampered / unreadable TREND input).
 */
export function invalidWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return makeCloseoutIndex([tamperedCloseout()]);
}

/** A window whose latest usable record is INVALID (its own closeout verdict is `invalid`) → an `blocked` window. */
export function invalidRecordWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  return makeCloseoutIndex([invalidCloseout()]);
}

/** Build a real closeout-index window for the given index verdict (a small dispatcher for table-driven tests). */
export function windowFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult {
  switch (verdict) {
    case "all-closed":
      return allClosedWindow();
    case "open":
      return openWindow();
    case "incomplete":
      return incompleteWindow();
    case "blocked":
      return blockedWindow();
    case "invalid":
      return invalidWindow();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a closeout-index window's recorded index verdict (the top-level headline + the nested `closeoutIndex` rollup verdict +
 * exit + allClosed flag) so it no longer re-derives from the window's own recorded coverage + distribution (a re-derivation
 * tamper).
 */
export function tamperCloseoutIndexVerdict(
  window: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(window)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    closeoutIndex: { verdict: string; exitCode: number; allClosed: boolean };
  };
  clone.verdict = to;
  clone.exitCode = exit;
  clone.closeoutIndex.verdict = to;
  clone.closeoutIndex.exitCode = exit;
  clone.closeoutIndex.allClosed = to === "all-closed";
  return clone;
}

/** A tampered window (a hand-flipped all-closed→blocked ⇒ a `tampered` point). */
export function tamperedWindow(): Record<string, unknown> {
  return tamperCloseoutIndexVerdict(allClosedWindow(), "blocked", 4);
}

/** An input that is NOT a recognized release decision closeout-index window (⇒ an `unreadable` point). */
export function notAWindow(): Record<string, unknown> {
  return {
    schema: "pdfxyz.something-else/1",
    note: "not a release decision closeout-index summary",
  };
}

/* ------------------------------------------------------------------ *
 *  Trend input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no strict-open, no require-latest). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy {
  return {
    maxIndexes: DEFAULT_MAX_INDEXES,
    maxOpen: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictOpen: false,
    requireLatestAllClosed: false,
    ...over,
  };
}

/** Reduce a list of window objects (oldest → newest) to the ingested windows the fold consumes. */
export function ingestWindowsFrom(objs: readonly unknown[]): IngestedCloseoutIndex[] {
  return objs.map((obj) => ingestCloseoutIndex(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult} from a list of window objects. */
export function makeTrend(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendResult {
  return buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied window object by its positional "path" (`index-<i>`) or a stdin payload. */
export function makeProvider(
  objs: readonly unknown[],
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendProvider {
  const byPath = new Map<string, unknown>();
  objs.forEach((obj, i) => byPath.set(`index-${i}`, obj));
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      if (!byPath.has(path)) throw new Error("enoent");
      const obj = byPath.get(path);
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs} that reference each window by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxIndexes: DEFAULT_MAX_INDEXES,
    maxOpen: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictOpen: false,
    requireLatestAllClosed: false,
    indexPaths: objs.map((_, i) => `index-${i}`),
    ...over,
  };
}
