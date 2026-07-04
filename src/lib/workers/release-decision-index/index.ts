/**
 * Node-free public surface of the secure-worker **release decision ledger index** (Phase 60).
 *
 * The index ingests a bounded batch of content-free `pdfxyz.release-decision/1` decision records a release pipeline
 * produced, RE-VALIDATES each against ITSELF (re-deriving its Phase 59 decision, so a hand-flipped decision is
 * caught as a tamper), and emits one stable, content-free `pdfxyz.release-decision-index/1` result: the decision
 * distribution, per-source posture counts, a per-record posture sequence, a final index verdict + bounded reasons,
 * and an ordered next-action checklist. It answers ONE question a release-decision review needs — "over the batch of
 * release decisions, what did they decide, is anything blocking / inconclusive / untrustworthy, and what follow-up
 * is warranted?" — and FAILS CLOSED when a record cannot be trusted or the batch is inconclusive.
 *
 * It is a local content-free ledger INDEX SUMMARY over decision records: it makes NO network call, reads NO secret/
 * bucket/object, RUNS no gate / bundle / audit / report / decision itself, and deletes / prunes / uploads /
 * promotes / approves / signs / mutates NOTHING — not a legal audit log, a compliance attestation, an external
 * approval / signature, an identity proof, or a deployment / promotion ledger. Everything here is pure and safe to
 * import from the CLI entry or a test; the actual filesystem/stdin reads live behind the entry's injected
 * {@link ReleaseDecisionIndexProvider} seam.
 */

export * from "./types";
export * from "./args";
export * from "./ingest";
export * from "./reduce";
export * from "./rollup";
export * from "./receipt";
export * from "./build";
export * from "./render";
export * from "./run";
export * from "./metrics";
