/**
 * Node-free public surface of the secure-worker **release decision closeout governance finalize index** (Phase 80).
 *
 * The index ingests a bounded history of content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1`
 * finalization records a release pipeline produced, RE-VALIDATES each against ITSELF (re-deriving its Phase 79
 * finalization rollup from its own recorded primary-receipt source facets + per-kind related-record signals + policy, so
 * a hand-flipped finalization verdict / exit / rollup — or a flipped cross-check / posture signal — is caught as a
 * tamper), and emits one stable, content-free `pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index/1` result: the
 * finalization-verdict distribution, a bounded summary of the newest usable finalization, a per-record posture
 * sequence, a final index verdict + bounded reasons, and an ordered next-action checklist. It answers ONE question a
 * finalization review needs — "across the recent closeout-governance finalization records, is the latest finalization
 * state consistently finalized, or is the latest / recent history open, incomplete, blocked, or untrustworthy?" — and
 * FAILS CLOSED when a record cannot be trusted or the history is inconclusive.
 *
 * It is a local content-free finalization-history INDEX SUMMARY over finalization records: it makes NO network call,
 * reads NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt / closeout / governance /
 * finalize itself, and deletes / prunes / uploads / promotes / approves / signs / mutates NOTHING — not a legal audit
 * log, a compliance attestation, an external approval / signature, an identity proof, or a deployment / promotion
 * ledger. Everything here is pure and safe to import from the CLI entry or a test; the actual filesystem/stdin reads
 * live behind the entry's injected {@link ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexProvider} seam.
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
