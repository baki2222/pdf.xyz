/**
 * Pure, node-free **window ingest** for the release decision index trend summary (Phase 61) — the trust boundary and
 * the no-leak core.
 *
 * The trend summarizes a bounded history of `pdfxyz.release-decision-index/1` ledger windows. Even though each window
 * is already content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, a committed
 * window, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded ingested shape, in
 * the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a window. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, the window's OWN
 *    stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary — TWICE.** A decision-index window records both a `ledger` (its bounded counts) and a
 *    per-record `points` sequence, and its load-bearing output is its `index` verdict. So the deepest self-consistency
 *    check available is two reuses of the Phase 60 reducers:
 *      (B) RE-RUN {@link computeIndexRollup} over the window's OWN recorded ledger + recorded policy, and require the
 *          recorded `index` rollup (verdict, exit code, reason set, the four severity counts, strict-escalation
 *          position) to re-derive — so a hand-flipped index verdict is caught;
 *      (A) RE-RUN {@link reduceIndex} over the window's OWN `points` sequence (reconstructed as ingested records) and
 *          require the recorded ledger's post-cap counts (usable / unreadable / tampered, the decision + cross-check
 *          distributions, newest / oldest, class) + the window arithmetic to re-derive — so a lied ledger count (even
 *          one consistent with a flipped verdict) is caught against the sequence it claims to summarize.
 *    A window is `usable` only if BOTH re-derive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` window); a
 *    recognized-but-inconsistent window is `recognized = true, usable = false` (⇒ a `tampered` window); a coherent
 *    window yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a decision index reduced its own decision RECORDS away into counts + a per-record posture sequence,
 * so the DEEPEST faithful check over a decision-index window is re-deriving its index verdict from its own ledger AND
 * re-checking that ledger against its own sequence — it is the atom of evidence here, as the report was at Phase 53 and
 * the decision was at Phase 60. A fully self-consistent FABRICATED window (real-looking counts + verdict + sequence)
 * is out of scope for structural tamper-evidence, exactly as at Phase 52–54; that would need a signature this offline
 * summarizer does not have.
 *
 * SAFETY of the stripped reconstruction: {@link computeIndexRollup} reads ONLY the ledger's `recordsUnreadable` /
 * `recordsTampered` / `recordsUsable` counts + the `decisionCounts` (reject / invalid / insufficient / hold /
 * proceed-with-followup) + `policy.strict`; {@link reduceIndex} (via `reduceRecord`) reads ONLY each ingested record's
 * `recognized` / `usable` / `decision` + `facts.crossCheck`. So filling the reconstructed records' other fields with
 * derived defaults cannot change either recompute — the load-bearing fields are read faithfully from the window's own
 * ledger + sequence. (Verified against `release-decision-index/rollup.ts` + `release-decision-index/reduce.ts` —
 * re-verify those field reads before trusting this reconstruction.)
 */

import type { IngestedDecision } from "../release-decision-index/ingest";
import { reduceIndex } from "../release-decision-index/reduce";
import { computeIndexRollup } from "../release-decision-index/rollup";
import {
  DECISION_SEVERITY,
  RELEASE_DECISION_CROSS_CHECKS,
  RELEASE_DECISION_DECISIONS,
  RELEASE_DECISION_INDEX_REASON_IDS,
  RELEASE_DECISION_INDEX_RECORD_STATES,
  RELEASE_DECISION_INDEX_SCHEMA,
  RELEASE_DECISION_INDEX_SEVERITIES,
  RELEASE_DECISION_INDEX_TREND_CLASSES,
  RELEASE_DECISION_INDEX_VERDICTS,
  type DecisionRecordFacts,
  type ReleaseDecisionCrossCheckStatus,
  type ReleaseDecisionDecision,
  type ReleaseDecisionIndexLedger,
  type ReleaseDecisionIndexReasonId,
  type ReleaseDecisionIndexRecordState,
  type ReleaseDecisionIndexRollup,
  type ReleaseDecisionIndexSeverity,
  type ReleaseDecisionIndexVerdict,
} from "../release-decision-index/types";
import type { DecisionIndexFacts } from "./types";

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

/** The bounded outcome of ingesting a `pdfxyz.release-decision-index/1` document. */
export interface IngestedDecisionIndex {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-index/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded index verdict + counts RE-DERIVE from its own ledger + sequence. */
  readonly usable: boolean;
  /** The window's recorded index verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionIndexVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: DecisionIndexFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-index/1`. */
export const UNRECOGNIZED_INDEX: IngestedDecisionIndex = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) window, carrying only its untrusted claimed verdict. */
function inconsistentIndex(verdict: ReleaseDecisionIndexVerdict | null): IngestedDecisionIndex {
  return { recognized: true, usable: false, verdict, facts: null };
}

/** Read a full `Record<K, number>` from `obj` over exactly `keys` (every key a non-negative int), or `undefined`. */
function readCounts<K extends string>(
  obj: unknown,
  keys: readonly K[],
): Record<K, number> | undefined {
  if (!isObject(obj)) return undefined;
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const n = intOf(obj[key]);
    if (n === undefined) return undefined;
    out[key] = n;
  }
  return out;
}

/** Validate the window's recorded `ledger` block into a bounded {@link ReleaseDecisionIndexLedger}, or `undefined`. */
function readLedger(root: Obj): ReleaseDecisionIndexLedger | undefined {
  const l = isObject(root.ledger) ? root.ledger : undefined;
  if (l === undefined) return undefined;

  const recordsSupplied = intOf(l.recordsSupplied);
  const recordsConsidered = intOf(l.recordsConsidered);
  const truncated = boolOf(l.truncated);
  const droppedOldest = intOf(l.droppedOldest);
  const recordsUsable = intOf(l.recordsUsable);
  const recordsUnreadable = intOf(l.recordsUnreadable);
  const recordsTampered = intOf(l.recordsTampered);
  const decisionCounts = readCounts(l.decisionCounts, RELEASE_DECISION_DECISIONS);
  const crossCheckCounts = readCounts(l.crossCheckCounts, RELEASE_DECISION_CROSS_CHECKS);
  const newest = nullableOneOf(l.newest, RELEASE_DECISION_DECISIONS);
  const oldest = nullableOneOf(l.oldest, RELEASE_DECISION_DECISIONS);
  const trendClass = oneOf(l.trendClass, RELEASE_DECISION_INDEX_TREND_CLASSES);
  if (
    recordsSupplied === undefined ||
    recordsConsidered === undefined ||
    truncated === undefined ||
    droppedOldest === undefined ||
    recordsUsable === undefined ||
    recordsUnreadable === undefined ||
    recordsTampered === undefined ||
    decisionCounts === undefined ||
    crossCheckCounts === undefined ||
    newest === undefined ||
    oldest === undefined ||
    trendClass === undefined
  ) {
    return undefined;
  }
  return {
    recordsSupplied,
    recordsConsidered,
    truncated,
    droppedOldest,
    recordsUsable,
    recordsUnreadable,
    recordsTampered,
    decisionCounts,
    crossCheckCounts,
    newest,
    oldest,
    trendClass,
  };
}

/** The recorded index-rollup fields the recompute must reproduce for the window to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionIndexVerdict;
  readonly exitCode: number;
  readonly stable: boolean;
  readonly reasons: readonly ReleaseDecisionIndexReasonId[];
  readonly invalidInputs: number;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly strict: boolean;
  readonly strictEscalated: boolean;
  readonly strictEscalatedFrom: "watch" | "insufficient" | null;
}

/** Validate the window's `index` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_INDEX_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const stable = boolOf(rollup.stable);
  const invalidInputs = intOf(rollup.invalidInputs);
  const blocking = intOf(rollup.blocking);
  const insufficiencies = intOf(rollup.insufficiencies);
  const advisories = intOf(rollup.advisories);
  const strict = boolOf(rollup.strict);
  const strictEscalated = boolOf(rollup.strictEscalated);
  const rawFrom = rollup.strictEscalatedFrom;
  const fromOk = rawFrom === null || rawFrom === "watch" || rawFrom === "insufficient";
  if (
    verdict === undefined ||
    exitCode === undefined ||
    stable === undefined ||
    invalidInputs === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    strict === undefined ||
    strictEscalated === undefined ||
    !fromOk ||
    !Array.isArray(rollup.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseDecisionIndexReasonId[] = [];
  for (const r of rollup.reasons) {
    const id = oneOf(r, RELEASE_DECISION_INDEX_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    stable,
    reasons,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    strict,
    strictEscalated,
    strictEscalatedFrom: rawFrom as "watch" | "insufficient" | null,
  };
}

/**
 * Compare two `ReleaseDecisionIndexReasonId` lists as sets (order-independent, exact membership). Size-aware in BOTH
 * directions so a crafted duplicate-plus-omission recorded list (same length, same members-as-subset, but a different
 * SET) cannot pass — the recompute is only trusted when the two lists are the identical set.
 */
function sameReasons(
  a: readonly ReleaseDecisionIndexReasonId[],
  b: readonly ReleaseDecisionIndexReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** Whether the re-derived rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameRollup(a: ReleaseDecisionIndexRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.stable === b.stable &&
    a.invalidInputs === b.invalidInputs &&
    a.blocking === b.blocking &&
    a.insufficiencies === b.insufficiencies &&
    a.advisories === b.advisories &&
    a.strict === b.strict &&
    a.strictEscalated === b.strictEscalated &&
    a.strictEscalatedFrom === b.strictEscalatedFrom &&
    sameReasons(a.reasons, b.reasons)
  );
}

/** One validated point from the window's own `points` sequence — enough to reconstruct its ingested record. */
interface ValidatedPoint {
  readonly state: ReleaseDecisionIndexRecordState;
  readonly decision: ReleaseDecisionDecision | null;
  readonly crossCheck: ReleaseDecisionCrossCheckStatus | null;
  readonly severity: ReleaseDecisionIndexSeverity | null;
}

/**
 * Validate the window's `points` array into a bounded sequence, or `undefined`. A usable point must carry a non-null
 * decision + cross-check whose severity matches `DECISION_SEVERITY` (a real Phase 60 usable point always does); an
 * off-shape / self-inconsistent point makes the whole window a tamper.
 */
function readPoints(root: Obj): ValidatedPoint[] | undefined {
  if (!Array.isArray(root.points)) return undefined;
  const out: ValidatedPoint[] = [];
  for (const raw of root.points) {
    if (!isObject(raw)) return undefined;
    const position = intOf(raw.position);
    const state = oneOf(raw.state, RELEASE_DECISION_INDEX_RECORD_STATES);
    const decision = nullableOneOf(raw.decision, RELEASE_DECISION_DECISIONS);
    const crossCheck = nullableOneOf(raw.crossCheck, RELEASE_DECISION_CROSS_CHECKS);
    const severity = nullableOneOf(raw.severity, RELEASE_DECISION_INDEX_SEVERITIES);
    if (
      position === undefined ||
      state === undefined ||
      decision === undefined ||
      crossCheck === undefined ||
      severity === undefined
    ) {
      return undefined;
    }
    if (state === "usable") {
      // A usable point must carry a trusted decision + cross-check, and a severity that re-derives from the decision.
      if (decision === null || crossCheck === null || severity !== DECISION_SEVERITY[decision]) {
        return undefined;
      }
    }
    out.push({ state, decision, crossCheck, severity });
  }
  return out;
}

/** Reconstruct the ingested record a point represents (only `recognized` / `usable` / `decision` / `crossCheck` matter). */
function reconstructRecord(point: ValidatedPoint): IngestedDecision {
  if (point.state === "usable" && point.decision !== null && point.crossCheck !== null) {
    const facts: DecisionRecordFacts = {
      decision: point.decision,
      exitCode: 0,
      proceed: point.decision === "proceed",
      crossCheck: point.crossCheck,
      invalidInputs: 0,
      blocking: 0,
      insufficiencies: 0,
      advisories: 0,
      strict: false,
      strictEscalated: false,
    };
    return { recognized: true, usable: true, decision: point.decision, facts };
  }
  if (point.state === "tampered") {
    return { recognized: true, usable: false, decision: point.decision, facts: null };
  }
  return { recognized: false, usable: false, decision: null, facts: null };
}

/** Whether the recorded ledger's post-cap counts + newest / oldest / class re-derive from the window's own sequence. */
function ledgerMatchesSequence(ledger: ReleaseDecisionIndexLedger, points: readonly ValidatedPoint[]): boolean {
  // Re-run the Phase 60 reducer over the reconstructed sequence with a cap of `points.length` (no further drop), so
  // the re-derived ledger's post-cap fields reflect exactly the sequence the window claims to summarize.
  const reReduced = reduceIndex(points.map(reconstructRecord), points.length).ledger;

  const sameDecisionCounts = RELEASE_DECISION_DECISIONS.every(
    (d) => reReduced.decisionCounts[d] === ledger.decisionCounts[d],
  );
  const sameCrossCheckCounts = RELEASE_DECISION_CROSS_CHECKS.every(
    (c) => reReduced.crossCheckCounts[c] === ledger.crossCheckCounts[c],
  );
  return (
    reReduced.recordsUsable === ledger.recordsUsable &&
    reReduced.recordsUnreadable === ledger.recordsUnreadable &&
    reReduced.recordsTampered === ledger.recordsTampered &&
    reReduced.newest === ledger.newest &&
    reReduced.oldest === ledger.oldest &&
    reReduced.trendClass === ledger.trendClass &&
    sameDecisionCounts &&
    sameCrossCheckCounts
  );
}

/** Whether the recorded ledger's window arithmetic is internally consistent with its own sequence + the window cap. */
function windowArithmeticOk(
  ledger: ReleaseDecisionIndexLedger,
  pointCount: number,
  maxRecords: number,
): boolean {
  return (
    ledger.recordsConsidered === pointCount &&
    ledger.recordsSupplied >= ledger.recordsConsidered &&
    ledger.droppedOldest === ledger.recordsSupplied - ledger.recordsConsidered &&
    ledger.truncated === ledger.droppedOldest > 0 &&
    ledger.recordsConsidered <= maxRecords
  );
}

/**
 * Reduce one parsed `pdfxyz.release-decision-index/1` `root` to the bounded {@link IngestedDecisionIndex}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_INDEX}. For a recognized window it validates the recorded
 * ledger + index rollup + policy + points, then requires BOTH: (B) the recorded rollup RE-DERIVES from the recorded
 * ledger + policy via {@link computeIndexRollup}, and (A) the recorded ledger's post-cap counts RE-DERIVE from the
 * window's own points sequence (via {@link reduceIndex}) with consistent window arithmetic. Any mismatch ⇒ a tamper.
 * Never throws and never echoes the input.
 */
export function ingestDecisionIndex(root: unknown): IngestedDecisionIndex {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_INDEX_SCHEMA) return UNRECOGNIZED_INDEX;

  const rollupObj = isObject(root.index) ? root.index : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.verdict, RELEASE_DECISION_INDEX_VERDICTS) ?? null) : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // index verdict surfaced (untrusted) so the trend can show what the window asserted.
  if (rollupObj === undefined) return inconsistentIndex(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentIndex(claimed);

  const ledger = readLedger(root);
  if (ledger === undefined) return inconsistentIndex(recorded.verdict);

  const points = readPoints(root);
  if (points === undefined) return inconsistentIndex(recorded.verdict);

  // The window's `policy.strict` must agree with the rollup's recorded `strict` (a smuggled inconsistent policy is a
  // tamper). A real Phase 60 window always carries both, equal; `policy.maxRecords` bounds its own record window.
  const policyObj = isObject(root.policy) ? root.policy : undefined;
  const policyStrict = policyObj ? boolOf(policyObj.strict) : undefined;
  const policyMaxRecords = policyObj ? intOf(policyObj.maxRecords) : undefined;
  if (
    policyStrict === undefined ||
    policyMaxRecords === undefined ||
    policyMaxRecords < 1 ||
    policyStrict !== recorded.strict
  ) {
    return inconsistentIndex(recorded.verdict);
  }

  // (B) Re-derive the index verdict from the window's OWN recorded ledger + strict, exactly as the Phase 60 CLI did,
  // and require the recorded rollup to match in every load-bearing field.
  const { rollup: rederived } = computeIndexRollup(ledger, {
    maxRecords: policyMaxRecords,
    strict: recorded.strict,
  });
  if (!sameRollup(rederived, recorded)) return inconsistentIndex(recorded.verdict);

  // (A) Re-check the recorded ledger's post-cap counts + arithmetic against the window's OWN per-record sequence, so a
  // lied count consistent with the verdict is still caught.
  if (
    !windowArithmeticOk(ledger, points.length, policyMaxRecords) ||
    !ledgerMatchesSequence(ledger, points)
  ) {
    return inconsistentIndex(recorded.verdict);
  }

  const facts: DecisionIndexFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    stable: recorded.stable,
    recordsConsidered: ledger.recordsConsidered,
    recordsUsable: ledger.recordsUsable,
    decisionCounts: ledger.decisionCounts,
    windowTrendClass: ledger.trendClass,
    strict: recorded.strict,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
