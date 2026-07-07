/**
 * Node-free public surface of the secure-worker **release decision closeout governance finalize index trend finalize
 * index trend closeout bundle** (Phase 94).
 *
 * The closeout ingests ONE content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-receipt/1` action-plan
 * execution receipt a release pipeline produced (REQUIRED) plus OPTIONAL related records already on hand (the
 * `…-action-plan/1` plan and the `…-closeout-index-trend/1` trend),
 * RE-VALIDATES the primary receipt against ITSELF (reconstructing its Phase 93 bounded plan-ingest from the source facets
 * it recorded and re-running the Phase 93 `computeReceipt` reducer, so a hand-flipped receipt verdict / ack coverage /
 * exit code is caught as a tamper), CROSS-CHECKS the supplied related records against what the receipt recorded, surfaces
 * the receipt's OWN recorded source-chain posture, and emits one stable, content-free
 * `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1` result: a closeout
 * verdict, a bounded primary-receipt summary, a bounded related-record checklist, a bounded source-chain posture, a
 * bounded rationale + next actions, and a content-free receipt. It answers ONE question a periodic release-governance
 * review needs — "is this closeout-index-trend follow-up loop closed out, still open, incomplete, blocked, or
 * untrustworthy?" — and FAILS CLOSED when the primary receipt cannot be trusted or a required related record is absent.
 *
 * It is a local content-free operational closeout SUMMARY: it makes NO network call, reads NO secret/bucket/object, RUNS
 * no gate / index / decision / trend / plan / receipt / governance / finalize / closeout itself, and archives / deletes /
 * uploads / promotes / approves / signs / mutates NOTHING — NOT a legal / compliance sign-off, an external approval /
 * signature, an identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log.
 * Everything here is pure and safe to import from the CLI entry or a test; the actual filesystem/stdin reads live behind
 * the entry's injected
 * {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutProvider} seam.
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
