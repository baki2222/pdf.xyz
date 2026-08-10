/**
 * The static **check catalog** for the release readiness gate (Phase 46).
 *
 * Each entry declares ONE already-safe worker command, the exact bounded exit code it must return
 * to pass, whether a mismatch is blocking (`fail`) or advisory (`warn`), and the app-authored prose
 * the report surfaces. The `script` + `args` are the ONLY place a command line / fixture path lives;
 * they are consumed by the CLI entry's spawn seam to run the check, and are DELIBERATELY never
 * copied into a {@link ReleaseCheckOutcome} or any rendered report — the gate serializes only the
 * bounded id, status, exit codes, and authored prose.
 *
 * Every command here is offline, read-only, deterministic (fixed args over committed content-free
 * fixtures, or a no-config environment), and already covered by its own tool's tests — the gate
 * composes them, it does not re-implement them. The expected exit codes are pinned to each tool's
 * documented ladder (see the per-check note); a test asserts the catalog ids match
 * {@link RELEASE_CHECK_IDS} so the two can never drift.
 */

import type { ReleaseCheckId, ReleaseCheckSeverity } from "./types";

/** A committed, content-free fixture the deterministic checks run over (paths never leave here). */
const HEALTHCHECK = "docs/examples/observability/healthcheck";
const OPS_BUNDLE = "docs/examples/ops-bundle";
const CLEANUP = "docs/examples/cleanup-project";
const LIFECYCLE = "docs/examples/lifecycle";

/**
 * A fixed clock the cleanup-pipeline arms evaluate retention evidence against, so their exit codes
 * are deterministic regardless of when the gate runs. Matches the committed CI fixtures.
 */
const PINNED_NOW = "1700000000000";

/**
 * One composed check. `script` + `args` drive the subprocess (`pnpm -s <script> <...args>`) and are
 * internal-only; `expectedExit`, `severity`, and the authored prose drive the bounded report.
 */
export interface ReleaseCheckSpec {
  readonly id: ReleaseCheckId;
  /** The pnpm script to run (a public, content-free script name). */
  readonly script: string;
  /** Fixed, authored args — committed fixture paths / flags only, never operator input. */
  readonly args: readonly string[];
  /** The exit code the check must return to pass. */
  readonly expectedExit: number;
  /** Whether a mismatch blocks promotion (`fail`) or is advisory (`warn`). */
  readonly severity: ReleaseCheckSeverity;
  /** A one-line, content-free title for the check (no path, no raw command). */
  readonly title: string;
  /** The authored headline when the check passes. */
  readonly passSummary: string;
  /** The authored next-step text when the check does not pass. Names public commands, never paths. */
  readonly remediation: string;
}

/**
 * The ordered catalog. Order is the display/run order; the rollup is order-independent.
 *
 * Exit-code contracts (each pinned to the composed tool's documented ladder):
 *  - `deploy:examples:check`  → 0 when every committed blueprint is structurally valid & secret-free.
 *  - `worker:smoke`           → 0 when the daemon honors its whole no-config exit-code contract
 *                               (also exercises lifecycle policy/verify/drift internally).
 *  - `worker:engines`         → 0 when no REQUIRED native engine is missing (the honest default in a
 *                               bare host). ADVISORY: the gate host may differ from the deployed
 *                               worker image, so a mismatch here warns rather than blocks.
 *  - `worker:ops-check`       → 0 for the healthy snapshot fixture; 4 for the lifecycle-drift
 *                               fixture (proves the healthcheck is not falsely green).
 *  - `worker:ops-bundle`      → 0 for the healthy composed fixture; 4 for the critical one.
 *  - `worker:cleanup-pipeline`→ 2 for a clean export with NO backend wired (the honest "cannot prove
 *                               absence" band — never a false 0); 4 for a present-but-tombstoned
 *                               export (proves fail-closed breach detection).
 *  - `worker:daemon --lifecycle-verify` → 0 for a matching observed export; 4 for a drifted one.
 */
export const RELEASE_CHECKS: readonly ReleaseCheckSpec[] = [
  {
    id: "deploy-examples",
    script: "deploy:examples:check",
    args: [],
    expectedExit: 0,
    severity: "fail",
    title: "Deployment blueprints are structurally valid and secret-free",
    passSummary:
      "All committed deployment example files validated (structure + no-secret invariants).",
    remediation:
      "Re-run `pnpm deploy:examples:check` to see which blueprint is missing, malformed, or carries a credential-shaped literal, and fix it before promoting.",
  },
  {
    id: "worker-smoke",
    script: "worker:smoke",
    args: [],
    expectedExit: 0,
    severity: "fail",
    title: "The worker daemon honors its no-config honesty contract",
    passSummary:
      "The daemon refuses to fabricate work, rejects bad flags, reports clean guardrails, and verifies lifecycle policy offline — all with the expected exit codes.",
    remediation:
      "Re-run `pnpm worker:smoke` to see which honest-refusal or lifecycle assertion regressed; a mismatch means the daemon's failure modes are no longer truthful.",
  },
  {
    id: "worker-engines",
    script: "worker:engines",
    args: [],
    expectedExit: 0,
    severity: "warn",
    title: "Native engine preflight is satisfied on this host",
    passSummary:
      "No required native engine is missing on the gate host (or none is required).",
    remediation:
      "Re-run `pnpm worker:engines` on the ACTUAL worker image/host: a required engine (opted in via a require flag) is missing. This gate's host may differ from the deployed image, so this is advisory — confirm on the image build.",
  },
  {
    id: "ops-check-healthy",
    script: "worker:ops-check",
    args: [`--file=${HEALTHCHECK}/healthy.json`, "--json"],
    expectedExit: 0,
    severity: "fail",
    title: "The operations healthcheck reads a healthy snapshot as healthy",
    passSummary:
      "worker:ops-check resolved the healthy snapshot fixture to a healthy verdict (exit 0).",
    remediation:
      "Re-run `pnpm worker:ops-check --file=<healthy snapshot> --json`: the healthcheck no longer classifies a healthy snapshot as healthy, so its verdict cannot be trusted.",
  },
  {
    id: "ops-check-critical",
    script: "worker:ops-check",
    args: [`--file=${HEALTHCHECK}/lifecycle-drift.json`, "--json"],
    expectedExit: 4,
    severity: "fail",
    title: "The operations healthcheck flags a critical snapshot as critical",
    passSummary:
      "worker:ops-check resolved the lifecycle-drift snapshot fixture to a critical verdict (exit 4).",
    remediation:
      "Re-run `pnpm worker:ops-check --file=<critical snapshot> --json`: the healthcheck failed to flag a critical (lifecycle-drift) snapshot, so it could pass a broken stack as healthy.",
  },
  {
    id: "ops-bundle-healthy",
    script: "worker:ops-bundle",
    args: [`--ops-check=${OPS_BUNDLE}/ops-check-healthy.json`, "--json"],
    expectedExit: 0,
    severity: "fail",
    title:
      "The operations evidence bundle composes a healthy result as healthy",
    passSummary:
      "worker:ops-bundle composed the healthy ops-check fixture to a healthy rollup (exit 0).",
    remediation:
      "Re-run `pnpm worker:ops-bundle --ops-check=<healthy result> --json`: the aggregator no longer composes a healthy input to a healthy rollup.",
  },
  {
    id: "ops-bundle-critical",
    script: "worker:ops-bundle",
    args: [`--ops-check=${OPS_BUNDLE}/ops-check-critical.json`, "--json"],
    expectedExit: 4,
    severity: "fail",
    title:
      "The operations evidence bundle composes a critical result as critical",
    passSummary:
      "worker:ops-bundle composed the critical ops-check fixture to a critical rollup (exit 4).",
    remediation:
      "Re-run `pnpm worker:ops-bundle --ops-check=<critical result> --json`: the aggregator failed to surface a critical composed signal, so it could pass a broken stack.",
  },
  {
    id: "cleanup-pipeline-unknown",
    script: "worker:cleanup-pipeline",
    args: [
      `--file=${CLEANUP}/raw-evidence-projected.json`,
      `--now=${PINNED_NOW}`,
    ],
    expectedExit: 2,
    severity: "fail",
    title:
      "The cleanup pipeline reports honest 'unknown' when absence cannot be proven",
    passSummary:
      "worker:cleanup-pipeline resolved a clean export with no backend wired to the honest 'cannot prove absence' band (exit 2), not a false clean pass.",
    remediation:
      "Re-run `pnpm worker:cleanup-pipeline --file=<clean export> --now=<epoch>`: the pipeline no longer reports the honest 'unknown' band without a wired backend — a regression toward a false clean pass.",
  },
  {
    id: "cleanup-pipeline-breach",
    script: "worker:cleanup-pipeline",
    args: [
      `--file=${CLEANUP}/raw-unsafe-tombstoned.json`,
      `--now=${PINNED_NOW}`,
    ],
    expectedExit: 4,
    severity: "fail",
    title:
      "The cleanup pipeline fails closed on a present-but-tombstoned object",
    passSummary:
      "worker:cleanup-pipeline resolved a present-but-tombstoned export to a composite breach (exit 4).",
    remediation:
      "Re-run `pnpm worker:cleanup-pipeline --file=<tombstoned export> --now=<epoch>`: the pipeline failed to fail-closed on an unsafe (present-but-tombstoned) export.",
  },
  {
    id: "lifecycle-verify",
    script: "worker:daemon",
    args: [
      "--lifecycle-verify",
      "--provider=aws-s3",
      "--versioned",
      `--observed=${LIFECYCLE}/observed-verified.aws-s3.json`,
    ],
    expectedExit: 0,
    severity: "fail",
    title: "Lifecycle verification accepts a matching observed policy",
    passSummary:
      "worker:daemon --lifecycle-verify accepted a matching observed export as verified (exit 0).",
    remediation:
      "Re-run `pnpm worker:daemon --lifecycle-verify --provider=aws-s3 --versioned --observed=<matching export>`: lifecycle verification no longer accepts a matching policy.",
  },
  {
    id: "lifecycle-drift",
    script: "worker:daemon",
    args: [
      "--lifecycle-verify",
      "--provider=aws-s3",
      "--versioned",
      `--observed=${LIFECYCLE}/observed-drift-weaker.aws-s3.json`,
    ],
    expectedExit: 4,
    severity: "fail",
    title: "Lifecycle verification flags a drifted observed policy",
    passSummary:
      "worker:daemon --lifecycle-verify flagged a weaker/drifted observed export as invalid (exit 4).",
    remediation:
      "Re-run `pnpm worker:daemon --lifecycle-verify --provider=aws-s3 --versioned --observed=<drifted export>`: lifecycle verification failed to flag a drifted (weaker) policy, so retention drift could ship unnoticed.",
  },
];
