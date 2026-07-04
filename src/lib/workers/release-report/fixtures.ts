/**
 * Test-support builders for the release evidence operator report tests (Phase 52).
 *
 * The report ingests `pdfxyz.release-ci-bundle/1` and/or `pdfxyz.release-audit/1` documents, so these helpers
 * build REAL, self-consistent documents of each posture — by composing the shipped Phase 50 bundle over a
 * genuinely coherent chain (reusing the release-audit bundle fixtures) and the shipped Phase 51 audit over two
 * such bundles (reusing the release-audit composer). A pass/warn/fail bundle or audit re-derives its own
 * rollup, so the report's trust boundary marks it `usable`; {@link tamperBundle} / {@link tamperAudit} flip a
 * recorded verdict so it no longer re-derives (a recognized-but-inconsistent document the report catches).
 *
 * This module is test infrastructure: it is NOT part of the public surface (never exported from `./index`) and
 * is never imported by any runtime module.
 */

import { buildAuditResult } from "../release-audit/build";
import { ingestBundle } from "../release-audit/ingest";
import { failBundle, passBundle, warnBundle } from "../release-audit/fixtures";
import type { AuditPolicy, ReleaseAuditResult } from "../release-audit/types";
import type { ReleaseCiBundleResult } from "../release-ci-bundle/types";
import { buildReportResult } from "./build";
import { ingestAudit, ingestBundleSource, type IngestedSources } from "./ingest";
import type { ReleaseReportArgs } from "./args";
import type { ReleaseReportProvider } from "./run";
import type { ReleaseReportResult } from "./types";

export { failBundle, passBundle, unknownBundle, warnBundle } from "../release-audit/fixtures";

/** A fixed clock the report tests stamp with (deterministic). */
export const NOW = "2026-07-04T00:00:00.000Z";

/** The default (strict-diff) audit policy: no warn tolerance, unknown drift stays advisory. */
const AUDIT_POLICY: AuditPolicy = { allowWarnRegression: false, maxNewWarnings: 0, failOnUnknown: false };

/* ------------------------------------------------------------------ *
 *  Real audit builders (each self-consistent → usable by the report)
 * ------------------------------------------------------------------ */

/** Build a real, self-consistent `pdfxyz.release-audit/1` diffing `current` against `baseline` (pair mode). */
export function makeAudit(
  baseline: ReleaseCiBundleResult,
  current: ReleaseCiBundleResult,
  policy: AuditPolicy = AUDIT_POLICY,
): ReleaseAuditResult {
  return buildAuditResult({
    generatedAt: NOW,
    mode: "pair",
    policy,
    baseline: { supplied: true, ingested: ingestBundle(baseline) },
    current: { supplied: true, ingested: ingestBundle(current) },
  });
}

/** A PASS audit: two coherent pass bundles → no regression. */
export function passAudit(): ReleaseAuditResult {
  return makeAudit(passBundle(), passBundle());
}

/** A WARN audit: a current whose posture softened pass → warn → a non-blocking drift. */
export function warnAudit(): ReleaseAuditResult {
  return makeAudit(passBundle(), warnBundle());
}

/** A FAIL audit: a current that dropped to fail → a blocking regression. */
export function failAudit(): ReleaseAuditResult {
  return makeAudit(passBundle(), failBundle());
}

/** An UNKNOWN audit: an unreadable current (`not-a-bundle`) → the diff could not be performed. */
export function unknownAudit(): ReleaseAuditResult {
  return buildAuditResult({
    generatedAt: NOW,
    mode: "pair",
    policy: AUDIT_POLICY,
    baseline: { supplied: true, ingested: ingestBundle(passBundle()) },
    current: { supplied: true, ingested: ingestBundle({ schema: "pdfxyz.not-a-bundle/1" }) },
  });
}

/* ------------------------------------------------------------------ *
 *  Tamper + not-a-document helpers
 * ------------------------------------------------------------------ */

/** Flip a document's recorded rollup verdict so it no longer re-derives from its own facts (a tamper). */
export function tamper(doc: { rollup: { verdict: string } }, to: string): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown> & { rollup: { verdict: string } };
  clone.rollup.verdict = to;
  return clone;
}

/** A tampered bundle: a hand-flipped recorded verdict (⇒ a `tampered` bundle source). */
export function tamperBundle(bundle: ReleaseCiBundleResult): Record<string, unknown> {
  return tamper(bundle, bundle.rollup.verdict === "pass" ? "warn" : "pass");
}

/** A tampered audit: a hand-flipped recorded verdict (⇒ a `tampered` audit source). */
export function tamperAudit(audit: ReleaseAuditResult): Record<string, unknown> {
  return tamper(audit, audit.rollup.verdict === "pass" ? "warn" : "pass");
}

/** An input that is NOT a recognized release document (⇒ an `unreadable` source). */
export function notADocument(): Record<string, unknown> {
  return { schema: "pdfxyz.something-else/1", note: "not a release bundle or audit" };
}

/* ------------------------------------------------------------------ *
 *  Report input assembly (what build/reduce/rollup fold, + CLI seams)
 * ------------------------------------------------------------------ */

/** The document objects a test supplies to the report (any subset; `undefined` ⇒ not supplied). */
export interface ReportObjects {
  bundle?: unknown;
  audit?: unknown;
}

/** Reduce a subset of document objects to the {@link IngestedSources} the build/reduce/rollup layers fold. */
export function ingestSourcesFrom(objs: ReportObjects): IngestedSources {
  return {
    bundle: { supplied: objs.bundle !== undefined, ingested: ingestBundleSource(objs.bundle) },
    audit: { supplied: objs.audit !== undefined, ingested: ingestAudit(objs.audit) },
  };
}

/** Build a real {@link ReleaseReportResult} from a subset of document objects. */
export function makeReport(objs: ReportObjects, strict = false): ReleaseReportResult {
  return buildReportResult(NOW, ingestSourcesFrom(objs), strict);
}

/** A provider that serves each supplied document object by its source-key "path" (used by the run tests). */
export function makeProvider(objs: ReportObjects, stdin = ""): ReleaseReportProvider {
  return {
    now: () => NOW,
    readFile: async (path: string) => {
      const obj = (objs as Record<string, unknown>)[path];
      if (obj === undefined) throw new Error("enoent");
      return typeof obj === "string" ? obj : JSON.stringify(obj);
    },
    readStdin: async () => stdin,
  };
}

/** Build {@link ReleaseReportArgs} that reference each supplied document by its source-key "path". */
export function makeArgs(objs: ReportObjects, over: Partial<ReleaseReportArgs> = {}): ReleaseReportArgs {
  return {
    format: "json",
    pretty: true,
    strict: false,
    ...(objs.bundle !== undefined ? { bundlePath: "bundle" } : {}),
    ...(objs.audit !== undefined ? { auditPath: "audit" } : {}),
    ...over,
  };
}
