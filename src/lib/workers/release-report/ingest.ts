/**
 * Pure, node-free **document ingest** for the release evidence operator report (Phase 52) — the trust
 * boundary and the no-leak core.
 *
 * The report composes up to two release-evidence composite outputs — a `pdfxyz.release-ci-bundle/1` and a
 * `pdfxyz.release-audit/1`. Even though each is already content-free, every one is UNTRUSTED input here (a CI
 * archive an operator points us at, a committed record, or a hand-crafted / tampered file), and this module
 * turns each parsed root into a bounded ingested shape, in the same paranoid spirit as the rest of the worker
 * ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of a document. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, caveats, guidance,
 *    stamps, and any stray extra field are all DROPPED.
 *  - **Reuse the tested boundaries.** The bundle source reuses the Phase 51 {@link ingestBundle} (which
 *    reconstructs the bundle's stages + links and RE-RUNS the Phase 50 rollup, marking it `usable` only if the
 *    recorded rollup re-derives). The audit source RE-RUNS the Phase 51 {@link computeAuditRollup} over the
 *    audit's own recorded regression findings + policy, and marks it `usable` only if the recorded rollup
 *    re-derives — so a hand-flipped verdict on either document is caught as self-inconsistent.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` source);
 *    a recognized-but-inconsistent document is `recognized = true, usable = false` (⇒ a `tampered` source,
 *    blocking); a coherent document yields reduced bounded facts. The offending content is never echoed.
 */

import { ingestBundle } from "../release-audit/ingest";
import { computeAuditRollup } from "../release-audit/rollup";
import {
  RELEASE_AUDIT_FINDING_STATUSES,
  RELEASE_AUDIT_MODES,
  RELEASE_AUDIT_REGRESSIONS,
  RELEASE_AUDIT_SCHEMA,
  RELEASE_AUDIT_SEVERITIES,
  RELEASE_AUDIT_VERDICTS,
  type AuditPolicy,
  type AuditRegressionFinding,
  type IngestedBundle,
  type ReleaseAuditRegressionId,
  type ReleaseAuditVerdict,
} from "../release-audit/types";
import { RELEASE_CI_BUNDLE_VERDICTS, type ReleaseCiBundleVerdict } from "../release-ci-bundle/types";
import type { AuditSourceFacts } from "./types";

export type { IngestedBundle } from "../release-audit/types";

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

/** A strict safe integer of any sign (for a signed delta), or `undefined`. */
function signedIntOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/** Strictly `true` or `false`, or `undefined`. */
function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/* ------------------------------------------------------------------ *
 *  Bundle source — reuse the Phase 51 bundle ingest (re-derives the bundle's rollup)
 * ------------------------------------------------------------------ */

/**
 * Reduce one parsed `pdfxyz.release-ci-bundle/1` `root` to the bounded {@link IngestedBundle}, reusing the
 * tested Phase 51 boundary. A non-object / wrong-schema input is not recognized (⇒ an `unreadable` source); a
 * recognized-but-self-inconsistent bundle is `usable = false` (⇒ a `tampered` source); a coherent bundle
 * yields reduced bounded facts (its verdict re-derived from its own stages + links). Never throws / echoes.
 */
export function ingestBundleSource(root: unknown): IngestedBundle {
  return ingestBundle(root);
}

/* ------------------------------------------------------------------ *
 *  Audit source — RE-RUN the Phase 51 audit rollup over the document's own findings + policy
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting a `pdfxyz.release-audit/1` result. */
export interface IngestedAudit {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-audit/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded rollup RE-DERIVES from its own findings + policy (self-consistent). */
  readonly usable: boolean;
  /** The audit's recorded rollup verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleaseAuditVerdict | null;
  /** The bounded reduced facts (present only when usable; `null` otherwise). */
  readonly facts: AuditSourceFacts | null;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-audit/1`. */
export const UNRECOGNIZED_AUDIT: IngestedAudit = {
  recognized: false,
  usable: false,
  verdict: null,
  facts: null,
};

/** A recognized-but-inconsistent (tampered) audit, carrying only its untrusted claimed verdict. */
function inconsistentAudit(verdict: ReleaseAuditVerdict | null): IngestedAudit {
  return { recognized: true, usable: false, verdict, facts: null };
}

/** Validate the audit's `policy` block into a bounded {@link AuditPolicy}, or `undefined` if malformed. */
function auditPolicyOf(value: unknown): AuditPolicy | undefined {
  if (!isObject(value)) return undefined;
  const allowWarnRegression = boolOf(value.allowWarnRegression);
  const maxNewWarnings = intOf(value.maxNewWarnings);
  const failOnUnknown = boolOf(value.failOnUnknown);
  if (allowWarnRegression === undefined || maxNewWarnings === undefined || failOnUnknown === undefined) {
    return undefined;
  }
  return { allowWarnRegression, maxNewWarnings, failOnUnknown };
}

/**
 * Reconstruct the audit's regression findings from its recorded `regressions[]`, validated in canonical order.
 * Returns `undefined` if the array is the wrong length, an id is off-order, or a status / severity is invalid
 * (⇒ a corrupt / tampered audit). The authored `detail` is irrelevant to the rollup recompute, so it is
 * reconstructed as an empty string (never read from the input).
 */
function reconstructFindings(raw: unknown): AuditRegressionFinding[] | undefined {
  if (!Array.isArray(raw) || raw.length !== RELEASE_AUDIT_REGRESSIONS.length) return undefined;
  const findings: AuditRegressionFinding[] = [];
  for (let i = 0; i < RELEASE_AUDIT_REGRESSIONS.length; i++) {
    const entry = raw[i];
    const expected = RELEASE_AUDIT_REGRESSIONS[i]!;
    if (!isObject(entry) || entry.id !== expected) return undefined;
    const status = oneOf(entry.status, RELEASE_AUDIT_FINDING_STATUSES);
    const severity = oneOf(entry.severity, RELEASE_AUDIT_SEVERITIES);
    if (status === undefined || severity === undefined) return undefined;
    findings.push({ id: expected, status, severity, detail: "" });
  }
  return findings;
}

/** Compare two regression-id lists as sets (order-independent, exact membership). */
function sameDrivers(
  a: readonly ReleaseAuditRegressionId[],
  b: readonly ReleaseAuditRegressionId[],
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((d) => set.has(d));
}

/** The recorded audit rollup fields the recompute must reproduce for the audit to be `usable`. */
function readRecordedAuditRollup(rollup: Obj):
  | {
      verdict: ReleaseAuditVerdict;
      exitCode: number;
      blockingRegressions: number;
      warningRegressions: number;
      comparable: boolean;
      drivers: ReleaseAuditRegressionId[];
    }
  | undefined {
  const verdict = oneOf(rollup.verdict, RELEASE_AUDIT_VERDICTS);
  const exitCode = intOf(rollup.exitCode);
  const blockingRegressions = intOf(rollup.blockingRegressions);
  const warningRegressions = intOf(rollup.warningRegressions);
  const comparable = boolOf(rollup.comparable);
  if (
    verdict === undefined ||
    exitCode === undefined ||
    blockingRegressions === undefined ||
    warningRegressions === undefined ||
    comparable === undefined ||
    !Array.isArray(rollup.drivers)
  ) {
    return undefined;
  }
  const drivers: ReleaseAuditRegressionId[] = [];
  for (const d of rollup.drivers) {
    const id = oneOf(d, RELEASE_AUDIT_REGRESSIONS);
    if (id === undefined) return undefined; // an off-enum driver is a corrupt rollup
    drivers.push(id);
  }
  return { verdict, exitCode, blockingRegressions, warningRegressions, comparable, drivers };
}

/** Extract the bounded, display-only context facts from a self-consistent audit (never load-bearing). */
function auditContextFacts(root: Obj): {
  baselineVerdict: ReleaseCiBundleVerdict | null;
  currentVerdict: ReleaseCiBundleVerdict | null;
  postureRankDelta: number | null;
} {
  const baseline = isObject(root.baseline) ? root.baseline : undefined;
  const current = isObject(root.current) ? root.current : undefined;
  const comparison = isObject(root.comparison) ? root.comparison : undefined;
  return {
    baselineVerdict: baseline ? (oneOf(baseline.verdict, RELEASE_CI_BUNDLE_VERDICTS) ?? null) : null,
    currentVerdict: current ? (oneOf(current.verdict, RELEASE_CI_BUNDLE_VERDICTS) ?? null) : null,
    postureRankDelta: comparison ? (signedIntOf(comparison.postureRankDelta) ?? null) : null,
  };
}

/**
 * Reduce one parsed `pdfxyz.release-audit/1` `root` to the bounded {@link IngestedAudit}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_AUDIT}. For a recognized audit it reconstructs the
 * regression findings + policy, RE-RUNS the Phase 51 {@link computeAuditRollup} over them, and marks the audit
 * `usable` only if the recorded rollup (verdict, exit code, blocking/warning counts, comparable flag, drivers)
 * equals the re-derived one — so a hand-flipped verdict / lied count / hidden regression is caught. Never
 * throws and never echoes the input.
 */
export function ingestAudit(root: unknown): IngestedAudit {
  if (!isObject(root) || root.schema !== RELEASE_AUDIT_SCHEMA) return UNRECOGNIZED_AUDIT;

  const rollupObj = isObject(root.rollup) ? root.rollup : undefined;
  const claimedVerdict = rollupObj ? (oneOf(rollupObj.verdict, RELEASE_AUDIT_VERDICTS) ?? null) : null;

  // Structural validation. Any malformed piece ⇒ recognized-but-not-usable (a tamper / corruption), with the
  // claimed verdict surfaced (untrusted) so the summary can show what the audit asserted.
  if (rollupObj === undefined) return inconsistentAudit(claimedVerdict);
  const recorded = readRecordedAuditRollup(rollupObj);
  if (recorded === undefined) return inconsistentAudit(claimedVerdict);

  const policy = auditPolicyOf(root.policy);
  const findings = reconstructFindings(root.regressions);
  if (policy === undefined || findings === undefined) return inconsistentAudit(recorded.verdict);

  // Re-derive the composite rollup from the audit's OWN reconstructed findings + policy + recorded comparable
  // flag, exactly as the Phase 51 CLI did, and require the recorded rollup to match in every load-bearing field.
  const rederived = computeAuditRollup(findings, policy, recorded.comparable);
  const consistent =
    rederived.verdict === recorded.verdict &&
    rederived.exitCode === recorded.exitCode &&
    rederived.blockingRegressions === recorded.blockingRegressions &&
    rederived.warningRegressions === recorded.warningRegressions &&
    rederived.comparable === recorded.comparable &&
    sameDrivers(rederived.drivers, recorded.drivers);
  if (!consistent) return inconsistentAudit(recorded.verdict);

  const mode = oneOf(root.mode, RELEASE_AUDIT_MODES);
  if (mode === undefined) return inconsistentAudit(recorded.verdict);

  const context = auditContextFacts(root);
  const facts: AuditSourceFacts = {
    verdict: rederived.verdict,
    mode,
    comparable: rederived.comparable,
    blockingRegressions: rederived.blockingRegressions,
    warningRegressions: rederived.warningRegressions,
    drivers: rederived.drivers,
    baselineVerdict: context.baselineVerdict,
    currentVerdict: context.currentVerdict,
    postureRankDelta: context.postureRankDelta,
  };
  return { recognized: true, usable: true, verdict: rederived.verdict, facts };
}

/* ------------------------------------------------------------------ *
 *  The combined ingested set (what reduce + rollup + build fold)
 * ------------------------------------------------------------------ */

/** One source's ingest, plus whether a file was SUPPLIED for it (vs the honest not-supplied default). */
export interface SourceIngest<I> {
  /** True iff a `--bundle` / `--audit` file was provided (independent of whether it parsed / recognized). */
  readonly supplied: boolean;
  readonly ingested: I;
}

/** The two ingested sources the reduce + rollup + build layers fold into one report. */
export interface IngestedSources {
  readonly bundle: SourceIngest<IngestedBundle>;
  readonly audit: SourceIngest<IngestedAudit>;
}
