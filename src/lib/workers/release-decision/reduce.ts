/**
 * Pure, node-free **reducer** for the release decision record ledger (Phase 59).
 *
 * Turns the two ingested documents (the trust boundary's output) plus whether a file was supplied for each into the
 * bounded, content-free {@link ReleaseDecisionPackSummary} + {@link ReleaseDecisionAckSummary} the result records and
 * the rollup folds, and computes the coherence {@link ReleaseDecisionCrossCheck} between the acknowledgement's recorded
 * source-pack summary and the SUPPLIED pack. It derives only bounded fields — a coverage state, each document's own
 * (trusted-only-when-usable) verdict / decision / classes, small counts, and one-line authored headlines — and never
 * reaches past the already-reduced facts, so there is nowhere for a locator or a byte to enter.
 *
 * The cross-check is the Phase 59 value-add over each document's own self-consistency: a publish pack and an
 * acknowledgement can each re-derive perfectly and still not be a coherent PAIR (the acknowledgement may have
 * acknowledged a DIFFERENT pack). So — only when BOTH documents are usable — it compares the acknowledgement's recorded
 * source-pack summary (the verdict / disclosure / source count it recorded acknowledging) to the supplied pack's own
 * re-derived summary, on those bounded fields only (no digest / path / id). A `mismatch` is fail-closed `invalid`.
 */

import type { IngestedAck, IngestedPublishPack } from "./ingest";
import {
  RELEASE_DECISION_ACK_DETAIL,
  RELEASE_DECISION_CROSS_CHECK_NOTE,
  RELEASE_DECISION_PACK_DETAIL,
  type ReleaseDecisionAckSummary,
  type ReleaseDecisionCrossCheck,
  type ReleaseDecisionCrossCheckStatus,
  type ReleaseDecisionPackSummary,
  type ReleaseDecisionSourceState,
} from "./types";

/** The coverage state of a document from its supplied / recognized / usable flags. */
export function sourceState(
  supplied: boolean,
  recognized: boolean,
  usable: boolean,
): ReleaseDecisionSourceState {
  if (!supplied) return "absent";
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** Reduce the ingested publish pack (plus whether it was supplied) to the bounded {@link ReleaseDecisionPackSummary}. */
export function reducePackSummary(
  supplied: boolean,
  ingested: IngestedPublishPack,
): ReleaseDecisionPackSummary {
  const usable = supplied && ingested.usable;
  const state = sourceState(supplied, ingested.recognized, usable);
  // Trusted verdict / disclosure only from a usable pack; a tampered pack surfaces its untrusted CLAIM; an absent /
  // unreadable pack surfaces nothing.
  return {
    state,
    supplied,
    recognized: ingested.recognized,
    usable,
    verdict: supplied ? ingested.verdict : null,
    disclosure: supplied ? ingested.disclosure : null,
    sourcesSupplied: supplied ? ingested.sourcesSupplied : 0,
    sourcesUsable: supplied ? ingested.sourcesUsable : 0,
    detail: `pack: ${RELEASE_DECISION_PACK_DETAIL[state]}`,
  };
}

/** Reduce the ingested acknowledgement (plus whether it was supplied) to the bounded {@link ReleaseDecisionAckSummary}. */
export function reduceAckSummary(
  supplied: boolean,
  ingested: IngestedAck,
): ReleaseDecisionAckSummary {
  const usable = supplied && ingested.usable;
  const state = sourceState(supplied, ingested.recognized, usable);
  // The recorded source pack STATE the ack saw is the ack's own bounded enum (identical value space to a decision
  // source state); a not-supplied ack surfaces nothing.
  const recordedPackState = supplied ? ingested.sourceState : null;
  return {
    state,
    supplied,
    recognized: ingested.recognized,
    usable,
    ackVerdict: supplied ? ingested.ackVerdict : null,
    decision: supplied ? ingested.decision : null,
    reviewer: supplied ? ingested.reviewer : null,
    note: supplied ? ingested.note : null,
    recordedPackVerdict: supplied ? ingested.recordedPackVerdict : null,
    recordedDisclosure: supplied ? ingested.recordedDisclosure : null,
    recordedPackState: recordedPackState as ReleaseDecisionSourceState | null,
    recordedSourcesSupplied: supplied ? ingested.recordedSourcesSupplied : 0,
    recordedSourcesUsable: supplied ? ingested.recordedSourcesUsable : 0,
    detail: `ack: ${RELEASE_DECISION_ACK_DETAIL[state]}`,
  };
}

/**
 * Compute the coherence cross-check between the acknowledgement's recorded source pack and the SUPPLIED pack.
 *
 * `unknown` unless BOTH documents are usable (an untrustworthy input already dominates the decision, so the coherence
 * is moot). When both are usable, `match` iff the acknowledgement recorded acknowledging a USABLE pack whose bounded
 * summary — verdict, disclosure, supplied-source count, usable-source count — equals the supplied pack's re-derived
 * summary; else `mismatch` (the acknowledgement does not correspond to the supplied pack). Never reads a digest / path
 * / id — only the bounded fields both documents already reduced.
 */
export function computeCrossCheck(
  pack: ReleaseDecisionPackSummary,
  ack: ReleaseDecisionAckSummary,
): ReleaseDecisionCrossCheck {
  let status: ReleaseDecisionCrossCheckStatus;
  if (!pack.usable || !ack.usable) {
    status = "unknown";
  } else {
    const matches =
      ack.recordedPackState === "usable" &&
      ack.recordedPackVerdict === pack.verdict &&
      ack.recordedDisclosure === pack.disclosure &&
      ack.recordedSourcesSupplied === pack.sourcesSupplied &&
      ack.recordedSourcesUsable === pack.sourcesUsable;
    status = matches ? "match" : "mismatch";
  }
  return { status, detail: RELEASE_DECISION_CROSS_CHECK_NOTE[status] };
}
