/**
 * Pure, node-free **document ingest** for the release decision record ledger (Phase 59) — the trust boundary and the
 * no-leak core.
 *
 * The record composes TWO upstream outputs: a `pdfxyz.release-publish-pack/1` (Phase 57) and a `pdfxyz.release-ack/1`
 * (Phase 58). Both are already content-free, but each is UNTRUSTED input here (a CI artifact an operator points us at,
 * a committed record, or a hand-crafted / tampered file), and this module turns each parsed root into a bounded
 * ingested shape, in the same paranoid spirit as the rest of the worker ingest layer:
 *  - **No-leak by reconstruction.** It NEVER copies a free-text field out of either document. Every recorded fact is
 *    validated against a bounded enum or reduced to a non-negative integer / boolean. Prose, notes, guidance, the
 *    document's own stamp, and any stray extra field are all DROPPED.
 *  - **Re-derive each document's OWN rollup.**
 *    - The publish pack is re-validated by REUSING the Phase 58 {@link ingestPublishPack} verbatim — it reconstructs
 *      the pack's five reduced sources + policy and re-runs the Phase 57 coverage + rollup, so a hand-flipped
 *      `pack.verdict` / `disclosure` / lied coverage / hidden source is caught as a tamper.
 *    - The acknowledgement keeps only its reduced source SUMMARY (the pack state + verdict it saw) and the operator's
 *      bounded acknowledgement (decision + reviewer + note + strict) — it reduced the upstream pack away. So the
 *      SOURCE + ACKNOWLEDGEMENT are the ATOM of an ack (as the reduced source was for the ack, the point for a trend).
 *      The DEEPEST self-consistency check available is reconstructing the ack's recorded source + acknowledgement and
 *      RE-RUNNING the Phase 58 {@link computeAckRollup} over them, then requiring the recorded `ack` rollup to equal
 *      the re-derived one. That catches a hand-flipped `ack.verdict` / reason set / count / escalation. A
 *      fully-coherent rewrite of BOTH a document's atom AND its rollup is beyond self-consistency (the same documented
 *      boundary as every prior re-derivation phase) — but the Phase 59 CROSS-CHECK (`./reduce`) additionally requires
 *      the acknowledgement's recorded source-pack summary to match the SUPPLIED pack, catching a coherently-rewritten
 *      ack that acknowledged a different pack.
 *  - **Honest tri-state.** A non-object / wrong-schema input is `recognized = false` (⇒ an `unreadable` document); a
 *    recognized-but-inconsistent document is `recognized = true, usable = false` (⇒ a `tampered` document, `invalid`);
 *    a coherent document yields trusted bounded facts. The offending content is never echoed.
 *
 * SAFETY of the stripped ack reconstruction: {@link computeAckRollup} reads ONLY the source's `state` + `packVerdict`
 * (+ the acknowledgement's `decision` / `note` / `strict`) — never the source's `disclosure` / counts / `detail` nor the
 * acknowledgement's `reviewer` / `hasFollowup`. So the recompute depends only on the recorded state + verdict + decision
 * + note + strict (verified against `release-ack/rollup.ts`; re-verify those field reads before trusting this
 * reconstruction). We additionally (a) rebuild the acknowledgement via the Phase 58 {@link buildAcknowledgement} and
 * require the recorded block (including its derived `hasFollowup`) to match, and (b) require the source's recorded
 * `state` to equal `packState(supplied, recognized, usable)` and, when `usable`, its disclosure to equal the
 * verdict's canonical disclosure — so a source that lies about its own coverage or disclosure is rejected as a tamper.
 */

import {
  ingestPublishPack,
  type IngestedPublishPack,
} from "../release-ack/ingest";
import { buildAcknowledgement, packState } from "../release-ack/reduce";
import { computeAckRollup } from "../release-ack/rollup";
import {
  RELEASE_ACK_DECISIONS,
  RELEASE_ACK_NOTES,
  RELEASE_ACK_PACK_STATES,
  RELEASE_ACK_REASON_IDS,
  RELEASE_ACK_REVIEWERS,
  RELEASE_ACK_SCHEMA,
  RELEASE_ACK_VERDICTS,
  type ReleaseAckAcknowledgement,
  type ReleaseAckDecision,
  type ReleaseAckNote,
  type ReleaseAckPackState,
  type ReleaseAckReasonId,
  type ReleaseAckReviewer,
  type ReleaseAckRollup,
  type ReleaseAckSource,
  type ReleaseAckVerdict,
} from "../release-ack/types";
import {
  RELEASE_PUBLISH_PACK_DISCLOSURES,
  RELEASE_PUBLISH_PACK_DISCLOSURE_FOR_VERDICT,
  RELEASE_PUBLISH_PACK_VERDICTS,
  type ReleasePublishPackDisclosure,
  type ReleasePublishPackVerdict,
} from "../release-publish-pack/types";

export { ingestPublishPack, type IngestedPublishPack };

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
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

/** A strict non-negative safe integer, or `undefined`. */
function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Strictly `true` or `false`, or `undefined`. */
function boolOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/* ------------------------------------------------------------------ *
 *  Acknowledgement (`pdfxyz.release-ack/1`) ingest
 * ------------------------------------------------------------------ */

/** The bounded outcome of ingesting a `pdfxyz.release-ack/1` document. */
export interface IngestedAck {
  /** True iff the input parsed to an object carrying the `pdfxyz.release-ack/1` schema tag. */
  readonly recognized: boolean;
  /** True iff recognized AND its recorded rollup + acknowledgement + source invariants RE-DERIVE (self-consistent). */
  readonly usable: boolean;
  /** The acknowledgement's recorded verdict (its CLAIM), or `null` if unreadable. Surfaced even when tampered. */
  readonly ackVerdict: ReleaseAckVerdict | null;
  /** The acknowledgement's recorded decision class (its CLAIM), or `null` if unreadable. */
  readonly decision: ReleaseAckDecision | null;
  /** The acknowledgement's recorded reviewer class (its CLAIM), or `null` if unreadable. */
  readonly reviewer: ReleaseAckReviewer | null;
  /** The acknowledgement's recorded note class (its CLAIM), or `null` if unreadable. */
  readonly note: ReleaseAckNote | null;
  /** The pack coverage state the acknowledgement recorded (its view of the pack it acknowledged), or `null`. */
  readonly sourceState: ReleaseAckPackState | null;
  /** The publish-pack verdict the acknowledgement recorded acknowledging (its CLAIM), or `null`. */
  readonly recordedPackVerdict: ReleasePublishPackVerdict | null;
  /** The publish-pack disclosure the acknowledgement recorded acknowledging (its CLAIM), or `null`. */
  readonly recordedDisclosure: ReleasePublishPackDisclosure | null;
  /** How many evidence sources the acknowledgement recorded its pack as supplying (0 if unreadable). */
  readonly recordedSourcesSupplied: number;
  /** How many evidence sources the acknowledgement recorded its pack as usable (0 if unreadable). */
  readonly recordedSourcesUsable: number;
}

/** The bounded outcome for an input that was not a recognized `pdfxyz.release-ack/1`. */
export const UNRECOGNIZED_ACK: IngestedAck = {
  recognized: false,
  usable: false,
  ackVerdict: null,
  decision: null,
  reviewer: null,
  note: null,
  sourceState: null,
  recordedPackVerdict: null,
  recordedDisclosure: null,
  recordedSourcesSupplied: 0,
  recordedSourcesUsable: 0,
};

/** A recognized-but-inconsistent (tampered) acknowledgement, carrying only its untrusted claimed facts. */
function inconsistentAck(claim: Partial<IngestedAck>): IngestedAck {
  return { ...UNRECOGNIZED_ACK, recognized: true, usable: false, ...claim };
}

/** The recorded acknowledgement block fields the recompute must reproduce. */
interface RecordedAcknowledgement {
  readonly decision: ReleaseAckDecision;
  readonly reviewer: ReleaseAckReviewer;
  readonly note: ReleaseAckNote;
  readonly strict: boolean;
  readonly hasFollowup: boolean;
}

/** Validate the `acknowledgement` block into the bounded {@link RecordedAcknowledgement}, or `undefined`. */
function readAcknowledgement(
  value: unknown,
): RecordedAcknowledgement | undefined {
  if (!isObject(value)) return undefined;
  const decision = oneOf(value.decision, RELEASE_ACK_DECISIONS);
  const reviewer = oneOf(value.reviewer, RELEASE_ACK_REVIEWERS);
  const note = oneOf(value.note, RELEASE_ACK_NOTES);
  const strict = boolOf(value.strict);
  const hasFollowup = boolOf(value.hasFollowup);
  if (
    decision === undefined ||
    reviewer === undefined ||
    note === undefined ||
    strict === undefined ||
    hasFollowup === undefined
  ) {
    return undefined;
  }
  return { decision, reviewer, note, strict, hasFollowup };
}

/** Validate the `source` block into the bounded {@link ReleaseAckSource}, or `undefined`. */
function readAckSource(value: unknown): ReleaseAckSource | undefined {
  if (!isObject(value)) return undefined;
  const state = oneOf(value.state, RELEASE_ACK_PACK_STATES);
  const supplied = boolOf(value.supplied);
  const recognized = boolOf(value.recognized);
  const usable = boolOf(value.usable);
  const sourcesSupplied = intOf(value.sourcesSupplied);
  const sourcesUsable = intOf(value.sourcesUsable);
  // packVerdict / disclosure are `null` or a bounded token — a stray other value is a corrupt source.
  const packVerdict =
    value.packVerdict === null
      ? null
      : oneOf(value.packVerdict, RELEASE_PUBLISH_PACK_VERDICTS);
  const disclosure =
    value.disclosure === null
      ? null
      : oneOf(value.disclosure, RELEASE_PUBLISH_PACK_DISCLOSURES);
  if (
    state === undefined ||
    supplied === undefined ||
    recognized === undefined ||
    usable === undefined ||
    sourcesSupplied === undefined ||
    sourcesUsable === undefined ||
    packVerdict === undefined ||
    disclosure === undefined
  ) {
    return undefined;
  }
  return {
    state,
    supplied,
    recognized,
    usable,
    packVerdict,
    disclosure,
    sourcesSupplied,
    sourcesUsable,
    detail: "",
  };
}

/** The recorded ack rollup fields the recompute must reproduce for the ack to be `usable`. */
interface RecordedAckRollup {
  readonly verdict: ReleaseAckVerdict;
  readonly exitCode: number;
  readonly acknowledged: boolean;
  readonly reasons: readonly ReleaseAckReasonId[];
  readonly invalidInputs: number;
  readonly blocking: number;
  readonly insufficiencies: number;
  readonly advisories: number;
  readonly strict: boolean;
  readonly strictEscalated: boolean;
  readonly strictEscalatedFrom:
    "acknowledged-with-followup" | "deferred" | null;
}

/** Validate the `ack` rollup block into the bounded {@link RecordedAckRollup}, or `undefined`. */
function readAckRollup(value: unknown): RecordedAckRollup | undefined {
  if (!isObject(value)) return undefined;
  const verdict = oneOf(value.verdict, RELEASE_ACK_VERDICTS);
  const exitCode = intOf(value.exitCode);
  const acknowledged = boolOf(value.acknowledged);
  const invalidInputs = intOf(value.invalidInputs);
  const blocking = intOf(value.blocking);
  const insufficiencies = intOf(value.insufficiencies);
  const advisories = intOf(value.advisories);
  const strict = boolOf(value.strict);
  const strictEscalated = boolOf(value.strictEscalated);
  const rawFrom = value.strictEscalatedFrom;
  const fromOk =
    rawFrom === null ||
    rawFrom === "acknowledged-with-followup" ||
    rawFrom === "deferred";
  if (
    verdict === undefined ||
    exitCode === undefined ||
    acknowledged === undefined ||
    invalidInputs === undefined ||
    blocking === undefined ||
    insufficiencies === undefined ||
    advisories === undefined ||
    strict === undefined ||
    strictEscalated === undefined ||
    !fromOk ||
    !Array.isArray(value.reasons)
  ) {
    return undefined;
  }
  const reasons: ReleaseAckReasonId[] = [];
  for (const r of value.reasons) {
    const id = oneOf(r, RELEASE_ACK_REASON_IDS);
    if (id === undefined) return undefined; // an off-enum reason is a corrupt rollup
    reasons.push(id);
  }
  return {
    verdict,
    exitCode,
    acknowledged,
    reasons,
    invalidInputs,
    blocking,
    insufficiencies,
    advisories,
    strict,
    strictEscalated,
    strictEscalatedFrom: rawFrom as
      "acknowledged-with-followup" | "deferred" | null,
  };
}

/** Compare two `ReleaseAckReasonId` lists as sets (order-independent, exact membership). */
function sameReasons(
  a: readonly ReleaseAckReasonId[],
  b: readonly ReleaseAckReasonId[],
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set<string>(a);
  return b.every((id) => set.has(id));
}

/** Whether the re-derived ack rollup matches the recorded one on every load-bearing field (skips authored `detail`). */
function sameAckRollup(a: ReleaseAckRollup, b: RecordedAckRollup): boolean {
  return (
    a.verdict === b.verdict &&
    a.exitCode === b.exitCode &&
    a.acknowledged === b.acknowledged &&
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

/**
 * Reduce one parsed `pdfxyz.release-ack/1` `root` to the bounded {@link IngestedAck}.
 *
 * A non-object / wrong-schema input is {@link UNRECOGNIZED_ACK}. For a recognized acknowledgement it validates the
 * recorded `acknowledgement` + `source` + `ack` blocks, RE-RUNS the Phase 58 {@link computeAckRollup} over the
 * reconstructed source + acknowledgement, and marks the ack `usable` only if (a) the recorded acknowledgement equals
 * the one {@link buildAcknowledgement} derives from its own decision / reviewer / note / strict, (b) the recorded
 * source's `state` equals `packState(supplied, recognized, usable)` and — when `usable` — its disclosure is the
 * verdict's canonical disclosure, and (c) the recorded rollup equals the re-derived one — so a hand-flipped verdict /
 * decision / lied coverage / off-position escalation is caught. Never throws and never echoes the input.
 */
export function ingestAck(root: unknown): IngestedAck {
  if (!isObject(root) || root.schema !== RELEASE_ACK_SCHEMA)
    return UNRECOGNIZED_ACK;

  // Best-effort claims surfaced even when the ack is tampered (never trusted; shown so the summary reports what was
  // asserted). All bounded / nullable — a smuggled off-enum string reduces to `null`, never echoed.
  const ackObj = isObject(root.ack) ? root.ack : undefined;
  const claimVerdict = ackObj
    ? (oneOf(ackObj.verdict, RELEASE_ACK_VERDICTS) ?? null)
    : null;
  const ackn = isObject(root.acknowledgement)
    ? root.acknowledgement
    : undefined;
  const claimDecision = ackn
    ? (oneOf(ackn.decision, RELEASE_ACK_DECISIONS) ?? null)
    : null;
  const claimReviewer = ackn
    ? (oneOf(ackn.reviewer, RELEASE_ACK_REVIEWERS) ?? null)
    : null;
  const claimNote = ackn ? (oneOf(ackn.note, RELEASE_ACK_NOTES) ?? null) : null;
  const srcObj = isObject(root.source) ? root.source : undefined;
  const claimSourceState = srcObj
    ? (oneOf(srcObj.state, RELEASE_ACK_PACK_STATES) ?? null)
    : null;
  const claimPackVerdict =
    srcObj && srcObj.packVerdict !== null
      ? (oneOf(srcObj.packVerdict, RELEASE_PUBLISH_PACK_VERDICTS) ?? null)
      : null;
  const claimDisclosure =
    srcObj && srcObj.disclosure !== null
      ? (oneOf(srcObj.disclosure, RELEASE_PUBLISH_PACK_DISCLOSURES) ?? null)
      : null;
  const claimSupplied = srcObj ? (intOf(srcObj.sourcesSupplied) ?? 0) : 0;
  const claimUsable = srcObj ? (intOf(srcObj.sourcesUsable) ?? 0) : 0;

  const claim: Partial<IngestedAck> = {
    ackVerdict: claimVerdict,
    decision: claimDecision,
    reviewer: claimReviewer,
    note: claimNote,
    sourceState: claimSourceState,
    recordedPackVerdict: claimPackVerdict,
    recordedDisclosure: claimDisclosure,
    recordedSourcesSupplied: claimSupplied,
    recordedSourcesUsable: claimUsable,
  };

  const acknowledgement = readAcknowledgement(root.acknowledgement);
  const source = readAckSource(root.source);
  const recordedRollup = readAckRollup(root.ack);
  if (
    acknowledgement === undefined ||
    source === undefined ||
    recordedRollup === undefined
  ) {
    return inconsistentAck(claim);
  }

  // (a) The recorded acknowledgement must equal the one the Phase 58 builder derives (catches a lied `hasFollowup`).
  const rebuilt = buildAcknowledgement(
    acknowledgement.decision,
    acknowledgement.reviewer,
    acknowledgement.note,
    acknowledgement.strict,
  );
  const acknowledgementConsistent =
    rebuilt.decision === acknowledgement.decision &&
    rebuilt.reviewer === acknowledgement.reviewer &&
    rebuilt.note === acknowledgement.note &&
    rebuilt.strict === acknowledgement.strict &&
    rebuilt.hasFollowup === acknowledgement.hasFollowup;

  // (b) The source must be internally self-consistent: its state must follow from its own flags, and a `usable` source
  // must carry a non-null verdict whose canonical disclosure it records (a usable pack's disclosure is a fixed map of
  // its verdict). A tampered / absent / unreadable source may carry an arbitrary claim, so only `usable` is constrained.
  const stateConsistent =
    source.state ===
    packState(source.supplied, source.recognized, source.usable);
  const disclosureConsistent =
    source.state !== "usable" ||
    (source.packVerdict !== null &&
      source.disclosure ===
        RELEASE_PUBLISH_PACK_DISCLOSURE_FOR_VERDICT[source.packVerdict]);

  // (c) Re-run the Phase 58 fold over the reconstructed source + acknowledgement; the recorded rollup must re-derive.
  const acknowledgementForRollup: ReleaseAckAcknowledgement = rebuilt;
  const { rollup: rederived } = computeAckRollup(
    source,
    acknowledgementForRollup,
  );

  const consistent =
    acknowledgementConsistent &&
    stateConsistent &&
    disclosureConsistent &&
    sameAckRollup(rederived, recordedRollup);
  if (!consistent) return inconsistentAck(claim);

  return {
    recognized: true,
    usable: true,
    ackVerdict: recordedRollup.verdict,
    decision: acknowledgement.decision,
    reviewer: acknowledgement.reviewer,
    note: acknowledgement.note,
    sourceState: source.state,
    recordedPackVerdict: source.packVerdict,
    recordedDisclosure: source.disclosure,
    recordedSourcesSupplied: source.sourcesSupplied,
    recordedSourcesUsable: source.sourcesUsable,
  };
}

/* ------------------------------------------------------------------ *
 *  Ingested pair (what the runner hands the fold)
 * ------------------------------------------------------------------ */

/** One ingested document, plus whether a file was SUPPLIED for it. */
export interface IngestedDecisionSource<T> {
  /** True iff an input was provided (the CLI requires both, so this is `true` at run time). */
  readonly supplied: boolean;
  readonly ingested: T;
}

/** The ingested publish pack + acknowledgement the fold consumes. */
export interface IngestedDecisionInputs {
  readonly pack: IngestedDecisionSource<IngestedPublishPack>;
  readonly ack: IngestedDecisionSource<IngestedAck>;
}
