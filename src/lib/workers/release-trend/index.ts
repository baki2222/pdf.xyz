/**
 * Node-free public surface of the secure-worker **release evidence trend summary** (Phase 53).
 *
 * The trend ingests a bounded history of content-free `pdfxyz.release-report/1` operator reports a release
 * pipeline produced, RE-VALIDATES each against ITSELF (re-deriving its Phase 52 recommendation, so a
 * hand-flipped recommendation is caught as a tamper), and emits one stable, content-free `pdfxyz.release-trend/1`
 * result: the recommendation distribution, a per-report posture sequence, a final trend verdict + bounded
 * reasons, and an ordered follow-up checklist. It answers ONE question a weekly / monthly release-governance
 * review needs — "how has release evidence posture changed over the recent report history, and what bounded
 * operator follow-up is warranted?" — and FAILS CLOSED when a report cannot be trusted or the history is
 * insufficient.
 *
 * It is local content-free trend reporting over evidence reports: it makes NO network call, reads NO secret/
 * bucket/object, RUNS no gate / bundle / audit / report itself, and deletes / prunes / uploads / promotes /
 * approves / mutates NOTHING — not signing, auth, cloud validation, storage retention enforcement, deployment
 * approval, or deployment promotion. Everything here is pure and safe to import from the CLI entry or a test;
 * the actual filesystem/stdin reads live behind the entry's injected {@link ReleaseTrendProvider} seam.
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
