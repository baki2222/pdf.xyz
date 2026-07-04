/**
 * Node-free public surface of the secure-worker **release evidence publish / handoff pack** (Phase 57).
 *
 * The pack ingests a content-free `pdfxyz.release-governance/1` bundle (the PRIMARY summary judgment) plus,
 * optionally, the related content-free `pdfxyz.release-archive/1`, `pdfxyz.release-restore-drill/1`,
 * `pdfxyz.release-report/1`, and/or `pdfxyz.release-trend/1` a release pipeline produced, RE-VALIDATES each against
 * ITSELF (reusing the Phase 51–56 boundaries, so a hand-flipped verdict / posture / recommendation is caught as a
 * tamper), and emits one stable, content-free `pdfxyz.release-publish-pack/1` result: the evidence coverage,
 * per-source summaries, a publish verdict, a DISCLOSURE CLASSIFICATION (share-safe / internal-review / blocked),
 * and a handoff checklist. It answers ONE question an operator handing a release-evidence package to an external
 * reviewer / approver / investor / incident responder needs — "is this package safe to share, with whom, and what
 * bounded evidence should it include?" — and FAILS CLOSED when a document cannot be trusted or the primary
 * governance evidence is missing / insufficient.
 *
 * It is local content-free HANDOFF PACKAGING over evidence summaries: it makes NO network call, reads NO
 * secret/bucket/object, RUNS no gate / bundle / audit / report / trend / governance / archive / restore-drill
 * itself, and NEVER publishes, shares, sends, uploads, signs, approves, promotes, deletes, or mutates anything —
 * not external publishing, signing, approval, legal / compliance sign-off, release promotion, cloud validation, or
 * deletion. Everything here is pure and safe to import from the CLI entry or a test; the actual filesystem/stdin
 * reads live behind the entry's injected {@link ReleasePublishPackProvider} seam.
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
