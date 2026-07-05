/**
 * Node-free public surface of the secure-worker **release decision closeout governance bundle** (Phase 69).
 *
 * The bundle ingests a REQUIRED content-free `pdfxyz.release-decision-closeout-action-receipt/1` primary receipt plus,
 * optionally, the related closeout-chain records it was built from (the follow-up plan, the closeout-index trend, the
 * closeout index, and the closeout bundle), RE-VALIDATES each against ITSELF through the existing Phase 64–68 boundaries
 * (so a hand-flipped verdict is caught as a tamper), CROSS-CHECKS the supplied plan / trend against what the primary
 * receipt recorded, folds every supplied source-chain record's own bounded posture, and emits one stable, content-free
 * `pdfxyz.release-decision-closeout-governance/1` result: a governance verdict + a per-source posture, a related-record
 * checklist, an archive checklist, a bounded follow-up assignment list, and a content-free receipt. It answers ONE
 * question a periodic release-governance review needs — "is this closeout governance chain fully CLOSED, OPEN,
 * INCOMPLETE, or BLOCKED?" — and FAILS CLOSED when the primary receipt cannot be trusted or a supplied record
 * contradicts / blocks the chain.
 *
 * It is a local content-free operational governance bundle: it makes NO network call, reads NO secret/bucket/object,
 * RUNS no gate / index / decision / trend / plan / closeout / receipt itself, and deletes / prunes / uploads / promotes /
 * approves / signs / mutates NOTHING — NOT a legal / compliance sign-off, an external approval / signature, an identity
 * proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. Everything here is pure and
 * safe to import from the CLI entry or a test; the actual filesystem/stdin reads live behind the entry's injected
 * {@link ReleaseDecisionCloseoutGovernanceProvider} seam.
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
