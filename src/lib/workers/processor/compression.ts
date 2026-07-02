/**
 * The compression {@link Processor}: the existing compression engine
 * (`../compression/engine`) wrapped behind the shared processor contract, so the
 * worker executor and the local-dev adapter dispatch it exactly like any other
 * secure-worker capability.
 *
 * It changes none of the engine's honesty guarantees. `lossless` is a genuine
 * pdf-lib structural repack (always available). `deep` requires a native engine
 * (Ghostscript/qpdf/mutool); when none is installed the processor returns a typed
 * `not_implemented` failure — never a fabricated smaller file. The native
 * dependencies are injected (the same {@link CompressionDeps} the engine takes),
 * so this module stays free of Node built-ins and is fully unit-testable without
 * shipping a binary.
 */

import type { JobError } from "@/lib/jobs";
import { outputName } from "@/lib/pdf/files";
import {
  DEEP_COMPRESSION_TOOLS,
  parseCompressionOptions,
  runCompression,
  type CompressionDeps,
  type CompressionRun,
} from "../compression/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorResult,
} from "./types";

const COMPRESS_TOOL = "compress-pdf";
const OUTPUT_CONTENT_TYPE = "application/pdf";

type CompressionFailure = Extract<CompressionRun, { ok: false }>;

/**
 * Map an honest engine failure to a typed, client-safe job error. A missing
 * native engine is a non-retryable `not_implemented` (retrying won't install a
 * binary); an oversized input is a non-retryable `payload_too_large` (retrying the
 * same bytes can't shrink them); an unreadable PDF is a non-retryable
 * `unprocessable_entity`; a wired engine that crashed or produced an unreadable
 * result is a retryable `internal_error` (a transient failure the executor may
 * re-attempt, bounded by the attempt cap). No raw error text is ever leaked.
 */
export function compressionJobError(run: CompressionFailure): JobError {
  switch (run.kind) {
    case "unsupported":
      return {
        code: "not_implemented",
        message: `${run.message} Install one of: ${run.requires.join(
          ", ",
        )}. See docs/WORKER_ARCHITECTURE.md.`,
        retryable: false,
      };
    case "too_large":
      return {
        code: "payload_too_large",
        message: run.message,
        retryable: false,
      };
    case "invalid_pdf":
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "failed":
    default:
      return {
        code: "internal_error",
        message: run.message,
        retryable: true,
      };
  }
}

/**
 * Build the compression processor over the host's compression dependencies
 * (available native engines + the native runner). `capability().ready` is always
 * true because lossless repack is always available; the detail states honestly
 * whether the deep path can run.
 */
export function createCompressionProcessor(deps: CompressionDeps): Processor {
  const installedEngines = (): string[] =>
    DEEP_COMPRESSION_TOOLS.filter((tool) => deps.tools[tool]);

  return {
    id: "compression",
    tools: [COMPRESS_TOOL],

    supports(tool) {
      return tool === COMPRESS_TOOL;
    },

    capability() {
      const engines = installedEngines();
      return {
        id: "compression",
        tools: [COMPRESS_TOOL],
        // Lossless is always available, so the processor can always run *a*
        // supported request; deep additionally needs a native engine.
        ready: true,
        detail:
          engines.length > 0
            ? `Compression ready: lossless structural repack plus deep image compression on ${engines[0]}.`
            : "Compression ready: lossless structural repack. Deep image compression needs a native engine (Ghostscript, qpdf, or mutool), which isn't installed here.",
      };
    },

    async process(input): Promise<ProcessorResult> {
      if (input.tool !== COMPRESS_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles PDF compression.",
          retryable: false,
        });
      }

      // Defensive re-validation. In the normal flow the caller has already
      // validated options at request time; a malformed bag here is an internal
      // inconsistency, so it fails the job honestly rather than throwing.
      const parsed = parseCompressionOptions(input.options);
      if (!parsed.ok) {
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      }

      const file = input.inputs[0];
      if (input.inputs.length !== 1 || !file) {
        return processorFail({
          code: "unprocessable_entity",
          message: "Compression accepts exactly one PDF input.",
          retryable: false,
        });
      }

      const run = await runCompression(file.bytes, parsed.value, deps);
      if (!run.ok) return processorFail(compressionJobError(run));

      return processorOk(
        [
          {
            filename: outputName(file.filename, "compressed"),
            contentType: OUTPUT_CONTENT_TYPE,
            bytes: run.output,
          },
        ],
        {
          engine: run.meta.engine,
          profile: run.meta.profile,
          originalBytes: run.meta.originalBytes,
          outputBytes: run.meta.outputBytes,
          savedBytes: run.meta.savedBytes,
          savedRatio: run.meta.savedRatio,
        },
      );
    },
  };
}
