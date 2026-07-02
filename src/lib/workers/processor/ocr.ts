/**
 * The OCR {@link Processor}: the OCR contract (`@/lib/jobs/ocr`) wrapped behind
 * the shared processor interface. It exists so the registry and executor treat
 * OCR like any other capability — and so the moment a real OCR runner is wired,
 * it flips on with no orchestration changes.
 *
 * Honesty posture (unchanged from Phase 11): **this build ships no OCR runner.**
 * The processor therefore validates a request honestly (a malformed request is a
 * client error, not a capability gap) and then returns a typed `not_implemented`
 * failure — it never fabricates recognized text or a searchable PDF. A native
 * runner is an injected dependency (mirroring the compression engine's native
 * seam); with none provided the processor is honestly not ready in every
 * environment, and unit tests can prove the "flips on when wired" branch without
 * shipping an OCR engine.
 */

import { parseOcrOptions, type OcrOptions } from "@/lib/jobs";
import {
  OCR_ENGINES,
  type OcrEngine,
  type OcrEngineAvailability,
} from "../ocr";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorArtifact,
  type ProcessorInputFile,
  type ProcessorResult,
} from "./types";

const OCR_TOOL = "ocr-pdf";

/**
 * A native OCR runner: given input files and validated options, produce real
 * artifacts (a searchable PDF and/or a text sidecar). This build provides none,
 * so the OCR processor reports itself not ready and fails honestly. A production
 * worker supplies a runner that shells out to OCRmyPDF/Tesseract in a sandbox.
 */
export type OcrRunner = (input: {
  options: OcrOptions;
  inputs: ProcessorInputFile[];
}) => Promise<ProcessorArtifact[]>;

/** Injected OCR dependencies: which engines are present and the native runner. */
export interface OcrProcessorDeps {
  /** Presence-only engine availability (names, never values). */
  engines?: OcrEngineAvailability;
  /** The native OCR runner; absent in every environment this build ships. */
  runner?: OcrRunner;
}

const UNAVAILABLE_DETAIL =
  "OCR isn't available: this build ships no OCR runner. OCR needs a native engine (OCRmyPDF/Tesseract) or a managed provider on a secure worker.";

/**
 * Build the OCR processor. It is ready only when BOTH a native runner is wired
 * and at least one advertised engine is present; with no runner (the shipped
 * state) it is honestly not ready and `process` fails with `not_implemented`
 * after validating the request.
 */
export function createOcrProcessor(deps: OcrProcessorDeps = {}): Processor {
  const engine: OcrEngine | null = deps.runner
    ? (OCR_ENGINES.find((candidate) => deps.engines?.[candidate]) ?? null)
    : null;
  const ready = deps.runner != null && engine != null;

  return {
    id: "ocr",
    tools: [OCR_TOOL],

    supports(tool) {
      return tool === OCR_TOOL;
    },

    capability() {
      return {
        id: "ocr",
        tools: [OCR_TOOL],
        ready,
        detail: ready
          ? `OCR ready on ${engine}, on an encrypted, auto-deleting secure worker.`
          : UNAVAILABLE_DETAIL,
      };
    },

    async process(input): Promise<ProcessorResult> {
      if (input.tool !== OCR_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles OCR.",
          retryable: false,
        });
      }

      // Validate the request even when we can't run it: a malformed request is a
      // client error the caller should see regardless of engine availability.
      const parsed = parseOcrOptions(input.options);
      if (!parsed.ok) {
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      }
      if (input.inputs.length < 1) {
        return processorFail({
          code: "unprocessable_entity",
          message: "OCR needs at least one input file.",
          retryable: false,
        });
      }

      if (!ready || !deps.runner) {
        return processorFail({
          code: "not_implemented",
          message: `${UNAVAILABLE_DETAIL} See docs/WORKER_ARCHITECTURE.md.`,
          retryable: false,
        });
      }

      // A real runner never fabricates text; it returns artifacts from actual
      // recognition or throws, which the executor records as a failed job.
      const artifacts = await deps.runner({
        options: parsed.value,
        inputs: input.inputs,
      });
      return processorOk(artifacts);
    },
  };
}
