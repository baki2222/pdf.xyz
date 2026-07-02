/**
 * The OCR {@link Processor}: the OCR contract (`@/lib/jobs/ocr`) wrapped behind
 * the shared processor interface. It exists so the registry and executor treat
 * OCR like any other capability — and so the moment a real OCR runner is wired,
 * it flips on with no orchestration changes.
 *
 * Honesty posture (Phase 23): the build now ships an OPTIONAL native OCR runner
 * (`../ocr-native`, wired only by the out-of-band daemon when an operator opts in and
 * an engine is installed), but it is **off by default**. With no runner injected the
 * processor validates a request honestly (a malformed request is a client error, not
 * a capability gap) and returns a typed `not_implemented` failure — it never
 * fabricates recognized text or a searchable PDF. The runner is an injected
 * dependency (mirroring the compression engine's native seam), so the processor is
 * honestly not ready wherever OCR isn't configured, and both the "flips on when
 * wired" branch and the failure mapping are unit-tested without shipping an engine.
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

/**
 * When OCR is not opted into at all (no runner injected): the honest default in
 * every environment that has not configured an OCR backend.
 */
const NO_RUNNER_DETAIL =
  "OCR isn't enabled on this worker. It needs a native OCR engine (OCRmyPDF/Tesseract) or a managed provider, enabled via configuration on a secure worker.";
/**
 * When OCR is enabled (a runner IS wired) but no engine is installed on the host:
 * distinct from "not enabled", and still honest — nothing can run here.
 */
const NO_ENGINE_DETAIL =
  "OCR is enabled, but no OCR engine (OCRmyPDF/Tesseract) is installed on this worker, so it can't run here.";

/**
 * Build the OCR processor. It is ready only when BOTH a native runner is wired
 * and at least one advertised engine is present; with no runner (the default,
 * un-opted-in state) or no engine it is honestly not ready and `process` fails with
 * `not_implemented` after validating the request. The unavailable detail
 * distinguishes "not enabled" from "enabled but no engine" so an operator readout is
 * accurate — never claiming the build lacks an OCR backend when it merely isn't
 * configured here.
 */
export function createOcrProcessor(deps: OcrProcessorDeps = {}): Processor {
  const engine: OcrEngine | null = deps.runner
    ? (OCR_ENGINES.find((candidate) => deps.engines?.[candidate]) ?? null)
    : null;
  const ready = deps.runner != null && engine != null;
  const unavailableDetail = deps.runner ? NO_ENGINE_DETAIL : NO_RUNNER_DETAIL;

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
          : unavailableDetail,
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
          message: `${unavailableDetail} See docs/OCR_BACKEND.md.`,
          retryable: false,
        });
      }

      // A real runner returns artifacts from ACTUAL recognition, or throws on any
      // failure (unreadable input, engine error, timeout, oversized/invalid output).
      // A throw is caught here and mapped to a typed, content-free failure — never a
      // raw error message and never fabricated output. It is retryable because an OCR
      // failure MAY be transient (a timed-out or memory-pressured worker); the
      // executor bounds retries by its attempt cap, so a deterministic failure
      // exhausts attempts and then fails the job terminally. This is the OCR analogue
      // of how the compression processor maps a crashed native engine to a retryable
      // `internal_error`, and it is why `process()` never throws.
      let artifacts: ProcessorArtifact[];
      try {
        artifacts = await deps.runner({
          options: parsed.value,
          inputs: input.inputs,
        });
      } catch {
        return processorFail({
          code: "internal_error",
          message:
            "The OCR engine could not process this file. No output was produced.",
          retryable: true,
        });
      }

      // A runner that returns no artifacts is a failure, never a fabricated success.
      if (artifacts.length === 0) {
        return processorFail({
          code: "internal_error",
          message: "The OCR engine produced no output.",
          retryable: true,
        });
      }
      return processorOk(artifacts);
    },
  };
}
