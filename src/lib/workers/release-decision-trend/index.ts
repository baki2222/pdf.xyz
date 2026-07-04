/**
 * Node-free public surface of the secure-worker **release decision index trend summary** (Phase 61).
 *
 * The trend ingests a bounded history of content-free `pdfxyz.release-decision-index/1` ledger windows a release
 * pipeline produced, RE-VALIDATES each against ITSELF (re-deriving its Phase 60 index verdict from its own recorded
 * ledger counts AND re-checking those counts against the window's own per-record sequence, so a hand-flipped index is
 * caught as a tamper), and emits one stable, content-free `pdfxyz.release-decision-trend/1` result: the per-window
 * index-verdict distribution, the aggregate decision distribution, a per-window posture sequence, an arc direction +
 * trend class, a final trend verdict + bounded reasons, and an ordered next-action checklist. It answers ONE question
 * a periodic release-governance review needs — "over the recent history of release-decision ledger windows, are the
 * decisions improving, stable, or degrading, is anything blocking / inconclusive / untrustworthy, and what follow-up
 * is warranted?" — and FAILS CLOSED when a window cannot be trusted or the history is inconclusive.
 *
 * It is a local content-free ledger-index TREND SUMMARY over decision-index windows: it makes NO network call, reads
 * NO secret/bucket/object, RUNS no gate / index / decision itself, and deletes / prunes / uploads / promotes /
 * approves / signs / mutates NOTHING — not a legal audit log, a compliance attestation, an external approval /
 * signature, an identity proof, or a deployment / promotion ledger. Everything here is pure and safe to import from
 * the CLI entry or a test; the actual filesystem/stdin reads live behind the entry's injected
 * {@link ReleaseDecisionTrendProvider} seam.
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
