/**
 * Test-support builders for the release decision ledger index tests (Phase 60).
 *
 * The index ingests `pdfxyz.release-decision/1` records, so these helpers build REAL, self-consistent decision
 * records of each decision — by composing the shipped Phase 59 decision over genuinely coherent publish packs /
 * acknowledgements (reusing the release-decision fixtures, which themselves reuse the Phase 57 / 58 builders). A
 * proceed / proceed-with-followup / hold / insufficient / reject / invalid record re-derives its own decision, so
 * the index's trust boundary marks it `usable`; {@link tamperDecision} flips a recorded decision so it no longer
 * re-derives (a recognized-but-inconsistent record the index catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and is
 * never imported by any runtime module.
 */

import {
  ackFor,
  blockedPack,
  incompletePack,
  publishablePack,
  reviewPack,
  type AckInputs,
} from "../release-decision/fixtures";
import { makeDecision } from "../release-decision/fixtures";
import type { ReleaseDecisionDecision, ReleaseDecisionResult } from "../release-decision/types";
import { ingestDecision, type IngestedDecision } from "./ingest";
import type { ReleaseDecisionIndexArgs } from "./args";
import { buildIndexResult } from "./build";
import type { ReleaseDecisionIndexProvider } from "./run";
import {
  DEFAULT_MAX_RECORDS,
  type ReleaseDecisionIndexPolicy,
  type ReleaseDecisionIndexResult,
} from "./types";

/** A fixed clock the index tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/* ------------------------------------------------------------------ *
 *  Real decision-record builders (each self-consistent → usable by the index)
 * ------------------------------------------------------------------ */

/** Build a coherent decision over a pack + a matching acknowledgement of it (cross-check always matches). */
function decisionOver(pack: unknown, inputs: AckInputs): ReleaseDecisionResult {
  return makeDecision(pack, ackFor(pack, inputs));
}

/** A PROCEED record: a publishable pack + a clean `accepted` acknowledgement (no follow-up). */
export function proceedDecision(): ReleaseDecisionResult {
  return decisionOver(publishablePack(), { decision: "accepted" });
}

/** A PROCEED-WITH-FOLLOWUP record: a publishable pack + an `accepted-with-notes` acknowledgement. */
export function followupDecision(): ReleaseDecisionResult {
  return decisionOver(publishablePack(), { decision: "accepted-with-notes" });
}

/** A HOLD record: a `review` pack accepted (its own verdict is internal-review → hold). */
export function holdDecision(): ReleaseDecisionResult {
  return decisionOver(reviewPack(), { decision: "accepted" });
}

/** An INSUFFICIENT record: a deferred acknowledgement over a publishable pack (evidence inconclusive). */
export function insufficientDecision(): ReleaseDecisionResult {
  return decisionOver(publishablePack(), { decision: "deferred" });
}

/** An INSUFFICIENT record via an incomplete pack accepted (the pack's own verdict is incomplete). */
export function incompleteDecision(): ReleaseDecisionResult {
  return decisionOver(incompletePack(), { decision: "accepted" });
}

/** A REJECT record: a `rejected` acknowledgement over a publishable pack (a blocking outcome). */
export function rejectDecision(): ReleaseDecisionResult {
  return decisionOver(publishablePack(), { decision: "rejected" });
}

/** A REJECT record via a blocked pack accepted (the pack's own verdict is blocked / do-not-share). */
export function blockedDecision(): ReleaseDecisionResult {
  return decisionOver(blockedPack(), { decision: "accepted" });
}

/**
 * An INVALID record (self-consistent, usable): the acknowledgement acknowledged a DIFFERENT pack than the one
 * supplied → a cross-check MISMATCH → the record's own decision is `invalid`. The record itself re-derives (it is a
 * valid decision document that concluded `invalid`), so the index marks it `usable` and counts a blocking `invalid`.
 */
export function invalidDecision(): ReleaseDecisionResult {
  // The ack acknowledged the REVIEW pack; the decision is composed with the PUBLISHABLE pack → mismatch → invalid.
  return makeDecision(publishablePack(), ackFor(reviewPack(), { decision: "accepted" }));
}

/** Build a real record for the given decision (a small dispatcher for table-driven tests). */
export function decisionFor(decision: ReleaseDecisionDecision): ReleaseDecisionResult {
  switch (decision) {
    case "proceed":
      return proceedDecision();
    case "proceed-with-followup":
      return followupDecision();
    case "hold":
      return holdDecision();
    case "insufficient":
      return insufficientDecision();
    case "reject":
      return rejectDecision();
    case "invalid":
      return invalidDecision();
  }
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/** Flip a record's recorded decision so it no longer re-derives from its own summaries (a tamper). */
export function tamperDecision(
  record: ReleaseDecisionResult,
  to: ReleaseDecisionDecision,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(record)) as Record<string, unknown> & {
    decision: { decision: string };
  };
  clone.decision.decision = to;
  return clone;
}

/** A tampered record (a hand-flipped recorded decision ⇒ a `tampered` point). */
export function tamperedDecision(): Record<string, unknown> {
  return tamperDecision(proceedDecision(), "reject");
}

/** An input that is NOT a recognized release decision record (⇒ an `unreadable` point). */
export function notADecision(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release decision record" };
}

/* ------------------------------------------------------------------ *
 *  Index input assembly (what build/reduce/rollup fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The default policy (conservative window, no strict). */
export function defaultPolicy(over: Partial<ReleaseDecisionIndexPolicy> = {}): ReleaseDecisionIndexPolicy {
  return { maxRecords: DEFAULT_MAX_RECORDS, strict: false, ...over };
}

/** Reduce a list of record objects (oldest → newest) to the ingested records the fold consumes. */
export function ingestRecordsFrom(objs: readonly unknown[]): IngestedDecision[] {
  return objs.map((obj) => ingestDecision(obj));
}

/** Build a real {@link ReleaseDecisionIndexResult} from a list of record objects (oldest → newest). */
export function makeIndex(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionIndexPolicy> = {},
): ReleaseDecisionIndexResult {
  return buildIndexResult(NOW, ingestRecordsFrom(objs), defaultPolicy(policy));
}

/** A provider that serves each supplied record object by its positional "path" (`record-<i>`) or a stdin payload. */
export function makeProvider(objs: readonly unknown[], stdin = ""): ReleaseDecisionIndexProvider {
  const byPath = new Map<string, unknown>();
  objs.forEach((obj, i) => byPath.set(`record-${i}`, obj));
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

/** Build {@link ReleaseDecisionIndexArgs} that reference each supplied record by its positional "path". */
export function makeArgs(
  objs: readonly unknown[],
  over: Partial<ReleaseDecisionIndexArgs> = {},
): ReleaseDecisionIndexArgs {
  return {
    format: "json",
    pretty: true,
    stdin: false,
    maxRecords: DEFAULT_MAX_RECORDS,
    strict: false,
    recordPaths: objs.map((_, i) => `record-${i}`),
    ...over,
  };
}
