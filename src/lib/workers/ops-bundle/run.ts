/**
 * The node-free **orchestrator** for the operations evidence bundle CLI (Phase 45).
 *
 * It is the whole of the CLI's behavior expressed over injected seams, so the real Node entry
 * (`scripts/worker-ops-bundle.ts`) is a thin shell: it resolves argv, reads stdin/files, and hands
 * those capabilities here. That keeps every branch — each input source, the ingest failure modes,
 * the rollup, and every output format — unit-testable without a runtime or a filesystem.
 *
 * Honesty flows straight through: the sections it composes are re-authored by the trust boundary
 * (`./ingest`) from bounded enums; the rollup adds nothing that is not a bounded severity; a bad
 * REQUIRED input is a usage error (exit 1), an absent OPTIONAL input is honestly `not-configured`,
 * and the exit code is the documented ladder (0 ok / 1 usage / 2 unknown / 3 warn / 4 critical).
 */

import { buildOpsBundle, buildUsageError } from "./build";
import {
  ingestOpsCheckResult,
  ingestPipelineSummary,
  unreadablePipeline,
} from "./ingest";
import { recordOpsBundle, severityForOutcome } from "./metrics";
import { renderOpsBundle } from "./render";
import {
  opsBundleExitCode,
  type OpsBundleOutcome,
  type OpsBundlePipelineSection,
} from "./types";
import type { OpsBundleArgs } from "./args";

/**
 * The capabilities the runner needs, injected by the Node entry (and faked in tests).
 * `readOpsCheck` reads the REQUIRED ops-check result text; `readPipeline` reads an OPTIONAL
 * pipeline summary; `now` stamps the bundle (a wall clock is the one unavoidable side effect,
 * kept behind a seam so tests are deterministic).
 */
export interface OpsBundleProvider {
  readOpsCheck(
    source: "stdin" | "file",
    filePath: string | undefined,
  ): Promise<string>;
  readPipeline(filePath: string): Promise<string>;
  now(): string;
}

/** The full outcome of a run: the exit code, the rendered output, and the structured result. */
export interface OpsBundleRun {
  readonly exitCode: number;
  readonly output: string;
  readonly outcome: OpsBundleOutcome;
}

/**
 * Run the bundle for validated `args` using the injected `provider`. Never throws on an
 * operational or input problem — those become a structured outcome + exit code; only a genuine
 * internal fault (a seam crash other than the guarded reads) propagates, to be caught by the
 * entry's top-level handler.
 */
export async function runOpsBundle(
  args: OpsBundleArgs,
  provider: OpsBundleProvider,
): Promise<OpsBundleRun> {
  const generatedAt = provider.now();

  const finish = (outcome: OpsBundleOutcome): OpsBundleRun => {
    // A metrics sink must never break the CLI; swallow anything it throws.
    try {
      recordOpsBundle(severityForOutcome(outcome));
    } catch {
      /* ignore */
    }
    return {
      exitCode: opsBundleExitCode(outcome),
      output: renderOpsBundle(outcome, args.format, args.pretty),
      outcome,
    };
  };

  // REQUIRED: the ops-check result. An unreadable read or a bad shape is a usage error.
  let opsText: string;
  try {
    opsText = await provider.readOpsCheck(
      args.opsCheckSource,
      args.opsCheckPath,
    );
  } catch {
    return finish(buildUsageError(generatedAt, ["ops-check-input-unreadable"]));
  }
  const ingested = ingestOpsCheckResult(opsText);
  if (!ingested.ok) {
    return finish(buildUsageError(generatedAt, ingested.issues));
  }

  // OPTIONAL: the cleanup-pipeline summary. Absent ⇒ not-configured; a read failure or a bad
  // shape ⇒ unreadable (honestly surfaced, never echoed, and never fatal).
  let pipeline: OpsBundlePipelineSection;
  if (args.pipelinePath === undefined) {
    pipeline = ingestPipelineSummary(null);
  } else {
    try {
      pipeline = ingestPipelineSummary(
        await provider.readPipeline(args.pipelinePath),
      );
    } catch {
      pipeline = unreadablePipeline();
    }
  }

  return finish(buildOpsBundle(generatedAt, ingested.value, pipeline));
}
