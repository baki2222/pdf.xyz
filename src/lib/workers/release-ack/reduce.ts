/**
 * Pure, node-free **reducer** for the release evidence handoff acknowledgement receipt (Phase 58).
 *
 * Turns the ingested pack (the trust boundary's output) plus whether a file was supplied for it into the bounded,
 * content-free {@link ReleaseAckSource} the result records and the rollup folds, and turns the validated args into the
 * bounded {@link ReleaseAckAcknowledgement}. It derives only bounded fields — the pack coverage state, the pack's own
 * (trusted-only-when-usable) verdict / disclosure, small source counts, and a one-line authored headline — and never
 * reaches past the already-reduced facts, so there is nowhere for a locator or a byte to enter.
 */

import type { IngestedAckSource } from "./ingest";
import {
  RELEASE_ACK_SOURCE_DETAIL,
  type ReleaseAckAcknowledgement,
  type ReleaseAckDecision,
  type ReleaseAckNote,
  type ReleaseAckPackState,
  type ReleaseAckReviewer,
  type ReleaseAckSource,
} from "./types";

/** The coverage state of the pack from its supplied / recognized / usable flags. */
export function packState(supplied: boolean, recognized: boolean, usable: boolean): ReleaseAckPackState {
  if (!supplied) return "absent";
  if (!recognized) return "unreadable";
  if (!usable) return "tampered";
  return "usable";
}

/** Reduce the ingested publish pack (the single acknowledged source) to the bounded {@link ReleaseAckSource}. */
export function reduceAckSource(source: IngestedAckSource): ReleaseAckSource {
  const { supplied, ingested } = source;
  const usable = supplied && ingested.usable;
  const state = packState(supplied, ingested.recognized, usable);
  // Trusted verdict / disclosure only from a usable pack; a tampered pack surfaces its untrusted CLAIM; an
  // absent / unreadable pack surfaces nothing.
  const packVerdict = supplied ? ingested.verdict : null;
  const disclosure = supplied ? ingested.disclosure : null;
  const sourcesSupplied = supplied ? ingested.sourcesSupplied : 0;
  const sourcesUsable = supplied ? ingested.sourcesUsable : 0;
  return {
    state,
    supplied,
    recognized: ingested.recognized,
    usable,
    packVerdict,
    disclosure,
    sourcesSupplied,
    sourcesUsable,
    detail: `pack: ${RELEASE_ACK_SOURCE_DETAIL[state]}`,
  };
}

/** Fold the validated decision + reviewer class + note class + strict knob into the bounded acknowledgement block. */
export function buildAcknowledgement(
  decision: ReleaseAckDecision,
  reviewer: ReleaseAckReviewer,
  note: ReleaseAckNote,
  strict: boolean,
): ReleaseAckAcknowledgement {
  const hasFollowup = decision === "accepted-with-notes" || note !== "none";
  return { decision, reviewer, note, strict, hasFollowup };
}
