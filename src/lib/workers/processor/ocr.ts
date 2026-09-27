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

import {
  describeOcrLanguage,
  OCR_MAX_INPUT_FILES,
  parseOcrOptions,
  type OcrOptions,
  type OcrResultMeta,
} from "@/lib/jobs";
import {
  OCR_ENGINES,
  type OcrEngine,
  type OcrEngineAvailability,
} from "../ocr";
import { OCR_REFUSAL_MESSAGES, OcrEngineRefusal } from "../ocr-engine-errors";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorArtifact,
  type ProcessorInputFile,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

const OCR_TOOL = "ocr-pdf";

/**
 * What a native OCR runner returns: the produced artifacts (a searchable PDF and/or
 * a text sidecar) plus the bounded, content-free {@link OcrResultMeta} it observed
 * from the ACTUAL run. The meta never carries recognized text, a path, or a filename;
 * it is derived structurally (engine family, produced flags, page/character counts).
 */
export interface OcrRunResult {
  artifacts: ProcessorArtifact[];
  meta: OcrResultMeta;
}

/**
 * A native OCR runner: given input files and validated options, produce real
 * artifacts and their safe metadata. This build provides none, so the OCR processor
 * reports itself not ready and fails honestly. A production worker supplies a runner
 * that shells out to OCRmyPDF/Tesseract in a sandbox.
 */
export type OcrRunner = (input: {
  options: OcrOptions;
  inputs: ProcessorInputFile[];
}) => Promise<OcrRunResult>;

/**
 * Flatten the structured {@link OcrResultMeta} to the flat, content-free
 * {@link ProcessorMeta} the processor attaches to its success. Nulls are OMITTED
 * (ProcessorMeta holds no null), and the language set becomes a stable, bounded
 * `"eng+spa"` token plus a count — so a downstream reader gets every safe fact and
 * never a null, a path, or recognized text.
 */
export function ocrProcessorMeta(meta: OcrResultMeta): ProcessorMeta {
  const flat: ProcessorMeta = {
    engine: meta.engine,
    outputMode: meta.outputMode,
    languages: meta.languages.join("+"),
    languageCount: meta.languages.length,
    producedSearchablePdf: meta.producedSearchablePdf,
    producedTextSidecar: meta.producedTextSidecar,
  };
  if (meta.pageCount !== null) flat.pageCount = meta.pageCount;
  if (meta.textCharacters !== null) flat.textCharacters = meta.textCharacters;
  if (meta.meanConfidence !== null) flat.meanConfidence = meta.meanConfidence;
  return flat;
}

/** Injected OCR dependencies: which engines are present and the native runner. */
export interface OcrProcessorDeps {
  /** Presence-only engine availability (names, never values). */
  engines?: OcrEngineAvailability;
  /** The native OCR runner; absent in every environment this build ships. */
  runner?: OcrRunner;
  /**
   * The recognition packs actually installed on this host, when the wiring layer
   * could observe them. Absent ⇒ the check is skipped and the engine's own error
   * is the only signal, which is the pre-existing behaviour.
   *
   * An engine binary says nothing about which languages it can recognize: that
   * needs a `traineddata` pack, and Tesseract exits non-zero on a language it has
   * none for. Without this, that surfaced as a retryable "could not process this
   * file" — the user's document blamed for our missing dependency, three times over.
   */
  installedLanguages?: readonly string[];
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
      // The runner reads one document per job. Refused here, final, rather than
      // letting the runner throw into the retryable catch below: two files are
      // two files on every attempt.
      if (input.inputs.length > OCR_MAX_INPUT_FILES) {
        return processorFail({
          code: "unprocessable_entity",
          message: `OCR runs on ${OCR_MAX_INPUT_FILES} file per job. Submit each document as its own job. Nothing was processed.`,
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

      // Requested-language check, BEFORE any work. A language with no traineddata
      // pack makes Tesseract exit non-zero, which the catch below maps to a
      // retryable "could not process this file" — the user's document blamed for a
      // dependency we did not install, and retried twice more for a failure that is
      // perfectly deterministic. Naming the language and refusing up front is both
      // honest and cheaper. Skipped when the wiring layer could not observe the
      // installed packs, so this can only ever make the failure more accurate.
      if (deps.installedLanguages) {
        const installed = new Set(deps.installedLanguages);
        const missing = parsed.value.languages.filter(
          (code) => !installed.has(code),
        );
        if (missing.length > 0) {
          return processorFail({
            code: "unprocessable_entity",
            message: `This worker has no recognition data installed for: ${missing
              .map(describeOcrLanguage)
              .join(
                ", ",
              )}. Choose a language this worker supports, or ask an operator to install the missing language pack. Nothing was processed.`,
            retryable: false,
          });
        }
      }

      // A real runner returns artifacts + safe metadata from ACTUAL recognition, or
      // throws on any failure. A throw is caught here and mapped to a typed,
      // content-free failure — never a raw error message and never fabricated
      // output, which is why `process()` never throws. Two branches:
      //
      //  - an {@link OcrEngineRefusal}: the DOCUMENT is the problem (encrypted,
      //    signed, unreadable, already has text). The same file returns the same
      //    answer on every attempt, so it is final, and its fixed copy names the
      //    next step. Until 2026-09-27 this branch did not exist: the bare
      //    `catch {}` discarded the error object, so a password-protected PDF was
      //    retried three times and then reported as "could not process this file".
      //  - anything else: the RUN (a timeout, a memory-pressured worker, a crash, an
      //    exit we do not recognise). That MAY be transient, so it is a retryable
      //    `internal_error`; the executor bounds retries by its attempt cap. This is
      //    the OCR analogue of how the compression processor maps a crashed native
      //    engine.
      let run: OcrRunResult;
      try {
        run = await deps.runner({
          options: parsed.value,
          inputs: input.inputs,
        });
      } catch (error) {
        if (error instanceof OcrEngineRefusal) {
          return processorFail({
            code: "unprocessable_entity",
            message: OCR_REFUSAL_MESSAGES[error.kind],
            retryable: false,
          });
        }
        return processorFail({
          code: "internal_error",
          message:
            "The OCR engine could not process this file. No output was produced.",
          retryable: true,
        });
      }

      // A runner that returns no artifacts is a failure, never a fabricated success.
      if (run.artifacts.length === 0) {
        return processorFail({
          code: "internal_error",
          message: "The OCR engine produced no output.",
          retryable: true,
        });
      }
      // Attach the bounded, content-free result metadata (engine family, produced
      // artifact kinds, validated languages, page/character counts) on BOTH seams:
      //  - `meta`    — flattened for the observability/log channel;
      //  - `results` — the structured block the executor threads onto the completed
      //    job record and the job status API (`Job.results.ocr`).
      // Neither carries recognized text, a filename, or a path — safe to log,
      // persist, and return. The structured block is re-bounded again at the
      // persistence boundary (`sanitizeJobResults`), so a downstream reader always
      // sees a schema-stable, safe value.
      return processorOk(run.artifacts, ocrProcessorMeta(run.meta), {
        ocr: run.meta,
      });
    },
  };
}
