/**
 * Test-support builders for the release decision closeout governance finalize index trend FINALIZATION record tests
 * (Phase 79).
 *
 * The record ingests a REQUIRED `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1`
 * primary receipt plus up to four OPTIONAL source-chain records, so these helpers build REAL, self-consistent documents at
 * every rung by driving the SHIPPED Phase 74→78 builders. The canonical coherent chain is built from a single underlying
 * history so that every cross-check passes:
 *
 *   finalization = `finalizedFinalize()`         (Phase 74, verdict `finalized`)
 *   index        = `indexedWindow()`             (Phase 75, verdict `indexed`, latest finalization `finalized`)
 *   trend        = `trendFor("stable")`          (Phase 76, verdict `stable`, newest window `indexed`)
 *   plan         = `clearPlan()`                 (Phase 77, verdict `clear`)
 *   receipt      = `makeReceipt(clearPlan(), …)` (Phase 78, verdict `completed` with `--ack-plan`)
 *
 * Building a REAL receipt drives the whole Phase 74→78 evidence chain, so the underlying builders are already memoized by
 * their own fixtures; each call here returns a fresh deep clone so a caller that mutates its copy never disturbs another's.
 * The chain is deterministic (fixed `NOW`s per phase), so the cross-checks are stable.
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is never
 * imported by any runtime module.
 */

import {
  finalizeFor,
  finalizedFinalize,
  tamperFinalizeVerdict,
  notAFinalize,
} from "../release-decision-closeout-governance-finalize-index/fixtures";
import {
  indexedWindow,
  windowFor,
  tamperFinalizeIndexVerdict,
  notAWindow,
} from "../release-decision-closeout-governance-finalize-index-trend/fixtures";
import {
  makePlan,
  tamperTrendVerdict,
  trendFor,
  notATrend,
} from "../release-decision-closeout-governance-finalize-index-trend-action-plan/fixtures";
import {
  blockPlan,
  clearPlan,
  investigatePlan,
  invalidPlan,
  makeReceipt,
  monitorPlan,
  policyWith,
  tamperPlanVerdict,
  notAPlan,
} from "../release-decision-closeout-governance-finalize-index-trend-action-receipt/fixtures";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult } from "../release-decision-closeout-governance-finalize-index-trend-action-receipt/types";
import { buildFinalizeIndexTrendFinalizeResult } from "./build";
import {
  ingestFinalizeIndexTrendFinalizeReceipt,
  ingestRelated,
  type IngestedFinalizeIndexTrendFinalizeReceipt,
  type IngestedFinalizeIndexTrendFinalizeRelated,
  type IngestedFinalizeIndexTrendFinalizeSources,
} from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs } from "./args";
import type { ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeProvider } from "./run";
import type {
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult,
} from "./types";

/** A fixed clock the finalization tests stamp with (deterministic). */
export const NOW = "2026-07-06T12:00:00.000Z";

/** Deep clone a value through JSON — the same round-trip the CLI does when it parses a record file. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ *
 *  Real primary-receipt (Phase 78) builders — each self-consistent
 * ------------------------------------------------------------------ */

/** A COMPLETED receipt: a clear plan reviewed (`--ack-plan`). The canonical coherent chain's receipt. */
export function completedReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(clearPlan(), policyWith({ plan: true }));
}

/** An INCOMPLETE receipt: a monitor plan reviewed but its monitor / executed acknowledgement absent (a coverage gap). */
export function incompleteReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(monitorPlan(), policyWith({ plan: true }));
}

/** A BLOCKED receipt: a block-release plan acknowledged as held (the release stays held → always blocked). */
export function blockedReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(blockPlan(), policyWith({ plan: true, block: true, executed: true }));
}

/** An INVALID receipt: a plan whose OWN verdict is `invalid` (its source trend was untrustworthy). */
export function invalidReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(invalidPlan(), policyWith({ plan: true }));
}

/** Build the receipt for a bounded verdict (a small dispatcher for table-driven tests). */
export function receiptFor(
  verdict: "completed" | "incomplete" | "blocked" | "invalid",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult {
  switch (verdict) {
    case "completed":
      return completedReceipt();
    case "incomplete":
      return incompleteReceipt();
    case "blocked":
      return blockedReceipt();
    case "invalid":
      return invalidReceipt();
  }
}

/* ------------------------------------------------------------------ *
 *  Coherent source-chain records for the COMPLETED (clear) receipt
 * ------------------------------------------------------------------ */

/** The Phase 77 plan the completed receipt receipted (a clear plan) — coherent for the `plan` cross-check. */
export function coherentPlan(): Record<string, unknown> {
  return clone(clearPlan()) as unknown as Record<string, unknown>;
}

/** The Phase 76 trend the plan folded (a stable trend) — coherent for the `trend` cross-check. */
export function coherentTrend(): Record<string, unknown> {
  return clone(trendFor("stable")) as unknown as Record<string, unknown>;
}

/** The Phase 75 index window (verdict `indexed`) matching the trend's newest window — coherent for the `index` cross-check. */
export function coherentIndex(): Record<string, unknown> {
  return clone(indexedWindow()) as unknown as Record<string, unknown>;
}

/** The Phase 74 finalization bundle (verdict `finalized`) matching the index's latest finalization — coherent for `finalization`. */
export function coherentFinalization(): Record<string, unknown> {
  return clone(finalizedFinalize()) as unknown as Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 *  Posture variants (usable + coherent cross-check, non-clean posture)
 * ------------------------------------------------------------------ */

/**
 * A coherent ADVISORY chain: a degrading trend → a monitor plan → a completed receipt. Supplying the trend / plan folds
 * an `advisory` posture (finalize-open) while its cross-check stays coherent.
 */
export function advisoryReceipt(): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult {
  return makeReceipt(makePlan(trendFor("degrading")), policyWith({ plan: true, monitor: true, executed: true }));
}
/** The degrading trend the advisory receipt folded (verdict `degrading`) — coherent + advisory. */
export function advisoryTrend(): Record<string, unknown> {
  return clone(trendFor("degrading")) as unknown as Record<string, unknown>;
}
/** The monitor plan the advisory receipt receipted (verdict `monitor`) — coherent + advisory. */
export function advisoryPlan(): Record<string, unknown> {
  return clone(makePlan(trendFor("degrading"))) as unknown as Record<string, unknown>;
}

/** An `index-open` window (Phase 75) — an advisory index posture (used with the advisory chain, whose latest is index-open). */
export function openIndex(): Record<string, unknown> {
  return clone(windowFor("index-open")) as unknown as Record<string, unknown>;
}
/** An `index-blocked` window (Phase 75) — a blocking index posture. */
export function blockedIndex(): Record<string, unknown> {
  return clone(windowFor("index-blocked")) as unknown as Record<string, unknown>;
}
/** A `finalize-open` bundle (Phase 74) — an advisory finalization posture. */
export function openFinalization(): Record<string, unknown> {
  return clone(finalizeFor("finalize-open")) as unknown as Record<string, unknown>;
}
/** A `finalize-blocked` bundle (Phase 74) — a blocking finalization posture. */
export function blockedFinalization(): Record<string, unknown> {
  return clone(finalizeFor("finalize-blocked")) as unknown as Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/**
 * Flip a receipt's recorded verdict (BOTH the top-level headline and the nested rollup) so it no longer re-derives from
 * the receipt's own recorded source facts (a re-derivation tamper ⇒ a `tampered` receipt ⇒ finalize-invalid).
 */
export function tamperReceiptVerdict(
  receipt: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptResult,
  to: "completed" | "incomplete" | "blocked" | "invalid",
): Record<string, unknown> {
  const c = clone(receipt) as unknown as Record<string, unknown> & {
    verdict: string;
    actionReceipt: { verdict: string };
  };
  c.verdict = to;
  c.actionReceipt.verdict = to;
  return c;
}

/** A tampered receipt (a hand-flipped recorded verdict ⇒ a `tampered` receipt ⇒ finalize-invalid). */
export function tamperedReceipt(): Record<string, unknown> {
  return tamperReceiptVerdict(completedReceipt(), "blocked");
}

/** An input that is NOT a recognized primary receipt (⇒ `unreadable` ⇒ finalize-invalid). */
export function notAReceipt(): Record<string, unknown> {
  return {
    schema: "pdfxyz.something-else/1",
    note: "not a release decision closeout governance finalize index trend action receipt",
  };
}

/** Re-export the per-source tamper + wrong-schema decoys for source-chain records. */
export {
  tamperPlanVerdict,
  tamperTrendVerdict,
  tamperFinalizeIndexVerdict,
  tamperFinalizeVerdict,
  notAPlan,
  notATrend,
  notAWindow,
  notAFinalize,
  investigatePlan,
};

/* ------------------------------------------------------------------ *
 *  Ingest + build seams (what build/reduce fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (no requires, no strict-open). */
export function defaultPolicy(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy {
  return {
    require: { plan: false, trend: false, index: false, finalization: false, ...(over.require ?? {}) },
    strictOpen: over.strictOpen ?? false,
  };
}

/** Ingest a primary receipt object through the trust boundary. */
export function ingestReceiptObj(obj: unknown): IngestedFinalizeIndexTrendFinalizeReceipt {
  return ingestFinalizeIndexTrendFinalizeReceipt(obj);
}

/** Ingest one source-chain record object of the given kind through the trust boundary. */
export function ingestRelatedObj(
  kind: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeRecordKind,
  obj: unknown,
): IngestedFinalizeIndexTrendFinalizeRelated {
  return ingestRelated(kind, obj);
}

/** The supplied source-chain record objects for a finalize run, by kind. */
export interface FinalizeInputs {
  readonly plan?: unknown;
  readonly trend?: unknown;
  readonly index?: unknown;
  readonly finalization?: unknown;
}

/** Assemble the ingested sources for the fold: the primary receipt + the supplied source-chain records. */
export function ingestSourcesFrom(receipt: unknown, inputs: FinalizeInputs = {}): IngestedFinalizeIndexTrendFinalizeSources {
  const related: IngestedFinalizeIndexTrendFinalizeRelated[] = [];
  for (const kind of ["plan", "trend", "index", "finalization"] as const) {
    const obj = inputs[kind];
    related.push(
      obj === undefined
        ? { kind, supplied: false, recognized: false, usable: false, verdict: null, facets: null }
        : ingestRelated(kind, obj),
    );
  }
  return { receipt: { supplied: true, ingested: ingestFinalizeIndexTrendFinalizeReceipt(receipt) }, related };
}

/** Build a real {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult} from a receipt object + inputs + policy. */
export function makeFinalize(
  receipt: unknown,
  inputs: FinalizeInputs = {},
  policy: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizePolicy = defaultPolicy(),
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeResult {
  return buildFinalizeIndexTrendFinalizeResult(NOW, ingestSourcesFrom(receipt, inputs), policy);
}

/**
 * A provider that serves the supplied receipt + record objects by their canonical "paths" (`receipt-0`, `plan-0`,
 * `trend-0`, `index-0`, `finalization-0`) or a stdin payload.
 */
export function makeProvider(
  receipt: unknown,
  inputs: FinalizeInputs = {},
  stdin = "",
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeProvider {
  const byPath = new Map<string, unknown>();
  byPath.set("receipt-0", receipt);
  if (inputs.plan !== undefined) byPath.set("plan-0", inputs.plan);
  if (inputs.trend !== undefined) byPath.set("trend-0", inputs.trend);
  if (inputs.index !== undefined) byPath.set("index-0", inputs.index);
  if (inputs.finalization !== undefined) byPath.set("finalization-0", inputs.finalization);
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

/** Build {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs} that reference the supplied inputs by their "paths". */
export function makeArgs(
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    requirePlan: false,
    requireTrend: false,
    requireIndex: false,
    requireFinalization: false,
    strictOpen: false,
    receiptPath: "receipt-0",
    ...over,
  };
}
