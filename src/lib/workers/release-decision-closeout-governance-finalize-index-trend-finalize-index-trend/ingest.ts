/**
 * Pure, node-free **window ingest** for the release decision closeout governance finalize index trend finalize index trend (Phase 81) — the
 * trust boundary and the no-leak core.
 *
 * The trend summarizes a bounded history of `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1` windows. Even
 * though each window is already content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, a
 * committed window, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded ingested
 * shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a window. Every recorded fact is validated
 *    against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance, the window's OWN
 *    stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary — TWICE.** A finalize-index window records both a `coverage` + `distribution` summary
 *    (its bounded counts) and a per-record `points` sequence, and its load-bearing output is its `finalizeIndex` verdict.
 *    So the deepest self-consistency check available is two reuses of the Phase 80 reducers:
 *      (B) RE-RUN {@link computeFinalizeIndexRollup} over the window's OWN recorded coverage + distribution + policy, and
 *          require the recorded `finalizeIndex` rollup (verdict, exit code, indexed flag, latest / oldest, trend class,
 *          reason set, the five severity counts, strict-open escalation) to re-derive — so a hand-flipped index verdict
 *          is caught;
 *      (A) RE-RUN {@link reduceIndex} over the window's OWN `points` sequence (reconstructed as ingested finalization
 *          bundles) and require the recorded coverage's post-cap counts (usable / unreadable / tampered, the finalization
 *          distribution, newest / oldest, class) + the window arithmetic to re-derive — so a lied count (even one
 *          consistent with a flipped verdict) is caught against the sequence it claims to summarize.
 *    A window is `usable` only if BOTH re-derive.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` window); a
 *    recognized-but-inconsistent window is `recognized = true, usable = false` (⇒ a `tampered` window); a coherent
 *    window yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a finalize index trend finalize index reduced its own finalization BUNDLES away into counts + a per-record posture
 * sequence, so the DEEPEST faithful check over a finalize-index window is re-deriving its index verdict from its own
 * coverage + distribution AND re-checking those against its own sequence — it is the atom of evidence here, exactly as the
 * finalization bundle was at Phase 79 and the governance index at Phase 70. A fully self-consistent FABRICATED window
 * (real-looking counts + verdict + sequence) is out of scope for structural tamper-evidence, exactly as at Phases 52–75;
 * that would need a signature this offline summarizer does not have.
 *
 * SAFETY of the stripped reconstruction: {@link reduceIndex} (via `reduceRecord`) reads ONLY each ingested bundle's
 * `recognized` / `usable` / `verdict` for the coverage + distribution counts, and the newest usable bundle's `facts` for
 * the (un-compared) `latest` object; {@link computeFinalizeIndexRollup} reads ONLY the coverage's usable / unreadable /
 * tampered counts + the `verdictCounts` + the passed `newest` + the policy thresholds. So filling the reconstructed
 * bundles' other fields with derived defaults cannot change either recompute — the load-bearing fields are read
 * faithfully from the window's own coverage + distribution + sequence. (Verified against
 * `release-decision-closeout-governance-finalize-index-trend-finalize-index/reduce.ts`; re-verify those field reads before trusting this
 * reconstruction.)
 */

import {
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SOURCE_STATES,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize/types";
import {
  computeFinalizeIndexRollup,
  reduceIndex,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index/reduce";
import type { IngestedFinalize } from "../release-decision-closeout-governance-finalize-index-trend-finalize-index/ingest";
import {
  FINALIZE_VERDICT_SEVERITY,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_RECORD_STATES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_REASON_IDS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SCHEMA,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SEVERITIES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLASSES,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS,
  type FinalizeRecordFacts,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexCoverage,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexDistribution,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexRecordState,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexRollup,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexSeverity,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendClass,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict,
} from "../release-decision-closeout-governance-finalize-index-trend-finalize-index/types";
import type { FinalizeIndexFacts } from "./types";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
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
 * Compare two `ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId` lists as sets (order-independent, exact
 * membership). Size-aware in BOTH directions so a crafted duplicate-plus-omission recorded list (same length, same
 * members-as-subset, but a different SET) cannot pass — the recompute is only trusted when the two lists are the
 * identical set.
 */
function sameReasons(
  a: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId[],
  b: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId[],
): boolean {
  const setA = new Set<string>(a);
  const setB = new Set<string>(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

/** The bounded outcome of ingesting a `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1` document. */
export interface IngestedFinalizeIndex {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1` tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded index verdict + counts RE-DERIVE from its own coverage + distribution + sequence. */
  readonly usable: boolean;
  /** The window's recorded index verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: FinalizeIndexFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1`. */
export const UNRECOGNIZED_FINALIZE_INDEX: IngestedFinalizeIndex = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) window, carrying only its untrusted claimed verdict. */
function inconsistentFinalizeIndex(
  verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict | null,
): IngestedFinalizeIndex {
  return { recognized: true, usable: false, verdict, facts: null };
}

/* ------------------------------------------------------------------ *
 *  Recorded blocks (validated into bounded shapes; nothing echoed)
 * ------------------------------------------------------------------ */

/** The recorded index-rollup fields the recompute must reproduce for the window to be `usable`. */
interface RecordedRollup {
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict;
  readonly exitCode: number;
  readonly indexed: boolean;
  readonly latest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict | null;
  readonly oldest: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict | null;
  readonly trendClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendClass;
  readonly reasons: readonly ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId[];
  readonly invalid: number;
  readonly blocking: number;
  readonly open: number;
  readonly incomplete: number;
  readonly informational: number;
  readonly strictOpen: boolean;
  readonly strictOpenEscalated: boolean;
  readonly strictOpenEscalatedFrom: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexVerdict | null;
}

/** Validate the window's `finalizeIndex` rollup block into the bounded {@link RecordedRollup}, or `undefined`. */
function readRecordedRollup(rollup: Obj): RecordedRollup | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const indexed = boolOf(rollup.indexed);
  const latest = nullableOneOf(rollup.latest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const oldest = nullableOneOf(rollup.oldest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const trendClass = oneOf(rollup.trendClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLASSES);
  const invalid = intOf(rollup.invalid);
  const blocking = intOf(rollup.blocking);
  const open = intOf(rollup.open);
  const incomplete = intOf(rollup.incomplete);
  const informational = intOf(rollup.informational);
  const strictOpen = boolOf(rollup.strictOpen);
  const strictOpenEscalated = boolOf(rollup.strictOpenEscalated);
  const strictOpenEscalatedFrom = nullableOneOf(
    rollup.strictOpenEscalatedFrom,
    RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS,
  );
  if (
    verdict === undefined ||
    exitCode === undefined ||
    indexed === undefined ||
    latest === undefined ||
    oldest === undefined ||
    trendClass === undefined ||
    invalid === undefined ||
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
  const reasons: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexReasonId[] = [];
  for (const r of rollup.reasons) {
    const id = oneOf(r, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    indexed,
    latest,
    oldest,
    trendClass,
    reasons,
    invalid,
    blocking,
    open,
    incomplete,
    informational,
    strictOpen,
    strictOpenEscalated,
    strictOpenEscalatedFrom,
  };
}

/** Validate the window's recorded `coverage` block into a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexCoverage}. */
function readCoverage(root: Obj): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexCoverage | undefined {
  const c = isObject(root.coverage) ? root.coverage : undefined;
  if (c === undefined) return undefined;
  const finalizationsSupplied = intOf(c.finalizationsSupplied);
  const finalizationsConsidered = intOf(c.finalizationsConsidered);
  const finalizationsUsable = intOf(c.finalizationsUsable);
  const finalizationsUnreadable = intOf(c.finalizationsUnreadable);
  const finalizationsTampered = intOf(c.finalizationsTampered);
  const truncated = boolOf(c.truncated);
  const droppedOldest = intOf(c.droppedOldest);
  if (
    finalizationsSupplied === undefined ||
    finalizationsConsidered === undefined ||
    finalizationsUsable === undefined ||
    finalizationsUnreadable === undefined ||
    finalizationsTampered === undefined ||
    truncated === undefined ||
    droppedOldest === undefined
  ) {
    return undefined;
  }
  return {
    finalizationsSupplied,
    finalizationsConsidered,
    finalizationsUsable,
    finalizationsUnreadable,
    finalizationsTampered,
    truncated,
    droppedOldest,
  };
}

/** Validate the window's recorded `distribution` block into a bounded {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexDistribution}. */
function readDistribution(root: Obj): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexDistribution | undefined {
  const d = isObject(root.distribution) ? root.distribution : undefined;
  if (d === undefined) return undefined;
  const verdictCounts = readCounts(d.verdictCounts, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const newest = nullableOneOf(d.newest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const oldest = nullableOneOf(d.oldest, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
  const trendClass = oneOf(d.trendClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLASSES);
  if (verdictCounts === undefined || newest === undefined || oldest === undefined || trendClass === undefined) {
    return undefined;
  }
  return { verdictCounts, newest, oldest, trendClass };
}

/** One validated point from the window's own `points` sequence — enough to reconstruct its ingested finalization bundle. */
interface ValidatedPoint {
  readonly state: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexRecordState;
  readonly verdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeVerdict | null;
  readonly receiptState: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeSourceState | null;
  readonly receiptVerdict: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptVerdict | null;
  readonly planClass: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendActionReceiptPlanClass | null;
  readonly severity: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexSeverity | null;
}

/**
 * Validate the window's `points` array into a bounded sequence, or `undefined`. A usable point must carry a non-null
 * finalization verdict whose severity matches `FINALIZE_VERDICT_SEVERITY` (a real Phase 80 usable point always does); an
 * off-shape / self-inconsistent point makes the whole window a tamper.
 */
function readPoints(root: Obj): ValidatedPoint[] | undefined {
  if (!Array.isArray(root.points)) return undefined;
  const out: ValidatedPoint[] = [];
  for (const raw of root.points) {
    if (!isObject(raw)) return undefined;
    const position = intOf(raw.position);
    const state = oneOf(raw.state, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_RECORD_STATES);
    const verdict = nullableOneOf(raw.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS);
    const receiptState = nullableOneOf(raw.receiptState, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_SOURCE_STATES);
    const receiptVerdict = nullableOneOf(raw.receiptVerdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_VERDICTS);
    const planClass = nullableOneOf(raw.planClass, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_ACTION_RECEIPT_PLAN_CLASSES);
    const severity = nullableOneOf(raw.severity, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SEVERITIES);
    if (
      position === undefined ||
      state === undefined ||
      verdict === undefined ||
      receiptState === undefined ||
      receiptVerdict === undefined ||
      planClass === undefined ||
      severity === undefined
    ) {
      return undefined;
    }
    if (state === "usable") {
      // A usable point must carry a trusted finalization verdict and a severity that re-derives from that verdict.
      if (verdict === null || severity !== FINALIZE_VERDICT_SEVERITY[verdict]) return undefined;
    }
    out.push({ state, verdict, receiptState, receiptVerdict, planClass, severity });
  }
  return out;
}

/** Reconstruct the ingested finalization bundle a point represents (only `recognized`/`usable`/`verdict`/`facts` matter). */
function reconstructFinalize(point: ValidatedPoint): IngestedFinalize {
  if (point.state === "usable" && point.verdict !== null) {
    const facts: FinalizeRecordFacts = {
      verdict: point.verdict,
      exitCode: 0,
      finalized: point.verdict === "finalized",
      receiptState: point.receiptState ?? "usable",
      receiptVerdict: point.receiptVerdict,
      planClass: point.planClass,
      relatedSupplied: 0,
      relatedCoherent: 0,
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
function sameRollup(a: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexRollup, b: RecordedRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.indexed === b.indexed &&
    a.latest === b.latest &&
    a.oldest === b.oldest &&
    a.trendClass === b.trendClass &&
    a.invalid === b.invalid &&
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

/** Whether the recorded coverage's post-cap counts + distribution re-derive from the window's own sequence. */
function coverageMatchesSequence(
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexCoverage,
  distribution: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexDistribution,
  points: readonly ValidatedPoint[],
): boolean {
  // Re-run the Phase 80 reducer over the reconstructed sequence with a cap of `points.length` (no further drop), so the
  // re-derived coverage's post-cap fields reflect exactly the sequence the window claims to summarize.
  const reReduced = reduceIndex(points.map(reconstructFinalize), points.length);
  const sameVerdictCounts = RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_VERDICTS.every(
    (v) => reReduced.distribution.verdictCounts[v] === distribution.verdictCounts[v],
  );
  return (
    reReduced.coverage.finalizationsConsidered === coverage.finalizationsConsidered &&
    reReduced.coverage.finalizationsUsable === coverage.finalizationsUsable &&
    reReduced.coverage.finalizationsUnreadable === coverage.finalizationsUnreadable &&
    reReduced.coverage.finalizationsTampered === coverage.finalizationsTampered &&
    reReduced.distribution.newest === distribution.newest &&
    reReduced.distribution.oldest === distribution.oldest &&
    reReduced.distribution.trendClass === distribution.trendClass &&
    sameVerdictCounts
  );
}

/** Whether the recorded coverage's window arithmetic is internally consistent with its own sequence + the window cap. */
function windowArithmeticOk(
  coverage: ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexCoverage,
  pointCount: number,
  maxFinalizations: number,
): boolean {
  return (
    coverage.finalizationsConsidered === pointCount &&
    coverage.finalizationsSupplied >= coverage.finalizationsConsidered &&
    coverage.droppedOldest === coverage.finalizationsSupplied - coverage.finalizationsConsidered &&
    coverage.truncated === coverage.droppedOldest > 0 &&
    coverage.finalizationsConsidered <= maxFinalizations
  );
}

/** The bounded `policy` block the window recorded (its own window cap + thresholds + require / strict flags). */
interface RecordedPolicy {
  readonly maxFinalizations: number;
  readonly maxOpen: number;
  readonly maxIncomplete: number;
  readonly requireLatestFinalized: boolean;
  readonly strictOpen: boolean;
}

/** Validate the window's `policy` block into a bounded {@link RecordedPolicy}, or `undefined`. */
function readPolicy(root: Obj): RecordedPolicy | undefined {
  const p = isObject(root.policy) ? root.policy : undefined;
  if (p === undefined) return undefined;
  const maxFinalizations = intOf(p.maxFinalizations);
  const maxOpen = intOf(p.maxOpen);
  const maxIncomplete = intOf(p.maxIncomplete);
  const requireLatestFinalized = boolOf(p.requireLatestFinalized);
  const strictOpen = boolOf(p.strictOpen);
  if (
    maxFinalizations === undefined ||
    maxFinalizations < 1 ||
    maxOpen === undefined ||
    maxIncomplete === undefined ||
    requireLatestFinalized === undefined ||
    strictOpen === undefined
  ) {
    return undefined;
  }
  return { maxFinalizations, maxOpen, maxIncomplete, requireLatestFinalized, strictOpen };
}

/**
 * Reduce one parsed `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1` `root` to the bounded
 * {@link IngestedFinalizeIndex}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_FINALIZE_INDEX}. For a recognized window it validates the
 * recorded finalizeIndex rollup + coverage + distribution + policy + points, then requires BOTH: (B) the recorded rollup
 * RE-DERIVES from the recorded coverage + distribution + policy via {@link computeFinalizeIndexRollup}, and (A) the
 * recorded coverage's post-cap counts + distribution RE-DERIVE from the window's own points sequence (via
 * {@link reduceIndex}) with consistent window arithmetic. Any mismatch ⇒ a tamper. Never throws and never echoes the
 * input.
 */
export function ingestFinalizeIndex(root: unknown): IngestedFinalizeIndex {
  if (!isObject(root) || root.schema !== RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SCHEMA) {
    return UNRECOGNIZED_FINALIZE_INDEX;
  }

  const rollupObj = isObject(root.finalizeIndex) ? root.finalizeIndex : undefined;
  const claimed = rollupObj
    ? (oneOf(rollupObj.verdict, RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_VERDICTS) ?? null)
    : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the claimed
  // index verdict surfaced (untrusted) so the trend can show what the window asserted.
  if (rollupObj === undefined) return inconsistentFinalizeIndex(claimed);
  const recorded = readRecordedRollup(rollupObj);
  if (recorded === undefined) return inconsistentFinalizeIndex(claimed);

  const coverage = readCoverage(root);
  if (coverage === undefined) return inconsistentFinalizeIndex(recorded.verdict);

  const distribution = readDistribution(root);
  if (distribution === undefined) return inconsistentFinalizeIndex(recorded.verdict);

  const points = readPoints(root);
  if (points === undefined) return inconsistentFinalizeIndex(recorded.verdict);

  // The window's `policy.strictOpen` must agree with the rollup's recorded `strictOpen` (a smuggled inconsistent policy
  // is a tamper). A real Phase 80 window always carries both, equal; the thresholds bound its own escalation.
  const policy = readPolicy(root);
  if (policy === undefined || policy.strictOpen !== recorded.strictOpen) {
    return inconsistentFinalizeIndex(recorded.verdict);
  }

  // (B) Re-derive the index verdict from the window's OWN recorded coverage + distribution + policy, exactly as the
  // Phase 80 CLI did, and require the recorded rollup to match in every load-bearing field.
  const { rollup: rederived } = computeFinalizeIndexRollup(coverage, distribution, {
    maxFinalizations: policy.maxFinalizations,
    maxOpen: policy.maxOpen,
    maxIncomplete: policy.maxIncomplete,
    requireLatestFinalized: policy.requireLatestFinalized,
    strictOpen: policy.strictOpen,
  });
  if (!sameRollup(rederived, recorded)) return inconsistentFinalizeIndex(recorded.verdict);

  // (A) Re-check the recorded coverage's post-cap counts + arithmetic against the window's OWN per-record sequence, so a
  // lied count consistent with the verdict is still caught.
  if (
    !windowArithmeticOk(coverage, points.length, policy.maxFinalizations) ||
    !coverageMatchesSequence(coverage, distribution, points)
  ) {
    return inconsistentFinalizeIndex(recorded.verdict);
  }

  const facts: FinalizeIndexFacts = {
    verdict: recorded.verdict,
    exitCode: recorded.exitCode,
    indexed: recorded.indexed,
    finalizationsConsidered: coverage.finalizationsConsidered,
    finalizationsUsable: coverage.finalizationsUsable,
    finalizationVerdictCounts: distribution.verdictCounts,
    latestFinalization: distribution.newest,
    strictOpen: recorded.strictOpen,
  };
  return { recognized: true, usable: true, verdict: recorded.verdict, facts };
}
