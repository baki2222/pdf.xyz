/**
 * The bounded, content-free vocabulary for the storage-artifact cleanup evidence **pipeline**
 * (Phase 44) — the single-command operator wrapper that composes the Phase 43 projector and
 * the two Phase 42 cleanup lenses into one fail-closed run.
 *
 * The pipeline reads a RAW provider export ONCE (an operator's own out-of-band
 * `aws s3api list-objects-v2` / `head-object` capture) and folds it through two arms:
 *   - VERIFY — project into cleanup-check EVIDENCE, then run the absence verifier;
 *   - SWEEP  — project into artifact-cleanup INVENTORY, then run the dry-run sweeper.
 * It rolls the two arms' documented exit codes into ONE severity + exit code, so a scheduler,
 * CI gate, or process supervisor can key on a single result.
 *
 * Like the tools it composes, it obeys the worker honesty contract:
 *  - it NEVER calls the cloud, needs NO credentials, and deletes NOTHING — the raw export is
 *    produced out-of-band and any deletion stays operator-owned and out-of-band;
 *  - every token here is a low-cardinality, redaction-stable enum — never a filename, object
 *    key, bucket, URL, endpoint, region, id, token, size, instant, or byte;
 *  - the raw export is read once and projected away before either arm runs, so no raw
 *    provider field can survive into the rolled-up document, the receipt, or a downstream tool;
 *  - it FAILS CLOSED: an operator mistake (a bad flag, an unreadable/malformed export) is a
 *    NON-ZERO usage result, never a silent clean pass, and the worst arm always wins.
 */

/**
 * The two independent arms a pipeline run folds the export through. Each arm projects the raw
 * export into one Phase 42 shape and evaluates it with the matching lens:
 *  - `verify` — project → cleanup-check EVIDENCE → absence verifier (`worker:cleanup-check`);
 *  - `sweep`  — project → artifact-cleanup INVENTORY → dry-run sweeper (`worker:artifact-cleanup`).
 * Both are read-only; neither lists a bucket, calls a cloud API, or deletes anything.
 */
export const PIPELINE_ARMS = ["verify", "sweep"] as const;
export type PipelineArm = (typeof PIPELINE_ARMS)[number];

/**
 * The pipeline's rolled-up severity — the artifact-cleanup ladder (`ok`/`unknown`/`drift`/
 * `breach`) extended with the distinct `usage` band the ops tools reserve for a misused check.
 * It is monotonic with the {@link PIPELINE_EXIT} exit code:
 *  - `ok`      — both arms clean; nothing to do (exit 0);
 *  - `usage`   — the pipeline was misused, or the export was unreadable/malformed (exit 1);
 *  - `unknown` — not enough evidence to prove cleanup: a thin export, no wired storage, or a
 *                probe that could not complete (exit 2);
 *  - `drift`   — an artifact is present past its retention window + reap grace (exit 3);
 *  - `breach`  — a present-but-tombstoned object, or a structurally unsafe export (exit 4).
 */
export const PIPELINE_SEVERITIES = ["ok", "usage", "unknown", "drift", "breach"] as const;
export type PipelineSeverity = (typeof PIPELINE_SEVERITIES)[number];

/**
 * The documented exit-code ladder — the UNION of the three composed tools' ladders, kept
 * monotonic (higher = worse) so a monitor keys on the number, never on stdout:
 *  - `0` OK      — both arms verified/clean;
 *  - `1` USAGE   — a misused pipeline, or an unreadable/malformed raw export (fail closed,
 *                  never a silent 0);
 *  - `2` UNKNOWN — cleanup could not be proven (insufficient / not-configured / unavailable);
 *  - `3` DRIFT   — an artifact lingers past its retention window + grace (page);
 *  - `4` BREACH  — bytes that should be gone remain, or the export is unsafe (page urgently).
 * These are deliberately the SAME numbers `worker:cleanup-check` (0/1/2/3) and
 * `worker:artifact-cleanup` (0/1/2/3/4) already emit, so the composite reads consistently.
 */
export const PIPELINE_EXIT = {
  OK: 0,
  USAGE: 1,
  UNKNOWN: 2,
  DRIFT: 3,
  BREACH: 4,
} as const;
export type PipelineExitCode = (typeof PIPELINE_EXIT)[keyof typeof PIPELINE_EXIT];

/** Stable identity of the pipeline policy — stamped on the receipt for an audit trail. */
export const PIPELINE_POLICY_ID = "pdfxyz-cleanup-evidence-pipeline";
/** Bump when the pipeline's rollup semantics or vocabulary change. */
export const PIPELINE_POLICY_VERSION = 1;

/** The schema tag the rolled-up document carries so a consumer can pin the shape. */
export const PIPELINE_SCHEMA = "pdfxyz.cleanup-pipeline/1" as const;

/**
 * One arm's content-free outcome. `code` is the arm's own exit code on the shared ladder
 * (0/1/2/3/4); `severity` is that code as a bounded word; `projected` is whether the raw
 * export projected cleanly enough to run the arm's downstream lens (false ⇒ the arm was
 * short-circuited to the projection's own verdict, e.g. `insufficient`/`unsafe`). No field is
 * or contains a locator, identifier, or byte.
 */
export interface PipelineArmResult {
  readonly arm: PipelineArm;
  readonly code: PipelineExitCode;
  readonly severity: PipelineSeverity;
  /** True iff the raw export projected to exit 0 and the downstream lens actually ran. */
  readonly projected: boolean;
}

/**
 * The content-free receipt one pipeline run rides alongside its output — the audit answer to
 * "what did this composite run resolve to, per arm" for a SIEM. Bounded enums + small integers
 * + a stable policy id only; safe to log or forward verbatim.
 */
export interface PipelineReceipt {
  readonly category: "cleanup-pipeline";
  readonly policyId: typeof PIPELINE_POLICY_ID;
  readonly policyVersion: typeof PIPELINE_POLICY_VERSION;
  readonly at: string;
  readonly severity: PipelineSeverity;
  readonly exitCode: PipelineExitCode;
  readonly arms: readonly PipelineArmResult[];
}

/**
 * The whole outcome of a pipeline run: the rolled-up severity + exit code, the per-arm
 * breakdown, and the audit receipt. Content-free by construction — the raw export never
 * reaches here; only bounded verdicts derived from it do.
 */
export interface PipelineResult {
  readonly severity: PipelineSeverity;
  readonly exitCode: PipelineExitCode;
  readonly arms: readonly PipelineArmResult[];
  readonly receipt: PipelineReceipt;
}
