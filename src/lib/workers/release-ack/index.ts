/**
 * Node-free public surface of the secure-worker **release evidence handoff acknowledgement receipt** (Phase 58).
 *
 * The receipt ingests a content-free `pdfxyz.release-publish-pack/1` (the Phase 57 publish / handoff pack),
 * RE-VALIDATES it against ITSELF (reusing the Phase 57 rollup, so a hand-flipped verdict / disclosure is caught as a
 * tamper), applies a bounded acknowledgement DECISION the operator supplies, and emits one stable, content-free
 * `pdfxyz.release-ack/1` receipt: an acknowledgement verdict, a bounded source summary (the pack's own verdict /
 * disclosure / source counts), the recorded decision + reviewer CLASS + note CLASS, and a next-action checklist. It
 * answers ONE question a handoff record needs — "this publish pack was reviewed / received; what bounded outcome was
 * chosen, and what happens next?" — and FAILS CLOSED when the pack cannot be trusted (never a vacuous pass).
 *
 * It is local content-free ACKNOWLEDGEMENT over an evidence summary: it makes NO network call, reads NO secret /
 * bucket / object, and NEVER signs, approves, publishes, promotes, notifies, deletes, or mutates anything — it is NOT
 * an external signature, an approval, an identity attestation, legal / compliance sign-off, or a release promotion.
 * Everything here is pure and safe to import from the CLI entry or a test; the actual filesystem/stdin reads live
 * behind the entry's injected {@link ReleaseAckProvider} seam.
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
