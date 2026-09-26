/**
 * The Chat with PDF {@link Processor}: the AI-backed document question-answering
 * engine (`../chat-with-pdf/engine`) wrapped behind the shared processor contract, so
 * the worker executor and the local-dev adapter dispatch **Chat with PDF** exactly
 * like any other secure-worker capability.
 *
 * It changes none of the engine's honesty guarantees: no configured AI provider ⇒
 * `not_implemented` with operator requirements; no selectable text ⇒ a `no_text`
 * failure pointing at OCR; an empty model reply ⇒ `internal_error` rather than a
 * fabricated answer; and the shipped answer is exactly the model's real text. The text
 * extractor and provider are injected (the same {@link ChatWithPdfDeps} the engine
 * takes), so this module stays free of Node built-ins and unit-testable.
 */

import type { JobError } from "@/lib/jobs";
import {
  parseChatOptions,
  chatAnswerOutputName,
} from "@/lib/jobs/chat-with-pdf";
import {
  CHAT_TOOL,
  runChatWithPdf,
  type ChatWithPdfDeps,
  type ChatWithPdfMeta,
  type ChatWithPdfRun,
} from "../chat-with-pdf/engine";
import {
  processorFail,
  aiResultsFromFailure,
  processorOk,
  type Processor,
  type ProcessorMeta,
  type ProcessorResult,
} from "./types";
import { perCallReadLimit } from "./read-cap-limit";

type Failure = Extract<ChatWithPdfRun, { ok: false }>;

/** Deterministic output name for the answer package (re-exported for tests/UI). */
export function chatWithPdfOutputName(originalName: unknown): string {
  return chatAnswerOutputName(originalName);
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
      // failure (an empty reply, a timeout) keeps the engine's retryable hint as an
      // `internal_error` so the executor may re-deliver it.
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

function meta(m: ChatWithPdfMeta): ProcessorMeta {
  return {
    engine: m.engine,
    tool: m.tool,
    provider: m.provider,
    model: m.model,
    pageCount: m.pageCount,
    questionCharacters: m.questionCharacters,
    contextTurns: m.contextTurns,
    answerCharacters: m.answerCharacters,
    citedPages: m.citedPages,
    grounded: m.grounded,
    inputBytes: m.inputBytes,
    outputBytes: m.outputBytes,
    sourceCharacters: m.sourceCharacters,
    truncated: m.truncated,
  };
}

export function createChatWithPdfProcessor(deps: ChatWithPdfDeps): Processor {
  const ready = deps.extract != null && deps.provider != null;
  return {
    id: "chat-with-pdf",
    tools: [CHAT_TOOL],
    supports(tool) {
      return tool === CHAT_TOOL;
    },
    capability() {
      return {
        id: "chat-with-pdf",
        tools: [CHAT_TOOL],
        ready,
        detail: ready
          ? "Chat with PDF ready: the PDF's selectable text is sent to a configured AI provider which answers from ONLY that text (with page-level [p.N] citations when page metadata is present), packaged as an answer ZIP (answer.md + answer.txt + manifest) on an encrypted, auto-deleting secure worker."
          : deps.extract == null
            ? "Chat with PDF needs the PDF text extractor, which isn't available on this worker."
            : "Chat with PDF needs a configured AI provider (PDFXYZ_AI_PROVIDER + API key). None is configured, so it fails honestly as not-implemented.",
      };
    },
    async process(input): Promise<ProcessorResult> {
      if (input.tool !== CHAT_TOOL) {
        return processorFail({
          code: "not_implemented",
          message: "This processor only handles chat-with-pdf.",
          retryable: false,
        });
      }
      const file = input.inputs[0];
      if (input.inputs.length !== 1 || !file) {
        return processorFail({
          code: "unprocessable_entity",
          message: "Chat with PDF accepts exactly one PDF input.",
          retryable: false,
        });
      }
      const parsed = parseChatOptions(input.options);
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
      const run = await runChatWithPdf(file.bytes, parsed.value, {
        ...deps,
        limits: { ...deps.limits, maxInputChars: readLimit.maxInputChars },
      });
      // A run that failed AFTER a provider call still owes the job record what
      // it spent — see `aiResultsFromFailure`. Absent when no call happened.
      if (!run.ok)
        return processorFail(jobError(run), aiResultsFromFailure(run));
      return processorOk(
        [
          {
            filename: chatWithPdfOutputName(file.filename),
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
