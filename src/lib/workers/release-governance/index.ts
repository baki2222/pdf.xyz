/**
 * Node-free public surface of the secure-worker **release evidence governance bundle** (Phase 54).
 *
 * The bundle ingests a content-free `pdfxyz.release-trend/1` window summary (the PRIMARY signal) plus,
 * optionally, the latest content-free `pdfxyz.release-report/1` and/or `pdfxyz.release-audit/1` a release
 * pipeline produced, RE-VALIDATES each against ITSELF (re-deriving the trend's Phase 53 verdict, the report's
 * Phase 52 recommendation, and the audit's Phase 51 rollup, so a hand-flipped verdict is caught as a tamper),
 * cross-checks the latest report against the trend's own newest report, and emits one stable, content-free
 * `pdfxyz.release-governance/1` result: the evidence coverage, per-source summaries, a governance verdict +
 * bounded reasons, an archive checklist, and an ordered follow-up assignment list. It answers ONE question a
 * weekly / monthly release-governance review needs — "what is the governance posture for this review window,
 * what bounded evidence should be archived, and what follow-up should be assigned?" — and FAILS CLOSED when a
 * document cannot be trusted or the primary trend evidence is missing / insufficient.
 *
 * It is local content-free governance bundling over evidence summaries: it makes NO network call, reads NO
 * secret/bucket/object, RUNS no gate / bundle / audit / report / trend itself, and deletes / prunes / uploads /
 * promotes / approves / mutates NOTHING — not signing, auth, cloud validation, storage retention enforcement,
 * deployment approval, or deployment promotion. Everything here is pure and safe to import from the CLI entry or
 * a test; the actual filesystem/stdin reads live behind the entry's injected {@link ReleaseGovernanceProvider}
 * seam.
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
