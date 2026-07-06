/**
 * Test-support builders for the release decision closeout governance finalize index trend tests (Phase 76).
 *
 * The trend ingests `pdfxyz.release-decision-closeout-governance-finalize-index/1` windows, so these helpers build REAL,
 * self-consistent finalize-index windows of each index verdict — by driving the shipped Phase 75 finalize-index builder
 * ({@link makeFinalizeIndex}) over real Phase 74 finalization bundles (via the finalize-index fixtures, which themselves
 * reuse each phase's builders). An `indexed` / `index-open` / `index-incomplete` / `index-blocked` / `index-invalid`
 * window re-derives its own index rollup + coverage + distribution, so the trend's trust boundary marks it `usable`;
 * {@link tamperFinalizeIndexVerdict} flips a recorded verdict so it no longer re-derives (a recognized-but-inconsistent
 * window the trend catches as a tamper).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedFinalize,
  finalizedFinalize,
  incompleteFinalize,
  makeIndex as makeFinalizeIndex,
  openFinalize,
  tamperedFinalize,
} from "../release-decision-closeout-governance-finalize-index/fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexResult } from "../release-decision-closeout-governance-finalize-index/types";
import { ingestFinalizeIndex, type IngestedFinalizeIndex } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs } from "./args";
import { buildTrendResult } from "./build";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendProvider } from "./run";
import {
  DEFAULT_MAX_WINDOWS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
} from "./types";

/** A fixed clock the trend tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real finalize-index-window builders (each self-consistent → usable by the trend)
 * ------------------------------------------------------------------ */

/** An INDEXED window: a single-bundle index whose latest finalization bundle is FINALIZED (a coherent history). */
export function indexedWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  return makeFinalizeIndex([finalizedFinalize()]);
}

/** An INDEXED window over a multi-bundle coherent history (exercises a wider finalization distribution). */
export function indexedHistory(): ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  return makeFinalizeIndex([finalizedFinalize(), finalizedFinalize(), finalizedFinalize()]);
}

/** An INDEX-OPEN window: a single-bundle index whose latest bundle is FINALIZE-OPEN (an open follow-up). */
export function openWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  return makeFinalizeIndex([openFinalize()]);
}

/** An INDEX-INCOMPLETE window: a single-bundle index whose latest bundle is FINALIZE-INCOMPLETE (a coverage gap). */
export function incompleteWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  return makeFinalizeIndex([incompleteFinalize()]);
}

/** An INDEX-BLOCKED window: a single-bundle index whose latest bundle is FINALIZE-BLOCKED (a blocked history). */
export function blockedWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  return makeFinalizeIndex([blockedFinalize()]);
}

/**
 * An INDEX-INVALID window: a single-bundle index over a TAMPERED finalization bundle. The window itself is
 * self-consistent (it correctly indexed a tampered bundle as `index-invalid`), so the trend marks it `usable` — its OWN
 * verdict `index-invalid` is a BLOCKING trend outcome (distinct from a tampered / unreadable TREND input).
 */
export function invalidWindow(): ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  return makeFinalizeIndex([tamperedFinalize()]);
}

/** Build a real finalize-index window for the given index verdict (a small dispatcher for table-driven tests). */
export function windowFor(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
): ReleaseDecisionCloseoutGovernanceFinalizeIndexResult {
  switch (verdict) {
    case "indexed":
      return indexedWindow();
    case "index-open":
      return openWindow();
    case "index-incomplete":
      return incompleteWindow();
    case "index-blocked":
      return blockedWindow();
    case "index-invalid":
      return invalidWindow();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a finalize-index window's recorded index verdict (the nested `finalizeIndex` rollup verdict + exit + indexed
 * flag) so it no longer re-derives from the window's own recorded coverage + distribution (a re-derivation tamper).
 */
export function tamperFinalizeIndexVerdict(
  window: ReleaseDecisionCloseoutGovernanceFinalizeIndexResult,
  to: ReleaseDecisionCloseoutGovernanceFinalizeIndexVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(window)) as Record<string, unknown> & {
    finalizeIndex: { verdict: string; exitCode: number; indexed: boolean };
  };
  clone.finalizeIndex.verdict = to;
  clone.finalizeIndex.exitCode = exit;
  clone.finalizeIndex.indexed = to === "indexed";
  return clone;
}

/** A tampered window (a hand-flipped indexed→blocked ⇒ a `tampered` point). */
export function tamperedWindow(): Record<string, unknown> {
  return tamperFinalizeIndexVerdict(indexedWindow(), "index-blocked", 4);
}

/** An input that is NOT a recognized release decision closeout governance finalize index (⇒ an `unreadable` point). */
export function notAWindow(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout governance finalize index summary" };
}

/* ------------------------------------------------------------------ *
 *  Trend input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, no strict-open, no require-latest). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy {
  return {
    maxWindows: DEFAULT_MAX_WINDOWS,
    strictOpen: false,
    requireLatestIndexed: false,
    ...over,
  };
}

/** Reduce a list of window objects (oldest → newest) to the ingested windows the fold consumes. */
export function ingestWindowsFrom(objs: readonly unknown[]): IngestedFinalizeIndex[] {
  return objs.map((obj) => ingestFinalizeIndex(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult} from a list of window objects. */
export function makeTrend(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendResult {
  return buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied window object by its positional "path" (`index-<i>`) or a stdin payload. */
export function makeProvider(
  objs: readonly unknown[],
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendProvider {
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

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs} that reference each window by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxWindows: DEFAULT_MAX_WINDOWS,
    strictOpen: false,
    requireLatestIndexed: false,
    indexPaths: objs.map((_, i) => `index-${i}`),
    ...over,
  };
}
