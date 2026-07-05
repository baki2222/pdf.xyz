/**
 * Test-support builders for the release decision closeout governance index trend tests (Phase 71).
 *
 * The trend ingests `pdfxyz.release-decision-closeout-governance-index/1` windows, so these helpers build REAL,
 * self-consistent governance-index windows of each index verdict — by driving the shipped Phase 70 governance-index
 * builder ({@link makeGovernanceIndex}) over real Phase 69 governance bundles (via the governance-index fixtures, which
 * themselves reuse each phase's builders). An `indexed` / `index-open` / `index-incomplete` / `index-blocked` window
 * re-derives its own index rollup + ledger, so the trend's trust boundary marks it `usable`;
 * {@link tamperIndexVerdict} flips a recorded verdict so it no longer re-derives (a recognized-but-inconsistent window
 * the trend catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedGovernance,
  closedGovernance,
  incompleteGovernance,
  makeIndex as makeGovernanceIndex,
  openGovernance,
} from "../release-decision-closeout-governance-index/fixtures";
import type { ReleaseDecisionCloseoutGovernanceIndexResult } from "../release-decision-closeout-governance-index/types";
import { ingestGovernanceIndex, type IngestedGovernanceIndex } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceIndexTrendArgs } from "./args";
import { buildTrendResult } from "./build";
import type { ReleaseDecisionCloseoutGovernanceIndexTrendProvider } from "./run";
import {
  DEFAULT_MAX_INDEXES,
  type ReleaseDecisionCloseoutGovernanceIndexTrendPolicy,
  type ReleaseDecisionCloseoutGovernanceIndexTrendResult,
  type ReleaseDecisionCloseoutGovernanceIndexVerdict,
} from "./types";

/** A fixed clock the trend tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real governance-index-window builders (each self-consistent → usable by the trend)
 * ------------------------------------------------------------------ */

/** An INDEXED window: a single-bundle index whose latest governance bundle is CLOSED (a coherent history). */
export function indexedWindow(): ReleaseDecisionCloseoutGovernanceIndexResult {
  return makeGovernanceIndex([closedGovernance()]);
}

/** An INDEXED window over a multi-bundle coherent history (exercises a wider governance distribution). */
export function indexedHistory(): ReleaseDecisionCloseoutGovernanceIndexResult {
  return makeGovernanceIndex([closedGovernance(), closedGovernance(), closedGovernance()]);
}

/** An INDEX-OPEN window: a single-bundle index whose latest bundle is GOVERNANCE-OPEN (an open follow-up). */
export function watchWindow(): ReleaseDecisionCloseoutGovernanceIndexResult {
  return makeGovernanceIndex([openGovernance()]);
}

/** An INDEX-INCOMPLETE window: a single-bundle index whose latest bundle is GOVERNANCE-INCOMPLETE (a coverage gap). */
export function incompleteWindow(): ReleaseDecisionCloseoutGovernanceIndexResult {
  return makeGovernanceIndex([incompleteGovernance()]);
}

/** An INDEX-BLOCKED window: a single-bundle index whose latest bundle is GOVERNANCE-BLOCKED (a blocked history). */
export function blockedWindow(): ReleaseDecisionCloseoutGovernanceIndexResult {
  return makeGovernanceIndex([blockedGovernance()]);
}

/** Build a real governance-index window for the given index verdict (a small dispatcher for table-driven tests). */
export function windowFor(
  verdict: ReleaseDecisionCloseoutGovernanceIndexVerdict,
): ReleaseDecisionCloseoutGovernanceIndexResult {
  switch (verdict) {
    case "indexed":
      return indexedWindow();
    case "index-incomplete":
      return incompleteWindow();
    case "index-open":
      return watchWindow();
    case "index-blocked":
      return blockedWindow();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a governance-index window's recorded index verdict (the nested `governanceIndex` rollup verdict + exit + indexed
 * flag) so it no longer re-derives from the window's own recorded ledger (a re-derivation tamper).
 */
export function tamperIndexVerdict(
  index: ReleaseDecisionCloseoutGovernanceIndexResult,
  to: ReleaseDecisionCloseoutGovernanceIndexVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(index)) as Record<string, unknown> & {
    governanceIndex: { verdict: string; exitCode: number; indexed: boolean };
  };
  clone.governanceIndex.verdict = to;
  clone.governanceIndex.exitCode = exit;
  clone.governanceIndex.indexed = to === "indexed";
  return clone;
}

/** A tampered window (a hand-flipped indexed→blocked ⇒ a `tampered` point). */
export function tamperedWindow(): Record<string, unknown> {
  return tamperIndexVerdict(indexedWindow(), "index-blocked", 4);
}

/** An input that is NOT a recognized release decision closeout governance index (⇒ an `unreadable` point). */
export function notAWindow(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout governance index summary" };
}

/* ------------------------------------------------------------------ *
 *  Trend input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no strict-watch). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutGovernanceIndexTrendPolicy {
  return {
    maxIndexes: DEFAULT_MAX_INDEXES,
    maxOpen: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictWatch: false,
    ...over,
  };
}

/** Reduce a list of window objects (oldest → newest) to the ingested windows the fold consumes. */
export function ingestWindowsFrom(objs: readonly unknown[]): IngestedGovernanceIndex[] {
  return objs.map((obj) => ingestGovernanceIndex(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceIndexTrendResult} from a list of window objects (oldest → newest). */
export function makeTrend(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutGovernanceIndexTrendResult {
  return buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied window object by its positional "path" (`index-<i>`) or a stdin payload. */
export function makeProvider(
  objs: readonly unknown[],
  stdin = "",
): ReleaseDecisionCloseoutGovernanceIndexTrendProvider {
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

/** Build {@link ReleaseDecisionCloseoutGovernanceIndexTrendArgs} that reference each supplied window by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutGovernanceIndexTrendArgs> = {},
): ReleaseDecisionCloseoutGovernanceIndexTrendArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxIndexes: DEFAULT_MAX_INDEXES,
    maxOpen: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictWatch: false,
    indexPaths: objs.map((_, i) => `index-${i}`),
    ...over,
  };
}
