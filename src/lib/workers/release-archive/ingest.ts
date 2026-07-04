/**
 * Pure, node-free **record ingest** for the release evidence archive pack (Phase 55) — the trust boundary and
 * the no-leak core.
 *
 * The pack indexes up to five release-evidence outputs — a `pdfxyz.release-governance/1` bundle (PRIMARY window
 * posture), a `pdfxyz.release-trend/1` window summary, a latest `pdfxyz.release-report/1`, a latest
 * `pdfxyz.release-audit/1`, and a latest `pdfxyz.release-ci-bundle/1`. Even though each is already content-free,
 * every one is UNTRUSTED input here (a CI archive an operator points us at, a committed record, or a
 * hand-crafted / tampered file), and this module turns each parsed root into a bounded ingested shape, in the
 * same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a record. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance,
 *    stamps, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundaries.** The trend record reuses the Phase 54 {@link ingestTrend} (which re-runs the
 *    Phase 53 trend reduce + rollup); the report record reuses the Phase 53 {@link ingestReport} (which
 *    re-derives the report's Phase 52 recommendation); the audit record reuses the Phase 52 {@link ingestAudit}
 *    (which re-runs the Phase 51 audit rollup); the CI bundle record reuses the Phase 51 {@link ingestBundle}
 *    (which re-runs the Phase 50 bundle rollup). The governance record (new here) RECONSTRUCTS the governance
 *    bundle's own per-source postures and RE-RUNS the Phase 54 {@link computeCoverage} + {@link computeGovernanceRollup}
 *    over them, marking the governance `usable` only if the recorded coverage + verdict re-derive — so a
 *    hand-flipped verdict / lied coverage / hidden tampered source is caught as self-inconsistent.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` record);
 *    a recognized-but-inconsistent record is `recognized = true, usable = false` (⇒ a `tampered` record,
 *    blocking); a coherent record yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON GOVERNANCE DEPTH: a governance bundle's own record keeps only its bounded per-source POSTURES (each
 * source's coverage state + its usable-only verdict, never the underlying trend's raw points or the report's raw
 * stages) — it already reduced those away. So the DEEPEST self-consistency check available over a governance
 * bundle is reconstructing those per-source postures and re-deriving the coverage + verdict from them; that is
 * exactly what {@link computeCoverage} + {@link computeGovernanceRollup} read, so re-running them is faithful
 * tamper-evidence at this boundary (the governance SOURCE is the atom of a governance bundle, as the report was
 * of a trend at Phase 54 and the point of a trend at Phase 53). SAFETY of the stripped reconstruction:
 * {@link computeCoverage} reads ONLY each source's `supplied` / `usable` / `state`, and
 * {@link computeGovernanceRollup} reads ONLY each source's `state` / `verdict` (+ the trend source's
 * `facts.newest`, for the report ↔ trend cross-check) + the policy — never any other `facts` field — so filling
 * the other trend-facts fields with type-valid defaults cannot change the recompute (verified against
 * `release-governance/reduce.ts` + `release-governance/rollup.ts`; re-verify those field reads before trusting
 * this reconstruction).
 */

import { computeCoverage, sourceState } from "../release-governance/reduce";
import { computeGovernanceRollup } from "../release-governance/rollup";
import { ingestTrend } from "../release-governance/ingest";
import {
  RELEASE_GOVERNANCE_REASON_IDS,
  RELEASE_GOVERNANCE_SCHEMA,
  RELEASE_GOVERNANCE_SOURCE_STATES,
  RELEASE_GOVERNANCE_VERDICTS,
  type GovernanceTrendFacts,
  type ReleaseGovernanceCoverage,
  type ReleaseGovernancePolicy,
  type ReleaseGovernanceReasonId,
  type ReleaseGovernanceSource,
  type ReleaseGovernanceSourceState,
  type ReleaseGovernanceVerdict,
} from "../release-governance/types";
import type { IngestedTrend } from "../release-governance/ingest";
import { ingestReport, type IngestedReport } from "../release-trend/ingest";
import { ingestAudit, type IngestedAudit } from "../release-report/ingest";
import { ingestBundle } from "../release-audit/ingest";
import type { IngestedBundle } from "../release-audit/types";
import { RELEASE_TREND_VERDICTS, type ReleaseTrendVerdict } from "../release-trend/types";
import {
  RELEASE_REPORT_RECOMMENDATIONS,
  type ReleaseReportRecommendation,
} from "../release-report/types";
import { RELEASE_AUDIT_VERDICTS, type ReleaseAuditVerdict } from "../release-audit/types";
import type { ArchiveGovernanceFacts } from "./types";

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
 *  Governance record — reconstruct the bundle's per-source postures, re-run the Phase 54 coverage + rollup
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting a `pdfxyz.release-governance/1` document. */
export interface IngestedGovernance {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-governance/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded coverage + verdict RE-DERIVE from its own per-source postures. */
  readonly usable: boolean;
  /** The governance's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseGovernanceVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: ArchiveGovernanceFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-governance/1`. */
export const UNRECOGNIZED_GOVERNANCE: IngestedGovernance = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) governance, carrying only its untrusted claimed verdict. */
function inconsistentGovernance(verdict: ReleaseGovernanceVerdict | null): IngestedGovernance {
  return { recognized: true, usable: false, verdict, facts: null };
}

/** The recorded governance rollup fields the recompute must reproduce for the governance to be `usable`. */
interface RecordedGovernanceRollup {
  readonly verdict: ReleaseGovernanceVerdict;
  readonly exitCode: number;
  readonly healthy: boolean;
  readonly reasons: readonly ReleaseGovernanceReasonId[];
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly requireReport: boolean;
  readonly requireAudit: boolean;
  readonly strictWatch: boolean;
  readonly strictWatchEscalated: boolean;
}

/** Validate the governance `governance` rollup block into the bounded {@link RecordedGovernanceRollup}. */
function readGovernanceRollup(value: unknown): RecordedGovernanceRollup | undefined {
  if (!isObject(value)) return undefined;
  const verdict = oneOf(value.verdict, RELEASE_GOVERNANCE_VERDICTS);
  const exitCode = intOf(value.exitCode);
  const healthy = boolOf(value.healthy);
  const blocking = intOf(value.blocking);
  const insufficiencies = intOf(value.insufficiencies);
  const advisories = intOf(value.advisories);
  const requireReport = boolOf(value.requireReport);
  const requireAudit = boolOf(value.requireAudit);
  const strictWatch = boolOf(value.strictWatch);
  const strictWatchEscalated = boolOf(value.strictWatchEscalated);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    healthy === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    requireReport === undefined ||
    requireAudit === undefined ||
    strictWatch === undefined ||
    strictWatchEscalated === undefined ||
    !Array.isArray(value.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseGovernanceReasonId[] = [];
  for (const r of value.reasons) {
    const id = oneOf(r, RELEASE_GOVERNANCE_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    healthy,
    reasons,
    blocking,
    insufficiencies,
    advisories,
    requireReport,
    requireAudit,
    strictWatch,
    strictWatchEscalated,
  };
}

/** The recorded governance `coverage` block validated into a bounded {@link ReleaseGovernanceCoverage}. */
function readGovernanceCoverage(value: unknown): ReleaseGovernanceCoverage | undefined {
  if (!isObject(value)) return undefined;
  const sourcesSupplied = intOf(value.sourcesSupplied);
  const sourcesUsable = intOf(value.sourcesUsable);
  const trend = oneOf(value.trend, RELEASE_GOVERNANCE_SOURCE_STATES);
  const report = oneOf(value.report, RELEASE_GOVERNANCE_SOURCE_STATES);
  const audit = oneOf(value.audit, RELEASE_GOVERNANCE_SOURCE_STATES);
  const hasTrend = boolOf(value.hasTrend);
  const hasReport = boolOf(value.hasReport);
  const hasAudit = boolOf(value.hasAudit);
  if (
    sourcesSupplied === undefined ||
    sourcesUsable === undefined ||
    trend === undefined ||
    report === undefined ||
    audit === undefined ||
    hasTrend === undefined ||
    hasReport === undefined ||
    hasAudit === undefined
  ) {
    return undefined;
  }
  return { sourcesSupplied, sourcesUsable, trend, report, audit, hasTrend, hasReport, hasAudit };
}

/** The recorded governance `policy` block validated into a bounded {@link ReleaseGovernancePolicy}. */
function readGovernancePolicy(value: unknown): ReleaseGovernancePolicy | undefined {
  if (!isObject(value)) return undefined;
  const requireReport = boolOf(value.requireReport);
  const requireAudit = boolOf(value.requireAudit);
  const strictWatch = boolOf(value.strictWatch);
  if (requireReport === undefined || requireAudit === undefined || strictWatch === undefined) {
    return undefined;
  }
  return { requireReport, requireAudit, strictWatch };
}

/** The per-source verdict ladders, keyed by governance source id, used to validate a recorded source's posture. */
const SOURCE_VERDICTS: Record<"trend" | "report" | "audit", readonly string[]> = {
  trend: RELEASE_TREND_VERDICTS,
  report: RELEASE_REPORT_RECOMMENDATIONS,
  audit: RELEASE_AUDIT_VERDICTS,
};

/**
 * Reconstruct one recorded governance source at `index` into the minimal {@link ReleaseGovernanceSource} the
 * Phase 54 coverage + rollup read. Returns `undefined` if the source is malformed, out of position, off-enum, or
 * internally inconsistent (its `state` does not derive from its supplied / recognized / usable flags), any of
 * which is a corrupt / tampered governance bundle. Only the load-bearing fields (`state`, `supplied`, `usable`,
 * `verdict`, and — for the trend — `facts.newest`) are reconstructed faithfully; `severity` / `detail` are
 * type-valid filler never read by the recompute.
 */
function reconstructGovernanceSource(raw: unknown, index: number): ReleaseGovernanceSource | undefined {
  const order = ["trend", "report", "audit"] as const;
  const id = order[index];
  if (id === undefined) return undefined; // more than three sources ⇒ corrupt
  if (!isObject(raw) || raw.id !== id) return undefined;

  const state = oneOf(raw.state, RELEASE_GOVERNANCE_SOURCE_STATES);
  const supplied = boolOf(raw.supplied);
  const recognized = boolOf(raw.recognized);
  const usable = boolOf(raw.usable);
  if (state === undefined || supplied === undefined || recognized === undefined || usable === undefined) {
    return undefined;
  }
  // The recorded state MUST derive from its own supplied / recognized / usable flags (the Phase 54 reduce rule).
  if (state !== sourceState(supplied, recognized, usable)) return undefined;

  // The verdict is null, or one of the source's own bounded verdict tokens; anything else is corrupt.
  let verdict: string | null;
  if (raw.verdict === null) verdict = null;
  else {
    const v = oneOf(raw.verdict, SOURCE_VERDICTS[id]);
    if (v === undefined) return undefined;
    verdict = v;
  }

  if (id === "trend") {
    // Only the trend's `facts.newest` is read by the recompute; reconstruct it faithfully for a usable trend.
    let facts: GovernanceTrendFacts | null = null;
    if (state === "usable") {
      if (!isObject(raw.facts)) return undefined;
      const newest = recommendationOrNull(raw.facts.newest);
      if (newest === undefined) return undefined;
      facts = trendFactsFiller(verdict as ReleaseTrendVerdict | null, newest);
    }
    return baseSource("trend", state, supplied, recognized, usable, verdict, facts);
  }
  return baseSource(id, state, supplied, recognized, usable, verdict, null);
}

/** Build a minimal, type-safe {@link ReleaseGovernanceSource} (severity / detail are unread filler). */
function baseSource(
  id: "trend" | "report" | "audit",
  state: ReleaseGovernanceSourceState,
  supplied: boolean,
  recognized: boolean,
  usable: boolean,
  verdict: string | null,
  facts: GovernanceTrendFacts | null,
): ReleaseGovernanceSource {
  const common = { state, supplied, recognized, usable, verdict, severity: null, detail: "" } as const;
  switch (id) {
    case "trend":
      return { id, ...common, facts };
    case "report":
      return { id, ...common, facts: null };
    case "audit":
      return { id, ...common, facts: null };
  }
}

/**
 * A type-valid {@link GovernanceTrendFacts} whose only load-bearing field is `newest` (the recompute reads
 * nothing else); every other field is a deterministic filler.
 */
function trendFactsFiller(
  verdict: ReleaseTrendVerdict | null,
  newest: ReleaseReportRecommendation | null,
): GovernanceTrendFacts {
  return {
    verdict: verdict ?? "stable",
    exitCode: 0,
    stable: verdict === "stable",
    reportsUsable: 0,
    reportsConsidered: 0,
    newest,
    oldest: null,
    direction: "n/a",
    blocking: 0,
    insufficiencies: 0,
    advisories: 0,
  };
}

/** The governance bundle's own usable-only per-source postures (for the archive cross-checks). */
function usableVerdict(source: ReleaseGovernanceSource): string | null {
  return source.state === "usable" ? source.verdict : null;
}

/** Compare two `ReleaseGovernanceReasonId` lists as sets (order-independent, exact membership). */
function sameReasons(a: readonly ReleaseGovernanceReasonId[], b: readonly ReleaseGovernanceReasonId[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((id) => set.has(id));
}

/** Whether the recorded coverage equals the re-derived coverage on every field. */
function sameCoverage(a: ReleaseGovernanceCoverage, b: ReleaseGovernanceCoverage): boolean {
  return (
    a.sourcesSupplied === b.sourcesSupplied &&
    a.sourcesUsable === b.sourcesUsable &&
    a.trend === b.trend &&
    a.report === b.report &&
    a.audit === b.audit &&
    a.hasTrend === b.hasTrend &&
    a.hasReport === b.hasReport &&
    a.hasAudit === b.hasAudit
  );
}

/**
 * Reduce one parsed `pdfxyz.release-governance/1` `root` to the bounded {@link IngestedGovernance}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_GOVERNANCE}. For a recognized bundle it reconstructs
 * the three per-source postures (trend / report / audit), RE-RUNS the Phase 54 {@link computeCoverage} +
 * {@link computeGovernanceRollup} over them, and marks the bundle `usable` only if the recorded coverage
 * (per-source states + counts) and the recorded verdict (verdict, exit code, healthy flag, reason set,
 * blocking / insufficiency / advisory counts, require / strict flags, escalation flag) equal the re-derived ones
 * — so a hand-flipped verdict / lied coverage / hidden source is caught. Never throws and never echoes the input.
 */
export function ingestGovernance(root: unknown): IngestedGovernance {
  if (!isObject(root) || root.schema !== RELEASE_GOVERNANCE_SCHEMA) return UNRECOGNIZED_GOVERNANCE;

  const rollupObj = isObject(root.governance) ? root.governance : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.verdict, RELEASE_GOVERNANCE_VERDICTS) ?? null) : null;

  const recordedRollup = readGovernanceRollup(root.governance);
  const recordedCoverage = readGovernanceCoverage(root.coverage);
  const policy = readGovernancePolicy(root.policy);
  if (recordedRollup === undefined || recordedCoverage === undefined || policy === undefined) {
    return inconsistentGovernance(claimed);
  }
  if (!Array.isArray(root.records) && !Array.isArray(root.sources)) {
    return inconsistentGovernance(recordedRollup.verdict);
  }
  // The governance bundle records its three sources under `sources`.
  const rawSources = root.sources;
  if (!Array.isArray(rawSources) || rawSources.length !== 3) return inconsistentGovernance(recordedRollup.verdict);

  const trend = reconstructGovernanceSource(rawSources[0], 0);
  const report = reconstructGovernanceSource(rawSources[1], 1);
  const audit = reconstructGovernanceSource(rawSources[2], 2);
  if (trend === undefined || report === undefined || audit === undefined) {
    return inconsistentGovernance(recordedRollup.verdict);
  }

  // Re-derive the coverage + verdict from the reconstructed postures, exactly as the Phase 54 CLI did.
  const rederivedCoverage = computeCoverage(trend, report, audit);
  const { rollup: rederivedRollup } = computeGovernanceRollup({ trend, report, audit }, policy);

  const consistent =
    sameCoverage(recordedCoverage, rederivedCoverage) &&
    rederivedRollup.verdict === recordedRollup.verdict &&
    rederivedRollup.exitCode === recordedRollup.exitCode &&
    rederivedRollup.healthy === recordedRollup.healthy &&
    rederivedRollup.blocking === recordedRollup.blocking &&
    rederivedRollup.insufficiencies === recordedRollup.insufficiencies &&
    rederivedRollup.advisories === recordedRollup.advisories &&
    rederivedRollup.requireReport === recordedRollup.requireReport &&
    rederivedRollup.requireAudit === recordedRollup.requireAudit &&
    rederivedRollup.strictWatch === recordedRollup.strictWatch &&
    rederivedRollup.strictWatchEscalated === recordedRollup.strictWatchEscalated &&
    sameReasons(rederivedRollup.reasons, recordedRollup.reasons);
  if (!consistent) return inconsistentGovernance(recordedRollup.verdict);

  const facts: ArchiveGovernanceFacts = {
    verdict: recordedRollup.verdict,
    exitCode: recordedRollup.exitCode,
    healthy: recordedRollup.healthy,
    sourcesSupplied: rederivedCoverage.sourcesSupplied,
    sourcesUsable: rederivedCoverage.sourcesUsable,
    trendVerdict: usableVerdict(trend) as ReleaseTrendVerdict | null,
    reportVerdict: usableVerdict(report) as ReleaseReportRecommendation | null,
    auditVerdict: usableVerdict(audit) as ReleaseAuditVerdict | null,
    blocking: recordedRollup.blocking,
    insufficiencies: recordedRollup.insufficiencies,
    advisories: recordedRollup.advisories,
  };
  return { recognized: true, usable: true, verdict: recordedRollup.verdict, facts };
}

/* ------------------------------------------------------------------ *
 *  Related records — reuse the Phase 51 / 52 / 53 / 54 boundaries verbatim
 * ------------------------------------------------------------------ */

/**
 * Reduce one parsed `pdfxyz.release-trend/1` `root` to the bounded {@link IngestedTrend}, reusing the tested
 * Phase 54 boundary (which re-runs the Phase 53 trend reduce + rollup over its own points). A non-object /
 * wrong-schema input is not recognized (⇒ an `unreadable` record); a recognized-but-self-inconsistent trend is
 * `usable = false` (⇒ a `tampered` record). Never throws / echoes.
 */
export function ingestTrendRecord(root: unknown): IngestedTrend {
  return ingestTrend(root);
}

/**
 * Reduce one parsed `pdfxyz.release-report/1` `root` to the bounded {@link IngestedReport}, reusing the tested
 * Phase 53 boundary (which re-derives the report's Phase 52 recommendation from its own sources). Never throws /
 * echoes.
 */
export function ingestReportRecord(root: unknown): IngestedReport {
  return ingestReport(root);
}

/**
 * Reduce one parsed `pdfxyz.release-audit/1` `root` to the bounded {@link IngestedAudit}, reusing the tested
 * Phase 52 boundary (which re-runs the Phase 51 audit rollup over the audit's own findings). Never throws /
 * echoes.
 */
export function ingestAuditRecord(root: unknown): IngestedAudit {
  return ingestAudit(root);
}

/**
 * Reduce one parsed `pdfxyz.release-ci-bundle/1` `root` to the bounded {@link IngestedBundle}, reusing the tested
 * Phase 51 boundary (which reconstructs the bundle's stages + links and re-runs the Phase 50 rollup). Never
 * throws / echoes.
 */
export function ingestBundleRecord(root: unknown): IngestedBundle {
  return ingestBundle(root);
}

export type { IngestedTrend } from "../release-governance/ingest";
export type { IngestedReport } from "../release-trend/ingest";
export type { IngestedAudit } from "../release-report/ingest";
export type { IngestedBundle } from "../release-audit/types";

/* ------------------------------------------------------------------ *
 *  The pack's five ingested records
 * ------------------------------------------------------------------ */

/** One ingested record `I`, plus whether a file was SUPPLIED for it. */
export interface ArchiveRecordIngest<I> {
  /** True iff a `--governance` / `--trend` / `--report` / `--audit` / `--bundle` input was provided. */
  readonly supplied: boolean;
  readonly ingested: I;
}

/** The five ingested records the reducer + rollup fold. */
export interface IngestedArchiveRecords {
  readonly governance: ArchiveRecordIngest<IngestedGovernance>;
  readonly trend: ArchiveRecordIngest<IngestedTrend>;
  readonly report: ArchiveRecordIngest<IngestedReport>;
  readonly audit: ArchiveRecordIngest<IngestedAudit>;
  readonly bundle: ArchiveRecordIngest<IngestedBundle>;
}
