/**
 * The Summarize PDF {@link Processor}: the AI-backed summarization engine
 * (`../summarize/engine`) wrapped behind the shared processor contract, so the worker
 * executor and the local-dev adapter dispatch **Summarize PDF** exactly like any other
 * secure-worker capability.
 *
 * It changes none of the engine's honesty guarantees: no configured AI provider ⇒
 * `not_implemented` with operator requirements; no selectable text ⇒ a `no_text`
 * failure pointing at OCR; and the shipped summary is exactly the model's real output.
 * The text extractor and provider are injected (the same {@link SummarizeDeps} the
 * engine takes), so this module stays free of Node built-ins and unit-testable.
 */

import type { JobError } from "@/lib/jobs";
import { summaryOutputName } from "@/lib/jobs/summarize-pdf";
import {
  SUMMARIZE_TOOL,
  runSummarize,
  type SummarizeDeps,
  type SummarizeMeta,
  type SummarizeRun,
} from "../summarize/engine";
import {
  processorFail,
  aiResultsFromFailure,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";
import { perCallReadLimit } from "./read-cap-limit";
import { AI_TOOL_OPTION_PARSERS } from "@/lib/jobs/ai-tool-options";

type Failure = Extract<SummarizeRun, { ok: false }>;

/** Deterministic output name for the summary package (re-exported for tests/UI). */
export function summarizeOutputName(originalName: unknown): string {
  return summaryOutputName(originalName);
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

function meta(m: SummarizeMeta): ProcessorMeta {
  return {
    engine: m.engine,
    tool: m.tool,
    provider: m.provider,
    model: m.model,
    length: m.length,
    format: m.format,
    pageCount: m.pageCount,
    inputBytes: m.inputBytes,
    outputBytes: m.outputBytes,
    sourceCharacters: m.sourceCharacters,
    summaryCharacters: m.summaryCharacters,
    truncated: m.truncated,
  };
}

export function createSummarizeProcessor(deps: SummarizeDeps): Processor {
  const ready = deps.extract != null && deps.provider != null;
  return {
    id: "summarize",
    tools: [SUMMARIZE_TOOL],
    supports(tool) {
      return tool === SUMMARIZE_TOOL;
    },
    capability() {
      return {
        id: "summarize",
        tools: [SUMMARIZE_TOOL],
        ready,
        detail: ready
          ? "Summarize PDF ready: the PDF's selectable text is summarized by a configured AI provider and packaged as a summary ZIP (summary.md + summary.txt + manifest) on an auto-deleting secure worker."
          : deps.extract == null
            ? "Summarize PDF needs the PDF text extractor, which isn't available on this worker."
            : "Summarize PDF needs a configured AI provider (PDFXYZ_AI_PROVIDER + API key). None is configured, so it fails honestly as not-implemented.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (input.tool !== SUMMARIZE_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles summarize-pdf.",
          retryable: false,
        });
      }
      const file = input.inputs[0];
      if (input.inputs.length !== 1 || !file) {
        return processorFail({
          code: "unprocessable_entity",
          message: "Summarize PDF accepts exactly one PDF input.",
          retryable: false,
        });
      }
      // The SAME parser the route ran before it charged the allowance
      // (`@/lib/jobs/ai-tool-options`), kept here as the second line of
      // defence for a job queued by anything but that route.
      const parsed = AI_TOOL_OPTION_PARSERS[SUMMARIZE_TOOL](input.options);
      if (!parsed.ok) {
        return processorFail({
          code: parsed.error.body.error.code,
          message: parsed.error.body.error.message,
          retryable: false,
        });
      }
      // The read bound this run was CHARGED for. The route prices a per-call
      // run by the characters the browser declared, which is only true if
      // no more than that is read — see `./read-cap-limit`. Absent leaves the
      // engine's own limit untouched; malformed fails closed.
      const readLimit = perCallReadLimit(
        input.delivery,
        deps.limits?.maxInputChars,
      );
      if (!readLimit.ok) return processorFail(readLimit.error);
      const run = await runSummarize(
        file.bytes,
        parsed.value,
        {
          ...deps,
          limits: { ...deps.limits, maxInputChars: readLimit.maxInputChars },
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
            filename: summarizeOutputName(file.filename),
            contentType: run.contentType,
            bytes: run.output,
          },
        ],
        meta(run.meta),
        // The window travels to the browser on the job record, so the panel
        // can state the bound whether or not the model chose to mention it.
        {
          ai: {
            truncation: run.meta.window,
            ...(run.meta.usage ? { usage: run.meta.usage } : {}),
          },
        },
      );
    },
  };
}
