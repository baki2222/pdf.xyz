/**
 * Test-support builders for the release decision closeout index tests (Phase 65).
 *
 * The index ingests `pdfxyz.release-decision-closeout/1` records, so these helpers build REAL, self-consistent closeout
 * records of each closeout verdict — by driving the shipped Phase 64 closeout builder ({@link makeCloseout}) over real
 * Phase 63 receipts (and, where a cross-check is exercised, real Phase 62 plans / Phase 61 trends / Phase 60 index
 * windows / Phase 59 decision records, all via the closeout fixtures, which themselves reuse each phase's builders). A
 * closed / incomplete / open / blocked record re-derives its own rollup, so the index's trust boundary marks it
 * `usable`; {@link tamperCloseoutVerdict} flips a recorded verdict so it no longer re-derives (a
 * recognized-but-inconsistent record the index catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is
 * never imported by any runtime module.
 */

import {
  blockedReceipt,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  decisionFor,
  incompleteReceipt,
  makeCloseout,
  openReceipt,
  policyWith,
  windowFor,
  type RelatedInputs,
} from "../release-decision-closeout/fixtures";
import type {
  ReleaseDecisionCloseoutPolicy,
  ReleaseDecisionCloseoutResult,
} from "../release-decision-closeout/types";
import { ingestCloseout, type IngestedCloseout } from "./ingest";
import type { ReleaseDecisionCloseoutIndexArgs } from "./args";
import { buildCloseoutIndexResult } from "./build";
import type { ReleaseDecisionCloseoutIndexProvider } from "./run";
import {
  DEFAULT_MAX_CLOSEOUTS,
  type ReleaseDecisionCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutIndexResult,
  type ReleaseDecisionCloseoutVerdict,
} from "./types";

/** A fixed clock the index tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real closeout-record builders (each self-consistent → usable by the index)
 * ------------------------------------------------------------------ */

/** A CLOSED closeout: a completed receipt, no related records. */
export function closedCloseout(): ReleaseDecisionCloseoutResult {
  return makeCloseout(completedReceipt());
}

/** A CLOSED closeout cross-checked against a coherent plan + trend (exercises coherent related signals). */
export function closedWithCoherent(): ReleaseDecisionCloseoutResult {
  return makeCloseout(completedReceipt(), { plan: coherentPlan(), trend: coherentTrend() });
}

/** A CLOSED closeout with a coherent decision + index source chain (exercises source-chain-coherent signals). */
export function closedWithSourceChain(): ReleaseDecisionCloseoutResult {
  return makeCloseout(completedReceipt(), { decision: decisionFor("proceed"), index: windowFor("stable") });
}

/** A CLOSEOUT-INCOMPLETE closeout: a clear plan NOT acknowledged as reviewed (an incomplete receipt). */
export function incompleteCloseout(): ReleaseDecisionCloseoutResult {
  return makeCloseout(incompleteReceipt());
}

/** A CLOSEOUT-OPEN closeout: a monitor plan reviewed but its follow-up not acknowledged (a followup-open receipt). */
export function openCloseout(): ReleaseDecisionCloseoutResult {
  return makeCloseout(openReceipt());
}

/** A CLOSEOUT-BLOCKED closeout: a block plan not acknowledged as held-blocked (a blocked receipt). */
export function blockedCloseout(): ReleaseDecisionCloseoutResult {
  return makeCloseout(blockedReceipt());
}

/** A CLOSEOUT-BLOCKED closeout via a cross-check contradiction (a plan that disagrees with the receipt). */
export function contradictoryCloseout(): ReleaseDecisionCloseoutResult {
  return makeCloseout(completedReceipt(), { plan: contradictoryPlan() });
}

/** A CLOSEOUT-BLOCKED closeout via a blocked source chain (a `reject` decision upstream). */
export function sourceBlockedCloseout(): ReleaseDecisionCloseoutResult {
  return makeCloseout(completedReceipt(), { decision: decisionFor("reject") });
}

/** A CLOSEOUT-OPEN closeout via an advisory source chain (a `proceed-with-followup` decision upstream). */
export function sourceAdvisoryCloseout(): ReleaseDecisionCloseoutResult {
  return makeCloseout(completedReceipt(), { decision: decisionFor("proceed-with-followup") });
}

/** Build a real closeout record for the given closeout verdict (a small dispatcher for table-driven tests). */
export function closeoutFor(verdict: ReleaseDecisionCloseoutVerdict): ReleaseDecisionCloseoutResult {
  switch (verdict) {
    case "closed":
      return closedCloseout();
    case "closeout-incomplete":
      return incompleteCloseout();
    case "closeout-open":
      return openCloseout();
    case "closeout-blocked":
      return blockedCloseout();
  }
}

/** Build a closeout with arbitrary related inputs / policy (for cross-check + require tests). */
export function closeoutWith(
  receipt: unknown,
  inputs: RelatedInputs = {},
  policy: ReleaseDecisionCloseoutPolicy = policyWith(),
): ReleaseDecisionCloseoutResult {
  return makeCloseout(receipt, inputs, policy);
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a closeout record's recorded verdict (the top-level headline + the nested `closeout` rollup + the mirrored exit
 * codes) so it no longer re-derives from the closeout's own recorded receipt-source + related-record signals (a
 * re-derivation tamper).
 */
export function tamperCloseoutVerdict(
  closeout: ReleaseDecisionCloseoutResult,
  to: ReleaseDecisionCloseoutVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(closeout)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    closeout: { verdict: string; exitCode: number };
  };
  clone.verdict = to;
  clone.exitCode = exit;
  clone.closeout.verdict = to;
  clone.closeout.exitCode = exit;
  return clone;
}

/** A tampered closeout (a hand-flipped closed→blocked ⇒ a `tampered` point). */
export function tamperedCloseout(): Record<string, unknown> {
  return tamperCloseoutVerdict(closedCloseout(), "closeout-blocked", 4);
}

/** An input that is NOT a recognized release decision closeout (⇒ an `unreadable` point). */
export function notACloseout(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout record" };
}

/* ------------------------------------------------------------------ *
 *  Index input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutIndexPolicy {
  return {
    maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
    maxOpen: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictOpen: false,
    ...over,
  };
}

/** Reduce a list of closeout objects (oldest → newest) to the ingested closeouts the fold consumes. */
export function ingestCloseoutsFrom(objs: readonly unknown[]): IngestedCloseout[] {
  return objs.map((obj) => ingestCloseout(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutIndexResult} from a list of closeout objects (oldest → newest). */
export function makeIndex(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutIndexResult {
  return buildCloseoutIndexResult(NOW, ingestCloseoutsFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied closeout object by its positional "path" (`closeout-<i>`) or a stdin payload. */
export function makeProvider(objs: readonly unknown[], stdin = ""): ReleaseDecisionCloseoutIndexProvider {
  const byPath = new Map<string, unknown>();
  objs.forEach((obj, i) => byPath.set(`closeout-${i}`, obj));
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

/** Build {@link ReleaseDecisionCloseoutIndexArgs} that reference each supplied closeout by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutIndexArgs> = {},
): ReleaseDecisionCloseoutIndexArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
    maxOpen: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictOpen: false,
    closeoutPaths: objs.map((_, i) => `closeout-${i}`),
    ...over,
  };
}
