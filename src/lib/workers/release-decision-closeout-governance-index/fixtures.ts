/**
 * Test-support builders for the release decision closeout governance index tests (Phase 70).
 *
 * The index ingests `pdfxyz.release-decision-closeout-governance/1` records, so these helpers build REAL,
 * self-consistent governance bundles of each governance verdict — by driving the shipped Phase 69 governance builder
 * ({@link makeGovernance}) over real Phase 68 primary receipts (and, where a cross-check / posture is exercised, real
 * Phase 65–67 related records, all via the governance fixtures, which themselves reuse each phase's builders). A
 * closed / incomplete / open / blocked bundle re-derives its own governance rollup, so the index's trust boundary marks
 * it `usable`; {@link tamperGovernanceVerdict} flips a recorded verdict so it no longer re-derives (a
 * recognized-but-inconsistent record the index catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  blockedIndex,
  blockedReceipt,
  coherentCloseout,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  followupOpenReceipt,
  incompleteReceipt,
  makeGovernance,
  openIndex,
  type GovernanceObjects,
} from "../release-decision-closeout-governance/fixtures";
import type {
  ReleaseDecisionCloseoutGovernancePolicy,
  ReleaseDecisionCloseoutGovernanceResult,
} from "../release-decision-closeout-governance/types";
import { ingestGovernance, type IngestedGovernance } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceIndexArgs } from "./args";
import { buildGovernanceIndexResult } from "./build";
import type { ReleaseDecisionCloseoutGovernanceIndexProvider } from "./run";
import {
  DEFAULT_MAX_GOVERNANCE,
  type ReleaseDecisionCloseoutGovernanceIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceIndexResult,
  type ReleaseDecisionCloseoutGovernanceVerdict,
} from "./types";

/** A fixed clock the index tests stamp with (deterministic). */
export const NOW = "2026-07-05T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real governance-bundle builders (each self-consistent → usable by the index)
 * ------------------------------------------------------------------ */

/** A CLOSED governance bundle: a completed primary receipt, no related records. */
export function closedGovernance(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: completedReceipt() });
}

/** A CLOSED bundle cross-checked against a coherent plan + trend (exercises coherent cross-check signals). */
export function closedWithCoherent(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: completedReceipt(), plan: coherentPlan(), trend: coherentTrend() });
}

/** A CLOSED bundle with a coherent index + closeout source chain (exercises source-chain-coherent signals). */
export function closedWithSourceChain(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: completedReceipt(), index: coherentIndex(), closeout: coherentCloseout() });
}

/** A GOVERNANCE-INCOMPLETE bundle: a clear plan NOT acknowledged as reviewed (an incomplete primary receipt). */
export function incompleteGovernance(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: incompleteReceipt() });
}

/** A GOVERNANCE-OPEN bundle: a monitor plan reviewed but its follow-up not acknowledged (a followup-open receipt). */
export function openGovernance(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: followupOpenReceipt() });
}

/** A GOVERNANCE-BLOCKED bundle: a block plan not acknowledged as held-blocked (a blocked primary receipt). */
export function blockedGovernance(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: blockedReceipt() });
}

/** A GOVERNANCE-BLOCKED bundle via a cross-check contradiction (a plan that disagrees with the receipt). */
export function contradictoryGovernance(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: completedReceipt(), plan: contradictoryPlan() });
}

/** A GOVERNANCE-BLOCKED bundle via a blocked source chain (a blocked closeout index upstream). */
export function sourceBlockedGovernance(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: completedReceipt(), index: blockedIndex() });
}

/** A GOVERNANCE-OPEN bundle via an advisory source chain (an open closeout index upstream). */
export function sourceAdvisoryGovernance(): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance({ receipt: completedReceipt(), index: openIndex() });
}

/** Build a real governance bundle for the given governance verdict (a small dispatcher for table-driven tests). */
export function governanceFor(
  verdict: ReleaseDecisionCloseoutGovernanceVerdict,
): ReleaseDecisionCloseoutGovernanceResult {
  switch (verdict) {
    case "closed":
      return closedGovernance();
    case "governance-incomplete":
      return incompleteGovernance();
    case "governance-open":
      return openGovernance();
    case "governance-blocked":
      return blockedGovernance();
  }
}

/** Build a governance bundle with arbitrary related inputs / policy (for cross-check + require tests). */
export function governanceWith(
  objs: GovernanceObjects,
  policy: Partial<ReleaseDecisionCloseoutGovernancePolicy> = {},
): ReleaseDecisionCloseoutGovernanceResult {
  return makeGovernance(objs, policy);
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a governance bundle's recorded verdict (the top-level headline + the nested `governance` rollup + the mirrored
 * exit codes) so it no longer re-derives from the bundle's own recorded primary-receipt source + related-record signals
 * (a re-derivation tamper).
 */
export function tamperGovernanceVerdict(
  governance: ReleaseDecisionCloseoutGovernanceResult,
  to: ReleaseDecisionCloseoutGovernanceVerdict,
  exit: number,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(governance)) as Record<string, unknown> & {
    verdict: string;
    exitCode: number;
    governance: { verdict: string; exitCode: number };
  };
  clone.verdict = to;
  clone.exitCode = exit;
  clone.governance.verdict = to;
  clone.governance.exitCode = exit;
  return clone;
}

/** A tampered governance bundle (a hand-flipped closed→blocked ⇒ a `tampered` point). */
export function tamperedGovernance(): Record<string, unknown> {
  return tamperGovernanceVerdict(closedGovernance(), "governance-blocked", 4);
}

/** An input that is NOT a recognized release decision closeout governance bundle (⇒ an `unreadable` point). */
export function notAGovernance(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision closeout governance record" };
}

/* ------------------------------------------------------------------ *
 *  Index input assembly (what build/reduce/fold fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, strict-zero thresholds, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceIndexPolicy {
  return {
    maxGovernance: DEFAULT_MAX_GOVERNANCE,
    maxOpen: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictOpen: false,
    ...over,
  };
}

/** Reduce a list of governance objects (oldest → newest) to the ingested bundles the fold consumes. */
export function ingestGovernanceFrom(objs: readonly unknown[]): IngestedGovernance[] {
  return objs.map((obj) => ingestGovernance(obj));
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceIndexResult} from a list of governance objects (oldest → newest). */
export function makeIndex(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceIndexResult {
  return buildGovernanceIndexResult(NOW, ingestGovernanceFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied bundle object by its positional "path" (`governance-<i>`) or a stdin payload. */
export function makeProvider(
  objs: readonly unknown[],
  stdin = "",
): ReleaseDecisionCloseoutGovernanceIndexProvider {
  const byPath = new Map<string, unknown>();
  objs.forEach((obj, i) => byPath.set(`governance-${i}`, obj));
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

/** Build {@link ReleaseDecisionCloseoutGovernanceIndexArgs} that reference each supplied bundle by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionCloseoutGovernanceIndexArgs> = {},
): ReleaseDecisionCloseoutGovernanceIndexArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxGovernance: DEFAULT_MAX_GOVERNANCE,
    maxOpen: 0,
    maxIncomplete: 0,
    maxBlocked: 0,
    strictOpen: false,
    governancePaths: objs.map((_, i) => `governance-${i}`),
    ...over,
  };
}
