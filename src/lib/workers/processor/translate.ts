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

import type { JobError } from "@/lib/jobs";
import {
  parseTranslateOptions,
  translationOutputName,
} from "@/lib/jobs/translate-pdf";
import {
  TRANSLATE_TOOL,
  runTranslate,
  type TranslateDeps,
  type TranslateMeta,
  type TranslateRun,
} from "../translate/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

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
    case "no_text":
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
          ? "Translate PDF ready: the PDF's selectable text is translated by a configured AI provider and packaged as a translation ZIP (translation.md + translation.txt + manifest) on an encrypted, auto-deleting secure worker."
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
      const parsed = parseTranslateOptions(input.options);
      if (!parsed.ok) {
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      }
      const run = await runTranslate(file.bytes, parsed.value, deps);
      if (!run.ok) return processorFail(jobError(run));
      return processorOk(
        [
          {
            filename: translateOutputName(file.filename),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        meta(run.meta),
      );
    },
  };
}
