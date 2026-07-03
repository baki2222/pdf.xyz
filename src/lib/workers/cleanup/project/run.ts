/**
 * The node-free **orchestrator** for the cleanup evidence exporter CLI (Phase 43). It is the
 * whole of the CLI's behavior expressed over injected values — the already-read export text,
 * the validated args, and the clock — so the Node entry (`scripts/worker-cleanup-project.ts`)
 * is a thin shell (read argv/stdin/file, call this, write the output, exit). That keeps every
 * branch — parse failures, both targets, the receipt emission, and the exit-code mapping —
 * unit-testable without a runtime or a filesystem.
 *
 * Everything it returns is content-free by construction: it composes only the bounded projector
 * (`./project`) and receipt seam (`./receipt`), neither of which can carry an object key,
 * bucket, URL, endpoint, region, id, filename, size, byte, or any echo of a dropped field. The
 * projected document is shaped so the record array is keyed exactly as the downstream tool
 * expects (`objects` for the verifier, `records` for the sweeper), and the content-free receipt
 * rides alongside — so an operator can `... | pnpm worker:cleanup-check --stdin` in one step.
 */

import { projectProviderExport, type ProjectionResult } from "./project";
import { emitProjectionReceipt } from "./receipt";
import { recordProjection } from "./metrics";
import { PROJECTION_SCHEMA, type ProjectionVerdict } from "./types";
import type { ProjectArgs } from "./args";

/** The stable output schema id, so a consumer can pin the shape. */
export { PROJECTION_SCHEMA } from "./types";

/** The exit code for a usage/input error (a malformed or unreadable export). */
export const PROJECT_EXIT_INPUT_ERROR = 1;

/** Map the aggregate projection verdict to the documented exit-code ladder. */
export function exitCodeForProjectionVerdict(verdict: ProjectionVerdict): number {
  switch (verdict) {
    case "projected":
      return 0;
    case "insufficient":
      return 2;
    case "unsafe":
      return 4;
  }
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface ProjectRun {
  readonly exitCode: number;
  readonly output: string;
  /** The projection result (or the input-error variant), for tests to assert on. */
  readonly result: ProjectionResult;
}

/** Render a content-free input-error document (parse failure). Never echoes the input. */
function renderInputError(issue: string, target: string, generatedAt: string): string {
  return `${JSON.stringify(
    {
      tool: "worker-cleanup-project",
      schema: PROJECTION_SCHEMA,
      target,
      generatedAt,
      error: { reason: "invalid-export", issue },
    },
    null,
    2,
  )}\n`;
}

/**
 * Run the projection for validated `args` over the already-read export `text`, against the
 * injected clock. Total: a parse failure is an input error (exit 1) with a content-free body,
 * never a throw; otherwise the exit code is the verdict's code (0 projected / 2 insufficient /
 * 4 unsafe). `generatedAt` is the ISO stamp the caller derived from the same clock.
 */
export function runProject(
  text: string,
  args: ProjectArgs,
  nowMs: number,
  generatedAt: string,
): ProjectRun {
  const result = projectProviderExport(
    text,
    { target: args.target, source: args.provider, now: nowMs },
    generatedAt,
  );

  if (!result.ok) {
    return {
      exitCode: PROJECT_EXIT_INPUT_ERROR,
      output: renderInputError(result.issue, args.target, generatedAt),
      result,
    };
  }

  // Best-effort observability: a run-level counter for a dashboard/alert plus the per-run audit
  // receipt for a SIEM. Both are content-free; a misbehaving sink can never break a projection.
  try {
    recordProjection(result.target, result.verdict);
  } catch {
    // A collector fault must never turn a valid projection into a crash.
  }
  emitProjectionReceipt(result.receipt);

  // Key the record array exactly as the downstream tool's parser expects, so the projected
  // document can be piped straight in. The receipt rides alongside and is ignored downstream.
  const recordsKey = result.target === "evidence" ? "objects" : "records";
  const output = `${JSON.stringify(
    {
      tool: "worker-cleanup-project",
      schema: PROJECTION_SCHEMA,
      target: result.target,
      source: args.provider,
      generatedAt,
      [recordsKey]: result.records,
      receipt: result.receipt,
    },
    null,
    2,
  )}\n`;

  return { exitCode: exitCodeForProjectionVerdict(result.verdict), output, result };
}
