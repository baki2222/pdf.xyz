/**
 * Pure, node-free **window ingest** for the release decision closeout index trend (Phase 66) — the trust boundary and
 * the no-leak core.
 *
 * The trend summarizes a bounded history of `pdfxyz.release-decision-closeout-index/1` windows. Even though each window
 * is already content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, a committed
 * window, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded ingested shape, in
 * the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a window. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, the window's OWN
 *    stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary — TWICE.** A closeout-index window records both a `ledger` (its bounded counts) and a
 *    per-record `points` sequence, and its load-bearing output is its `closeoutIndex` verdict. So the deepest
 *    self-consistency check available is two reuses of the Phase 65 reducers:
 *      (B) RE-RUN {@link computeCloseoutIndexRollup} over the window's OWN recorded ledger + latest + recorded policy,
 *          and require the recorded `closeoutIndex` rollup (verdict, exit code, indexed flag, latest, reason set, the
 *          four severity counts, strict-open escalation) to re-derive — so a hand-flipped index verdict is caught;
 *      (A) RE-RUN {@link reduceIndex} over the window's OWN `points` sequence (reconstructed as ingested closeouts) and
 *          require the recorded ledger's post-cap counts (usable / unreadable / tampered, the closeout distribution,
 *          newest / oldest, class) + the window arithmetic to re-derive — so a lied ledger count (even one consistent
 *          with a flipped verdict) is caught against the sequence it claims to summarize.
 *    A window is `usable` only if BOTH re-derive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` window); a
 *    recognized-but-inconsistent window is `recognized = true, usable = false` (⇒ a `tampered` window); a coherent
 *    window yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a closeout index reduced its own closeout RECORDS away into counts + a per-record posture sequence,
 * so the DEEPEST faithful check over a closeout-index window is re-deriving its index verdict from its own ledger AND
 * re-checking that ledger against its own sequence — it is the atom of evidence here, exactly as the closeout was at
 * Phase 64 and the decision index at Phase 60. A fully self-consistent FABRICATED window (real-looking counts + verdict
 * + sequence) is out of scope for structural tamper-evidence, exactly as at Phases 52–65; that would need a signature
 * this offline summarizer does not have.
 *
 * SAFETY of the stripped reconstruction: {@link computeCloseoutIndexRollup} reads ONLY the ledger's `closeoutsUsable` /
 * `closeoutsUnreadable` / `closeoutsTampered` counts + the `verdictCounts` + the passed `latest` + the policy thresholds;
 * {@link reduceIndex} (via `reduceRecord`) reads ONLY each ingested closeout's `recognized` / `usable` / `verdict` +
 * `facts.receiptVerdict` / `facts.planClass`. So filling the reconstructed closeouts' other fields with derived defaults
 * cannot change either recompute — the load-bearing fields are read faithfully from the window's own ledger + sequence.
 * (Verified against `release-decision-closeout-index/reduce.ts` — re-verify those field reads before trusting this
 * reconstruction.)
 */

import { reduceIndex, computeCloseoutIndexRollup } from "../release-decision-closeout-index/reduce";
import type { IngestedCloseout } from "../release-decision-closeout-index/ingest";
import {
  RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_ACTION_RECEIPT_VERDICTS,
} from "../release-decision-action-receipt/types";
import {
  CLOSEOUT_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_INDEX_RECORD_STATES,
  RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_INDEX_SEVERITIES,
  RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_VERDICTS,
  type CloseoutRecordFacts,
  type ReleaseDecisionActionReceiptPlanClass,
  type ReleaseDecisionActionReceiptVerdict,
  type ReleaseDecisionCloseoutIndexLedger,
  type ReleaseDecisionCloseoutIndexReasonId,
  type ReleaseDecisionCloseoutIndexRecordState,
  type ReleaseDecisionCloseoutIndexRollup,
  type ReleaseDecisionCloseoutIndexSeverity,
  type ReleaseDecisionCloseoutIndexVerdict,
  type ReleaseDecisionCloseoutVerdict,
} from "../release-decision-closeout-index/types";
import type { CloseoutIndexFacts } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A strict non-negative safe integer, or `undefined`. */
function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Strictly `true` or `false`, or `undefined`. */
function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** `null`, or one of `allowed`; anything else (a stray non-null off-enum value) is a corrupt field (`undefined`). */
function nullableOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined {
  if (value === null) return null;
  return oneOf(value, allowed);
}

/** Read a full `Record<K, number>` from `obj` over exactly `keys` (every key a non-negative int), or `undefined`. */
function readCounts<K extends string>(obj: unknown, keys: readonly K[]): Record<K, number> | undefined {
  if (!isObject(obj)) return undefined;
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const n = intOf(obj[key]);
    if (n === undefined) return undefined;
    out[key] = n;
  }
  return out;
}

/**
 * Compare two `ReleaseDecisionCloseoutIndexReasonId` lists as sets (order-independent, exact membership). Size-aware in
 * BOTH directions so a crafted duplicate-plus-omission recorded list (same length, same members-as-subset, but a
 * different SET) cannot pass — the recompute is only trusted when the two lists are the identical set.
 */
function sameReasons(
  a: readonly ReleaseDecisionCloseoutIndexReasonId[],
  b: readonly ReleaseDecisionCloseoutIndexReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout-index/1` document. */
export interface IngestedCloseoutIndex {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-closeout-index/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded index verdict + counts RE-DERIVE from its own ledger + sequence. */
  readonly usable: boolean;
  /** The window's recorded index verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutIndexVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: CloseoutIndexFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-closeout-index/1`. */
export const UNRECOGNIZED_INDEX: IngestedCloseoutIndex = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) window, carrying only its untrusted claimed verdict. */
function inconsistentIndex(verdict: ReleaseDecisionCloseoutIndexVerdict | null): IngestedCloseoutIndex {
  return { recognized: true, usable: false, verdict, facts: null };
}

/* ------------------------------------------------------------------ *
 *  Recorded blocks (validated into bounded shapes; nothing echoed)
 * ------------------------------------------------------------------ */

/** The recorded index-rollup fields the recompute must reproduce for the window to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionCloseoutIndexVerdict;
  readonly exitCode: number;
  readonly indexed: boolean;
  readonly latest: ReleaseDecisionCloseoutVerdict | null;
  readonly reasons: readonly ReleaseDecisionCloseoutIndexReasonId[];
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: "index-open" | null;
}

const ROLLUP_STRICT_FROM = ["index-open"] as const;

/** Validate the window's `closeoutIndex` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const indexed = boolOf(rollup.indexed);
  const latest = nullableOneOf(rollup.latest, RELEASE_DECISION_CLOSEOUT_VERDICTS);
  const blocking = intOf(rollup.blocking);
  const open = intOf(rollup.open);
  const incomplete = intOf(rollup.incomplete);
  const informational = intOf(rollup.informational);
  const strictOpen = boolOf(rollup.strictOpen);
  const strictOpenEscalated = boolOf(rollup.strictOpenEscalated);
  const strictOpenEscalatedFrom = nullableOneOf(rollup.strictOpenEscalatedFrom, ROLLUP_STRICT_FROM);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    indexed === undefined ||
    latest === undefined ||
    blocking === undefined ||
    open === undefined ||
    incomplete === undefined ||
    informational === undefined ||
    strictOpen === undefined ||
    strictOpenEscalated === undefined ||
    strictOpenEscalatedFrom === undefined ||
    !Array.isArray(rollup.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseDecisionCloseoutIndexReasonId[] = [];
  for (const r of rollup.reasons) {
    const id = oneOf(r, RELEASE_DECISION_CLOSEOUT_INDEX_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    indexed,
    latest,
    reasons,
    blocking,
    open,
    incomplete,
    informational,
    strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom,
  };
}

/** Validate the window's recorded `ledger` block into a bounded {@link ReleaseDecisionCloseoutIndexLedger}, or `undefined`. */
function readLedger(root: Obj): ReleaseDecisionCloseoutIndexLedger | undefined {
  const l = isObject(root.ledger) ? root.ledger : undefined;
  if (l === undefined) return undefined;

  const closeoutsSupplied = intOf(l.closeoutsSupplied);
  const closeoutsConsidered = intOf(l.closeoutsConsidered);
  const truncated = boolOf(l.truncated);
  const droppedOldest = intOf(l.droppedOldest);
  const closeoutsUsable = intOf(l.closeoutsUsable);
  const closeoutsUnreadable = intOf(l.closeoutsUnreadable);
  const closeoutsTampered = intOf(l.closeoutsTampered);
  const verdictCounts = readCounts(l.verdictCounts, RELEASE_DECISION_CLOSEOUT_VERDICTS);
  const newest = nullableOneOf(l.newest, RELEASE_DECISION_CLOSEOUT_VERDICTS);
  const oldest = nullableOneOf(l.oldest, RELEASE_DECISION_CLOSEOUT_VERDICTS);
  const trendClass = oneOf(l.trendClass, RELEASE_DECISION_CLOSEOUT_INDEX_TREND_CLASSES);
  if (
    closeoutsSupplied === undefined ||
    closeoutsConsidered === undefined ||
    truncated === undefined ||
    droppedOldest === undefined ||
    closeoutsUsable === undefined ||
    closeoutsUnreadable === undefined ||
    closeoutsTampered === undefined ||
    verdictCounts === undefined ||
    newest === undefined ||
    oldest === undefined ||
    trendClass === undefined
  ) {
    return undefined;
  }
  return {
    closeoutsSupplied,
    closeoutsConsidered,
    truncated,
    droppedOldest,
    closeoutsUsable,
    closeoutsUnreadable,
    closeoutsTampered,
    verdictCounts,
    newest,
    oldest,
    trendClass,
  };
}

/** One validated point from the window's own `points` sequence — enough to reconstruct its ingested closeout. */
interface ValidatedPoint {
  readonly state: ReleaseDecisionCloseoutIndexRecordState;
  readonly verdict: ReleaseDecisionCloseoutVerdict | null;
  readonly receiptVerdict: ReleaseDecisionActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionActionReceiptPlanClass | null;
  readonly severity: ReleaseDecisionCloseoutIndexSeverity | null;
}

/**
 * Validate the window's `points` array into a bounded sequence, or `undefined`. A usable point must carry a non-null
 * closeout verdict whose severity matches `CLOSEOUT_VERDICT_SEVERITY` (a real Phase 65 usable point always does); an
 * off-shape / self-inconsistent point makes the whole window a tamper.
 */
function readPoints(root: Obj): ValidatedPoint[] | undefined {
  if (!Array.isArray(root.points)) return undefined;
  const out: ValidatedPoint[] = [];
  for (const raw of root.points) {
    if (!isObject(raw)) return undefined;
    const position = intOf(raw.position);
    const state = oneOf(raw.state, RELEASE_DECISION_CLOSEOUT_INDEX_RECORD_STATES);
    const verdict = nullableOneOf(raw.verdict, RELEASE_DECISION_CLOSEOUT_VERDICTS);
    const receiptVerdict = nullableOneOf(raw.receiptVerdict, RELEASE_DECISION_ACTION_RECEIPT_VERDICTS);
    const planClass = nullableOneOf(raw.planClass, RELEASE_DECISION_ACTION_RECEIPT_PLAN_CLASSES);
    const severity = nullableOneOf(raw.severity, RELEASE_DECISION_CLOSEOUT_INDEX_SEVERITIES);
    if (
      position === undefined ||
      state === undefined ||
      verdict === undefined ||
      receiptVerdict === undefined ||
      planClass === undefined ||
      severity === undefined
    ) {
      return undefined;
    }
    if (state === "usable") {
      // A usable point must carry a trusted closeout verdict and a severity that re-derives from that verdict.
      if (verdict === null || severity !== CLOSEOUT_VERDICT_SEVERITY[verdict]) return undefined;
    }
    out.push({ state, verdict, receiptVerdict, planClass, severity });
  }
  return out;
}

/** Reconstruct the ingested closeout a point represents (only `recognized` / `usable` / `verdict` / `facts` matter). */
function reconstructCloseout(point: ValidatedPoint): IngestedCloseout {
  if (point.state === "usable" && point.verdict !== null) {
    const facts: CloseoutRecordFacts = {
      verdict: point.verdict,
      exitCode: 0,
      closed: point.verdict === "closed",
      receiptState: "usable",
      receiptVerdict: point.receiptVerdict,
      planClass: point.planClass,
      blocking: 0,
      open: 0,
      incomplete: 0,
      relatedContradictory: 0,
      relatedBlocking: 0,
      requiredMissing: 0,
      strictOpen: false,
      strictOpenEscalated: false,
    };
    return { recognized: true, usable: true, verdict: point.verdict, facts };
  }
  if (point.state === "tampered") {
    return { recognized: true, usable: false, verdict: point.verdict, facts: null };
  }
  return { recognized: false, usable: false, verdict: null, facts: null };
}

/** The recorded index-rollup fields the recompute must reproduce (skips authored `detail`). */
function sameRollup(a: ReleaseDecisionCloseoutIndexRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.indexed === b.indexed &&
    a.latest === b.latest &&
    a.blocking === b.blocking &&
    a.open === b.open &&
    a.incomplete === b.incomplete &&
    a.informational === b.informational &&
    a.strictOpen === b.strictOpen &&
    a.strictOpenEscalated === b.strictOpenEscalated &&
    a.strictOpenEscalatedFrom === b.strictOpenEscalatedFrom &&
    sameReasons(a.reasons, b.reasons)
  );
}

/** Whether the recorded ledger's post-cap counts + newest / oldest / class re-derive from the window's own sequence. */
function ledgerMatchesSequence(
  ledger: ReleaseDecisionCloseoutIndexLedger,
  points: readonly ValidatedPoint[],
): boolean {
  // Re-run the Phase 65 reducer over the reconstructed sequence with a cap of `points.length` (no further drop), so the
  // re-derived ledger's post-cap fields reflect exactly the sequence the window claims to summarize.
  const reReduced = reduceIndex(points.map(reconstructCloseout), points.length).ledger;

  const sameVerdictCounts = RELEASE_DECISION_CLOSEOUT_VERDICTS.every(
    (v) => reReduced.verdictCounts[v] === ledger.verdictCounts[v],
  );
  return (
    reReduced.closeoutsUsable === ledger.closeoutsUsable &&
    reReduced.closeoutsUnreadable === ledger.closeoutsUnreadable &&
    reReduced.closeoutsTampered === ledger.closeoutsTampered &&
    reReduced.newest === ledger.newest &&
    reReduced.oldest === ledger.oldest &&
    reReduced.trendClass === ledger.trendClass &&
    sameVerdictCounts
  );
}

/** Whether the recorded ledger's window arithmetic is internally consistent with its own sequence + the window cap. */
function windowArithmeticOk(
  ledger: ReleaseDecisionCloseoutIndexLedger,
  pointCount: number,
  maxCloseouts: number,
): boolean {
  return (
    ledger.closeoutsConsidered === pointCount &&
    ledger.closeoutsSupplied >= ledger.closeoutsConsidered &&
    ledger.droppedOldest === ledger.closeoutsSupplied - ledger.closeoutsConsidered &&
    ledger.truncated === ledger.droppedOldest > 0 &&
    ledger.closeoutsConsidered <= maxCloseouts
  );
}

/** The bounded `policy` block the window recorded (its own window cap + thresholds + strict-open flag). */
interface RecordedPolicy {
  readonly maxCloseouts: number;
  readonly maxOpen: number;
  readonly maxIncomplete: number;
  readonly maxBlocked: number;
  readonly strictOpen: boolean;
}

/** Validate the window's `policy` block into a bounded {@link RecordedPolicy}, or `undefined`. */
function readPolicy(root: Obj): RecordedPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const maxCloseouts = intOf(p.maxCloseouts);
  const maxOpen = intOf(p.maxOpen);
  const maxIncomplete = intOf(p.maxIncomplete);
  const maxBlocked = intOf(p.maxBlocked);
  const strictOpen = boolOf(p.strictOpen);
  if (
    maxCloseouts === undefined ||
    maxCloseouts < 1 ||
    maxOpen === undefined ||
    maxIncomplete === undefined ||
    maxBlocked === undefined ||
    strictOpen === undefined
  ) {
    return undefined;
  }
  return { maxCloseouts, maxOpen, maxIncomplete, maxBlocked, strictOpen };
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-index/1` `root` to the bounded {@link IngestedCloseoutIndex}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_INDEX}. For a recognized window it validates the recorded
 * closeoutIndex rollup + ledger + policy + points, then requires BOTH: (B) the recorded rollup RE-DERIVES from the
 * recorded ledger + latest + policy via {@link computeCloseoutIndexRollup}, and (A) the recorded ledger's post-cap
 * counts RE-DERIVE from the window's own points sequence (via {@link reduceIndex}) with consistent window arithmetic.
 * Any mismatch ⇒ a tamper. Never throws and never echoes the input.
 */
export function ingestCloseoutIndex(root: unknown): IngestedCloseoutIndex {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_INDEX_SCHEMA) return UNRECOGNIZED_INDEX;

  const rollupObj = isObject(root.closeoutIndex) ? root.closeoutIndex : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS) ?? null)
    : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // index verdict surfaced (untrusted) so the trend can show what the window asserted.
  if (rollupObj === undefined) return inconsistentIndex(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentIndex(claimed);

  const ledger = readLedger(root);
  if (ledger === undefined) return inconsistentIndex(recorded.verdict);

  const points = readPoints(root);
  if (points === undefined) return inconsistentIndex(recorded.verdict);

  // The window's `policy.strictOpen` must agree with the rollup's recorded `strictOpen` (a smuggled inconsistent policy
  // is a tamper). A real Phase 65 window always carries both, equal; the thresholds bound its own escalation.
  const policy = readPolicy(root);
  if (policy === undefined || policy.strictOpen !== recorded.strictOpen) {
    return inconsistentIndex(recorded.verdict);
  }

  // (B) Re-derive the index verdict from the window's OWN recorded ledger + latest (= ledger.newest) + policy, exactly
  // as the Phase 65 CLI did, and require the recorded rollup to match in every load-bearing field.
  const { rollup: rederived } = computeCloseoutIndexRollup(ledger, ledger.newest, {
    maxCloseouts: policy.maxCloseouts,
    maxOpen: policy.maxOpen,
    maxIncomplete: policy.maxIncomplete,
    maxBlocked: policy.maxBlocked,
    strictOpen: policy.strictOpen,
  });
  if (!sameRollup(rederived, recorded)) return inconsistentIndex(recorded.verdict);

  // (A) Re-check the recorded ledger's post-cap counts + arithmetic against the window's OWN per-record sequence, so a
  // lied count consistent with the verdict is still caught.
  if (
    !windowArithmeticOk(ledger, points.length, policy.maxCloseouts) ||
    !ledgerMatchesSequence(ledger, points)
  ) {
    return inconsistentIndex(recorded.verdict);
  }

  const facts: CloseoutIndexFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    indexed: recorded.indexed,
    closeoutsConsidered: ledger.closeoutsConsidered,
    closeoutsUsable: ledger.closeoutsUsable,
    closeoutVerdictCounts: ledger.verdictCounts,
    latestCloseout: ledger.newest,
    strictOpen: recorded.strictOpen,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
