/**
 * The AI Data Extraction {@link Processor}: the AI-backed structured-extraction
 * engine (`../ai-extract/engine`) wrapped behind the shared processor contract, so
 * the worker executor and the local-dev adapter dispatch **AI Data Extraction**
 * exactly like any other secure-worker capability.
 *
 * It changes none of the engine's honesty guarantees: no configured AI provider ⇒
 * `not_implemented` with operator requirements; no selectable text ⇒ a `no_text`
 * failure pointing at OCR; a non-JSON model reply ⇒ `unprocessable_entity` rather
 * than a fabricated result; and the shipped extraction is exactly the model's real
 * JSON. The text extractor and provider are injected (the same {@link AiExtractDeps}
 * the engine takes), so this module stays free of Node built-ins and unit-testable.
 */

import type { JobError } from "@/lib/jobs";
import {
  parseExtractOptions,
  extractionOutputName,
} from "@/lib/jobs/ai-extract";
import {
  AI_EXTRACT_TOOL,
  runAiExtract,
  type AiExtractDeps,
  type AiExtractMeta,
  type AiExtractRun,
} from "../ai-extract/engine";
import {
  processorFail,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";

type Failure = Extract<AiExtractRun, { ok: false }>;

/** Deterministic output name for the extraction package (re-exported for tests/UI). */
export function aiExtractOutputName(originalName: unknown): string {
  return extractionOutputName(originalName);
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
      // A terminal content problem the caller can't fix by retrying (e.g. the PDF
      // could not be read) surfaces as `unprocessable_entity`; a genuinely transient
      // failure (a non-JSON model reply, a timeout) keeps the engine's retryable hint
      // as an `internal_error` so the executor may re-deliver it.
      return run.retryable === false
        ? {
            code: "unprocessable_entity",
            message: run.message,
            retryable: false,
          }
        : {
            code: "internal_error",
            message: run.message,
            retryable: run.retryable ?? true,
          };
  }
}

function meta(m: AiExtractMeta): ProcessorMeta {
  return {
    engine: m.engine,
    tool: m.tool,
    provider: m.provider,
    model: m.model,
    mode: m.mode,
    fieldCount: m.fieldCount,
    extractedKeys: m.extractedKeys,
    pageCount: m.pageCount,
    inputBytes: m.inputBytes,
    outputBytes: m.outputBytes,
    sourceCharacters: m.sourceCharacters,
    truncated: m.truncated,
  };
}

export function createAiExtractProcessor(deps: AiExtractDeps): Processor {
  const ready = deps.extract != null && deps.provider != null;
  return {
    id: "ai-extract",
    tools: [AI_EXTRACT_TOOL],
    supports(tool) {
      return tool === AI_EXTRACT_TOOL;
    },
    capability() {
      return {
        id: "ai-extract",
        tools: [AI_EXTRACT_TOOL],
        ready,
        detail: ready
          ? "AI Data Extraction ready: the PDF's selectable text is sent to a configured AI provider which returns structured JSON, packaged as an extraction ZIP (extraction.json + extraction.md + manifest) on an encrypted, auto-deleting secure worker."
          : deps.extract == null
            ? "AI Data Extraction needs the PDF text extractor, which isn't available on this worker."
            : "AI Data Extraction needs a configured AI provider (PDFXYZ_AI_PROVIDER + API key). None is configured, so it fails honestly as not-implemented.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (input.tool !== AI_EXTRACT_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles ai-extract.",
          retryable: false,
        });
      }
      const file = input.inputs[0];
      if (input.inputs.length !== 1 || !file) {
        return processorFail({
          code: "unprocessable_entity",
          message: "AI Data Extraction accepts exactly one PDF input.",
          retryable: false,
        });
      }
      const parsed = parseExtractOptions(input.options);
      if (!parsed.ok) {
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      }
      const run = await runAiExtract(file.bytes, parsed.value, deps);
      if (!run.ok) return processorFail(jobError(run));
      return processorOk(
        [
          {
            filename: aiExtractOutputName(file.filename),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        meta(run.meta),
        // The window travels to the browser on the job record, so the panel
        // can state the bound whether or not the model chose to mention it.
        { ai: { truncation: run.meta.window } },
      );
    },
  };
}
