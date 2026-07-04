/**
 * Pure, node-free **document ingest** for the release evidence handoff acknowledgement receipt (Phase 58) — the trust
 * boundary and the no-leak core.
 *
 * The receipt acknowledges ONE upstream output: a `pdfxyz.release-publish-pack/1` (Phase 57). Even though the pack is
 * already content-free, it is UNTRUSTED input here (a CI artifact an operator points us at, a committed record, or a
 * hand-crafted / tampered file), and this module turns the parsed root into a bounded ingested shape, in the same
 * paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of the pack. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, notes, guidance, the
 *    pack's own stamp, and any stray extra field are all DROPPED.
 *  - **Re-derive the pack's OWN rollup.** A publish pack keeps only its per-source SUMMARIES (each source's
 *    state + native verdict) — it reduced the upstream governance / archive / drill / report / trend documents away.
 *    So the SOURCE (state + verdict) is the ATOM of a pack (as the point was for a trend, the record for an archive,
 *    the check for a drill). The DEEPEST self-consistency check available is reconstructing the pack's five reduced
 *    sources + policy and RE-RUNNING the Phase 57 {@link computeCoverage} + {@link computePublishRollup} over them,
 *    then requiring the recorded coverage + rollup to equal the re-derived ones. That catches a hand-flipped
 *    `pack.verdict` / `disclosure` / reason set / count, a shuffled / off-position source, an off-enum source verdict,
 *    or a state that contradicts its own flags. A fully-coherent rewrite of BOTH a source's atom AND the rollup is
 *    beyond self-consistency (the pack threw the upstream document away) — the same documented boundary as every prior
 *    re-derivation phase; anchor deeper trust in the upstream signed evidence.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` pack); a
 *    recognized-but-inconsistent pack is `recognized = true, usable = false` (⇒ a `tampered` pack, `invalid`); a
 *    coherent pack yields a trusted bounded verdict. The offending content is never echoed.
 *
 * SAFETY of the stripped source reconstruction: {@link computePublishRollup} reads ONLY each source's `state` +
 * `verdict` (+ the policy), and {@link computeCoverage} reads ONLY each source's `supplied` / `usable` / `state` —
 * never the unread `severity` / `detail`. So filling those with deterministic filler cannot change the recompute
 * (verified against `release-publish-pack/rollup.ts` + `release-publish-pack/reduce.ts`; re-verify those field reads
 * before trusting this reconstruction). The per-source `verdict` is additionally validated to be `null` or a native
 * token for THAT source id, so an off-enum locator smuggled into a verdict field is rejected as a tamper, never
 * surfaced.
 */

import { RELEASE_GOVERNANCE_VERDICTS } from "../release-governance/types";
import { RELEASE_ARCHIVE_POSTURES } from "../release-archive/types";
import { RELEASE_RESTORE_DRILL_VERDICTS } from "../release-restore-drill/types";
import { RELEASE_REPORT_RECOMMENDATIONS } from "../release-report/types";
import { RELEASE_TREND_VERDICTS } from "../release-trend/types";
import { computeCoverage, sourceState } from "../release-publish-pack/reduce";
import { computePublishRollup, type PublishPackSources } from "../release-publish-pack/rollup";
import {
  RELEASE_PUBLISH_PACK_DISCLOSURES,
  RELEASE_PUBLISH_PACK_REASON_IDS,
  RELEASE_PUBLISH_PACK_SCHEMA,
  RELEASE_PUBLISH_PACK_SOURCE_IDS,
  RELEASE_PUBLISH_PACK_SOURCE_STATES,
  RELEASE_PUBLISH_PACK_VERDICTS,
  type ReleasePublishPackCoverage,
  type ReleasePublishPackDisclosure,
  type ReleasePublishPackPolicy,
  type ReleasePublishPackReasonId,
  type ReleasePublishPackSource,
  type ReleasePublishPackSourceId,
  type ReleasePublishPackSourceState,
  type ReleasePublishPackVerdict,
} from "../release-publish-pack/types";

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

/** The native verdict / posture / recommendation tokens each source id may carry (for a usable / tampered claim). */
const SOURCE_VERDICTS: Record<ReleasePublishPackSourceId, readonly string[]> = {
  governance: RELEASE_GOVERNANCE_VERDICTS,
  archive: RELEASE_ARCHIVE_POSTURES,
  "restore-drill": RELEASE_RESTORE_DRILL_VERDICTS,
  report: RELEASE_REPORT_RECOMMENDATIONS,
  trend: RELEASE_TREND_VERDICTS,
};

/** The bounded outcome of ingesting a `pdfxyz.release-publish-pack/1` document. */
export interface IngestedPublishPack {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-publish-pack/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded coverage + rollup RE-DERIVE from its own reduced sources (self-consistent). */
  readonly usable: boolean;
  /** The pack's recorded publish verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly verdict: ReleasePublishPackVerdict | null;
  /** The pack's recorded disclosure classification (its CLAIM), or `null` if unreadable. */
  readonly disclosure: ReleasePublishPackDisclosure | null;
  /** The pack's recorded supplied-source count (0 if unreadable). */
  readonly sourcesSupplied: number;
  /** The pack's recorded usable-source count (0 if unreadable). */
  readonly sourcesUsable: number;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-publish-pack/1`. */
export const UNRECOGNIZED_PUBLISH_PACK: IngestedPublishPack = {
  recognized: false,
  usable: false,
  verdict: null,
  disclosure: null,
  sourcesSupplied: 0,
  sourcesUsable: 0,
};

/** A recognized-but-inconsistent (tampered) pack, carrying only its untrusted claimed verdict / disclosure / counts. */
function inconsistentPack(
  verdict: ReleasePublishPackVerdict | null,
  disclosure: ReleasePublishPackDisclosure | null,
  sourcesSupplied: number,
  sourcesUsable: number,
): IngestedPublishPack {
  return { recognized: true, usable: false, verdict, disclosure, sourcesSupplied, sourcesUsable };
}

/** The recorded pack rollup fields the recompute must reproduce for the pack to be `usable`. */
interface RecordedPackRollup {
  readonly verdict: ReleasePublishPackVerdict;
  readonly exitCode: number;
  readonly publishable: boolean;
  readonly disclosure: ReleasePublishPackDisclosure;
  readonly reasons: readonly ReleasePublishPackReasonId[];
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly requireArchive: boolean;
  readonly requireRestoreDrill: boolean;
  readonly strict: boolean;
  readonly strictEscalated: boolean;
  readonly strictEscalatedFrom: "review" | "incomplete" | null;
}

/** Validate the pack's `pack` rollup block into the bounded {@link RecordedPackRollup}, or `undefined`. */
function readPackRollup(value: unknown): RecordedPackRollup | undefined {
  if (!isObject(value)) return undefined;
  const verdict = oneOf(value.verdict, RELEASE_PUBLISH_PACK_VERDICTS);
  const exitCode = intOf(value.exitCode);
  const publishable = boolOf(value.publishable);
  const disclosure = oneOf(value.disclosure, RELEASE_PUBLISH_PACK_DISCLOSURES);
  const blocking = intOf(value.blocking);
  const insufficiencies = intOf(value.insufficiencies);
  const advisories = intOf(value.advisories);
  const requireArchive = boolOf(value.requireArchive);
  const requireRestoreDrill = boolOf(value.requireRestoreDrill);
  const strict = boolOf(value.strict);
  const strictEscalated = boolOf(value.strictEscalated);
  // `strictEscalatedFrom` is `review | incomplete | null` — a stray other value is a corrupt rollup.
  const rawFrom = value.strictEscalatedFrom;
  const fromOk = rawFrom === null || rawFrom === "review" || rawFrom === "incomplete";
  if (
    verdict === undefined ||
    exitCode === undefined ||
    publishable === undefined ||
    disclosure === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    requireArchive === undefined ||
    requireRestoreDrill === undefined ||
    strict === undefined ||
    strictEscalated === undefined ||
    !fromOk ||
    !Array.isArray(value.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleasePublishPackReasonId[] = [];
  for (const r of value.reasons) {
    const id = oneOf(r, RELEASE_PUBLISH_PACK_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    publishable,
    disclosure,
    reasons,
    blocking,
    insufficiencies,
    advisories,
    requireArchive,
    requireRestoreDrill,
    strict,
    strictEscalated,
    strictEscalatedFrom: rawFrom as "review" | "incomplete" | null,
  };
}

/** Validate the pack's `coverage` block into the bounded {@link ReleasePublishPackCoverage}, or `undefined`. */
function readPackCoverage(value: unknown): ReleasePublishPackCoverage | undefined {
  if (!isObject(value)) return undefined;
  const sourcesSupplied = intOf(value.sourcesSupplied);
  const sourcesUsable = intOf(value.sourcesUsable);
  const governance = oneOf(value.governance, RELEASE_PUBLISH_PACK_SOURCE_STATES);
  const archive = oneOf(value.archive, RELEASE_PUBLISH_PACK_SOURCE_STATES);
  const restoreDrill = oneOf(value.restoreDrill, RELEASE_PUBLISH_PACK_SOURCE_STATES);
  const report = oneOf(value.report, RELEASE_PUBLISH_PACK_SOURCE_STATES);
  const trend = oneOf(value.trend, RELEASE_PUBLISH_PACK_SOURCE_STATES);
  const hasGovernance = boolOf(value.hasGovernance);
  const hasArchive = boolOf(value.hasArchive);
  const hasRestoreDrill = boolOf(value.hasRestoreDrill);
  const hasReport = boolOf(value.hasReport);
  const hasTrend = boolOf(value.hasTrend);
  if (
    sourcesSupplied === undefined ||
    sourcesUsable === undefined ||
    governance === undefined ||
    archive === undefined ||
    restoreDrill === undefined ||
    report === undefined ||
    trend === undefined ||
    hasGovernance === undefined ||
    hasArchive === undefined ||
    hasRestoreDrill === undefined ||
    hasReport === undefined ||
    hasTrend === undefined
  ) {
    return undefined;
  }
  return {
    sourcesSupplied,
    sourcesUsable,
    governance,
    archive,
    restoreDrill,
    report,
    trend,
    hasGovernance,
    hasArchive,
    hasRestoreDrill,
    hasReport,
    hasTrend,
  };
}

/** Validate the pack's `policy` block into a bounded {@link ReleasePublishPackPolicy}, or `undefined`. */
function readPackPolicy(value: unknown): ReleasePublishPackPolicy | undefined {
  if (!isObject(value)) return undefined;
  const requireArchive = boolOf(value.requireArchive);
  const requireRestoreDrill = boolOf(value.requireRestoreDrill);
  const strict = boolOf(value.strict);
  if (requireArchive === undefined || requireRestoreDrill === undefined || strict === undefined) {
    return undefined;
  }
  return { requireArchive, requireRestoreDrill, strict };
}

/**
 * Reconstruct one recorded reduced SOURCE at `index` (`root.sources[i]`) into the minimal
 * {@link ReleasePublishPackSource} the Phase 57 coverage + rollup read (`state` + `verdict` + `supplied` + `usable`).
 * Returns `undefined` if the source is malformed, out of position, off-enum, violates the reduce invariant
 * `state === sourceState(supplied, recognized, usable)`, or carries a verdict that is not `null` / a native token for
 * that source id (an off-enum locator smuggled into the verdict field). `severity` / `detail` are unread filler.
 */
function reconstructSource(raw: unknown, index: number): ReleasePublishPackSource | undefined {
  const id = RELEASE_PUBLISH_PACK_SOURCE_IDS[index];
  if (id === undefined) return undefined; // more than five sources ⇒ corrupt
  if (!isObject(raw) || raw.id !== id) return undefined;
  const state = oneOf(raw.state, RELEASE_PUBLISH_PACK_SOURCE_STATES);
  const supplied = boolOf(raw.supplied);
  const recognized = boolOf(raw.recognized);
  const usable = boolOf(raw.usable);
  if (state === undefined || supplied === undefined || recognized === undefined || usable === undefined) {
    return undefined;
  }
  if (state !== sourceState(supplied, recognized, usable)) return undefined; // Phase 57 reduce invariant
  // The verdict must be `null` or a native token for THIS source id — never an off-enum string (a smuggled locator).
  let verdict: string | null;
  if (raw.verdict === null) {
    verdict = null;
  } else {
    const token = oneOf(raw.verdict, SOURCE_VERDICTS[id]);
    if (token === undefined) return undefined;
    verdict = token;
  }
  return {
    id: id as ReleasePublishPackSourceId,
    state: state as ReleasePublishPackSourceState,
    supplied,
    recognized,
    usable,
    verdict,
    severity: null,
    detail: "",
  };
}

/** Reconstruct the five recorded reduced sources into the {@link PublishPackSources} the fold reads, or `undefined`. */
function reconstructSources(value: unknown): PublishPackSources | undefined {
  if (!Array.isArray(value) || value.length !== RELEASE_PUBLISH_PACK_SOURCE_IDS.length) return undefined;
  const built: ReleasePublishPackSource[] = [];
  for (let i = 0; i < value.length; i++) {
    const source = reconstructSource(value[i], i);
    if (source === undefined) return undefined;
    built.push(source);
  }
  const [governance, archive, restoreDrill, report, trend] = built;
  return {
    governance: governance!,
    archive: archive!,
    restoreDrill: restoreDrill!,
    report: report!,
    trend: trend!,
  };
}

/** Compare two `ReleasePublishPackReasonId` lists as sets (order-independent, exact membership). */
function sameReasons(
  a: readonly ReleasePublishPackReasonId[],
  b: readonly ReleasePublishPackReasonId[],
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((id) => set.has(id));
}

/** Whether the re-derived coverage matches the recorded coverage on every field. */
function sameCoverage(a: ReleasePublishPackCoverage, b: ReleasePublishPackCoverage): boolean {
  return (
    a.sourcesSupplied === b.sourcesSupplied &&
    a.sourcesUsable === b.sourcesUsable &&
    a.governance === b.governance &&
    a.archive === b.archive &&
    a.restoreDrill === b.restoreDrill &&
    a.report === b.report &&
    a.trend === b.trend &&
    a.hasGovernance === b.hasGovernance &&
    a.hasArchive === b.hasArchive &&
    a.hasRestoreDrill === b.hasRestoreDrill &&
    a.hasReport === b.hasReport &&
    a.hasTrend === b.hasTrend
  );
}

/**
 * Reduce one parsed `pdfxyz.release-publish-pack/1` `root` to the bounded {@link IngestedPublishPack}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_PUBLISH_PACK}. For a recognized pack it reconstructs the
 * pack's five reduced sources + policy, RE-RUNS the Phase 57 {@link computeCoverage} + {@link computePublishRollup}
 * over them, and marks the pack `usable` only if the recorded coverage AND the recorded rollup (verdict, exit code,
 * publishable flag, disclosure, reason set, blocking / insufficiency / advisory counts, policy + escalation flags)
 * equal the re-derived ones — so a hand-flipped verdict / disclosure / lied coverage / hidden source is caught. Never
 * throws and never echoes the input.
 */
export function ingestPublishPack(root: unknown): IngestedPublishPack {
  if (!isObject(root) || root.schema !== RELEASE_PUBLISH_PACK_SCHEMA) return UNRECOGNIZED_PUBLISH_PACK;

  const packObj = isObject(root.pack) ? root.pack : undefined;
  const claimedVerdict = packObj ? (oneOf(packObj.verdict, RELEASE_PUBLISH_PACK_VERDICTS) ?? null) : null;
  const claimedDisclosure = packObj ? (oneOf(packObj.disclosure, RELEASE_PUBLISH_PACK_DISCLOSURES) ?? null) : null;
  const covObj = isObject(root.coverage) ? root.coverage : undefined;
  const claimedSupplied = covObj ? (intOf(covObj.sourcesSupplied) ?? 0) : 0;
  const claimedUsable = covObj ? (intOf(covObj.sourcesUsable) ?? 0) : 0;

  const recordedRollup = readPackRollup(root.pack);
  const recordedCoverage = readPackCoverage(root.coverage);
  const policy = readPackPolicy(root.policy);
  if (recordedRollup === undefined || recordedCoverage === undefined || policy === undefined) {
    return inconsistentPack(claimedVerdict, claimedDisclosure, claimedSupplied, claimedUsable);
  }
  const sources = reconstructSources(root.sources);
  if (sources === undefined) {
    return inconsistentPack(
      recordedRollup.verdict,
      recordedRollup.disclosure,
      recordedCoverage.sourcesSupplied,
      recordedCoverage.sourcesUsable,
    );
  }

  const rederivedCoverage = computeCoverage(
    sources.governance,
    sources.archive,
    sources.restoreDrill,
    sources.report,
    sources.trend,
  );
  const { rollup: rederivedRollup } = computePublishRollup(sources, policy);

  const consistent =
    sameCoverage(recordedCoverage, rederivedCoverage) &&
    rederivedRollup.verdict === recordedRollup.verdict &&
    rederivedRollup.exitCode === recordedRollup.exitCode &&
    rederivedRollup.publishable === recordedRollup.publishable &&
    rederivedRollup.disclosure === recordedRollup.disclosure &&
    rederivedRollup.blocking === recordedRollup.blocking &&
    rederivedRollup.insufficiencies === recordedRollup.insufficiencies &&
    rederivedRollup.advisories === recordedRollup.advisories &&
    rederivedRollup.requireArchive === recordedRollup.requireArchive &&
    rederivedRollup.requireRestoreDrill === recordedRollup.requireRestoreDrill &&
    rederivedRollup.strict === recordedRollup.strict &&
    rederivedRollup.strictEscalated === recordedRollup.strictEscalated &&
    rederivedRollup.strictEscalatedFrom === recordedRollup.strictEscalatedFrom &&
    sameReasons(rederivedRollup.reasons, recordedRollup.reasons);
  if (!consistent) {
    return inconsistentPack(
      recordedRollup.verdict,
      recordedRollup.disclosure,
      recordedCoverage.sourcesSupplied,
      recordedCoverage.sourcesUsable,
    );
  }

  return {
    recognized: true,
    usable: true,
    verdict: recordedRollup.verdict,
    disclosure: recordedRollup.disclosure,
    sourcesSupplied: recordedCoverage.sourcesSupplied,
    sourcesUsable: recordedCoverage.sourcesUsable,
  };
}

/** One ingested pack, plus whether a file was SUPPLIED for it. */
export interface IngestedAckSource {
  /** True iff a `--publish-pack` input was provided (the CLI requires one, so this is `true` at run time). */
  readonly supplied: boolean;
  readonly ingested: IngestedPublishPack;
}
