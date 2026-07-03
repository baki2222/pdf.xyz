/**
 * The bounded, content-free vocabulary for the secure-worker **release evidence artifact**
 * (Phase 47).
 *
 * Phases 30–46 gave a release operator a family of content-free, offline signals about the secure
 * worker: the deployment-example validator, the no-config honesty smoke + native-engine preflight,
 * the operations snapshot/healthcheck, the cleanup evidence pipeline, the operations evidence bundle
 * (`pnpm worker:ops-bundle`), and — closing the promotion loop — the release readiness gate
 * (`pnpm worker:release-gate`), which RUNS those checks and folds their exit codes into ONE
 * PASS/WARN/FAIL verdict. This phase closes the *archival* loop: it takes that gate result (and,
 * optionally, an ops-bundle summary), stamps it with bounded release/git provenance, and computes an
 * INTEGRITY DIGEST over the whole safe artifact, so a CI job / incident handoff / deployment-approval
 * record can archive a stable, tamper-evident, content-free release evidence artifact —
 *
 *    "Here is exactly what evidence this build carried when it was promoted, and here is a digest
 *     that lets anyone confirm the archived artifact was not altered."
 *
 * This module is the closed vocabulary the artifact produces. It obeys the same honesty contract as
 * the rest of the worker layer, and is deliberately even more content-free than the tools it
 * archives: it never parses a subprocess's stdout/stderr, never copies a free-text string out of an
 * ingested tool result, and reduces every load-bearing field to a low-cardinality, redaction-stable
 * enum or a small integer.
 *  - Every load-bearing token here is a bounded enum — never a filename, object key, bucket, URL,
 *    endpoint, region, id, token, size, instant beyond an ISO stamp, path, byte, or a raw command
 *    line. The one non-enum strings are the app-authored prose, the operator-supplied release LABEL
 *    (validated to a strict charset and redaction-stable, else rejected), a validated git commit
 *    SHORT hash (bounded hex, else null), and the artifact's own INTEGRITY DIGEST (a hex hash of the
 *    canonical, already-content-free body).
 *  - It never fabricates evidence: a missing/unreadable gate result is honestly `unknown` (which
 *    blocks a `pass`), never a false `pass`; an absent optional ops-bundle is `not-configured`
 *    (never a fault); an unknown git state is `unknown` (never a claimed clean/dirty).
 *
 * It is deliberately NOT a new evidence rung, NOT a signature, and NOT a cloud action. The artifact
 * proves nothing the gate does not already prove; it AGGREGATES the gate's result with bounded
 * provenance and computes an integrity hash over the safe aggregate. Its authored caveats (see
 * {@link RELEASE_ARTIFACT_CAVEATS}) say so out loud: it is evidence aggregation + integrity over
 * content-free data — not cryptographic signing, not authentication, not live cloud validation, not
 * deletion proof, and not the promotion itself.
 */

import type { ReleaseCheckId, ReleaseCheckStatus, ReleaseGateVerdict } from "../release-gate/types";
import type { OpsBundleSeverity } from "../ops-bundle/types";

/** The schema tag every release-artifact carries, so tooling can pin the shape it parses. */
export const RELEASE_ARTIFACT_SCHEMA = "pdfxyz.release-artifact/1" as const;

/** Stable identity of the release-artifact policy — for docs / receipts / audit. */
export const RELEASE_ARTIFACT_POLICY_ID = "pdfxyz-worker-release-evidence-artifact";
/** Bump when the artifact schema, the metadata set, the rollup, or the digest scheme changes. */
export const RELEASE_ARTIFACT_POLICY_VERSION = 1;

/**
 * The single archival verdict an operator/CI keys on — an evidence-readiness rollup, aligned 1:1
 * with the gate's promotion decision so an operator reads one ladder end-to-end:
 *  - `pass`    — the gate passed and this build's provenance is clean; a promote-able evidence
 *                artifact;
 *  - `warn`    — no blocker, but an advisory signal was raised (the gate warned, or the working tree
 *                is dirty so the recorded commit does not fully describe the built bytes);
 *  - `fail`    — a blocking release-gate check failed; not a promote-able artifact;
 *  - `unknown` — the gate result could not be obtained/validated; the artifact cannot certify what
 *                it could not read, and will not resolve `pass`.
 *
 * These are the exact bounded values the run-level {@link import("../observability/metrics").WorkerMetricName}
 * `worker_release_artifact_total` carries as its `verdict` label; all four are low-cardinality,
 * redaction-stable tokens.
 */
export const RELEASE_ARTIFACT_VERDICTS = ["pass", "warn", "fail", "unknown"] as const;
export type ReleaseArtifactVerdict = (typeof RELEASE_ARTIFACT_VERDICTS)[number];

/**
 * The exit-code ladder a CI/release job routes on — the same shape as the gate/ops-bundle ladders so
 * the whole worker suite speaks one language:
 *  - `0` PASS    — a promote-able evidence artifact was written;
 *  - `1` USAGE   — the CLI was misused (a bad flag, an invalid release label, an unreadable REQUIRED
 *                  input, or — in `--verify` mode — an unreadable/not-an-artifact file). CLI-owned;
 *  - `2` UNKNOWN — the gate result was indeterminate/absent, or an internal fault occurred;
 *  - `3` WARN    — an advisory signal was raised (gate warn, or a dirty working tree);
 *  - `4` FAIL    — a blocking gate check failed, or (in `--verify` mode) the integrity digest did
 *                  NOT match the recomputed digest (a corrupt / altered artifact).
 * Monotonic — a higher code is always a stronger "do not promote".
 */
export const RELEASE_ARTIFACT_EXIT = {
  PASS: 0,
  USAGE: 1,
  UNKNOWN: 2,
  WARN: 3,
  FAIL: 4,
} as const;
export type ReleaseArtifactExitCode = (typeof RELEASE_ARTIFACT_EXIT)[keyof typeof RELEASE_ARTIFACT_EXIT];

/**
 * The bounded working-tree cleanliness the artifact records — never a diff, a path, or a file count:
 *  - `clean`   — the working tree had no uncommitted changes when the artifact was generated;
 *  - `dirty`   — the working tree had uncommitted changes, so the recorded commit does not fully
 *                describe the built bytes (an advisory `warn`);
 *  - `unknown` — cleanliness could not be determined (not a git repo, git unavailable, or VCS
 *                provenance was suppressed with `--no-vcs`).
 */
export const GIT_CLEANLINESS = ["clean", "dirty", "unknown"] as const;
export type GitCleanliness = (typeof GIT_CLEANLINESS)[number];

/**
 * The bounded classification of the checked-out ref — deliberately a CLASS, never the raw branch
 * name (which can be arbitrary text) and never the remote URL (which can embed a host or credential):
 *  - `default`  — a mainline branch (`main` / `master`);
 *  - `release`  — a release branch or tag (`release/*`, `hotfix/*`, or a `vX.Y.Z`-shaped ref);
 *  - `topic`    — any other named branch (a feature / phase / topic branch);
 *  - `detached` — a detached HEAD (no branch);
 *  - `unknown`  — the ref could not be determined, or VCS provenance was suppressed.
 */
export const REF_CLASSES = ["default", "release", "topic", "detached", "unknown"] as const;
export type RefClass = (typeof REF_CLASSES)[number];

/**
 * The bounded provenance of the archived release-gate result:
 *  - `generated`      — the artifact RAN `worker:release-gate` internally and archived its result;
 *  - `supplied`       — the operator supplied a pre-run gate result file (`--release-gate=<file>`);
 *  - `unreadable`     — the obtained gate result could not be read or recognized (never echoed);
 *  - `not-configured` — no gate result was obtained (should not normally occur; a fail-closed floor).
 */
export const GATE_SOURCES = ["generated", "supplied", "unreadable", "not-configured"] as const;
export type GateSource = (typeof GATE_SOURCES)[number];

/**
 * The bounded provenance of the optional ops-bundle summary:
 *  - `supplied`       — a valid `pdfxyz.ops-bundle/1` summary was attached;
 *  - `not-configured` — none was attached (the honest default, never a fault);
 *  - `unreadable`     — a summary was attached but could not be read/recognized (never echoed).
 */
export const OPS_BUNDLE_SOURCES = ["supplied", "not-configured", "unreadable"] as const;
export type OpsBundleSource = (typeof OPS_BUNDLE_SOURCES)[number];

/**
 * The bounded reasons a rollup escalated off `pass` — a closed set a reader can route on without
 * parsing prose. `dirty-tree` is provenance; the three `gate-*` are the archived gate verdict.
 */
export const RELEASE_ARTIFACT_DRIVERS = [
  "gate-fail",
  "gate-warn",
  "gate-unknown",
  "dirty-tree",
] as const;
export type ReleaseArtifactDriver = (typeof RELEASE_ARTIFACT_DRIVERS)[number];

/** The integrity-digest algorithm the artifact uses (the one bounded value; not operator-selectable). */
export const RELEASE_ARTIFACT_DIGEST_ALGORITHM = "sha256" as const;
/** The digest encoding — lowercase hex. */
export const RELEASE_ARTIFACT_DIGEST_ENCODING = "hex" as const;
/**
 * The canonicalization scheme the digest is computed over: a deterministic, recursively
 * key-sorted, minimally-separated JSON serialization of the artifact BODY (see `./canonicalize`).
 * Named + versioned so a verifier knows exactly how to reproduce the pre-image. This is NOT full
 * RFC 8785 JCS (our body carries only small integers, bounded enums, and app prose, for which
 * `String(n)` number formatting is already canonical), but it IS stable and reproducible.
 */
export const RELEASE_ARTIFACT_CANONICALIZATION = "pdfxyz-sorted-keys/1" as const;

/**
 * The bounded git/release provenance block — everything the artifact records about the build's
 * source, reduced to enums + a validated short hash. NEVER the raw branch name, the remote URL, a
 * path, or a diff.
 */
export interface ReleaseGitProvenance {
  readonly cleanliness: GitCleanliness;
  readonly refClass: RefClass;
  /** A validated abbreviated commit hash (`[0-9a-f]{7,40}`, capped to 12 chars), or `null`. */
  readonly commit: string | null;
  /** Honesty bit: whether a usable bounded commit hash was recorded (`commit !== null`). */
  readonly commitPresent: boolean;
}

/**
 * The bounded release metadata block. Carries the artifact schema/policy identity, the optional
 * operator-supplied label (validated + redaction-stable, else absent), and the git provenance.
 */
export interface ReleaseArtifactMetadata {
  /** The artifact schema version (numeric mirror of the string {@link RELEASE_ARTIFACT_SCHEMA} tag). */
  readonly schemaVersion: number;
  readonly policyId: typeof RELEASE_ARTIFACT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_ARTIFACT_POLICY_VERSION;
  /** An operator-supplied release label (strict charset, redaction-stable), or `null` if none. */
  readonly label: string | null;
  readonly git: ReleaseGitProvenance;
}

/** One archived gate check, reduced to its two bounded enums (no exit codes, no prose, no path). */
export interface ReleaseArtifactGateCheck {
  readonly id: ReleaseCheckId;
  readonly status: ReleaseCheckStatus;
}

/**
 * The archived release-gate result, reduced to bounded values by the ingest trust boundary. Carries
 * the gate's composite verdict, its bounded check counts + blocker ids + per-check statuses, and the
 * bounded provenance of how the result was obtained. It NEVER carries the gate's authored prose,
 * receipt stamp, or any free-text field — all re-authored here from `detail`.
 */
export interface ReleaseArtifactGate {
  readonly source: GateSource;
  /** Whether a usable gate result was ingested (`source === "generated" | "supplied"`). */
  readonly present: boolean;
  readonly verdict: ReleaseGateVerdict;
  readonly includedChecks: number;
  readonly passedChecks: number;
  readonly skippedChecks: number;
  readonly blockers: readonly ReleaseCheckId[];
  readonly checks: readonly ReleaseArtifactGateCheck[];
  /** A one-line, content-free headline authored from `source` + `verdict`. */
  readonly detail: string;
}

/**
 * The optional archived ops-bundle summary, reduced to its bounded composite severity. It is
 * attached CONTEXT for an incident handoff and deliberately does NOT drive the artifact rollup
 * (which is about THIS build's promotion readiness, not a possibly-different runtime's live ops
 * posture). It NEVER carries the bundle's sections, alerts, or any free text.
 */
export interface ReleaseArtifactOpsBundle {
  readonly source: OpsBundleSource;
  /** Whether a valid bundle summary was attached (`source === "supplied"`). */
  readonly present: boolean;
  /** The bundle's composite severity, or `null` unless a valid full bundle was supplied. */
  readonly severity: OpsBundleSeverity | null;
  /** A one-line, content-free headline authored from `source` + `severity`. */
  readonly detail: string;
}

/** The composite rollup — the single verdict + exit code an operator/CI acts on. */
export interface ReleaseArtifactRollup {
  readonly verdict: ReleaseArtifactVerdict;
  readonly exitCode: ReleaseArtifactExitCode;
  /** True iff `verdict === "pass"`. */
  readonly ready: boolean;
  /** The bounded reasons the rollup escalated off `pass` (empty on a clean `pass`). */
  readonly drivers: readonly ReleaseArtifactDriver[];
  readonly detail: string;
}

/**
 * The content-bearing body of the artifact — the exact bytes the integrity digest is computed over
 * (after canonicalization). Everything here is a bounded enum, a small integer, an ISO stamp, or
 * app-authored prose, so the digest attests a fully content-free aggregate. The digest itself lives
 * OUTSIDE the body (in {@link ReleaseArtifactIntegrity}) so it can cover the body without being
 * self-referential.
 */
export interface ReleaseArtifactBody {
  readonly generatedAt: string;
  readonly metadata: ReleaseArtifactMetadata;
  readonly gate: ReleaseArtifactGate;
  readonly opsBundle: ReleaseArtifactOpsBundle;
  readonly rollup: ReleaseArtifactRollup;
  /** Bounded, app-authored operator reminders (out-of-scope steps this artifact does NOT perform). */
  readonly guidance: readonly string[];
  /** Bounded, app-authored honesty caveats. Never derived from any ingested input. */
  readonly caveats: readonly string[];
}

/**
 * The integrity block — a digest of the canonical {@link ReleaseArtifactBody}. It attests that the
 * archived body was not altered; it is NOT a signature (no key, no identity) and proves nothing about
 * the body's meaning beyond byte-stability. The digest is over content-free data, so it is itself
 * safe to log, forward, or print.
 */
export interface ReleaseArtifactIntegrity {
  readonly algorithm: typeof RELEASE_ARTIFACT_DIGEST_ALGORITHM;
  readonly encoding: typeof RELEASE_ARTIFACT_DIGEST_ENCODING;
  readonly canonicalization: typeof RELEASE_ARTIFACT_CANONICALIZATION;
  /** The lowercase-hex digest of the canonical body. */
  readonly digest: string;
}

/**
 * The content-free **audit receipt** one artifact rides alongside its body — the flattened answer
 * to "what did this release evidence artifact resolve to, and what is its integrity anchor" for a
 * SIEM / release record. Bounded enums + small integers + a stable policy id + the content-free
 * digest only; safe to log or forward verbatim. It lives OUTSIDE the body (it references the digest),
 * so it is not itself hashed.
 */
export interface ReleaseArtifactReceipt {
  readonly category: "worker-release-artifact";
  readonly policyId: typeof RELEASE_ARTIFACT_POLICY_ID;
  readonly policyVersion: typeof RELEASE_ARTIFACT_POLICY_VERSION;
  readonly at: string;
  readonly verdict: ReleaseArtifactVerdict;
  readonly exitCode: ReleaseArtifactExitCode;
  /** The archived gate's composite verdict (the primary evidence the artifact carries). */
  readonly gateVerdict: ReleaseGateVerdict;
  /** The build's working-tree cleanliness (the primary provenance signal). */
  readonly cleanliness: GitCleanliness;
  readonly algorithm: typeof RELEASE_ARTIFACT_DIGEST_ALGORITHM;
  /** The content-free integrity digest of the body. */
  readonly digest: string;
}

/** The stable, content-free release evidence artifact an operator archives before promoting a build. */
export interface ReleaseArtifact {
  readonly schema: typeof RELEASE_ARTIFACT_SCHEMA;
  /** The content-bearing, digest-covered body. */
  readonly body: ReleaseArtifactBody;
  /** The integrity digest over the canonical body (NOT part of the body). */
  readonly integrity: ReleaseArtifactIntegrity;
  /** The flattened audit receipt (references the digest; NOT part of the body). */
  readonly receipt: ReleaseArtifactReceipt;
}

/** The process exit code for an artifact. */
export function releaseArtifactExitCode(artifact: ReleaseArtifact): number {
  return artifact.body.rollup.exitCode;
}

/**
 * The bounded reasons a `--verify` (re-verification of a previously written artifact) resolved:
 *  - `verified`        — the recomputed digest matched the archived one over the canonical body;
 *  - `digest-mismatch` — it did NOT match (the archived body was altered / corrupted);
 *  - `malformed-digest`— the archived integrity digest was not a well-formed sha256 hex;
 *  - `unreadable`      — the file was not a recognized `pdfxyz.release-artifact/1` artifact.
 */
export const RELEASE_ARTIFACT_VERIFY_REASONS = [
  "verified",
  "digest-mismatch",
  "malformed-digest",
  "unreadable",
] as const;
export type ReleaseArtifactVerifyReason = (typeof RELEASE_ARTIFACT_VERIFY_REASONS)[number];

/**
 * The bounded, content-free result of re-verifying a previously written artifact. The two hex
 * digests are content-free; a malformed/absent claimed digest is never echoed (`claimedDigest` is
 * empty). `verdict` echoes the archived rollup verdict when the file parsed, else `null`.
 */
export interface ReleaseArtifactVerifyOutcome {
  readonly schema: typeof RELEASE_ARTIFACT_SCHEMA;
  readonly ok: boolean;
  readonly reason: ReleaseArtifactVerifyReason;
  readonly exitCode: ReleaseArtifactExitCode;
  readonly claimedDigest: string;
  readonly computedDigest: string;
  readonly verdict: ReleaseArtifactVerdict | null;
  readonly detail: string;
}

/* ------------------------------------------------------------------ *
 *  Authored prose (never derived from any ingested input)
 * ------------------------------------------------------------------ */

/** The one-line rollup headline per verdict. Authored here, keyed by the enum. */
export const RELEASE_ARTIFACT_VERDICT_SUMMARY: Record<ReleaseArtifactVerdict, string> = {
  pass: "READY: the release gate passed and this build's provenance is clean. A promote-able, integrity-stamped evidence artifact.",
  warn: "READY with a caveat: no blocker, but an advisory signal was raised (the gate warned, or the working tree is dirty so the recorded commit does not fully describe the built bytes). Review before promoting.",
  fail: "NOT READY: a blocking release-gate check failed. This is not a promote-able evidence artifact. Resolve the blocker and regenerate.",
  unknown:
    "EVIDENCE UNKNOWN: the release-gate result could not be obtained or validated. The artifact will not certify a promotion it could not read.",
};

/**
 * The honesty caveats every artifact carries and every text render prints. The artifact AGGREGATES
 * the gate's already-content-free evidence and hashes the safe aggregate; it must never be read as
 * more than that.
 */
export const RELEASE_ARTIFACT_CAVEATS: readonly string[] = [
  "This is a RELEASE EVIDENCE ARTIFACT: it aggregates the offline release-gate result with bounded git/release provenance and computes an integrity digest over the safe, content-free aggregate. It is not itself a new proof, and it does not perform the promotion.",
  "The integrity digest is a plain content hash for TAMPER-EVIDENCE (confirm the archived body was not altered); it is NOT a cryptographic signature — there is no signing key and no attested identity — and it proves nothing about the body's meaning beyond byte-stability.",
  "It is local, offline, and read-only: it makes no network call and reads no provider export, secret, bucket, or object. It cannot validate real cloud state, bucket lifecycle correctness, deletion of bytes, or CDN state.",
  "It archives only bounded enums, small counts, an ISO stamp, app-authored prose, an optional validated release label, a validated short git commit hash, and the digest — so it carries no filename, object key, bucket, URL, endpoint, region, job/user id, IP, token, size, byte, or document content, even from a hostile input.",
  "A `pass` verdict means the archived evidence shows no blocker on THIS build/host — not that every out-of-band concern (real load, data migration, legal retention, provider quotas, secrets management) is resolved. Those remain operator-owned.",
  "It is not malware scanning, sanitization, authentication, or authorization of any request, and it deletes, uploads, or mutates nothing.",
];

/**
 * Operator reminders the artifact carries but does NOT itself perform — the honest edges of an
 * offline evidence archive. Authored, bounded, content-free; never derived from an input.
 */
export const RELEASE_ARTIFACT_GUIDANCE: readonly string[] = [
  "Verify the archived artifact's integrity out of band with `pnpm worker:release-artifact --verify=<file>`, which recomputes the digest over the canonical body and confirms it matches — a mismatch means the archived body was altered.",
  "Run the changed-file no-secret / no-NUL scan separately before promoting: this artifact records the release-gate result but does not diff your working tree for credential-shaped literals or stray NUL bytes.",
  "Archive the artifact generated from the SAME build you intend to promote; a `pass` attests the evidence on THIS build/host, not a later rebuild. A dirty working tree is recorded as `dirty` precisely because the commit hash then does not fully describe the built bytes.",
  "Validate real cloud state out of band: bucket lifecycle rules, object deletion, queue/broker health, and CDN state are not observable from this offline artifact.",
];
