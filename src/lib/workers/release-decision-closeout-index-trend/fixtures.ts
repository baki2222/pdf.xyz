/**
 * Test-support builders for the release decision closeout index trend tests (Phase 66).
 *
 * The trend ingests `pdfxyz.release-decision-closeout-index/1` windows, so these helpers build REAL, self-consistent
 * closeout-index windows of each index verdict — by driving the shipped Phase 65 closeout-index builder
 * ({@link makeIndex}) over real Phase 64 closeout records (via the closeout-index fixtures, which themselves reuse each
 * phase's builders). An `indexed` / `index-open` / `index-incomplete` / `index-blocked` window re-derives its own index
 * rollup + ledger, so the trend's trust boundary marks it `usable`; {@link tamperIndexVerdict} flips a recorded verdict
 * so it no longer re-derives (a recognized-but-inconsistent window the trend catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedCloseout,
  closedCloseout,
  incompleteCloseout,
  makeIndex,
  openCloseout,
} from "../release-decision-closeout-index/fixtures";
import type { ReleaseDecisionCloseoutIndexResult } from "../release-decision-closeout-index/types";
import { ingestCloseoutIndex, type IngestedCloseoutIndex } from "./ingest";
import type { ReleaseDecisionCloseoutIndexTrendArgs } from "./args";
import { buildTrendResult } from "./build";
import type { ReleaseDecisionCloseoutIndexTrendProvider } from "./run";
import {
  DEFAULT_MAX_INDEXES,
  type ReleaseDecisionCloseoutIndexTrendPolicy,
  type ReleaseDecisionCloseoutIndexTrendResult,
  type ReleaseDecisionCloseoutIndexVerdict,
} from "./types";

/** A fixed clock the trend tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real closeout-index-window builders (each self-consistent → usable by the trend)
 * ------------------------------------------------------------------ */

/** An INDEXED window: a single-closeout index whose latest closeout is CLOSED (a coherent history). */
export function indexedIndex(): ReleaseDecisionCloseoutIndexResult {
  return makeIndex([closedCloseout()]);
}

/** An INDEXED window over a multi-closeout coherent history (exercises a wider closeout distribution). */
export function indexedHistory(): ReleaseDecisionCloseoutIndexResult {
  return makeIndex([closedCloseout(), closedCloseout(), closedCloseout()]);
}

/** An INDEX-OPEN window: a single-closeout index whose latest closeout is CLOSEOUT-OPEN (an open follow-up). */
export function openIndex(): ReleaseDecisionCloseoutIndexResult {
  return makeIndex([openCloseout()]);
}

/** An INDEX-INCOMPLETE window: a single-closeout index whose latest closeout is CLOSEOUT-INCOMPLETE (a coverage gap). */
export function incompleteIndex(): ReleaseDecisionCloseoutIndexResult {
  return makeIndex([incompleteCloseout()]);
}

/** An INDEX-BLOCKED window: a single-closeout index whose latest closeout is CLOSEOUT-BLOCKED (a blocked batch). */
export function blockedIndex(): ReleaseDecisionCloseoutIndexResult {
  return makeIndex([blockedCloseout()]);
}

/** Build a real closeout-index window for the given index verdict (a small dispatcher for table-driven tests). */
export function indexFor(verdict: ReleaseDecisionCloseoutIndexVerdict): ReleaseDecisionCloseoutIndexResult {
  switch (verdict) {
    case "indexed":
      return indexedIndex();
    case "index-incomplete":
      return incompleteIndex();
    case "index-open":
      return openIndex();
    case "index-blocked":
      return blockedIndex();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a closeout-index window's recorded index verdict (the nested `closeoutIndex` rollup verdict + exit + indexed
 * flag) so it no longer re-derives from the window's own recorded ledger (a re-derivation tamper).
 */
export function tamperIndexVerdict(
  index: ReleaseDecisionCloseoutIndexResult,
  to: ReleaseDecisionCloseoutIndexVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(index)) as Record<string, unknown> & {
    closeoutIndex: { verdict: string; exitCode: number; indexed: boolean };
  };
  clone.closeoutIndex.verdict = to;
  clone.closeoutIndex.exitCode = exit;
  clone.closeoutIndex.indexed = to === "indexed";
  return clone;
}

/** A tampered window (a hand-flipped indexed→blocked ⇒ a `tampered` point). */
export function tamperedIndex(): Record<string, unknown> {
  return tamperIndexVerdict(indexedIndex(), "index-blocked", 4);
}

/** An input that is NOT a recognized release decision closeout index (⇒ an `unreadable` point). */
export function notAnIndex(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout index summary" };
}

/* ------------------------------------------------------------------ *
 *  Trend input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no strict-watch). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutIndexTrendPolicy {
  return {
    maxIndexes: DEFAULT_MAX_INDEXES,
    maxWatch: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictWatch: false,
    ...over,
  };
}

/** Reduce a list of window objects (oldest → newest) to the ingested windows the fold consumes. */
export function ingestIndexesFrom(objs: readonly unknown[]): IngestedCloseoutIndex[] {
  return objs.map((obj) => ingestCloseoutIndex(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutIndexTrendResult} from a list of window objects (oldest → newest). */
export function makeTrend(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutIndexTrendPolicy> = {},
): ReleaseDecisionCloseoutIndexTrendResult {
  return buildTrendResult(NOW, ingestIndexesFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied window object by its positional "path" (`index-<i>`) or a stdin payload. */
export function makeProvider(objs: readonly unknown[], stdin = ""): ReleaseDecisionCloseoutIndexTrendProvider {
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

/** Build {@link ReleaseDecisionCloseoutIndexTrendArgs} that reference each supplied window by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutIndexTrendArgs> = {},
): ReleaseDecisionCloseoutIndexTrendArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxIndexes: DEFAULT_MAX_INDEXES,
    maxWatch: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictWatch: false,
    indexPaths: objs.map((_, i) => `index-${i}`),
    ...over,
  };
}
