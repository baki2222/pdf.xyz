/**
 * Pure, node-free **reducer** for the release evidence operator report (Phase 52).
 *
 * Turns each ingested source (the trust boundary's output) plus whether a file was supplied for it into the
 * bounded, content-free {@link ReleaseReportSource} the result records and the rollup folds. It derives only
 * bounded fields — the coverage state, the common-ladder severity, a one-line authored headline, and safe
 * defaults for a not-usable / not-supplied source — and never reaches past the already-reduced facts, so there
 * is nowhere for a locator or a byte to enter.
 */

import type { ReleaseCiBundleVerdict } from "../release-ci-bundle/types";
import type { ReleaseAuditVerdict } from "../release-audit/types";
import type { IngestedAudit, IngestedBundle, SourceIngest } from "./ingest";
import {
  type BundleSourceFacts,
  type ReleaseReportCoverage,
  type ReleaseReportSeverity,
  type ReleaseReportSource,
  type ReleaseReportSourceState,
} from "./types";

/** A usable bundle's coherence verdict → common report severity. */
const BUNDLE_SEVERITY: Record<ReleaseCiBundleVerdict, ReleaseReportSeverity> = {
  pass: "ready",
  warn: "advisory",
  unknown: "insufficient",
  fail: "blocking",
};

/** A usable audit's regression verdict → common report severity. */
const AUDIT_SEVERITY: Record<ReleaseAuditVerdict, ReleaseReportSeverity> = {
  pass: "ready",
  warn: "advisory",
  unknown: "insufficient",
  fail: "blocking",
};

/** The coverage state of a source from its supplied / recognized / usable flags. */
export function sourceState(
  supplied: boolean,
  recognized: boolean,
  usable: boolean,
): ReleaseReportSourceState {
  if (!supplied) return "absent";
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** The common-ladder severity contribution of a source, given its state + (usable-only) verdict severity. */
function severityForState(
  state: ReleaseReportSourceState,
  usableSeverity: ReleaseReportSeverity | null,
): ReleaseReportSeverity | null {
  switch (state) {
    case "absent":
      return null; // no evidence supplied ⇒ no severity contribution (the rollup handles missing coherence)
    case "unreadable":
      return "insufficient";
    case "tampered":
      return "blocking";
    case "usable":
      return usableSeverity;
  }
}

/** A one-line, content-free headline authored from the source id + state + verdict. */
function sourceDetail(id: "bundle" | "audit", state: ReleaseReportSourceState, verdict: string | null): string {
  const label = id === "bundle" ? "release CI bundle" : "release audit";
  switch (state) {
    case "absent":
      return `${id}: no ${label} supplied.`;
    case "unreadable":
      return `${id}: supplied, but not a recognized ${label} (unreadable — never echoed). It certifies no evidence.`;
    case "tampered":
      return `${id}: recognized, but its recorded rollup does NOT re-derive from its own facts (tampered / corrupt — treated as a blocking failure). Claimed verdict: ${verdict ?? "n/a"}.`;
    case "usable":
      return `${id}: ${verdict ?? "n/a"} (a self-consistent ${label}).`;
  }
}

/** Reduce the ingested bundle source to the bounded {@link ReleaseReportSource}. */
export function reduceBundleSource(source: SourceIngest<IngestedBundle>): ReleaseReportSource {
  const { supplied, ingested } = source;
  const recognized = ingested.recognized;
  const usable = supplied && ingested.usable;
  const state = sourceState(supplied, recognized, usable);
  // Trusted verdict + facts only from a usable bundle; a tampered bundle surfaces its untrusted claimed verdict.
  const verdict = supplied ? (ingested.facts?.verdict ?? null) : null;
  const usableSeverity = state === "usable" && verdict !== null ? BUNDLE_SEVERITY[verdict] : null;
  const facts: BundleSourceFacts | null =
    state === "usable" && ingested.facts !== null
      ? {
          verdict: ingested.facts.verdict as ReleaseCiBundleVerdict,
          exitCode: ingested.facts.exitCode,
          stagesPresent: ingested.facts.stagesPresent,
          chainComplete: ingested.facts.chainComplete,
          decisionStage: ingested.facts.decisionStage,
          inconsistencies: ingested.facts.inconsistencies,
          warningSignals: ingested.facts.warningSignals,
          archiveVerdict: ingested.facts.archiveVerdict,
        }
      : null;
  return {
    id: "bundle",
    state,
    supplied,
    recognized,
    usable,
    verdict,
    severity: severityForState(state, usableSeverity),
    facts,
    detail: sourceDetail("bundle", state, verdict),
  };
}

/** Reduce the ingested audit source to the bounded {@link ReleaseReportSource}. */
export function reduceAuditSource(source: SourceIngest<IngestedAudit>): ReleaseReportSource {
  const { supplied, ingested } = source;
  const recognized = ingested.recognized;
  const usable = supplied && ingested.usable;
  const state = sourceState(supplied, recognized, usable);
  const verdict = supplied ? ingested.verdict : null;
  const usableSeverity = state === "usable" && verdict !== null ? AUDIT_SEVERITY[verdict] : null;
  const facts = state === "usable" ? ingested.facts : null;
  return {
    id: "audit",
    state,
    supplied,
    recognized,
    usable,
    verdict,
    severity: severityForState(state, usableSeverity),
    facts,
    detail: sourceDetail("audit", state, verdict),
  };
}

/** Fold the two reduced sources into the bounded coverage summary. */
export function computeCoverage(
  bundle: ReleaseReportSource,
  audit: ReleaseReportSource,
): ReleaseReportCoverage {
  const suppliedCount = (bundle.supplied ? 1 : 0) + (audit.supplied ? 1 : 0);
  const usableCount = (bundle.usable ? 1 : 0) + (audit.usable ? 1 : 0);
  return {
    sourcesSupplied: suppliedCount,
    sourcesUsable: usableCount,
    bundle: bundle.state,
    audit: audit.state,
    hasBundle: bundle.usable,
    hasAudit: audit.usable,
  };
}
