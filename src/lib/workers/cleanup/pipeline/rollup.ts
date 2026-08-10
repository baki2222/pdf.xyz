/**
 * The pure rollup arithmetic for the cleanup evidence **pipeline** (Phase 44): how a stage's
 * raw exit code becomes a bounded severity, and how the two arms' codes fold into ONE composite
 * exit code. Node-free and total, so every rule is unit-tested without a runtime.
 *
 * The rule is deliberately the simplest defensible one: the pipeline exits with the WORST
 * (highest) code any stage produced, on the shared 0/1/2/3/4 ladder. That is monotonic in
 * severity, matches the numbers the composed tools already emit, and — unlike the Phase 43
 * scheduler notifier, which let a `usage` fold to a silent 0 — counts `usage` (1) into the
 * maximum, so a misused pipeline or an unreadable export always exits NON-ZERO. An exit code
 * outside the known ladder is treated as `usage` (a broken check), never as a clean 0.
 */

import {
  PIPELINE_EXIT,
  type PipelineExitCode,
  type PipelineSeverity,
} from "./types";

/**
 * Map any stage exit code to a bounded {@link PipelineSeverity}. The known ladder maps
 * 1:1 (0→ok, 2→unknown, 3→drift, 4→breach); `1` and ANY unrecognized code fold to `usage`
 * — the "this check was misused / could not be trusted" band, which is still a non-zero exit,
 * so an unexpected code can never masquerade as a clean pass.
 */
export function severityForExit(code: number): PipelineSeverity {
  switch (code) {
    case PIPELINE_EXIT.OK:
      return "ok";
    case PIPELINE_EXIT.UNKNOWN:
      return "unknown";
    case PIPELINE_EXIT.DRIFT:
      return "drift";
    case PIPELINE_EXIT.BREACH:
      return "breach";
    default:
      // 1 (usage) and anything off-ladder → the non-zero "misused/untrusted check" band.
      return "usage";
  }
}

/**
 * Clamp a raw stage exit code onto the bounded ladder. A code already in {0,1,2,3,4} passes
 * through; anything else (a negative, a non-integer, an out-of-range value from a future tool)
 * folds to `USAGE` (1) — a fail-closed, non-zero band, never `OK`.
 */
export function clampExit(code: number): PipelineExitCode {
  if (
    Number.isInteger(code) &&
    code >= PIPELINE_EXIT.OK &&
    code <= PIPELINE_EXIT.BREACH
  ) {
    return code as PipelineExitCode;
  }
  return PIPELINE_EXIT.USAGE;
}

/**
 * Roll a set of arm exit codes into the composite pipeline exit code: the worst (highest) code
 * on the clamped ladder. An empty set is `OK` (nothing ran and nothing failed) — but the
 * orchestrator always supplies both arms, so in practice this reflects the two arms. Because
 * `usage` (1) participates in the maximum, an all-usage run yields `1`, never a silent `0`.
 */
export function rollupExit(codes: readonly number[]): PipelineExitCode {
  let worst: PipelineExitCode = PIPELINE_EXIT.OK;
  for (const raw of codes) {
    const code = clampExit(raw);
    if (code > worst) worst = code;
  }
  return worst;
}
