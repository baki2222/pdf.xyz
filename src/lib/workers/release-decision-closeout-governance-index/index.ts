/**
 * Node-free public surface of the secure-worker **release decision closeout governance index** (Phase 70).
 *
 * The index ingests a bounded history of content-free `pdfxyz.release-decision-closeout-governance/1` governance bundles
 * a release pipeline produced, RE-VALIDATES each against ITSELF (re-deriving its Phase 69 governance rollup from its own
 * recorded primary-receipt source facets + per-kind related-record signals + policy, so a hand-flipped governance
 * verdict / exit / rollup — or a flipped cross-check / posture signal — is caught as a tamper), and emits one stable,
 * content-free `pdfxyz.release-decision-closeout-governance-index/1` result: the governance-verdict distribution, the
 * latest / oldest governance verdict, a per-record posture sequence, a final index verdict + bounded reasons, and an
 * ordered next-action checklist. It answers ONE question a release-governance review needs — "across the recent release
 * closeout governance bundles, is the latest governance state consistently closed, or is the latest / recent history
 * open, incomplete, or blocked?" — and FAILS CLOSED when a bundle cannot be trusted or the history is inconclusive.
 *
 * It is a local content-free governance-history INDEX SUMMARY over governance bundles: it makes NO network call, reads
 * NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt / closeout / governance itself, and
 * deletes / prunes / uploads / promotes / approves / signs / mutates NOTHING — not a legal audit log, a compliance
 * attestation, an external approval / signature, an identity proof, or a deployment / promotion ledger. Everything here
 * is pure and safe to import from the CLI entry or a test; the actual filesystem/stdin reads live behind the entry's
 * injected {@link ReleaseDecisionCloseoutGovernanceIndexProvider} seam.
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
