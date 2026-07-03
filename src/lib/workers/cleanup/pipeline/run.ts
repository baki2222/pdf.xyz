/**
 * The node-free **orchestrator** for the cleanup evidence pipeline CLI (Phase 44,
 * `scripts/worker-cleanup-pipeline.ts`). It is the whole of the CLI's behavior expressed over
 * injected stage seams — a projector, an absence verifier, and a dry-run sweeper — so the Node
 * entry is a thin shell (read argv/stdin/file, wire the real in-process runners as stages, call
 * this, write the output, exit). That keeps every branch — each arm, the short-circuit on a
 * failed projection, the rollup, the receipt/metric emission, and both output formats —
 * unit-testable without a runtime, a filesystem, or a spawned subprocess.
 *
 * The composition is the point: it projects the raw export ONCE per arm into the exact bounded
 * shape each downstream lens reads, then evaluates it, then rolls the two arms' exit codes into
 * one composite result. Because it only ever forwards the projector's already-content-free
 * output to a lens (never the raw export), and its own output is bounded severities + small
 * codes + the audit receipt, no raw provider field can survive into anything it returns.
 */

import { rollupExit, severityForExit } from "./rollup";
import { recordPipeline } from "./metrics";
import { buildPipelineReceipt, emitPipelineReceipt } from "./receipt";
import {
  PIPELINE_ARMS,
  PIPELINE_EXIT,
  PIPELINE_SCHEMA,
  type PipelineArm,
  type PipelineArmResult,
  type PipelineResult,
} from "./types";

/** The exit code for a usage/input error, re-exported so the CLI shell can pin it. */
export const PIPELINE_EXIT_USAGE = PIPELINE_EXIT.USAGE;

/** A downstream lens's content-free outcome: only the exit code on the shared 0/1/2/3/4 ladder. */
export interface LensOutcome {
  readonly exitCode: number;
}

/** A projection stage's outcome: the exit code plus the content-free projected document text. */
export interface ProjectOutcome {
  readonly exitCode: number;
  /** The projected, content-free document to feed the lens (empty when the projection failed). */
  readonly projected: string;
}

/**
 * The stages the pipeline composes, injected by the Node entry (and faked in tests). Each is a
 * thin wrapper over the real Phase 42/43 in-process runner:
 *  - `project` runs the Phase 43 projector for one target over the raw export;
 *  - `verify`  runs the Phase 42 absence verifier over a projected EVIDENCE document (async,
 *    mirroring `runCleanupCheck`, which resolves the env storage posture);
 *  - `sweep`   runs the Phase 42 dry-run sweeper over a projected INVENTORY document.
 * None list a bucket, call a cloud API, or delete anything.
 */
export interface PipelineStages {
  project(target: "evidence" | "inventory", rawText: string): ProjectOutcome;
  verify(evidenceText: string): Promise<LensOutcome>;
  sweep(inventoryText: string): LensOutcome;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface PipelineRun {
  readonly exitCode: number;
  readonly output: string;
  readonly result: PipelineResult;
}

/** How the composite result is rendered. */
export type PipelineFormat = "json" | "text";

/** The target each arm projects into, and the arm's display order. */
const ARM_TARGET: Record<PipelineArm, "evidence" | "inventory"> = {
  verify: "evidence",
  sweep: "inventory",
};

/**
 * Run one arm: project the raw export into the arm's target, then — only if the projection
 * exited cleanly (0) — run the arm's downstream lens over the projected document. A failed
 * projection SHORT-CIRCUITS the arm to the projection's own exit code (1 usage / 2 insufficient
 * / 4 unsafe), so a malformed or metadata-thin export is never fed to a lens as if it were
 * clean evidence, and the arm is marked `projected: false`.
 */
async function runArm(
  arm: PipelineArm,
  rawText: string,
  stages: PipelineStages,
): Promise<PipelineArmResult> {
  const target = ARM_TARGET[arm];
  const projection = stages.project(target, rawText);

  let code: number;
  let projected: boolean;
  if (projection.exitCode === PIPELINE_EXIT.OK) {
    const lens = arm === "verify" ? await stages.verify(projection.projected) : stages.sweep(projection.projected);
    code = lens.exitCode;
    projected = true;
  } else {
    // The raw export did not project cleanly for this arm; surface the projection's verdict and
    // do NOT run the lens (there is no trustworthy document to evaluate).
    code = projection.exitCode;
    projected = false;
  }

  const clamped = rollupExit([code]);
  return { arm, code: clamped, severity: severityForExit(clamped), projected };
}

/**
 * Run the whole pipeline over the already-read raw export `rawText` using the injected `stages`,
 * against the injected clock. Total: it never throws on an operational or input problem — a
 * failed projection or an inconclusive lens becomes a per-arm code and a rolled-up exit code;
 * only a genuine internal fault in a stage propagates, to be caught by the entry's top-level
 * handler. `generatedAt` is the ISO stamp the caller derived from the same clock.
 */
export async function runPipeline(
  rawText: string,
  stages: PipelineStages,
  generatedAt: string,
  format: PipelineFormat = "json",
): Promise<PipelineRun> {
  const arms: PipelineArmResult[] = [];
  for (const arm of PIPELINE_ARMS) {
    arms.push(await runArm(arm, rawText, stages));
  }

  const exitCode = rollupExit(arms.map((a) => a.code));
  const severity = severityForExit(exitCode);

  // Best-effort observability: one bounded counter per arm plus the per-run audit receipt. Both
  // are content-free; a misbehaving sink can never break a pipeline run.
  try {
    for (const a of arms) recordPipeline(a.arm, a.severity);
  } catch {
    // A collector fault must never turn a valid pipeline run into a crash.
  }
  const receipt = emitPipelineReceipt(buildPipelineReceipt(severity, exitCode, arms, generatedAt));

  const result: PipelineResult = { severity, exitCode, arms, receipt };
  return { exitCode, output: render(result, generatedAt, format), result };
}

/** Render the rolled-up result as a stable JSON document. */
function renderJson(result: PipelineResult, generatedAt: string): string {
  return `${JSON.stringify(
    {
      tool: "worker-cleanup-pipeline",
      schema: PIPELINE_SCHEMA,
      dryRun: true,
      generatedAt,
      severity: result.severity,
      exitCode: result.exitCode,
      arms: result.arms,
      receipt: result.receipt,
    },
    null,
    2,
  )}\n`;
}

/** Render a short, content-free human summary. */
function renderText(result: PipelineResult): string {
  const lines = [
    "pdf.xyz storage-artifact cleanup pipeline (dry-run, read-only)",
    `  severity               ${result.severity}`,
    `  exit                   ${result.exitCode}`,
  ];
  for (const a of result.arms) {
    const note = a.projected ? "" : " (projection short-circuited)";
    lines.push(`  ${a.arm.padEnd(20)} ${a.severity} (code ${a.code})${note}`);
  }
  lines.push(
    "This composite reshapes + evaluates your own out-of-band export offline. It lists no",
    "bucket, calls no cloud API, and deletes nothing; deletion stays operator-owned and out-of-band.",
  );
  return `${lines.join("\n")}\n`;
}

/** Render the result in the chosen format. */
export function render(result: PipelineResult, generatedAt: string, format: PipelineFormat): string {
  return format === "text" ? renderText(result) : renderJson(result, generatedAt);
}
