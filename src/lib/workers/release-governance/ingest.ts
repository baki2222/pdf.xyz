/**
 * Pure, node-free **document ingest** for the release evidence governance bundle (Phase 54) — the trust
 * boundary and the no-leak core.
 *
 * The bundle composes up to three release-evidence outputs — a `pdfxyz.release-trend/1` (PRIMARY window
 * summary), a latest `pdfxyz.release-report/1`, and a latest `pdfxyz.release-audit/1`. Even though each is
 * already content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, a committed
 * record, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded ingested
 * shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a document. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance,
 *    stamps, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundaries.** The report source reuses the Phase 53 {@link ingestReport} (which
 *    re-derives the report's Phase 52 recommendation). The audit source reuses the Phase 52 {@link ingestAudit}
 *    (which re-runs the Phase 51 audit rollup). The trend source (new here) reconstructs the trend's own
 *    per-report POINTS and RE-RUNS the Phase 53 {@link reduceTrend} + {@link computeTrendRollup} over them,
 *    marking the trend `usable` only if the recorded history + verdict re-derive — so a hand-flipped verdict /
 *    lied recommendation distribution / hidden tampered point is caught as self-inconsistent.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` source);
 *    a recognized-but-inconsistent document is `recognized = true, usable = false` (⇒ a `tampered` source,
 *    blocking); a coherent document yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON TREND DEPTH: a trend's own record keeps only its bounded per-report POINTS (each point's coverage
 * state + recommendation, never the underlying report's raw stages) — it already reduced the reports away. So
 * the DEEPEST self-consistency check available over a trend is reconstructing those points and re-deriving the
 * history + verdict from them; that is exactly what {@link reduceTrend} + {@link computeTrendRollup} read, so
 * re-running them is faithful tamper-evidence at this boundary (the POINT is the atom of a trend, as the report
 * was at Phase 53 and the bundle at Phase 51). SAFETY of the stripped reconstruction: {@link reduceTrend} reads
 * ONLY each ingested report's `recognized` / `usable` / `recommendation`, and {@link computeTrendRollup} reads
 * ONLY the history + the usable-recommendation sequence + the policy — never `facts` — so filling `facts: null`
 * cannot change the recompute (verified against `release-trend/reduce.ts` + `release-trend/rollup.ts`;
 * re-verify those field reads before trusting this reconstruction).
 */

import { ingestAudit } from "../release-report/ingest";
import { computeTrendRollup } from "../release-trend/rollup";
import { reduceTrend } from "../release-trend/reduce";
import { ingestReport } from "../release-trend/ingest";
import {
  RECOMMENDATION_SEVERITY,
  RELEASE_REPORT_RECOMMENDATIONS,
  RELEASE_TREND_DIRECTIONS,
  RELEASE_TREND_REASON_IDS,
  RELEASE_TREND_REPORT_STATES,
  RELEASE_TREND_SCHEMA,
  RELEASE_TREND_SEVERITIES,
  RELEASE_TREND_VERDICTS,
  type ReleaseReportRecommendation,
  type ReleaseTrendDirection,
  type ReleaseTrendHistory,
  type ReleaseTrendPolicy,
  type ReleaseTrendReasonId,
  type ReleaseTrendReportState,
  type ReleaseTrendSeverity,
  type ReleaseTrendVerdict,
} from "../release-trend/types";
import type { IngestedReport } from "../release-trend/ingest";
import type { IngestedAudit } from "../release-report/ingest";
import type { GovernanceTrendFacts } from "./types";

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

/** A recommendation token, or `null` if the value is `null`, or `undefined` if off-enum. */
function recommendationOrNull(value: unknown): ReleaseReportRecommendation | null | undefined {
  if (value === null) return null;
  return oneOf(value, RELEASE_REPORT_RECOMMENDATIONS);
}

/* ------------------------------------------------------------------ *
 *  Trend source — reconstruct the trend's POINTS, re-run the Phase 53 reduce + rollup
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting a `pdfxyz.release-trend/1` document. */
export interface IngestedTrend {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-trend/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded history + verdict RE-DERIVE from its own points (self-consistent). */
  readonly usable: boolean;
  /** The trend's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseTrendVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: GovernanceTrendFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-trend/1`. */
export const UNRECOGNIZED_TREND: IngestedTrend = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) trend, carrying only its untrusted claimed verdict. */
function inconsistentTrend(verdict: ReleaseTrendVerdict | null): IngestedTrend {
  return { recognized: true, usable: false, verdict, facts: null };
}

/** The recorded trend `policy` block validated into a bounded {@link ReleaseTrendPolicy}, or `undefined`. */
function readTrendPolicy(value: unknown): ReleaseTrendPolicy | undefined {
  if (!isObject(value)) return undefined;
  const maxReports = intOf(value.maxReports);
  const maxHoldWarning = intOf(value.maxHoldWarning);
  const maxHoldFail = intOf(value.maxHoldFail);
  const requireLatestReady = boolOf(value.requireLatestReady);
  if (
    maxReports === undefined ||
    maxHoldWarning === undefined ||
    maxHoldFail === undefined ||
    requireLatestReady === undefined
  ) {
    return undefined;
  }
  return { maxReports, maxHoldWarning, maxHoldFail, requireLatestReady };
}

/** The recorded trend `history` block validated into a bounded {@link ReleaseTrendHistory}, or `undefined`. */
function readTrendHistory(value: unknown): ReleaseTrendHistory | undefined {
  if (!isObject(value)) return undefined;
  const reportsSupplied = intOf(value.reportsSupplied);
  const reportsConsidered = intOf(value.reportsConsidered);
  const truncated = boolOf(value.truncated);
  const droppedOldest = intOf(value.droppedOldest);
  const reportsUsable = intOf(value.reportsUsable);
  const reportsUnreadable = intOf(value.reportsUnreadable);
  const reportsTampered = intOf(value.reportsTampered);
  const direction = oneOf(value.direction, RELEASE_TREND_DIRECTIONS);
  const newest = recommendationOrNull(value.newest);
  const oldest = recommendationOrNull(value.oldest);
  if (
    reportsSupplied === undefined ||
    reportsConsidered === undefined ||
    truncated === undefined ||
    droppedOldest === undefined ||
    reportsUsable === undefined ||
    reportsUnreadable === undefined ||
    reportsTampered === undefined ||
    direction === undefined ||
    newest === undefined ||
    oldest === undefined ||
    !isObject(value.counts)
  ) {
    return undefined;
  }
  const counts = {} as Record<ReleaseReportRecommendation, number>;
  for (const rec of RELEASE_REPORT_RECOMMENDATIONS) {
    const n = intOf((value.counts as Obj)[rec]);
    if (n === undefined) return undefined;
    counts[rec] = n;
  }
  return {
    reportsSupplied,
    reportsConsidered,
    truncated,
    droppedOldest,
    reportsUsable,
    reportsUnreadable,
    reportsTampered,
    counts,
    newest,
    oldest,
    direction,
  };
}

/** The recorded trend rollup fields the recompute must reproduce for the trend to be `usable`. */
interface RecordedTrendRollup {
  readonly verdict: ReleaseTrendVerdict;
  readonly exitCode: number;
  readonly stable: boolean;
  readonly reasons: readonly ReleaseTrendReasonId[];
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly requireLatestReady: boolean;
  readonly readyEscalated: boolean;
}

/** Validate the trend's `trend` rollup block into the bounded {@link RecordedTrendRollup}, or `undefined`. */
function readTrendRollup(value: unknown): RecordedTrendRollup | undefined {
  if (!isObject(value)) return undefined;
  const verdict = oneOf(value.verdict, RELEASE_TREND_VERDICTS);
  const exitCode = intOf(value.exitCode);
  const stable = boolOf(value.stable);
  const blocking = intOf(value.blocking);
  const insufficiencies = intOf(value.insufficiencies);
  const advisories = intOf(value.advisories);
  const requireLatestReady = boolOf(value.requireLatestReady);
  const readyEscalated = boolOf(value.readyEscalated);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    stable === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    requireLatestReady === undefined ||
    readyEscalated === undefined ||
    !Array.isArray(value.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseTrendReasonId[] = [];
  for (const r of value.reasons) {
    const id = oneOf(r, RELEASE_TREND_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    stable,
    reasons,
    blocking,
    insufficiencies,
    advisories,
    requireLatestReady,
    readyEscalated,
  };
}

/**
 * Reconstruct one recorded trend point at `index` into the minimal {@link IngestedReport} the Phase 53 reducer
 * reads (`recognized` / `usable` / `recommendation` only). Returns `undefined` if the point is malformed,
 * off-enum, out of position, or internally inconsistent (a usable point whose severity does not derive from its
 * recommendation, an unreadable point carrying a recommendation, etc.) — any of which is a corrupt / tampered
 * trend. `facts: null` is never read by the reducer.
 */
function reconstructPoint(raw: unknown, index: number): IngestedReport | undefined {
  if (!isObject(raw)) return undefined;
  if (intOf(raw.position) !== index) return undefined; // points must be positioned oldest = 0, in order
  const state = oneOf(raw.state, RELEASE_TREND_REPORT_STATES);
  if (state === undefined) return undefined;
  const recommendation = recommendationOrNull(raw.recommendation);
  if (recommendation === undefined) return undefined; // an off-enum recommendation is corrupt
  const severity =
    raw.severity === null ? null : oneOf(raw.severity, RELEASE_TREND_SEVERITIES);
  if (severity === undefined) return undefined; // an off-enum severity is corrupt

  if (!pointConsistent(state, recommendation, severity)) return undefined;

  switch (state) {
    case "usable":
      return { recognized: true, usable: true, recommendation, facts: null };
    case "tampered":
      return { recognized: true, usable: false, recommendation, facts: null };
    case "unreadable":
      return { recognized: false, usable: false, recommendation: null, facts: null };
  }
}

/** Whether a recorded point's (state, recommendation, severity) is internally consistent (a cheap tamper gate). */
function pointConsistent(
  state: ReleaseTrendReportState,
  recommendation: ReleaseReportRecommendation | null,
  severity: ReleaseTrendSeverity | null,
): boolean {
  switch (state) {
    case "usable":
      // A usable point carries a trusted recommendation whose severity derives from it (Phase 53 reduceReport).
      return recommendation !== null && severity === RECOMMENDATION_SEVERITY[recommendation];
    case "unreadable":
      // An unreadable point contributes no recommendation and no severity.
      return recommendation === null && severity === null;
    case "tampered":
      // A tampered point surfaces an untrusted claim (recommendation may be null / any) but no severity.
      return severity === null;
  }
}

/** Compare two `ReleaseTrendReasonId` lists as sets (order-independent, exact membership). */
function sameReasons(a: readonly ReleaseTrendReasonId[], b: readonly ReleaseTrendReasonId[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((id) => set.has(id));
}

/** Whether the recorded window arithmetic (supplied / considered / dropped / truncated) is self-consistent. */
function windowConsistent(history: ReleaseTrendHistory, policy: ReleaseTrendPolicy, consideredPoints: number): boolean {
  return (
    history.reportsConsidered === consideredPoints &&
    history.reportsSupplied >= history.reportsConsidered &&
    history.droppedOldest === history.reportsSupplied - history.reportsConsidered &&
    history.truncated === history.droppedOldest > 0 &&
    history.reportsConsidered <= policy.maxReports
  );
}

/** Whether the re-derived history matches the recorded history on every POINT-derivable field. */
function historyPointFieldsMatch(recorded: ReleaseTrendHistory, rederived: ReleaseTrendHistory): boolean {
  return (
    recorded.reportsConsidered === rederived.reportsConsidered &&
    recorded.reportsUsable === rederived.reportsUsable &&
    recorded.reportsUnreadable === rederived.reportsUnreadable &&
    recorded.reportsTampered === rederived.reportsTampered &&
    recorded.newest === rederived.newest &&
    recorded.oldest === rederived.oldest &&
    recorded.direction === rederived.direction &&
    RELEASE_REPORT_RECOMMENDATIONS.every((rec) => recorded.counts[rec] === rederived.counts[rec])
  );
}

/**
 * Reduce one parsed `pdfxyz.release-trend/1` `root` to the bounded {@link IngestedTrend}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_TREND}. For a recognized trend it reconstructs the
 * per-report points, RE-RUNS the Phase 53 {@link reduceTrend} + {@link computeTrendRollup} over them, and marks
 * the trend `usable` only if the recorded history (point-derivable fields + window arithmetic) and the recorded
 * verdict (verdict, exit code, stable flag, reason set, blocking / insufficiency / advisory counts, escalation
 * flags) equal the re-derived ones — so a hand-flipped verdict / lied distribution / hidden point is caught.
 * Never throws and never echoes the input.
 */
export function ingestTrend(root: unknown): IngestedTrend {
  if (!isObject(root) || root.schema !== RELEASE_TREND_SCHEMA) return UNRECOGNIZED_TREND;

  const rollupObj = isObject(root.trend) ? root.trend : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.verdict, RELEASE_TREND_VERDICTS) ?? null) : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the
  // claimed verdict surfaced (untrusted) so the bundle can show what the trend asserted.
  const recordedRollup = readTrendRollup(root.trend);
  const recordedHistory = readTrendHistory(root.history);
  const policy = readTrendPolicy(root.policy);
  if (recordedRollup === undefined || recordedHistory === undefined || policy === undefined) {
    return inconsistentTrend(claimed);
  }
  if (!Array.isArray(root.points)) return inconsistentTrend(recordedRollup.verdict);

  // Reconstruct every point (oldest → newest). A single malformed / inconsistent point ⇒ a tampered trend.
  const reconstructed: IngestedReport[] = [];
  for (let i = 0; i < root.points.length; i++) {
    const point = reconstructPoint(root.points[i], i);
    if (point === undefined) return inconsistentTrend(recordedRollup.verdict);
    reconstructed.push(point);
  }

  // Re-derive the history + verdict from the reconstructed points, exactly as the Phase 53 CLI did (no further
  // windowing — the points are already the considered window; a cap ≥ length keeps them all).
  const { history: rederivedHistory, usableRecommendations } = reduceTrend(
    reconstructed,
    Math.max(reconstructed.length, 1),
  );
  const { rollup: rederivedRollup } = computeTrendRollup(rederivedHistory, usableRecommendations, policy);

  const consistent =
    windowConsistent(recordedHistory, policy, reconstructed.length) &&
    historyPointFieldsMatch(recordedHistory, rederivedHistory) &&
    rederivedRollup.verdict === recordedRollup.verdict &&
    rederivedRollup.exitCode === recordedRollup.exitCode &&
    rederivedRollup.stable === recordedRollup.stable &&
    rederivedRollup.blocking === recordedRollup.blocking &&
    rederivedRollup.insufficiencies === recordedRollup.insufficiencies &&
    rederivedRollup.advisories === recordedRollup.advisories &&
    rederivedRollup.requireLatestReady === recordedRollup.requireLatestReady &&
    rederivedRollup.readyEscalated === recordedRollup.readyEscalated &&
    sameReasons(rederivedRollup.reasons, recordedRollup.reasons);
  if (!consistent) return inconsistentTrend(recordedRollup.verdict);

  const facts: GovernanceTrendFacts = {
    verdict: recordedRollup.verdict,
    exitCode: recordedRollup.exitCode,
    stable: recordedRollup.stable,
    reportsUsable: rederivedHistory.reportsUsable,
    reportsConsidered: rederivedHistory.reportsConsidered,
    newest: rederivedHistory.newest,
    oldest: rederivedHistory.oldest,
    direction: rederivedHistory.direction as ReleaseTrendDirection,
    blocking: recordedRollup.blocking,
    insufficiencies: recordedRollup.insufficiencies,
    advisories: recordedRollup.advisories,
  };
  return { recognized: true, usable: true, verdict: recordedRollup.verdict, facts };
}

/* ------------------------------------------------------------------ *
 *  Report + audit sources — reuse the Phase 53 / Phase 52 boundaries verbatim
 * ------------------------------------------------------------------ */

/**
 * Reduce one parsed `pdfxyz.release-report/1` `root` to the bounded {@link IngestedReport}, reusing the tested
 * Phase 53 boundary (which re-derives the report's Phase 52 recommendation from its own sources). A non-object /
 * wrong-schema input is not recognized (⇒ an `unreadable` source); a recognized-but-self-inconsistent report is
 * `usable = false` (⇒ a `tampered` source). Never throws / echoes.
 */
export function ingestReportSource(root: unknown): IngestedReport {
  return ingestReport(root);
}

/**
 * Reduce one parsed `pdfxyz.release-audit/1` `root` to the bounded {@link IngestedAudit}, reusing the tested
 * Phase 52 boundary (which re-runs the Phase 51 audit rollup over the audit's own findings). A non-object /
 * wrong-schema input is not recognized (⇒ an `unreadable` source); a recognized-but-self-inconsistent audit is
 * `usable = false` (⇒ a `tampered` source). Never throws / echoes.
 */
export function ingestAuditSource(root: unknown): IngestedAudit {
  return ingestAudit(root);
}

export type { IngestedReport } from "../release-trend/ingest";
export type { IngestedAudit } from "../release-report/ingest";

/* ------------------------------------------------------------------ *
 *  The bundle's three ingested sources
 * ------------------------------------------------------------------ */

/** One ingested source `I`, plus whether a file was SUPPLIED for it. */
export interface GovernanceSourceIngest<I> {
  /** True iff a `--trend` / `--report` / `--audit` input was provided for this slot. */
  readonly supplied: boolean;
  readonly ingested: I;
}

/** The three ingested sources the reducer + rollup fold. */
export interface IngestedGovernanceSources {
  readonly trend: GovernanceSourceIngest<IngestedTrend>;
  readonly report: GovernanceSourceIngest<IngestedReport>;
  readonly audit: GovernanceSourceIngest<IngestedAudit>;
}
