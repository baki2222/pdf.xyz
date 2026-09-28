import JSZip from "jszip";
import { pdfTextOpenFailure } from "@/lib/workers/pdf-text/errors";
import { NO_SELECTABLE_TEXT_MESSAGE } from "@/lib/jobs/ai-no-text";
import {
  PAGE_JOIN,
  pageTextChunks,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import {
  describeWindow,
  modelTruncationNotice,
  pageStartsFor,
  userTruncationNotice,
  type TruncationWindow,
} from "../ai/truncation";
import type {
  SummarizeOptions,
  SummaryFormat,
  SummaryLength,
} from "@/lib/jobs/summarize-pdf";
import type { AiProvider, AiCompletionResult } from "../ai/provider";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";
import type { AiUsageMeta } from "@/lib/jobs/ai-results";

/**
 * Summarize PDF engine for the `summarize-pdf` AI tool.
 *
 * This is a real, honest AI summarization engine — never a fabricated "here is your
 * summary" result. Given a PDF and validated options it:
 *   1. extracts the PDF's SELECTABLE text only (no OCR — a scanned/image-only PDF is
 *      honestly rejected as `no_text` and pointed at the OCR tool), then
 *   2. asks a configured {@link AiProvider} to summarize ONLY that text, then
 *   3. packages the model's real summary as a ZIP (summary.md + summary.txt +
 *      manifest.json + README.txt) recording the provider, model, and honest scope.
 *
 * HONESTY (load-bearing):
 *   - No provider ⇒ `ai_unconfigured` with operator requirements. The engine NEVER
 *     invents a summary when no model is configured.
 *   - No selectable text ⇒ `no_text` (run OCR first). The engine never summarizes an
 *     empty/scanned document by guessing.
 *   - The system prompt constrains the model to the document text; the summary that
 *     ships is exactly the model's output, unedited and unfabricated.
 *   - The text extractor and AI provider are injected, so this module stays node-free
 *     and unit-testable: production wires the real pdfjs extractor + Anthropic
 *     provider (`./native`), tests wire deterministic fakes.
 */

export const SUMMARIZE_TOOL = "summarize-pdf" as const;
export const SUMMARIZE_ENGINE = "ai-text-summary" as const;

/** Extract selectable text from a PDF; throws on an unreadable PDF. */
export type PdfTextExtractor = (bytes: Uint8Array) => Promise<ExtractedPdfText>;

export interface SummarizeLimits {
  maxInputBytes?: number;
  maxOutputBytes?: number;
  /** Max source characters sent to the model; longer input is truncated (never silently). */
  maxInputChars?: number;
  /** Ceiling on the model's generated tokens; the per-length budget is clamped to it. */
  maxOutputTokens?: number;
}

export interface SummarizeDeps {
  extract?: PdfTextExtractor;
  /** A configured AI provider. Absent ⇒ the engine fails honestly as `ai_unconfigured`. */
  provider?: AiProvider;
  /** ISO timestamp source; defaults to the wall clock. Injected for deterministic tests. */
  now?: () => string;
  limits?: SummarizeLimits;
}

/** Content-free metrics a successful run reports. Never carries document text. */
export interface SummarizeMeta {
  engine: typeof SUMMARIZE_ENGINE;
  tool: typeof SUMMARIZE_TOOL;
  /** AI provider family id (e.g. "anthropic"). Never a key. */
  provider: string;
  /** Public model id (e.g. "claude-sonnet-5"). Never a secret. */
  model: string;
  length: SummaryLength;
  format: SummaryFormat;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
  /** Character count of the extracted source text (a COUNT, never the text). */
  sourceCharacters: number;
  /** Character count of the produced summary (a COUNT, never the text). */
  summaryCharacters: number;
  /** True when the source exceeded `maxInputChars` and only a prefix was summarized. */
  truncated: boolean;
  /**
   * The one-line disclosure to show beside the result when `truncated` — e.g.
   * "Only pages 1-131 of 400 could be read, cut mid-page - ...". `null` when the
   * whole document was read. The UI renders THIS, not the model's words: a
   * model asked to disclose its own bound may quietly decline to.
   */
  truncationNotice: string | null;
  /**
   * What the model actually saw, structurally — the block the job record carries
   * to the browser so the panel can state the bound without re-deriving it.
   */
  window: TruncationWindow;
  /**
   * Provider-reported token usage, absent when the provider did not report it.
   * Carried to the job record so an AI run's cost is measurable after the fact.
   */
  usage?: AiUsageMeta;
}

export type SummarizeFailureKind =
  | "unsupported"
  | "ai_unconfigured"
  | "no_text"
  /** The PDF needs a password, or is not a readable PDF: a fact about the file. */
  | "cannot_open"
  | "too_large"
  | "rate_limited"
  | "content_filtered"
  | "failed";

export type SummarizeRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "zip";
      contentType: "application/zip";
      meta: SummarizeMeta;
    }
  | {
      ok: false;
      kind: SummarizeFailureKind;
      limitBytes?: number;
      retryable?: boolean;
      message: string;
      /**
       * Token usage when the failure came AFTER a provider call. Absent when no
       * call happened.
       *
       * `incomplete_output` is why this exists: non-retryable precisely because
       * the model hit its output ceiling, so it burned the maximum budget and is
       * the most expensive outcome in the system. A ceiling fed only by
       * successes would be blind to exactly its largest expenses.
       */
      usage?: AiUsageMeta;
      /**
       * What the model was given, when there was a call to give it to.
       *
       * SEPARATELY OPTIONAL from `usage` even though the two co-occur in
       * practice: the window is computed before the call, so a failure that
       * spent tokens always has both and a pre-extraction failure has neither.
       * Encoding "both or neither" as one object would make that invariant
       * UNFALSIFIABLE — the test could not construct the broken state to prove
       * it is rejected.
       */
      window?: TruncationWindow;
    };

/** Per-length generation budget (tokens) and human guidance woven into the prompt. */
const LENGTH_PLAN: Record<SummaryLength, { tokens: number; guidance: string }> =
  {
    brief: {
      tokens: 700,
      guidance:
        "Write a very concise summary: a 2–3 sentence TL;DR followed by at most three key points.",
    },
    standard: {
      tokens: 1600,
      guidance:
        "Write a clear summary of the main points in a few short paragraphs (or 5–8 key points).",
    },
    detailed: {
      tokens: 4000,
      guidance:
        "Write a thorough summary covering every major section, key finding, and important detail.",
    },
  };

const FORMAT_GUIDANCE: Record<SummaryFormat, string> = {
  paragraphs: "Format the summary as short prose paragraphs.",
  bullets: "Format the summary as markdown bullet points.",
  outline:
    "Format the summary as a hierarchical markdown outline with section headings.",
};

const DEFAULT_MAX_INPUT_CHARS = AI_INPUT_LIMITS.maxInputCharacters;

/** The honesty-critical system prompt: summarize ONLY the provided text; invent nothing. */
function buildSystemPrompt(
  options: SummarizeOptions,
  window: TruncationWindow,
): string {
  const parts = [
    "You are a precise document summarizer for pdf.xyz.",
    "Summarize ONLY the content of the document text provided by the user.",
    "Do not add facts, figures, names, or claims that are not present in the text.",
    "If the text is empty or unintelligible, say so plainly instead of guessing.",
    "Write the summary in the same language as the document.",
    LENGTH_PLAN[options.length].guidance,
    FORMAT_GUIDANCE[options.format],
  ];
  if (options.focus) {
    parts.push(`Pay special attention to: ${options.focus}.`);
  }
  // The window disclosure goes last so it overrides anything above it.
  // A summarizer's wrong claim is not a denial — it is presenting a summary of
  // the first pages AS the summary of the document.
  const notice = modelTruncationNotice(
    window,
    (upTo) =>
      `State plainly in the summary that it covers only ${upTo} (e.g. "This summarises ${upTo}").\n` +
      "Never describe it as a summary of the whole document.",
  );
  if (notice) parts.push(notice);
  return parts.join(" ");
}

/** Map a provider completion failure to an honest, typed run failure. */
function mapProviderFailure(
  result: Extract<AiCompletionResult, { ok: false }>,
  window: TruncationWindow,
  model: string,
): Extract<SummarizeRun, { ok: false }> {
  // A provider CALL happened, so both travel with every branch below: the spend
  // is real even though the run failed. Built ONCE and spread — five copies
  // could drift into four, one definition cannot.
  const spent =
    result.usage !== undefined
      ? ({ ...result.usage, calls: 1, model } satisfies AiUsageMeta)
      : undefined;
  const carry = {
    ...(spent ? { usage: spent } : {}),
    window,
  };
  switch (result.kind) {
    case "not_configured":
      return {
        ok: false,
        kind: "ai_unconfigured",
        retryable: false,
        message: result.message,
        ...carry,
      };
    case "rate_limited":
      return {
        ok: false,
        kind: "rate_limited",
        retryable: true,
        message: result.message,
        ...carry,
      };
    case "content_filtered":
      return {
        ok: false,
        kind: "content_filtered",
        retryable: false,
        message: result.message,
        ...carry,
      };
    case "too_long":
      return {
        ok: false,
        kind: "too_large",
        retryable: false,
        message:
          "This document is too large for the AI model's context window. Try a shorter PDF or a briefer summary.",
        ...carry,
      };
    case "timeout":
    case "invalid_response":
    case "provider_error":
    default:
      return {
        ok: false,
        kind: "failed",
        retryable: result.retryable,
        message: result.message,
        ...carry,
      };
  }
}

/**
 * Run the summary flow honestly: reject oversized input, fail `unsupported` when no
 * text extractor is wired, `ai_unconfigured` when no provider is configured, `no_text`
 * when the PDF has no selectable text (run OCR first), and map every provider failure
 * to a typed run failure — never a fabricated summary. On success, return a real ZIP
 * package (summary.md + summary.txt + manifest.json + README.txt).
 */
export async function runSummarize(
  input: Uint8Array,
  options: SummarizeOptions,
  deps: SummarizeDeps,
): Promise<SummarizeRun> {
  const { extract, provider } = deps;
  if (!extract) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "Summarize PDF requires the PDF text extractor, which is not available in this environment.",
    };
  }

  // No provider is the biggest blocker and needs no file work to detect — fail first,
  // honestly, with operator requirements. Never fabricate a summary without a model.
  if (!provider) {
    return {
      ok: false,
      kind: "ai_unconfigured",
      retryable: false,
      message:
        "Summarizing a PDF requires a configured AI provider (operator setup: PDFXYZ_AI_PROVIDER + PDFXYZ_AI_API_KEY). No provider is configured on this worker, so no summary can be produced. See docs/WORKER_ARCHITECTURE.md.",
    };
  }

  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      message: "The PDF input exceeds the worker's size limit.",
    };
  }

  const now = deps.now ?? (() => new Date().toISOString());

  let extracted: ExtractedPdfText;
  try {
    extracted = await extract(input);
  } catch (err) {
    // A file the extractor cannot OPEN (it needs a password, or is not a
    // readable PDF) gets its own reason, never the generic failure. No model
    // has been called yet, so this failure has spent nothing.
    const open = pdfTextOpenFailure(err);
    if (open) return { ok: false, ...open };
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: "The PDF could not be read for text extraction.",
    };
  }

  const sourceText = extracted.text.trim();
  if (!extracted.hasText || sourceText.length === 0) {
    return {
      ok: false,
      kind: "no_text",
      retryable: false,
      // One string for both sides of the upload — see `@/lib/jobs/ai-no-text`.
      message: NO_SELECTABLE_TEXT_MESSAGE["summarize-pdf"],
    };
  }

  const maxChars = deps.limits?.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  // One description of the window, shared by the prompt, the meta and the
  // package, so the model and the user cannot be told different things.
  const window = describeWindow(
    sourceText,
    pageStartsFor(pageTextChunks(extracted.pages), PAGE_JOIN),
    extracted.pageCount,
    maxChars,
  );
  const truncated = window.truncated;
  const promptText = truncated ? sourceText.slice(0, maxChars) : sourceText;

  const plan = LENGTH_PLAN[options.length];
  const maxOutputTokens = Math.min(
    plan.tokens,
    deps.limits?.maxOutputTokens ?? plan.tokens,
  );

  const completion = await provider.complete({
    system: buildSystemPrompt(options, window),
    messages: [
      {
        role: "user",
        content: `Summarize the following document.${truncated ? " (Only the first part of a long document is included.)" : ""}\n\n---\n${promptText}\n---`,
      },
    ],
    maxOutputTokens,
    temperature: 0.2,
  });

  if (!completion.ok)
    return mapProviderFailure(completion, window, provider.model);

  const summary = completion.text.trim();
  if (summary.length === 0) {
    return {
      ok: false,
      kind: "failed",
      retryable: true,
      message: "The AI provider returned an empty summary.",
    };
  }

  const createdAt = now();
  const manifest: SummaryManifest = {
    schema: "pdfxyz.summary/v1",
    tool: SUMMARIZE_TOOL,
    engine: SUMMARIZE_ENGINE,
    createdAt,
    provider: provider.id,
    model: completion.model,
    options: {
      length: options.length,
      format: options.format,
      ...(options.focus ? { focus: options.focus } : {}),
    },
    source: {
      pageCount: extracted.pageCount,
      characters: sourceText.length,
      truncatedToCharacters: truncated ? maxChars : null,
      truncationNotice: userTruncationNotice(window) || null,
    },
    summary: { characters: summary.length },
    notice:
      "This summary was generated by an AI model from the SELECTABLE TEXT of the source PDF only. It may omit or misstate details — verify against the original before relying on it. No content was fabricated beyond the model's summary of the provided text.",
  };

  const output = await buildPackage(summary, manifest, options);
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: "The summary package exceeds the worker size limit.",
    };
  }

  return {
    ok: true,
    output,
    filenameExt: "zip",
    contentType: "application/zip",
    meta: {
      engine: SUMMARIZE_ENGINE,
      tool: SUMMARIZE_TOOL,
      provider: provider.id,
      model: completion.model,
      // Token counts travel to the job record so the per-page cost of an AI run
      // is measurable after the fact. Absent when the provider did not report.
      ...(completion.usage
        ? {
            usage: {
              inputTokens: completion.usage.inputTokens,
              outputTokens: completion.usage.outputTokens,
              ...(completion.usage.cachedInputTokens !== undefined
                ? { cachedInputTokens: completion.usage.cachedInputTokens }
                : {}),
              ...(completion.usage.cacheWriteInputTokens !== undefined
                ? {
                    cacheWriteInputTokens:
                      completion.usage.cacheWriteInputTokens,
                  }
                : {}),
              // One provider call per job today. Chunked translation makes this N.
              calls: 1,
              model: completion.model,
            },
          }
        : {}),
      length: options.length,
      format: options.format,
      pageCount: extracted.pageCount,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
      sourceCharacters: sourceText.length,
      summaryCharacters: summary.length,
      truncated,
      truncationNotice: userTruncationNotice(window) || null,
      window,
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest / package types + serialization
// ---------------------------------------------------------------------------

interface SummaryManifest {
  schema: string;
  tool: string;
  engine: string;
  createdAt: string;
  provider: string;
  model: string;
  options: { length: SummaryLength; format: SummaryFormat; focus?: string };
  source: {
    pageCount: number;
    characters: number;
    truncatedToCharacters: number | null;
    /** The page-named disclosure, or null when the whole document was read. */
    truncationNotice: string | null;
  };
  summary: { characters: number };
  notice: string;
}

/** Render the summary.md with an honest provenance header + the model's summary. */
function renderMarkdown(summary: string, manifest: SummaryManifest): string {
  const lines: string[] = [];
  lines.push("# Summary");
  lines.push("");
  lines.push(
    `> Generated by ${manifest.provider} (${manifest.model}) from the selectable text of the source PDF.`,
  );
  lines.push(
    `> Pages: ${manifest.source.pageCount} · Source characters: ${manifest.source.characters}${manifest.source.truncatedToCharacters !== null ? ` (truncated to ${manifest.source.truncatedToCharacters} for summarization)` : ""}`,
  );
  // A character count is not something a reader can act on; the page sentence
  // is. It goes in the file itself, because the file outlives the panel.
  if (manifest.source.truncationNotice) {
    lines.push(`>`);
    lines.push(`> **${manifest.source.truncationNotice}**`);
  }
  lines.push("");
  lines.push(summary);
  lines.push("");
  lines.push("---");
  lines.push(`_${manifest.notice}_`);
  return lines.join("\n");
}

/** Render a plain-text README describing the package and its honest scope. */
function renderReadme(manifest: SummaryManifest): string {
  const lines: string[] = [];
  lines.push("pdf.xyz — AI Summary Package");
  lines.push("============================");
  lines.push("");
  lines.push(`Generated: ${manifest.createdAt}`);
  lines.push(`Provider: ${manifest.provider}`);
  lines.push(`Model: ${manifest.model}`);
  lines.push(
    `Length: ${manifest.options.length} · Format: ${manifest.options.format}`,
  );
  if (manifest.options.focus) lines.push(`Focus: ${manifest.options.focus}`);
  lines.push("");
  lines.push("Contents:");
  lines.push(
    "  summary.md    The AI summary (markdown) with a provenance header.",
  );
  lines.push("  summary.txt   The AI summary as plain text.");
  lines.push(
    "  manifest.json A structured record of the request (provider, model, options, source stats).",
  );
  lines.push("");
  lines.push("HONEST SCOPE:");
  lines.push("  " + manifest.notice);
  return lines.join("\n");
}

/** Package the summary + manifest + README into a real ZIP. */
async function buildPackage(
  summary: string,
  manifest: SummaryManifest,
  _options: SummarizeOptions,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("summary.md", renderMarkdown(summary, manifest));
  zip.file("summary.txt", summary);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt", renderReadme(manifest));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
