/**
 * Node-free public surface of the secure-worker **release evidence audit / diff** (Phase 51).
 *
 * The audit ingests two (or a history of) content-free `pdfxyz.release-ci-bundle/1` bundles — a BASELINE
 * and a CURRENT — RE-VALIDATES each bundle against ITSELF (re-deriving its Phase 50 rollup, so a hand-
 * flipped bundle verdict is caught as a tamper), DIFFS their bounded postures, and emits one stable,
 * content-free `pdfxyz.release-audit/1` result: per-slot summaries, the regression findings, a rollup
 * verdict + exit code, the next safe operator action, and honesty caveats. It answers ONE question a CI
 * regression gate / operator handoff needs — "did this release's evidence posture REGRESS versus a
 * baseline/history, and what bounded next action should the operator take?" — and FAILS CLOSED when a
 * bundle cannot be trusted or the posture regressed in a blocking way.
 *
 * It is local content-free audit/diff over evidence: it makes NO network call, reads NO secret/bucket/
 * object, RUNS no stage or bundle itself, and deletes/prunes/uploads/promotes/mutates NOTHING — not
 * signing, auth, cloud validation, storage retention enforcement, or deployment promotion. Everything here
 * is pure and safe to import from the CLI entry or a test; the actual filesystem/stdin reads live behind
 * the entry's injected {@link ReleaseAuditProvider} seam.
 */

export * from "./types";
export * from "./args";
export * from "./ingest";
export * from "./reduce";
export * from "./compare";
export * from "./rollup";
export * from "./receipt";
export * from "./build";
export * from "./render";
export * from "./run";
export * from "./metrics";
