/**
 * The pure, node-free **parser** for cleanup evidence report summaries (Phase 44) — the trust
 * boundary of the monitor.
 *
 * A monitor is pointed at a file an operator's own scheduled job wrote. That file must be a
 * bounded, content-free report SUMMARY — the `pdfxyz.cleanup-check/1` output of the absence
 * verifier or the `pdfxyz.artifact-cleanup/1` output of the dry-run sweeper. It must NEVER be a
 * RAW input the tools consume (a per-object evidence array, an inventory record set, an
 * `aws s3api` provider export) or the projector's projected document — those are dense with
 * object keys, buckets, and metadata the monitor must never read. This module is deliberately
 * paranoid about that distinction:
 *
 *  - It reads ONLY a fixed allowlist of BOUNDED fields off a recognized summary (its `schema`
 *    tag, its bounded `verdict`, its bounded `provider`, its `generatedAt`). Every other field
 *    is never read, so a summary that also carried a stray string could not leak it.
 *  - It REFUSES a raw object outright: an array, or any object carrying a raw marker key
 *    (`objects` / `records` / `Contents` — the evidence / inventory / provider-export shapes,
 *    which the projector's document also carries), or an unrecognized `schema`. A refusal is a
 *    bounded reason code (`report_malformed`), never an echo of the offending value.
 *
 * It folds the two summary dialects into one bounded {@link CleanupVerdictClass}, so the posture
 * resolver never has to know which tool wrote the report.
 */

import {
  CLEANUP_VERIFICATION_VERDICTS,
  type CleanupVerdict,
} from "../cleanup/types";
import { CLEANUP_CHECK_SCHEMA } from "../cleanup/render";
import { ARTIFACT_CLEANUP_SCHEMA } from "../artifacts/cleanup/run";
import {
  CLEANUP_SEVERITIES,
  type CleanupSeverity,
} from "../artifacts/cleanup/taxonomy";
import { RETRIEVAL_STORAGE_PROVIDERS } from "../artifacts/access";
import type { CleanupEvidenceProvider, CleanupEvidenceReason } from "./types";

/**
 * The unified verdict class both summary dialects fold to — the single vocabulary the posture
 * resolver maps to a state/reason. The absence verifier contributes `verified`/`drift`/`unknown`/
 * `not-configured`; the sweeper contributes `verified` (its `ok`), `drift`, `breach`, `unknown`.
 */
export const CLEANUP_VERDICT_CLASSES = [
  "verified",
  "drift",
  "breach",
  "unknown",
  "not-configured",
] as const;
export type CleanupVerdictClass = (typeof CLEANUP_VERDICT_CLASSES)[number];

/** A recognized, content-free cleanup report summary, reduced to its bounded load-bearing facts. */
export interface ParsedCleanupReport {
  /** Which tool's summary this is. */
  readonly reportKind: "cleanup-check" | "artifact-cleanup";
  /** The folded, bounded verdict class. */
  readonly verdictClass: CleanupVerdictClass;
  /** The bounded storage provider the report concerned (`unknown` when it declares none). */
  readonly provider: CleanupEvidenceProvider;
  /** The report's own `generatedAt` parsed to epoch ms, or `null` when absent/unparseable. */
  readonly generatedAtMs: number | null;
}

/** The outcome of parsing one report value: a bounded parsed summary, or a bounded refusal reason. */
export type ParseReportResult =
  | { readonly ok: true; readonly report: ParsedCleanupReport }
  | { readonly ok: false; readonly reason: CleanupEvidenceReason };

/** Raw-shape marker keys. Any object carrying one of these is a raw input / projected doc — refused. */
const RAW_MARKER_KEYS = ["objects", "records", "Contents"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `value` if it is one of `allowed`, else `undefined`. */
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Parse an ISO-8601 `generatedAt` to epoch ms, or `null`. Never throws; rejects non-finite. */
function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Fold an absence-verifier {@link CleanupVerdict} to the unified class. */
function verdictClassForCheck(verdict: CleanupVerdict): CleanupVerdictClass {
  switch (verdict) {
    case "verified":
      return "verified";
    case "drift":
      return "drift";
    case "not-configured":
      return "not-configured";
    case "unknown":
    case "unavailable":
      return "unknown";
  }
}

/** Fold a dry-run sweeper verdict ({@link CleanupSeverity}) to the unified class. */
function verdictClassForSweep(verdict: CleanupSeverity): CleanupVerdictClass {
  switch (verdict) {
    case "ok":
      return "verified";
    case "drift":
      return "drift";
    case "breach":
      return "breach";
    case "unknown":
      return "unknown";
  }
}

/**
 * Validate + reduce an untrusted parsed-JSON value into a {@link ParsedCleanupReport}, or a
 * bounded refusal reason. Refuses arrays, any object carrying a raw marker key, and any object
 * whose `schema` is not a recognized summary tag — so a raw evidence/inventory/provider export
 * (or the projector's projected document) can never be mistaken for a summary. Only the bounded
 * allowlisted fields are ever read.
 */
export function parseCleanupReport(raw: unknown): ParseReportResult {
  // A raw evidence array (`[{ presence, ... }]`) is the verifier's INPUT, never a summary.
  if (!isObject(raw)) return { ok: false, reason: "report_malformed" };

  // Any raw-shape marker key means this is a raw input / projected document, not a summary —
  // refuse before reading anything else, even if a `schema` tag is also present.
  for (const key of RAW_MARKER_KEYS) {
    if (key in raw) return { ok: false, reason: "report_malformed" };
  }

  const schema = raw.schema;

  if (schema === CLEANUP_CHECK_SCHEMA) {
    const verdict = oneOf(raw.verdict, CLEANUP_VERIFICATION_VERDICTS);
    if (!verdict) return { ok: false, reason: "report_malformed" };
    const provider = oneOf(raw.provider, RETRIEVAL_STORAGE_PROVIDERS);
    return {
      ok: true,
      report: {
        reportKind: "cleanup-check",
        verdictClass: verdictClassForCheck(verdict),
        provider: provider ?? "unknown",
        generatedAtMs: parseTimestampMs(raw.generatedAt),
      },
    };
  }

  if (schema === ARTIFACT_CLEANUP_SCHEMA) {
    // The sweeper wraps its verdict in a nested `report` object and declares no single provider.
    const report = isObject(raw.report) ? raw.report : undefined;
    const verdict = report && oneOf(report.verdict, CLEANUP_SEVERITIES);
    if (!verdict) return { ok: false, reason: "report_malformed" };
    return {
      ok: true,
      report: {
        reportKind: "artifact-cleanup",
        verdictClass: verdictClassForSweep(verdict),
        provider: "unknown",
        generatedAtMs: parseTimestampMs(raw.generatedAt),
      },
    };
  }

  // An unrecognized (or missing) schema — including the projector's `pdfxyz.cleanup-projection/1`
  // document, which carries raw projected records — is refused, never guessed.
  return { ok: false, reason: "report_malformed" };
}

/**
 * Parse ingest TEXT into a {@link ParsedCleanupReport} or a bounded refusal reason. A JSON
 * failure is a `report_malformed` refusal — never a throw, never an echo of the input.
 */
export function parseCleanupReportText(text: string): ParseReportResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "report_malformed" };
  }
  return parseCleanupReport(value);
}
