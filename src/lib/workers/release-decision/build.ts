/**
 * Pure, node-free **composer** for the release decision record ledger (Phase 59).
 *
 * It takes the two ingested documents the trust boundary produced ({@link IngestedDecisionInputs}), the operator's
 * `--strict` knob, and the run's stamp, and folds them into one stable {@link ReleaseDecisionResult}: it reduces each
 * document to a bounded summary (`./reduce`), computes the coherence cross-check, folds the composite decision +
 * reasons (`./rollup`), derives the ordered next-action checklist from the decision, and flattens the receipt
 * (`./receipt`).
 *
 * Determinism: the reasons / checklist items are emitted in canonical order, no field is a raw value from an input,
 * and every fact is a bounded enum / small integer / boolean / app-authored prose — so the same ingested states +
 * strict flag + stamp always produce a byte-identical result. Honesty: the source summaries report each document's own
 * CLAIM, while the rollup (folded separately) resolves the decision posture — so a tampered / blocked / incomplete
 * document, or a mismatched pair, never yields a `proceed`.
 */

import {
  computeCrossCheck,
  reduceAckSummary,
  reducePackSummary,
} from "./reduce";
import { buildDecisionReceipt } from "./receipt";
import { computeDecisionRollup } from "./rollup";
import type { IngestedDecisionInputs } from "./ingest";
import {
  RELEASE_ACK_SCHEMA,
  RELEASE_DECISION_CAVEATS,
  RELEASE_DECISION_CHECKLIST_DETAIL,
  RELEASE_DECISION_CHECKLIST_IDS,
  RELEASE_DECISION_GUIDANCE,
  RELEASE_DECISION_POLICY_ID,
  RELEASE_DECISION_POLICY_VERSION,
  RELEASE_DECISION_SCHEMA,
  RELEASE_PUBLISH_PACK_SCHEMA,
  type ReleaseDecisionChecklistId,
  type ReleaseDecisionChecklistItem,
  type ReleaseDecisionMetadata,
  type ReleaseDecisionResult,
  type ReleaseDecisionRollup,
} from "./types";

/** Assemble the stable identity block (with the pinned upstream document schemas). */
export function buildDecisionMetadata(): ReleaseDecisionMetadata {
  return {
    schemaVersion: RELEASE_DECISION_POLICY_VERSION,
    policyId: RELEASE_DECISION_POLICY_ID,
    policyVersion: RELEASE_DECISION_POLICY_VERSION,
    publishPackSchema: RELEASE_PUBLISH_PACK_SCHEMA,
    ackSchema: RELEASE_ACK_SCHEMA,
  };
}

/**
 * Derive the ordered next-action checklist from the rollup. Every predicate is a bounded read over the already
 * content-free decision; the checklist is emitted in canonical {@link RELEASE_DECISION_CHECKLIST_IDS} order, deduped.
 */
export function buildDecisionChecklist(
  rollup: ReleaseDecisionRollup,
): ReleaseDecisionChecklistItem[] {
  const wanted = new Set<ReleaseDecisionChecklistId>();

  if (rollup.decision === "invalid")
    wanted.add("resolve-inputs-before-deciding");
  if (rollup.decision === "reject") wanted.add("do-not-proceed-on-rejection");
  if (rollup.decision === "insufficient")
    wanted.add("complete-evidence-before-proceeding");
  if (rollup.decision === "hold") wanted.add("hold-for-internal-review");
  if (rollup.decision === "proceed-with-followup")
    wanted.add("track-recorded-followup");

  // A proceed (clean or with follow-up) → do the handoff out of band + a reminder that this is not an approval.
  if (
    rollup.decision === "proceed" ||
    rollup.decision === "proceed-with-followup"
  ) {
    wanted.add("proceed-with-handoff-out-of-band");
    wanted.add("obtain-external-approval-out-of-band");
  }

  wanted.add("keep-decision-record"); // always the last step — keep the content-free ledger entry

  return RELEASE_DECISION_CHECKLIST_IDS.filter((id) => wanted.has(id)).map(
    (id) => ({
      id,
      detail: RELEASE_DECISION_CHECKLIST_DETAIL[id],
    }),
  );
}

/**
 * Fold the two ingested documents + the `--strict` knob + the run stamp into the full {@link ReleaseDecisionResult}.
 * Pure and deterministic.
 */
export function buildDecisionResult(
  generatedAt: string,
  inputs: IngestedDecisionInputs,
  strict: boolean,
): ReleaseDecisionResult {
  const publishPack = reducePackSummary(
    inputs.pack.supplied,
    inputs.pack.ingested,
  );
  const acknowledgement = reduceAckSummary(
    inputs.ack.supplied,
    inputs.ack.ingested,
  );
  const crossCheck = computeCrossCheck(publishPack, acknowledgement);
  const { rollup, reasons } = computeDecisionRollup(
    publishPack,
    acknowledgement,
    crossCheck.status,
    strict,
  );
  const checklist = buildDecisionChecklist(rollup);

  return {
    schema: RELEASE_DECISION_SCHEMA,
    generatedAt,
    metadata: buildDecisionMetadata(),
    policy: { strict },
    publishPack,
    acknowledgement,
    crossCheck,
    decision: rollup,
    reasons,
    checklist,
    guidance: RELEASE_DECISION_GUIDANCE,
    caveats: RELEASE_DECISION_CAVEATS,
    receipt: buildDecisionReceipt(
      generatedAt,
      publishPack,
      acknowledgement,
      crossCheck,
      rollup,
    ),
  };
}
