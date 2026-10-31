/**
 * The Translate PDF {@link Processor}: the AI-backed translation engine
 * (`../translate/engine`) wrapped behind the shared processor contract, so the worker
 * executor and the local-dev adapter dispatch **Translate PDF** exactly like any other
 * secure-worker capability.
 *
 * It changes none of the engine's honesty guarantees: no configured AI provider ⇒
 * `not_implemented` with operator requirements; no selectable text ⇒ a `no_text`
 * failure pointing at OCR; and the shipped translation is exactly the model's real
 * output. The text extractor and provider are injected (the same {@link TranslateDeps}
 * the engine takes), so this module stays free of Node built-ins and unit-testable.
 */

import { readDeliveryCap, type JobError } from "@/lib/jobs";
import { translationOutputName } from "@/lib/jobs/translate-pdf";
import {
  TRANSLATE_TOOL,
  runTranslate,
  type TranslateDeps,
  type TranslateMeta,
  type TranslateRun,
} from "../translate/engine";
import {
  processorFail,
  aiResultsFromFailure,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";
import { AI_TOOL_OPTION_PARSERS } from "@/lib/jobs/ai-tool-options";

type Failure = Extract<TranslateRun, { ok: false }>;

/** Deterministic output name for the translation package (re-exported for tests/UI). */
export function translateOutputName(originalName: unknown): string {
  return translationOutputName(originalName);
}

function jobError(run: Failure): JobError {
  switch (run.kind) {
    case "unsupported":
    case "ai_unconfigured":
      return {
        code: "not_implemented",
        message: `${run.message}`,
        retryable: false,
      };
    case "too_large":
      return {
        code: "payload_too_large",
        message: run.message,
        retryable: false,
      };
    case "over_reservation":
      // Not `payload_too_large` and not retryable: the file may be tiny, and
      // the same file submitted with an honest declaration would succeed. The
      // message carries the reservation, so the caller can see what to change.
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "too_much_text":
      // Not retryable and not a size error: the same document through the same
      // model produces the same overflow, and the file may be tiny. The message
      // already carries both numbers.
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "no_text":
    case "cannot_open":
      // Both are facts about the file: retrying cannot change them.
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "content_filtered":
      return {
        code: "unprocessable_entity",
        message: run.message,
        retryable: false,
      };
    case "rate_limited":
      return {
        code: "service_unavailable",
        message: run.message,
        retryable: true,
      };
    case "failed":
    default:
      return {
        code: "internal_error",
        message: run.message,
        retryable: run.retryable ?? true,
      };
  }
}

function meta(m: TranslateMeta): ProcessorMeta {
  return {
    engine: m.engine,
    tool: m.tool,
    provider: m.provider,
    model: m.model,
    targetLanguage: m.targetLanguage,
    sourceLanguage: m.sourceLanguage,
    pageCount: m.pageCount,
    inputBytes: m.inputBytes,
    outputBytes: m.outputBytes,
    sourceCharacters: m.sourceCharacters,
    translationCharacters: m.translationCharacters,
    truncated: m.truncated,
  };
}

export function createTranslateProcessor(deps: TranslateDeps): Processor {
  const ready = deps.extract != null && deps.provider != null;
  return {
    id: "translate",
    tools: [TRANSLATE_TOOL],
    supports(tool) {
      return tool === TRANSLATE_TOOL;
    },
    capability() {
      return {
        id: "translate",
        tools: [TRANSLATE_TOOL],
        ready,
        detail: ready
          ? "Translate PDF ready: the PDF's selectable text is translated by a configured AI provider and packaged as a translation ZIP (translation.md + translation.txt + manifest) on an auto-deleting secure worker."
          : deps.extract == null
            ? "Translate PDF needs the PDF text extractor, which isn't available on this worker."
            : "Translate PDF needs a configured AI provider (PDFXYZ_AI_PROVIDER + API key). None is configured, so it fails honestly as not-implemented.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (input.tool !== TRANSLATE_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles translate-pdf.",
          retryable: false,
        });
      }
      const file = input.inputs[0];
      if (input.inputs.length !== 1 || !file) {
        return processorFail({
          code: "unprocessable_entity",
          message: "Translate PDF accepts exactly one PDF input.",
          retryable: false,
        });
      }
      // The SAME parser the route ran before it charged the allowance
      // (`@/lib/jobs/ai-tool-options`), kept here as the second line of
      // defence for a job queued by anything but that route.
      const parsed = AI_TOOL_OPTION_PARSERS[TRANSLATE_TOOL](input.options);
      if (!parsed.ok) {
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      }
      /**
       * The delivery cap arrives on the INPUT, not on `deps`: `deps` is the
       * worker's wiring, built once at start-up, and the cap is per-job.
       *
       * IT IS RE-READ RATHER THAN TRUSTED. The value is typed here but it came
       * back from the queue as `JSON.parse(raw) as T` — an assertion, not a
       * check. A malformed cap must not read as "no cap": absent is a supported
       * state meaning unbounded, so the convenient reading of a broken value is
       * "deliver everything", which is precisely what the cap exists to prevent.
       * Fail closed.
       */
      const cap = readDeliveryCap(input.delivery);
      if (!cap.ok) {
        return processorFail({
          code: "internal_error",
          message: `This job could not be run because ${cap.reason}.`,
          retryable: false,
        });
      }
      const run = await runTranslate(
        file.bytes,
        parsed.value,
        {
          ...deps,
          limits: {
            ...deps.limits,
            ...(cap.cap ? { delivery: cap.cap } : {}),
          },
        },
        input.signal,
      );
      // A run that failed AFTER a provider call still owes the job record what
      // it spent — see `aiResultsFromFailure`. Absent when no call happened.
      if (!run.ok)
        return processorFail(jobError(run), aiResultsFromFailure(run));
      return processorOk(
        [
          {
            filename: translateOutputName(file.filename),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        meta(run.meta),
        // The window travels to the browser on the job record, so the panel
        // can state the bound whether or not the model mentioned it.
        {
          ai: {
            truncation: run.meta.window,
            ...(run.meta.usage ? { usage: run.meta.usage } : {}),
            // Carried to the job record so the PANEL can tell a complete
            // delivery from a partial one. The positioned gap in the artifact
            // is read by someone who opens it; the completion state is read by
            // everyone.
            ...(run.meta.delivery ? { delivery: run.meta.delivery } : {}),
          },
        },
      );
    },
  };
}
