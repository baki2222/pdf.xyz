/**
 * Test-support builders for the release decision index trend summary tests (Phase 61).
 *
 * The trend ingests `pdfxyz.release-decision-index/1` windows, so these helpers build REAL, self-consistent decision
 * indexes of each index verdict — by composing the shipped Phase 60 index over genuinely coherent batches of decision
 * records (reusing the release-decision-index fixtures, which themselves reuse the Phase 59 / 57 / 58 builders). A
 * stable / watch / insufficient / blocked / invalid window re-derives its own index verdict + counts, so the trend's
 * trust boundary marks it `usable`; {@link tamperWindowVerdict} flips a recorded index verdict so it no longer
 * re-derives, and {@link tamperWindowCounts} lies about a ledger count so it no longer matches the window's own
 * sequence (both recognized-but-inconsistent windows the trend catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is
 * never imported by any runtime module.
 */

import {
  followupDecision,
  holdDecision,
  insufficientDecision,
  makeIndex,
  notADecision,
  proceedDecision,
  rejectDecision,
} from "../release-decision-index/fixtures";
import type {
  ReleaseDecisionIndexPolicy,
  ReleaseDecisionIndexResult,
} from "../release-decision-index/types";
import { buildTrendResult } from "./build";
import { ingestDecisionIndex, type IngestedDecisionIndex } from "./ingest";
import type { ReleaseDecisionTrendArgs } from "./args";
import type { ReleaseDecisionTrendProvider } from "./run";
import {
  DEFAULT_MAX_WINDOWS,
  type ReleaseDecisionTrendPolicy,
  type ReleaseDecisionTrendResult,
} from "./types";

/** A fixed clock the trend tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real decision-index-window builders (each self-consistent → usable by the trend)
 * ------------------------------------------------------------------ */

/** A STABLE window: a clean batch of proceed decisions (its index verdict re-derives as `stable`). */
export function stableWindow(over: Partial<ReleaseDecisionIndexPolicy> = {}): ReleaseDecisionIndexResult {
  return makeIndex([proceedDecision(), proceedDecision()], over);
}

/** A WATCH window: a proceed + a proceed-with-followup decision (its index verdict is `watch`). */
export function watchWindow(): ReleaseDecisionIndexResult {
  return makeIndex([proceedDecision(), followupDecision()]);
}

/** A WATCH window via a HOLD decision (its index verdict is `watch`; distinct from the followup watch window). */
export function holdWindow(): ReleaseDecisionIndexResult {
  return makeIndex([proceedDecision(), holdDecision()]);
}

/** An INSUFFICIENT window: a proceed + an insufficient decision (its index verdict is `insufficient`). */
export function insufficientWindow(): ReleaseDecisionIndexResult {
  return makeIndex([proceedDecision(), insufficientDecision()]);
}

/** A BLOCKED window: a proceed + a reject decision (its index verdict is `blocked`). */
export function blockedWindow(): ReleaseDecisionIndexResult {
  return makeIndex([proceedDecision(), rejectDecision()]);
}

/**
 * An INVALID window: a proceed decision + an unreadable decoy record → the window's OWN index verdict is `invalid`
 * (Phase 60 found an untrustworthy record in its batch). The window itself re-derives (it is a valid decision index
 * that concluded `invalid`), so the trend marks it `usable` and counts a blocking `invalid` window.
 */
export function invalidWindow(): ReleaseDecisionIndexResult {
  return makeIndex([proceedDecision(), notADecision()]);
}

/** Build a real window for the given index verdict (a small dispatcher for table-driven tests). */
export function windowFor(
  verdict: "stable" | "watch" | "insufficient" | "blocked" | "invalid",
): ReleaseDecisionIndexResult {
  switch (verdict) {
    case "stable":
      return stableWindow();
    case "watch":
      return watchWindow();
    case "insufficient":
      return insufficientWindow();
    case "blocked":
      return blockedWindow();
    case "invalid":
      return invalidWindow();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/** Flip a window's recorded index verdict so it no longer re-derives from its own ledger (a CHECK-B tamper). */
export function tamperWindowVerdict(
  window: ReleaseDecisionIndexResult,
  to: "stable" | "watch" | "insufficient" | "blocked" | "invalid",
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(window)) as Record<string, unknown> & {
    index: { verdict: string };
  };
  clone.index.verdict = to;
  return clone;
}

/**
 * Inflate a window's recorded `ledger.decisionCounts.proceed` so it no longer matches the window's own per-record
 * sequence (a CHECK-A tamper) — the index verdict still re-derives (proceed is not read by the rollup), but the count
 * disagrees with the sequence that produced it.
 */
export function tamperWindowCounts(window: ReleaseDecisionIndexResult): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(window)) as Record<string, unknown> & {
    ledger: { decisionCounts: { proceed: number } };
  };
  clone.ledger.decisionCounts.proceed += 7;
  return clone;
}

/** A tampered window (a hand-flipped recorded index verdict ⇒ a `tampered` point). */
export function tamperedWindow(): Record<string, unknown> {
  return tamperWindowVerdict(stableWindow(), "blocked");
}

/** An input that is NOT a recognized release decision index (⇒ an `unreadable` point). */
export function notADecisionIndex(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision index" };
}

/* ------------------------------------------------------------------ *
 *  Trend input assembly (what build/reduce/rollup fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, no strict). */
export function defaultPolicy(over: Partial<ReleaseDecisionTrendPolicy> = {}): ReleaseDecisionTrendPolicy {
  return { maxWindows: DEFAULT_MAX_WINDOWS, strict: false, ...over };
}

/** Reduce a list of window objects (oldest → newest) to the ingested windows the fold consumes. */
export function ingestWindowsFrom(objs: readonly unknown[]): IngestedDecisionIndex[] {
  return objs.map((obj) => ingestDecisionIndex(obj));
}

/** Build a real {@link ReleaseDecisionTrendResult} from a list of window objects (oldest → newest). */
export function makeTrend(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionTrendPolicy> = {},
): ReleaseDecisionTrendResult {
  return buildTrendResult(NOW, ingestWindowsFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied window object by its positional "path" (`window-<i>`) or a stdin payload. */
export function makeProvider(objs: readonly unknown[], stdin = ""): ReleaseDecisionTrendProvider {
  const byPath = new Map<string, unknown>();
  objs.forEach((obj, i) => byPath.set(`window-${i}`, obj));
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

/** Build {@link ReleaseDecisionTrendArgs} that reference each supplied window by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionTrendArgs> = {},
): ReleaseDecisionTrendArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxWindows: DEFAULT_MAX_WINDOWS,
    strict: false,
    windowPaths: objs.map((_, i) => `window-${i}`),
    ...over,
  };
}
