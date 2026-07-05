/**
 * Node-free public surface of the secure-worker **release decision closeout bundle** (Phase 64).
 *
 * The closeout ingests ONE content-free `pdfxyz.release-decision-action-receipt/1` execution receipt a release pipeline
 * produced (REQUIRED) plus OPTIONAL related records already on hand — the `pdfxyz.release-decision-action-plan/1` plan the
 * receipt receipted, the `pdfxyz.release-decision-trend/1` trend the plan folded, and the `pdfxyz.release-decision/1` /
 * `pdfxyz.release-decision-index/1` ledger records upstream — RE-VALIDATES the primary receipt against ITSELF
 * (reconstructing its Phase 63 bounded decision from the source facets it recorded and re-running the Phase 63
 * `computeReceipt` reducer, so a hand-flipped receipt verdict / ack coverage / exit code is caught as a tamper),
 * CROSS-CHECKS each supplied related record against what the receipt recorded, and emits one stable, content-free
 * `pdfxyz.release-decision-closeout/1` result: a closeout verdict + the primary receipt's state / verdict, a bounded
 * related-record checklist, a bounded rationale, and a content-free receipt. It answers ONE question a periodic
 * release-governance review needs — "is this release decision governance chain closed out, still open, incomplete, or
 * blocked?" — and FAILS CLOSED when the primary receipt cannot be trusted or a required related record is absent.
 *
 * It is a local content-free operational closeout SUMMARY: it makes NO network call, reads NO secret/bucket/object, RUNS
 * no gate / index / decision / trend / plan / receipt itself, and deletes / prunes / uploads / promotes / approves /
 * signs / mutates NOTHING — NOT a legal / compliance sign-off, an external approval / signature, an identity proof, a
 * deployment authorization, a promotion ledger, an incident record, or an audit log. Everything here is pure and safe to
 * import from the CLI entry or a test; the actual filesystem/stdin reads live behind the entry's injected
 * {@link ReleaseDecisionCloseoutProvider} seam.
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
