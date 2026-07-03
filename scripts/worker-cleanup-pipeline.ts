/**
 * pdf.xyz storage-artifact cleanup evidence **pipeline** — the out-of-band operator CLI (Phase 44).
 *
 * `pnpm worker:cleanup-pipeline` runs the whole cleanup evidence workflow as ONE fail-closed,
 * read-only command. Given a RAW provider export the operator produced out-of-band (their own
 * `aws s3api list-objects-v2` / `head-object` capture), it:
 *   1. PROJECTS it once (Phase 43) into the two bounded, content-free Phase 42 shapes, dropping
 *      every object key / bucket / URL / endpoint / region / id / ETag / filename / user-metadata;
 *   2. VERIFIES absence (project --target=evidence  → the Phase 42 absence verifier);
 *   3. SWEEPS  inventory (project --target=inventory → the Phase 42 dry-run sweeper);
 * then rolls the two arms' documented exit codes into ONE composite exit code (0 ok / 1 usage /
 * 2 unknown / 3 drift / 4 breach).
 *
 * It is deliberately a thin shell over unit-tested, node-free modules under
 * `src/lib/workers/cleanup/pipeline/` (and the Phase 42/43 runners they compose); this file only
 * reads argv, reads stdin/files, wires the real in-process runners as stages, writes the output,
 * and exits. Like the other worker CLIs it is NEVER imported by the web app (it lives outside
 * `src/` and is invoked only as `pnpm worker:cleanup-pipeline`), so importing the app never runs
 * a pipeline or touches the host.
 *
 * Honesty & privacy:
 *  - It makes NO cloud call and needs NO credentials: the export is produced out-of-band. It
 *    deletes NOTHING — deletion stays operator-owned and out-of-band.
 *  - The raw export is read once and projected away before either arm runs, so no raw provider
 *    field can survive into the rolled-up document, the receipt, or a downstream tool.
 *  - It FAILS CLOSED: a bad flag or an unreadable/malformed export is a NON-ZERO usage result
 *    (exit 1), never a silent clean pass, and the worst arm always wins the composite code.
 *
 *   pnpm worker:cleanup-pipeline --file=export.json
 *   aws s3api list-objects-v2 --bucket "$B" | pnpm worker:cleanup-pipeline --stdin --source=aws-s3
 */

import {
  parsePipelineArgs,
  PIPELINE_USAGE,
  runPipeline,
  PIPELINE_EXIT_USAGE,
  PIPELINE_SCHEMA,
  type PipelineStages,
} from "@/lib/workers/cleanup/pipeline";
import { runProject } from "@/lib/workers/cleanup/project";
import { runCleanupCheck, type CleanupCheckProvider } from "@/lib/workers/cleanup";
import { runArtifactCleanup } from "@/lib/workers/artifacts/cleanup";
import { parseS3Config } from "@/lib/workers/storage/s3-config";
import type { RetrievalStorageProvider } from "@/lib/workers/artifacts/access";
import { readFileSync, statSync } from "node:fs";

/** Hard cap on the raw export a read will accept (mirrors the projector's own char cap). */
const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MiB

/**
 * Read the raw export text from the chosen source, bounded. Throws a fixed-message Error on any
 * failure (too large, unreadable) — the caller maps it to exit 1 WITHOUT echoing the OS error or
 * the path, which could carry a filename.
 */
function readInput(source: "stdin" | "file", filePath: string | undefined): string {
  if (source === "file") {
    if (filePath === undefined) throw new Error("input-error");
    if (statSync(filePath).size > MAX_INPUT_BYTES) throw new Error("input-too-large");
    return readFileSync(filePath, "utf8");
  }
  // stdin: read fd 0 to EOF, then bound the size defensively.
  const text = readFileSync(0, "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_INPUT_BYTES) throw new Error("input-too-large");
  return text;
}

/**
 * Resolve the bounded storage provider from the environment EXACTLY as the retrieval backend and
 * the cleanup verifier do: `remote-configured` only when S3 is explicitly selected AND fully
 * valid, else `not-configured`. It reads only whether storage is configured — never a secret VALUE.
 */
function resolveProvider(): RetrievalStorageProvider {
  return parseS3Config(process.env).ok ? "remote-configured" : "not-configured";
}

/**
 * Wire the real Phase 42/43 in-process runners as pipeline stages over a fixed clock. Each stage
 * forwards ONLY the projector's already-content-free output to a lens — never the raw export.
 */
function makeStages(
  provider: "aws-s3" | "generic",
  graceHours: number,
  nowMs: number,
  generatedAt: string,
): PipelineStages {
  return {
    project(target, rawText) {
      // `source`/`filePath` are placeholders: the text is already read, and runProject re-reads
      // nothing — it projects the injected text for the given target + dialect.
      const run = runProject(
        rawText,
        { source: "stdin", target, provider },
        nowMs,
        generatedAt,
      );
      return { exitCode: run.exitCode, projected: run.output };
    },
    async verify(evidenceText) {
      const checkProvider: CleanupCheckProvider = {
        resolveProvider,
        readInput: async () => evidenceText,
        now: () => nowMs,
      };
      const run = await runCleanupCheck(
        { source: "stdin", format: "json", graceHours },
        checkProvider,
      );
      return { exitCode: run.exitCode };
    },
    sweep(inventoryText) {
      const run = runArtifactCleanup(
        inventoryText,
        {
          source: "stdin",
          format: "json",
          includePlan: false,
          includeBreakdown: false,
          includeMetrics: false,
        },
        nowMs,
        generatedAt,
      );
      return { exitCode: run.exitCode };
    },
  };
}

/** Render a content-free input-error document (unreadable/oversized export). Never echoes input. */
function renderInputError(generatedAt: string): string {
  return `${JSON.stringify(
    {
      tool: "worker-cleanup-pipeline",
      schema: PIPELINE_SCHEMA,
      dryRun: true,
      generatedAt,
      severity: "usage",
      exitCode: PIPELINE_EXIT_USAGE,
      error: { reason: "input-unreadable" },
    },
    null,
    2,
  )}\n`;
}

async function main(): Promise<number> {
  const parsed = parsePipelineArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${PIPELINE_USAGE}`);
    return PIPELINE_EXIT_USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(PIPELINE_USAGE);
    return 0;
  }

  const args = parsed.args;
  const nowMs = args.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();

  let text: string;
  try {
    text = readInput(args.source, args.filePath);
  } catch {
    // Content-free: a fixed reason, never the OS error or the path.
    process.stdout.write(renderInputError(generatedAt));
    return PIPELINE_EXIT_USAGE;
  }

  const stages = makeStages(args.provider, args.graceHours, nowMs, generatedAt);
  const run = await runPipeline(text, stages, generatedAt, args.format);
  process.stdout.write(run.output);
  return run.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. An internal fault in
    // the pipeline harness is a "the check is broken" condition → fail closed to the usage band.
    process.stdout.write(
      `${JSON.stringify({ tool: "worker-cleanup-pipeline", error: { reason: "internal-error" } })}\n`,
    );
    process.exit(PIPELINE_EXIT_USAGE);
  });
