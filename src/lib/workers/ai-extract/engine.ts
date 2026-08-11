import JSZip from "jszip";
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
import type { ExtractOptions, ExtractionField } from "@/lib/jobs/ai-extract";
import type { AiProvider, AiCompletionResult } from "../ai/provider";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";

/**
 * AI Data Extraction engine for the `ai-extract` AI tool.
 *
 * This is a real, honest structured-extraction engine — never a fabricated "here is
 * your data" result. Given a PDF and validated options it:
 *   1. extracts the PDF's SELECTABLE text only (no OCR — a scanned/image-only PDF is
 *      honestly rejected as `no_text` and pointed at the OCR tool), then
 *   2. asks a configured {@link AiProvider} to extract structured data from ONLY that
 *      text, returning a single JSON object, then
 *   3. parses the model's JSON (never re-invents values) and packages it as a ZIP
 *      (extraction.json + extraction.md + manifest.json + README.txt) recording the
 *      provider, model, request mode/schema, and honest scope.
 *
 * HONESTY (load-bearing):
 *   - No provider ⇒ `ai_unconfigured` with operator requirements. The engine NEVER
 *     invents an extraction when no model is configured.
 *   - No selectable text ⇒ `no_text` (run OCR first). It never extracts from an
 *     empty/scanned document by guessing.
 *   - The system prompt constrains the model to the document text, demands JSON only,
 *     and requires `null` for values not present — the shipped extraction is exactly
 *     the model's JSON, parsed and re-serialized, unedited and unfabricated.
 *   - If the model does not return valid JSON, the run fails honestly (`failed`)
 *     rather than shipping prose dressed up as structured data.
 *   - The text extractor and AI provider are injected, so this module stays node-free
 *     and unit-testable: production wires the real pdfjs extractor + Anthropic
 *     provider (`./native`), tests wire deterministic fakes.
 *
 * SAFETY: the extraction prompt/schema are user-authored directives already validated
 * (bounded, control-character-free) by the job contract. No secret ever reaches this
 * layer — the AI key lives only in the provider's closure (`../ai/native`).
 */

export const AI_EXTRACT_TOOL = "ai-extract" as const;
export const AI_EXTRACT_ENGINE = "ai-data-extraction" as const;

/** Extract selectable text from a PDF; throws on an unreadable PDF. */
export type PdfTextExtractor = (bytes: Uint8Array) => Promise<ExtractedPdfText>;

export interface AiExtractLimits {
  maxInputBytes?: number;
  maxOutputBytes?: number;
  /** Max source characters sent to the model; longer input is truncated (never silently). */
  maxInputChars?: number;
  /** Ceiling on the model's generated tokens; the default budget is clamped to it. */
  maxOutputTokens?: number;
}

export interface AiExtractDeps {
  extract?: PdfTextExtractor;
  /** A configured AI provider. Absent ⇒ the engine fails honestly as `ai_unconfigured`. */
  provider?: AiProvider;
  /** ISO timestamp source; defaults to the wall clock. Injected for deterministic tests. */
  now?: () => string;
  limits?: AiExtractLimits;
}

/** Content-free metrics a successful run reports. Never carries document text or values. */
export interface AiExtractMeta {
  engine: typeof AI_EXTRACT_ENGINE;
  tool: typeof AI_EXTRACT_TOOL;
  /** AI provider family id (e.g. "anthropic"). Never a key. */
  provider: string;
  /** Public model id (e.g. "claude-sonnet-5"). Never a secret. */
  model: string;
  /** How the request described what to extract. */
  mode: ExtractOptions["mode"];
  /** Number of fields requested (schema mode); 0 in prompt mode. */
  fieldCount: number;
  /** Number of top-level keys/items the model returned (a COUNT, never the values). */
  extractedKeys: number;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
  /** Character count of the extracted source text (a COUNT, never the text). */
  sourceCharacters: number;
  /** True when the source exceeded `maxInputChars` and only a prefix was sent. */
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
}

export type AiExtractFailureKind =
  | "unsupported"
  | "ai_unconfigured"
  | "no_text"
  | "too_large"
  | "rate_limited"
  | "content_filtered"
  | "failed";

export type AiExtractRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "zip";
      contentType: "application/zip";
      meta: AiExtractMeta;
    }
  | {
      ok: false;
      kind: AiExtractFailureKind;
      limitBytes?: number;
      retryable?: boolean;
      message: string;
    };

/**
 * A generous default generation budget. Structured extraction output is bounded by
 * the requested fields, so a fixed default the operator's `maxOutputTokens` limit can
 * only lower (never raise) is sufficient.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4000;
const DEFAULT_MAX_INPUT_CHARS = AI_INPUT_LIMITS.maxInputCharacters;

/** Human-readable one-line description of a field, for the system prompt. */
function describeField(field: ExtractionField): string {
  const desc = field.description ? ` — ${field.description}` : "";
  return `- "${field.name}" (${field.type})${desc}`;
}

/** The honesty-critical system prompt: extract ONLY from the provided text; invent nothing. */
function buildSystemPrompt(
  options: ExtractOptions,
  window: TruncationWindow,
): string {
  const parts = [
    "You are a precise structured-data extraction engine for pdf.xyz.",
    "Extract information ONLY from the document text provided by the user.",
    "Do not invent, infer beyond the text, or fabricate values.",
    "When a requested value is not present in the text, use null — never a guess.",
    "Return ONLY a single JSON object. No prose, no explanation, no markdown, no code fences.",
  ];
  if (options.mode === "schema" && options.schema) {
    parts.push(
      "Extract exactly these fields, using the given names verbatim as JSON keys:",
    );
    parts.push(options.schema.map(describeField).join("\n"));
    parts.push(
      "Coerce each value to the stated type where the text supports it; use null when a field is absent.",
    );
  } else if (options.mode === "prompt" && options.prompt) {
    parts.push(
      "Extract the data described by the following instruction as a flat JSON object with clear, descriptive keys:",
    );
    parts.push(options.prompt);
  }
  // The window disclosure goes last so it overrides anything above it.
  const notice = modelTruncationNotice(window);
  if (notice) {
    parts.push(
      notice,
      "If a requested field does not appear in the text you were given, report it as not found IN THE PAGES EXAMINED — never as absent from the document.",
    );
  }
  return parts.join("\n");
}

/** Map a provider completion failure to an honest, typed run failure. */
function mapProviderFailure(
  result: Extract<AiCompletionResult, { ok: false }>,
): Extract<AiExtractRun, { ok: false }> {
  switch (result.kind) {
    case "not_configured":
      return {
        ok: false,
        kind: "ai_unconfigured",
        retryable: false,
        message: result.message,
      };
    case "rate_limited":
      return {
        ok: false,
        kind: "rate_limited",
        retryable: true,
        message: result.message,
      };
    case "content_filtered":
      return {
        ok: false,
        kind: "content_filtered",
        retryable: false,
        message: result.message,
      };
    case "too_long":
      return {
        ok: false,
        kind: "too_large",
        retryable: false,
        message:
          "This document is too large for the AI model's context window. Try a shorter PDF or split it first.",
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
      };
  }
}

/**
 * Parse the model's completion as a single JSON object/array, tolerating a ```json
 * code fence the model may wrap it in. Returns the parsed value (must be a non-null
 * object or array — a bare primitive is not a usable extraction) or `null` on failure.
 */
function parseModelJson(
  text: string,
): Record<string, unknown> | unknown[] | null {
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) body = fence[1]!.trim();
  if (body.length === 0) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object") {
      return parsed as Record<string, unknown> | unknown[];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run the extraction flow honestly: reject oversized input, fail `unsupported` when no
 * text extractor is wired, `ai_unconfigured` when no provider is configured, `no_text`
 * when the PDF has no selectable text (run OCR first), and map every provider failure
 * to a typed run failure — never a fabricated extraction. On success, return a real ZIP
 * package (extraction.json + extraction.md + manifest.json + README.txt).
 */
export async function runAiExtract(
  input: Uint8Array,
  options: ExtractOptions,
  deps: AiExtractDeps,
): Promise<AiExtractRun> {
  const { extract, provider } = deps;
  if (!extract) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "AI Data Extraction requires the PDF text extractor, which is not available in this environment.",
    };
  }

  // No provider is the biggest blocker and needs no file work to detect — fail first,
  // honestly, with operator requirements. Never fabricate an extraction without a model.
  if (!provider) {
    return {
      ok: false,
      kind: "ai_unconfigured",
      retryable: false,
      message:
        "Extracting structured data from a PDF requires a configured AI provider (operator setup: PDFXYZ_AI_PROVIDER + PDFXYZ_AI_API_KEY). No provider is configured on this worker, so no extraction can be produced. See docs/WORKER_ARCHITECTURE.md.",
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
  } catch {
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
      message:
        "This PDF has no selectable text to extract from. It may be a scan or image-only PDF — run OCR PDF first, then extract from the result.",
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

  const maxOutputTokens =
    deps.limits?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  const completion = await provider.complete({
    system: buildSystemPrompt(options, window),
    messages: [
      {
        role: "user",
        content: `Extract structured data from the following document.${truncated ? " (Only the first part of a long document is included.)" : ""}\n\n---\n${promptText}\n---`,
      },
    ],
    maxOutputTokens,
    // Deterministic extraction: no creative sampling.
    temperature: 0,
  });

  if (!completion.ok) return mapProviderFailure(completion);

  const data = parseModelJson(completion.text);
  if (data === null) {
    return {
      ok: false,
      kind: "failed",
      retryable: true,
      message:
        "The AI provider did not return valid JSON, so no honest extraction could be produced. No data was fabricated. Retrying may succeed.",
    };
  }

  const extractedKeys = Array.isArray(data)
    ? data.length
    : Object.keys(data).length;

  const createdAt = now();
  const manifest: ExtractionManifest = {
    schema: "pdfxyz.extraction/v1",
    tool: AI_EXTRACT_TOOL,
    engine: AI_EXTRACT_ENGINE,
    createdAt,
    provider: provider.id,
    model: completion.model,
    options:
      options.mode === "schema"
        ? { mode: "schema", schema: options.schema ?? [] }
        : { mode: "prompt", prompt: options.prompt ?? "" },
    source: {
      pageCount: extracted.pageCount,
      characters: sourceText.length,
      truncatedToCharacters: truncated ? maxChars : null,
      truncationNotice: userTruncationNotice(window) || null,
    },
    extraction: { keys: extractedKeys },
    notice:
      "This data was extracted by an AI model from the SELECTABLE TEXT of the source PDF only. Values may be missing or incorrect and absent values are null — verify against the original before relying on it. No content was fabricated beyond the model's extraction of the provided text.",
  };

  const output = await buildPackage(data, manifest);
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: "The extraction package exceeds the worker size limit.",
    };
  }

  return {
    ok: true,
    output,
    filenameExt: "zip",
    contentType: "application/zip",
    meta: {
      engine: AI_EXTRACT_ENGINE,
      tool: AI_EXTRACT_TOOL,
      provider: provider.id,
      model: completion.model,
      mode: options.mode,
      fieldCount: options.mode === "schema" ? (options.schema?.length ?? 0) : 0,
      extractedKeys,
      pageCount: extracted.pageCount,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
      sourceCharacters: sourceText.length,
      truncated,
      truncationNotice: userTruncationNotice(window) || null,
      window,
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest / package types + serialization
// ---------------------------------------------------------------------------

type ExtractionManifestOptions =
  | { mode: "schema"; schema: ExtractionField[] }
  | { mode: "prompt"; prompt: string };

interface ExtractionManifest {
  schema: string;
  tool: string;
  engine: string;
  createdAt: string;
  provider: string;
  model: string;
  options: ExtractionManifestOptions;
  source: {
    pageCount: number;
    characters: number;
    truncatedToCharacters: number | null;
    /** The page-named disclosure, or null when the whole document was read. */
    truncationNotice: string | null;
  };
  extraction: { keys: number };
  notice: string;
}

/** Render a single extracted value for the human-readable Markdown table. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "_(not found)_";
  if (Array.isArray(value)) return value.map((v) => renderValue(v)).join("; ");
  if (typeof value === "object") return "`" + JSON.stringify(value) + "`";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Render the extraction.md with a provenance header + a key/value rendering of the data. */
function renderMarkdown(
  data: Record<string, unknown> | unknown[],
  manifest: ExtractionManifest,
): string {
  const lines: string[] = [];
  lines.push("# Extracted Data");
  lines.push("");
  lines.push(
    `> Generated by ${manifest.provider} (${manifest.model}) from the selectable text of the source PDF.`,
  );
  lines.push(
    `> Pages: ${manifest.source.pageCount} · Source characters: ${manifest.source.characters}${manifest.source.truncatedToCharacters !== null ? ` (truncated to ${manifest.source.truncatedToCharacters} for extraction)` : ""}`,
  );
  // A null value in this table means "not found in the pages examined" when the
  // window was short. Saying so beside the table is the difference between a
  // gap and a false negative.
  if (manifest.source.truncationNotice) {
    lines.push(`>`);
    lines.push(
      `> **${manifest.source.truncationNotice}** Fields shown as \`null\` were not found in the pages examined — they may still appear later in the document.`,
    );
  }
  lines.push("");
  if (Array.isArray(data)) {
    data.forEach((item, i) => {
      lines.push(`${i + 1}. ${renderValue(item)}`);
    });
  } else {
    lines.push("| Field | Value |");
    lines.push("| --- | --- |");
    for (const [key, value] of Object.entries(data)) {
      lines.push(`| ${key.replace(/\|/g, "\\|")} | ${renderValue(value)} |`);
    }
  }
  lines.push("");
  lines.push("---");
  lines.push(`_${manifest.notice}_`);
  return lines.join("\n");
}

/** Render a plain-text README describing the package and its honest scope. */
function renderReadme(manifest: ExtractionManifest): string {
  const lines: string[] = [];
  lines.push("pdf.xyz — AI Data Extraction Package");
  lines.push("====================================");
  lines.push("");
  lines.push(`Generated: ${manifest.createdAt}`);
  lines.push(`Provider: ${manifest.provider}`);
  lines.push(`Model: ${manifest.model}`);
  if (manifest.options.mode === "schema") {
    lines.push(`Request: schema (${manifest.options.schema.length} field(s))`);
    for (const field of manifest.options.schema) {
      lines.push(
        `  - ${field.name} (${field.type})${field.description ? ` — ${field.description}` : ""}`,
      );
    }
  } else {
    lines.push("Request: prompt");
    lines.push(`  ${manifest.options.prompt}`);
  }
  lines.push("");
  lines.push("Contents:");
  lines.push(
    "  extraction.json  The AI-extracted structured data (exactly the model's JSON output).",
  );
  lines.push(
    "  extraction.md    A human-readable rendering with a provenance header.",
  );
  lines.push(
    "  manifest.json    A structured record of the request (provider, model, request, source stats).",
  );
  lines.push("");
  lines.push("HONEST SCOPE:");
  lines.push("  " + manifest.notice);
  return lines.join("\n");
}

/** Package the extraction data + manifest + README into a real ZIP. */
async function buildPackage(
  data: Record<string, unknown> | unknown[],
  manifest: ExtractionManifest,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("extraction.json", JSON.stringify(data, null, 2));
  zip.file("extraction.md", renderMarkdown(data, manifest));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt", renderReadme(manifest));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
