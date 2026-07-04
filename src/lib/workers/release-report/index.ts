/**
 * Node-free public surface of the secure-worker **release evidence operator report** (Phase 52).
 *
 * The report ingests whichever of a content-free `pdfxyz.release-ci-bundle/1` (this release's evidence
 * coherence) and/or a `pdfxyz.release-audit/1` (regression versus a baseline) a release job produced,
 * RE-VALIDATES each against ITSELF (re-deriving its Phase 50/51 rollup, so a hand-flipped verdict is caught as
 * a tamper), and emits one stable, content-free `pdfxyz.release-report/1` result: the evidence coverage,
 * per-source summaries, a final recommendation + bounded rationale, an archive checklist, and an ordered
 * next-action checklist. It answers ONE question a CI summary / deployment review / incident handoff needs —
 * "what should the operator DO now, based only on the content-free release evidence?" — and FAILS CLOSED when
 * a document cannot be trusted or the primary coherence evidence (a usable bundle) is missing.
 *
 * It is local content-free reporting over evidence: it makes NO network call, reads NO secret/bucket/object,
 * RUNS no stage / bundle / audit itself, and deletes / prunes / uploads / promotes / approves / mutates
 * NOTHING — not signing, auth, cloud validation, storage retention enforcement, deployment approval, or
 * deployment promotion. Everything here is pure and safe to import from the CLI entry or a test; the actual
 * filesystem/stdin reads live behind the entry's injected {@link ReleaseReportProvider} seam.
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
