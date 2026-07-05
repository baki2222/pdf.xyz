/**
 * Node-free public surface of the secure-worker **release decision closeout index trend** (Phase 66).
 *
 * The trend ingests a bounded history of content-free `pdfxyz.release-decision-closeout-index/1` windows a release
 * pipeline produced, RE-VALIDATES each against ITSELF (re-deriving its Phase 65 index verdict from its own recorded
 * ledger AND re-checking those counts against the window's own per-record sequence, so a hand-flipped index is caught
 * as a tamper), and emits one stable, content-free `pdfxyz.release-decision-closeout-index-trend/1` result: the
 * per-window index-verdict distribution, the aggregate closeout distribution, a per-window posture sequence, an arc
 * direction + trend class, a final trend verdict + bounded reasons, and an ordered next-action checklist. It answers
 * ONE question a periodic release-governance review needs — "over the recent history of closeout-index windows, are the
 * closeouts trending stable / improving, watching, incomplete, or blocked, and what follow-up is warranted?" — and
 * FAILS CLOSED when a window cannot be trusted or the history is inconclusive.
 *
 * It is a local content-free closeout-index TREND SUMMARY over closeout-index windows: it makes NO network call, reads
 * NO secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt / closeout itself, and deletes /
 * prunes / uploads / promotes / approves / signs / mutates NOTHING — not a legal audit log, a compliance attestation,
 * an external approval / signature, an identity proof, or a deployment / promotion ledger. Everything here is pure and
 * safe to import from the CLI entry or a test; the actual filesystem/stdin reads live behind the entry's injected
 * {@link ReleaseDecisionCloseoutIndexTrendProvider} seam.
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
