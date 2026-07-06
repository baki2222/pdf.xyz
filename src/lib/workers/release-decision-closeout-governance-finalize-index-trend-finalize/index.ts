/**
 * Node-free public surface of the secure-worker **release decision closeout governance finalize index trend FINALIZATION
 * record** (Phase 79).
 *
 * The record ingests a REQUIRED content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1` primary receipt (Phase 78) plus,
 * optionally, the source-chain records it was built from (the Phase 77 follow-up plan, the Phase 76 finalize-index trend,
 * the Phase 75 finalize index, and the Phase 74 finalization bundle), RE-VALIDATES each against ITSELF through the
 * existing Phase 74–78 boundaries (so a hand-flipped verdict is caught as a tamper), CROSS-CHECKS each supplied record
 * against what its downstream record recorded, folds every supplied source-chain record's own bounded posture, and emits
 * one stable, content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1` result: a
 * finalization verdict + a per-source posture, a source-chain checklist, a bounded next-action list, and a content-free
 * receipt. It answers ONE question a periodic release-governance review needs — "given the content-free finalization-index
 * trend follow-up receipt and optional source-chain records, is this follow-up loop FINALIZED, OPEN, INCOMPLETE, BLOCKED,
 * or untrustworthy?" — and FAILS CLOSED when the primary receipt cannot be trusted or a supplied record contradicts /
 * blocks the loop.
 *
 * It is a local content-free operational FINALIZATION record: it makes NO network call, reads NO secret/bucket/object,
 * RUNS no gate / index / decision / trend / finalize / plan / governance / closeout / receipt itself, and deletes /
 * prunes / uploads / promotes / approves / signs / mutates NOTHING — NOT a legal / compliance sign-off, an external
 * approval / signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an
 * audit log. Everything here is pure and safe to import from the CLI entry or a test; the actual filesystem/stdin reads
 * live behind the entry's injected
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeProvider} seam.
 */

export * from "./types";
export * from "./args";
export * from "./ingest";
export * from "./reduce";
export * from "./receipt";
export * from "./build";
export * from "./render";
export * from "./run";
export * from "./metrics";
