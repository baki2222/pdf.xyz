/**
 * Node-free public surface of the secure-worker **release decision closeout governance action-plan execution receipt**
 * (Phase 73).
 *
 * The receipt ingests ONE content-free `pdfxyz.release-decision-closeout-governance-action-plan/1` follow-up plan a
 * release pipeline produced plus a small set of bounded operator acknowledgement flags, RE-VALIDATES the plan against
 * ITSELF (reconstructing its Phase 72 bounded decision from the source-trend details it recorded and re-running the Phase
 * 72 `computeGovernanceActionPlan` reducer, so a hand-flipped plan verdict / action class / exit code is caught as a
 * tamper), and emits one stable, content-free `pdfxyz.release-decision-closeout-governance-action-receipt/1` result: a
 * receipt verdict + the resolved plan class, a bounded acknowledgement checklist, a bounded rationale, and a content-free
 * receipt. It answers ONE question a periodic release-governance review needs — "given this content-free governance
 * follow-up plan and the operator's bounded acknowledgements, were the plan's required follow-ups closed out for the
 * release governance record?" — and FAILS CLOSED when the plan cannot be trusted or a required acknowledgement is absent.
 *
 * It is a local content-free operational execution receipt: it makes NO network call, reads NO secret/bucket/object,
 * RUNS no gate / index / decision / trend / plan / governance / closeout itself, and deletes / prunes / uploads /
 * promotes / approves / signs / mutates NOTHING — NOT a legal / compliance sign-off, an external approval / signature, an
 * identity proof, a deployment authorization, a promotion ledger, an incident record, or an audit log. Everything here is
 * pure and safe to import from the CLI entry or a test; the actual filesystem/stdin reads live behind the entry's
 * injected {@link ReleaseDecisionCloseoutGovernanceActionReceiptProvider} seam.
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
