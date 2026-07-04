/**
 * Node-free public surface of the secure-worker **release decision record ledger** (Phase 59).
 *
 * The record ingests a content-free `pdfxyz.release-publish-pack/1` (the Phase 57 publish / handoff pack) and a
 * `pdfxyz.release-ack/1` (the Phase 58 acknowledgement of it), RE-VALIDATES each against ITSELF (reusing the Phase 57
 * pack rollup + re-running the Phase 58 ack rollup, so a hand-flipped verdict / disclosure / decision is caught as a
 * tamper), CROSS-CHECKS that the acknowledgement corresponds to the supplied pack, and emits one stable, content-free
 * `pdfxyz.release-decision/1` document: a bounded decision (proceed / proceed-with-followup / hold / reject /
 * insufficient / invalid), per-source summaries, a coherence cross-check status, and a next-action checklist. It
 * answers ONE question a release ledger needs — "given this publish pack and this acknowledgement of it, what is the
 * recorded decision?" — and FAILS CLOSED when a document cannot be trusted or the pair is incoherent (never a vacuous
 * pass).
 *
 * It is local content-free DECISION RECORDING over two evidence summaries: it makes NO network call, reads NO secret /
 * bucket / object, and NEVER signs, approves, publishes, promotes, deploys, notifies, deletes, or mutates anything —
 * it is NOT an external signature, an approval, an identity attestation, legal / compliance sign-off, or an actual
 * deployment / promotion. Everything here is pure and safe to import from the CLI entry or a test; the actual
 * filesystem/stdin reads live behind the entry's injected {@link ReleaseDecisionProvider} seam.
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
