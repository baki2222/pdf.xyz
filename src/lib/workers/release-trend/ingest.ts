/**
 * Pure, node-free **report ingest** for the release evidence trend summary (Phase 53) — the trust boundary and
 * the no-leak core.
 *
 * The trend summarizes a bounded history of `pdfxyz.release-report/1` operator reports. Even though each report
 * is already content-free, every one is UNTRUSTED input here (a CI archive an operator points us at, a committed
 * record, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded ingested
 * shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a report. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance,
 *    the report's OWN stamp, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundary.** It RE-RUNS the Phase 52 {@link computeReportRecommendation} over the
 *    report's OWN recorded sources (each source's bounded `state` + `verdict`) + its recorded `strict` flag, and
 *    marks the report `usable` only if the recorded recommendation (recommendation, exit code, ready flag,
 *    blocking / insufficiency / advisory counts, rationale set, strict-escalated flag) re-derives — so a
 *    hand-flipped recommendation / lied count / hidden rationale on a report is caught as self-inconsistent.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` report);
 *    a recognized-but-inconsistent report is `recognized = true, usable = false` (⇒ a `tampered` report,
 *    blocking); a coherent report yields reduced bounded facts. The offending content is never echoed.
 *
 * A NOTE ON DEPTH: a report's own sources record only the bounded posture of the bundle / audit it composed
 * (their verdicts + counts), not the raw stages / regressions — the report already reduced those away. So the
 * DEEPEST self-consistency check available over a report is re-deriving its RECOMMENDATION from its own recorded
 * (state, verdict, strict); that is exactly what the Phase 52 reducer reads, so re-running it is faithful
 * tamper-evidence at this boundary (the report is the atom of evidence here, as the bundle was at Phase 51).
 */

import { computeReportRecommendation } from "../release-report/rollup";
import {
  RELEASE_REPORT_RATIONALE_IDS,
  RELEASE_REPORT_RECOMMENDATIONS,
  RELEASE_REPORT_SCHEMA,
  RELEASE_REPORT_SOURCE_STATES,
  type ReleaseReportRationaleId,
  type ReleaseReportRecommendation,
  type ReleaseReportSource,
  type ReleaseReportSourceState,
} from "../release-report/types";
import { RELEASE_CI_BUNDLE_VERDICTS } from "../release-ci-bundle/types";
import { RELEASE_AUDIT_VERDICTS } from "../release-audit/types";
import type { TrendReportFacts } from "./types";

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

/** The two source ids the report records, and the verdict ladders each is validated against. */
const BUNDLE_VERDICTS: readonly string[] = RELEASE_CI_BUNDLE_VERDICTS;
const AUDIT_VERDICTS: readonly string[] = RELEASE_AUDIT_VERDICTS;

/** The bounded outcome of ingesting a `pdfxyz.release-report/1` document. */
export interface IngestedReport {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-report/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded recommendation RE-DERIVES from its own sources + strict (self-consistent). */
  readonly usable: boolean;
  /** The report's recorded recommendation (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly recommendation: ReleaseReportRecommendation | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: TrendReportFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-report/1`. */
export const UNRECOGNIZED_REPORT: IngestedReport = {
  recognized: false,
  usable: false,
  recommendation: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) report, carrying only its untrusted claimed recommendation. */
function inconsistentReport(recommendation: ReleaseReportRecommendation | null): IngestedReport {
  return { recognized: true, usable: false, recommendation, facts: null };
}

/**
 * Reconstruct one report source (bundle / audit) into the minimal {@link ReleaseReportSource} the Phase 52
 * recommendation reducer reads. Returns `undefined` if the recorded `state` / `verdict` is off-enum (⇒ a
 * corrupt / tampered report).
 *
 * SAFETY of the stripped reconstruction: {@link computeReportRecommendation} (via `deriveRationale` /
 * `usableVerdictIs`) reads ONLY each source's `state` and `verdict` — never `severity`, `facts`, `detail`,
 * `supplied`, `recognized`, or `usable`. So filling those with derived defaults cannot change the recompute; the
 * load-bearing fields (`state`, `verdict`) are read faithfully from the report's own record. (Verified against
 * `release-report/rollup.ts` — re-verify those field reads before trusting this reconstruction.)
 */
function reconstructSource(
  id: "bundle" | "audit",
  raw: unknown,
  verdicts: readonly string[],
): ReleaseReportSource | undefined {
  if (!isObject(raw) || raw.id !== id) return undefined;
  const state = oneOf(raw.state, RELEASE_REPORT_SOURCE_STATES);
  if (state === undefined) return undefined;
  // The verdict is null, or one of the source's own bounded verdict tokens; anything else is corrupt.
  let verdict: string | null;
  if (raw.verdict === null) verdict = null;
  else if (typeof raw.verdict === "string" && verdicts.includes(raw.verdict)) verdict = raw.verdict;
  else return undefined;
  return sourceFrom(id, state, verdict);
}

/** Build a minimal, type-safe {@link ReleaseReportSource} from its two load-bearing fields (+ derived filler). */
function sourceFrom(
  id: "bundle" | "audit",
  state: ReleaseReportSourceState,
  verdict: string | null,
): ReleaseReportSource {
  const supplied = state !== "absent";
  const recognized = state !== "absent" && state !== "unreadable";
  const usable = state === "usable";
  // `facts: null` and `severity: null` are valid for both union members and are never read by the recompute.
  return { id, state, supplied, recognized, usable, verdict, severity: null, facts: null, detail: "" };
}

/** Compare two rationale-id lists as sets (order-independent, exact membership). */
function sameRationale(
  a: readonly ReleaseReportRationaleId[],
  b: readonly ReleaseReportRationaleId[],
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((id) => set.has(id));
}

/** The recorded report-recommendation fields the recompute must reproduce for the report to be `usable`. */
interface RecordedRecommendation {
  readonly recommendation: ReleaseReportRecommendation;
  readonly exitCode: number;
  readonly ready: boolean;
  readonly rationale: readonly ReleaseReportRationaleId[];
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly strict: boolean;
  readonly strictEscalated: boolean;
}

/** Validate the report's `recommendation` block into the bounded {@link RecordedRecommendation}, or `undefined`. */
function readRecordedRecommendation(rollup: Obj): RecordedRecommendation | undefined {
  const recommendation = oneOf(rollup.recommendation, RELEASE_REPORT_RECOMMENDATIONS);
  const exitCode = intOf(rollup.exitCode);
  const ready = boolOf(rollup.ready);
  const blocking = intOf(rollup.blocking);
  const insufficiencies = intOf(rollup.insufficiencies);
  const advisories = intOf(rollup.advisories);
  const strict = boolOf(rollup.strict);
  const strictEscalated = boolOf(rollup.strictEscalated);
  if (
    recommendation === undefined ||
    exitCode === undefined ||
    ready === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    strict === undefined ||
    strictEscalated === undefined ||
    !Array.isArray(rollup.rationale)
  ) {
    return undefined;
  }
  const rationale: ReleaseReportRationaleId[] = [];
  for (const r of rollup.rationale) {
    const id = oneOf(r, RELEASE_REPORT_RATIONALE_IDS);
    if (id === undefined) return undefined; // an off-enum rationale is a corrupt record
    rationale.push(id);
  }
  return {
    recommendation,
    exitCode,
    ready,
    rationale,
    blocking,
    insufficiencies,
    advisories,
    strict,
    strictEscalated,
  };
}

/**
 * Reduce one parsed `pdfxyz.release-report/1` `root` to the bounded {@link IngestedReport}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_REPORT}. For a recognized report it reconstructs the
 * two sources (bundle + audit) from the report's OWN recorded `state` + `verdict`, RE-RUNS the Phase 52
 * {@link computeReportRecommendation} over them with the report's recorded `strict`, and marks the report
 * `usable` only if the recorded recommendation equals the re-derived one in every load-bearing field — so a
 * hand-flipped recommendation / lied count / hidden rationale is caught. Never throws and never echoes the input.
 */
export function ingestReport(root: unknown): IngestedReport {
  if (!isObject(root) || root.schema !== RELEASE_REPORT_SCHEMA) return UNRECOGNIZED_REPORT;

  const rollupObj = isObject(root.recommendation) ? root.recommendation : undefined;
  const claimed = rollupObj ? (oneOf(rollupObj.recommendation, RELEASE_REPORT_RECOMMENDATIONS) ?? null) : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the
  // claimed recommendation surfaced (untrusted) so the trend can show what the report asserted.
  if (rollupObj === undefined) return inconsistentReport(claimed);
  const recorded = readRecordedRecommendation(rollupObj);
  if (recorded === undefined) return inconsistentReport(claimed);

  if (!Array.isArray(root.sources)) return inconsistentReport(recorded.recommendation);
  const bundleRaw = root.sources.find((s) => isObject(s) && (s as Obj).id === "bundle");
  const auditRaw = root.sources.find((s) => isObject(s) && (s as Obj).id === "audit");
  const bundle = reconstructSource("bundle", bundleRaw, BUNDLE_VERDICTS);
  const audit = reconstructSource("audit", auditRaw, AUDIT_VERDICTS);
  if (bundle === undefined || audit === undefined) return inconsistentReport(recorded.recommendation);

  // Re-derive the composite recommendation from the report's OWN reconstructed sources + recorded strict flag,
  // exactly as the Phase 52 CLI did, and require the recorded rollup to match in every load-bearing field.
  const { rollup: rederived } = computeReportRecommendation({ bundle, audit }, recorded.strict);
  const consistent =
    rederived.recommendation === recorded.recommendation &&
    rederived.exitCode === recorded.exitCode &&
    rederived.ready === recorded.ready &&
    rederived.blocking === recorded.blocking &&
    rederived.insufficiencies === recorded.insufficiencies &&
    rederived.advisories === recorded.advisories &&
    rederived.strictEscalated === recorded.strictEscalated &&
    sameRationale(rederived.rationale, recorded.rationale);
  if (!consistent) return inconsistentReport(recorded.recommendation);

  const facts: TrendReportFacts = {
    recommendation: rederived.recommendation,
    exitCode: rederived.exitCode,
    ready: rederived.ready,
    blocking: rederived.blocking,
    insufficiencies: rederived.insufficiencies,
    advisories: rederived.advisories,
    // Derive coverage from the reconstructed source states (never trust the report's own coverage claim).
    hasBundle: bundle.state === "usable",
    hasAudit: audit.state === "usable",
    strict: rederived.strict,
  };
  return { recognized: true, usable: true, recommendation: rederived.recommendation, facts };
}

/** One ingested report, plus whether a file was SUPPLIED for it (always true for a real input slot). */
export interface ReportIngest {
  /** True iff a `--report` / `--file` / stdin element was provided for this slot. */
  readonly supplied: boolean;
  readonly ingested: IngestedReport;
}
