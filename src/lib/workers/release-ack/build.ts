/**
 * Pure, node-free **composer** for the release evidence handoff acknowledgement receipt (Phase 58).
 *
 * It takes the ingested pack the trust boundary produced ({@link IngestedAckSource}), the operator's validated
 * acknowledgement inputs, and the run's stamp, and folds them into one stable {@link ReleaseAckResult}: it reduces the
 * pack to a bounded source summary (`./reduce`), builds the bounded acknowledgement block, folds the composite ack
 * verdict + reasons (`./rollup`), derives the ordered next-action checklist from the verdict + acknowledgement, and
 * flattens the receipt (`./receipt`).
 *
 * Determinism: the reasons / checklist items are emitted in canonical order, no field is a raw value from the input,
 * and every fact is a bounded enum / small integer / boolean / app-authored prose — so the same ingested state +
 * inputs + stamp always produce a byte-identical result. Honesty: the source summary reports the pack's own CLAIM,
 * while the rollup (folded separately) resolves the acknowledgement posture — so a tampered / blocked / incomplete
 * pack never yields a clean `acknowledged`.
 */

import { buildAckReceipt } from "./receipt";
import { buildAcknowledgement, reduceAckSource } from "./reduce";
import { computeAckRollup } from "./rollup";
import type { IngestedAckSource } from "./ingest";
import {
  RELEASE_ACK_CAVEATS,
  RELEASE_ACK_CHECKLIST_DETAIL,
  RELEASE_ACK_CHECKLIST_IDS,
  RELEASE_ACK_GUIDANCE,
  RELEASE_ACK_POLICY_ID,
  RELEASE_ACK_POLICY_VERSION,
  RELEASE_ACK_SCHEMA,
  RELEASE_PUBLISH_PACK_SCHEMA,
  type ReleaseAckChecklistId,
  type ReleaseAckChecklistItem,
  type ReleaseAckDecision,
  type ReleaseAckMetadata,
  type ReleaseAckNote,
  type ReleaseAckResult,
  type ReleaseAckReviewer,
  type ReleaseAckRollup,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream publish-pack schema). */
export function buildAckMetadata(): ReleaseAckMetadata {
  return {
    schemaVersion: RELEASE_ACK_POLICY_VERSION,
    policyId: RELEASE_ACK_POLICY_ID,
    policyVersion: RELEASE_ACK_POLICY_VERSION,
    publishPackSchema: RELEASE_PUBLISH_PACK_SCHEMA,
  };
}

/**
 * Derive the ordered next-action checklist from the rollup. Every predicate is a bounded read over the already
 * content-free rollup verdict; the checklist is emitted in canonical {@link RELEASE_ACK_CHECKLIST_IDS} order, deduped.
 * (A recorded follow-up always resolves to at least an `acknowledged-with-followup` verdict, so the `track-recorded-followup`
 * step is keyed on the verdict, not on the acknowledgement's `hasFollowup` flag.)
 */
export function buildAckChecklist(rollup: ReleaseAckRollup): ReleaseAckChecklistItem[] {
  const wanted = new Set<ReleaseAckChecklistId>();

  if (rollup.verdict === "invalid") wanted.add("resolve-input-before-acknowledging");
  if (rollup.verdict === "rejected") wanted.add("do-not-proceed-on-rejection");
  if (rollup.verdict === "deferred") wanted.add("complete-evidence-before-proceeding");
  if (rollup.verdict === "acknowledged-with-followup") wanted.add("track-recorded-followup");

  // A recorded acknowledgement (clean or with follow-up) → record it + a reminder that this is not an approval.
  if (rollup.verdict === "acknowledged" || rollup.verdict === "acknowledged-with-followup") {
    wanted.add("record-acknowledgement");
    wanted.add("obtain-external-approval-out-of-band");
  }

  wanted.add("keep-ack-receipt"); // always the last step — keep the content-free acknowledgement record

  return RELEASE_ACK_CHECKLIST_IDS.filter((id) => wanted.has(id)).map((id) => ({
    id,
    detail: RELEASE_ACK_CHECKLIST_DETAIL[id],
  }));
}

/**
 * Fold the ingested pack + the operator's acknowledgement inputs + the run stamp into the full
 * {@link ReleaseAckResult}. Pure and deterministic.
 */
export function buildAckResult(
  generatedAt: string,
  ingested: IngestedAckSource,
  decision: ReleaseAckDecision,
  reviewer: ReleaseAckReviewer,
  note: ReleaseAckNote,
  strict: boolean,
): ReleaseAckResult {
  const source = reduceAckSource(ingested);
  const acknowledgement = buildAcknowledgement(decision, reviewer, note, strict);
  const { rollup, reasons } = computeAckRollup(source, acknowledgement);
  const checklist = buildAckChecklist(rollup);

  return {
    schema: RELEASE_ACK_SCHEMA,
    generatedAt,
    metadata: buildAckMetadata(),
    acknowledgement,
    source,
    ack: rollup,
    reasons,
    checklist,
    guidance: RELEASE_ACK_GUIDANCE,
    caveats: RELEASE_ACK_CAVEATS,
    receipt: buildAckReceipt(generatedAt, source, rollup),
  };
}
