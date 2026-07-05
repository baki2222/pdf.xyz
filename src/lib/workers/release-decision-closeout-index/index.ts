/**
 * Node-free public surface of the secure-worker **release decision closeout index** (Phase 65).
 *
 * The index ingests a bounded history of content-free `pdfxyz.release-decision-closeout/1` closeout records a release
 * pipeline produced, RE-VALIDATES each against ITSELF (re-deriving its Phase 64 closeout rollup from its own recorded
 * receipt-source + related-record signals + policy, so a hand-flipped closeout verdict / exit / rollup is caught as a
 * tamper), and emits one stable, content-free `pdfxyz.release-decision-closeout-index/1` result: the closeout-verdict
 * distribution, the latest / oldest closeout verdict, a per-record posture sequence, a final index verdict + bounded
 * reasons, and an ordered next-action checklist. It answers ONE question a release-closeout review needs — "across the
 * recent release decision closeouts, are we consistently closed, or is the latest / recent history open, incomplete,
 * or blocked?" — and FAILS CLOSED when a closeout cannot be trusted or the history is inconclusive.
 *
 * It is a local content-free closeout-ledger INDEX SUMMARY over closeout records: it makes NO network call, reads NO
 * secret/bucket/object, RUNS no gate / index / decision / trend / plan / receipt / closeout itself, and deletes /
 * prunes / uploads / promotes / approves / signs / mutates NOTHING — not a legal audit log, a compliance attestation,
 * an external approval / signature, an identity proof, or a deployment / promotion ledger. Everything here is pure and
 * safe to import from the CLI entry or a test; the actual filesystem/stdin reads live behind the entry's injected
 * {@link ReleaseDecisionCloseoutIndexProvider} seam.
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
