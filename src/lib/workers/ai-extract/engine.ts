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
import type { ExtractOptions, ExtractionField } from "@/lib/jobs/ai-extract";
import type { AiProvider, AiCompletionResult } from "../ai/provider";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";
import type { AiUsageMeta } from "@/lib/jobs/ai-results";

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
 *      (extraction.json + model-output.json + extraction.md + manifest.json +
 *      README.txt) recording the provider, model, request mode/schema, and honest
 *      scope.
 *
 * HONESTY (load-bearing):
 *   - No provider ⇒ `ai_unconfigured` with operator requirements. The engine NEVER
 *     invents an extraction when no model is configured.
 *   - No selectable text ⇒ `no_text` (run OCR first). It never extracts from an
 *     empty/scanned document by guessing.
 *   - The system prompt constrains the model to the document text, demands JSON only,
 *     and requires `null` for values not present. No VALUE is ever edited or invented:
 *     model-output.json is exactly the model's JSON, parsed and re-serialized.
 *   - In SCHEMA mode extraction.json is that reply RECONCILED with the request: the
 *     requested fields, in the requested order, each with the model's value — under
 *     the requested name even when the model respelled it (`Invoice Number` →
 *     `invoice_number`). A requested field the model did not return is `null` there
 *     and is NAMED in manifest.json (`extraction.missingKeys`) and in extraction.md
 *     as "not returned by the model" — never folded into a null the model
 *     returned (shown as "not found, or more than one match"). Until
 *     2026-09-28 a dropped field simply vanished: a request for 12 fields could ship
 *     10 rows, and a consumer keyed on the requested names broke, while the manifest
 *     said "absent values are null". A LIST reply in schema mode fails honestly.
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
  /**
   * Provider-reported token usage, absent when the provider did not report it.
   * Carried to the job record so an AI run's cost is measurable after the fact.
   */
  usage?: AiUsageMeta;
}

export type AiExtractFailureKind =
  | "unsupported"
  | "ai_unconfigured"
  | "no_text"
  /** The PDF needs a password, or is not a readable PDF: a fact about the file. */
  | "cannot_open"
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
  // An extractor's wrong claim is a null that reads as "this document has no
  // such field" when the field merely sits past the cut.
  const notice = modelTruncationNotice(
    window,
    (upTo) =>
      "If a requested field does not appear in the text you were given, report it as not found IN THE PAGES EXAMINED —\n" +
      `you saw only ${upTo}, so it is never evidence the document lacks the field.`,
  );
  if (notice) parts.push(notice);
  return parts.join("\n");
}

/** Map a provider completion failure to an honest, typed run failure. */
function mapProviderFailure(
  result: Extract<AiCompletionResult, { ok: false }>,
  window: TruncationWindow,
  model: string,
): Extract<AiExtractRun, { ok: false }> {
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
          "This document is too large for the AI model's context window. Try a shorter PDF or split it first.",
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
      message: NO_SELECTABLE_TEXT_MESSAGE["ai-extract"],
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

  if (!completion.ok)
    return mapProviderFailure(completion, window, provider.model);

  // The call is PAID from here on, so every failure below carries what it
  // spent and what the model saw — the success arm is not the only one that
  // costs money (CLAUDE.md rule 3). Until 2026-09-28 the non-JSON failure
  // dropped both.
  const spent = {
    ...(completion.usage
      ? {
          usage: {
            ...completion.usage,
            calls: 1,
            model: completion.model,
          } satisfies AiUsageMeta,
        }
      : {}),
    window,
  };

  const data = parseModelJson(completion.text);
  if (data === null) {
    return {
      ok: false,
      kind: "failed",
      retryable: true,
      message:
        "The AI provider did not return valid JSON, so no honest extraction could be produced. No data was fabricated. Retrying may succeed.",
      ...spent,
    };
  }

  // A schema asks for NAMED fields. A list has no names to match them against,
  // so there is no honest way to say which requested field any item is.
  if (options.mode === "schema" && Array.isArray(data)) {
    return {
      ok: false,
      kind: "failed",
      retryable: true,
      message:
        "The AI provider returned a list instead of the requested fields, so no honest extraction could be produced. No data was fabricated. Retrying may succeed.",
      ...spent,
    };
  }

  const reconciled =
    options.mode === "schema" && !Array.isArray(data)
      ? reconcileWithSchema(data, options.schema ?? [])
      : null;

  const extractedKeys = reconciled
    ? reconciled.returned
    : Array.isArray(data)
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
    extraction: reconciled
      ? {
          keys: extractedKeys,
          missingKeys: reconciled.missingKeys,
          renamedKeys: reconciled.renamedKeys,
          extraKeys: reconciled.extraKeys,
        }
      : { keys: extractedKeys },
    notice: reconciled
      ? "This data was extracted by an AI model from the SELECTABLE TEXT of the source PDF only. Values may be missing or incorrect — verify against the original before relying on it. A value of null means the model gave no single value for the field: it was not found, or it matched more than once — ask for the field as a list (the array type) to get every value. A requested field the model did not return at all is also null in extraction.json, and is listed in manifest.json under extraction.missingKeys. No content was fabricated beyond the model's extraction of the provided text."
      : "This data was extracted by an AI model from the SELECTABLE TEXT of the source PDF only. Values may be missing or incorrect — verify against the original before relying on it. No content was fabricated beyond the model's extraction of the provided text.",
  };

  const output = await buildPackage(data, reconciled, manifest);
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
  extraction: {
    /**
     * Schema mode: the requested fields the model RETURNED (exactly or respelled).
     * Prompt mode: the top-level keys/items of the reply. Never the extra keys a
     * schema did not ask for — counting those is how 2 requested fields and 3
     * returned keys read as a complete extraction.
     */
    keys: number;
    /** Schema mode: requested fields the model did not return (null in extraction.json). */
    missingKeys?: string[];
    /** Schema mode: requested name → the spelling the model returned it under. */
    renamedKeys?: Record<string, string>;
    /** Schema mode: keys the model returned that no requested field matches. */
    extraKeys?: string[];
  };
  notice: string;
}

/** A field or key name, safe inside a Markdown table cell. */
function tableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * A key as a model might respell a requested name: case, spaces, underscores,
 * hyphens and dots ignored — `Invoice Number`, `invoice_number` and
 * `invoice-number` are one field. Letters of every script are kept, so a
 * field named in Bengali is not collapsed to the empty string.
 */
function looseKey(key: string): string {
  return key
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "");
}

/** A schema-mode reply matched against the fields that were asked for. */
interface SchemaReconciliation {
  /** Requested name → the model's value, or null when it was not returned. */
  values: Record<string, unknown>;
  /** How many requested fields the model returned (exactly or respelled). */
  returned: number;
  missingKeys: string[];
  renamedKeys: Record<string, string>;
  extraKeys: string[];
}

/**
 * Match a reply to the request. Exact names first, for EVERY field, so a
 * respelling can never steal the key another field asked for verbatim; then one
 * respelled key per remaining field, and only when exactly one key matches AND
 * no other remaining field shares that respelling — an ambiguous respelling,
 * in either direction, is reported missing rather than guessed.
 */
function reconcileWithSchema(
  data: Record<string, unknown>,
  schema: readonly ExtractionField[],
): SchemaReconciliation {
  const own = (key: string) => Object.prototype.hasOwnProperty.call(data, key);
  const used = new Set<string>();
  const chosen = new Map<string, string>();
  for (const field of schema) {
    if (own(field.name)) {
      chosen.set(field.name, field.name);
      used.add(field.name);
    }
  }
  const renamedKeys: Record<string, string> = {};
  // Ambiguity runs BOTH ways: two keys respelling one field, or one key
  // respelling two fields (`invoice number` and `invoice_number` are distinct
  // to the parser and one loose key to this matcher). Counted over the fields
  // still unmatched, so an exact match above never makes a respelling look
  // ambiguous.
  const fieldsPerLooseKey = new Map<string, number>();
  for (const field of schema) {
    if (chosen.has(field.name)) continue;
    const want = looseKey(field.name);
    fieldsPerLooseKey.set(want, (fieldsPerLooseKey.get(want) ?? 0) + 1);
  }
  for (const field of schema) {
    if (chosen.has(field.name)) continue;
    const want = looseKey(field.name);
    if (fieldsPerLooseKey.get(want) !== 1) continue;
    const candidates = Object.keys(data).filter(
      (key) => !used.has(key) && looseKey(key) === want,
    );
    if (candidates.length === 1) {
      chosen.set(field.name, candidates[0]!);
      used.add(candidates[0]!);
      renamedKeys[field.name] = candidates[0]!;
    }
  }
  const values: Record<string, unknown> = {};
  const missingKeys: string[] = [];
  for (const field of schema) {
    const key = chosen.get(field.name);
    if (key === undefined) {
      missingKeys.push(field.name);
      values[field.name] = null;
    } else {
      values[field.name] = data[key] ?? null;
    }
  }
  return {
    values,
    returned: schema.length - missingKeys.length,
    missingKeys,
    renamedKeys,
    extraKeys: Object.keys(data).filter((key) => !used.has(key)),
  };
}

/**
 * What a null VALUE is shown as. Not "not found": the model is told to answer
 * null rather than guess, so a single-value field whose value appears several
 * times comes back null too — the ai-extract production proof failed exactly
 * that way (one region asked of a four-row table, 2026-10-09). Until then this
 * cell read "_(not found)_" and told a user whose PDF held the value four
 * times that it held it none. `null-meaning.test.ts` holds every surface that
 * explains a null to both reasons.
 */
export const NULL_VALUE_CELL = "_(not found, or more than one match)_";

/** Render a single extracted value for the human-readable Markdown table. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return NULL_VALUE_CELL;
  // A null INSIDE a list is the model's own entry; it is shown as what it
  // is, with no reason claimed for it.
  if (Array.isArray(value))
    return value
      .map((v) => (v === null || v === undefined ? "_(null)_" : renderValue(v)))
      .join("; ");
  if (typeof value === "object") return "`" + JSON.stringify(value) + "`";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Render the extraction.md with a provenance header + a key/value rendering of the data. */
function renderMarkdown(
  data: Record<string, unknown> | unknown[],
  reconciled: SchemaReconciliation | null,
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
  // When the window was short, a null may be a value past the cut. Saying so
  // beside the table is the difference between a gap and a false negative.
  if (manifest.source.truncationNotice) {
    lines.push(`>`);
    lines.push(
      `> **${manifest.source.truncationNotice}** A field shown as not found, or more than one match, was judged on the pages examined only — it may still appear later in the document.`,
    );
  }
  lines.push("");
  if (reconciled) {
    // EVERY requested field, in the order requested — a field the model left
    // out is a row that says so, not a row that is missing.
    lines.push("| Field | Value |");
    lines.push("| --- | --- |");
    const missing = new Set(reconciled.missingKeys);
    for (const [key, value] of Object.entries(reconciled.values)) {
      const respelled = reconciled.renamedKeys[key];
      const cell = missing.has(key)
        ? "_(not returned by the model)_"
        : respelled !== undefined
          ? `${renderValue(value)} _(returned as "${tableCell(respelled)}")_`
          : renderValue(value);
      lines.push(`| ${tableCell(key)} | ${cell} |`);
    }
    if (reconciled.extraKeys.length > 0) {
      lines.push("");
      lines.push("Other keys the model returned (not requested):");
      lines.push("");
      lines.push("| Key | Value |");
      lines.push("| --- | --- |");
      const raw = data as Record<string, unknown>;
      for (const key of reconciled.extraKeys) {
        lines.push(`| ${tableCell(key)} | ${renderValue(raw[key])} |`);
      }
    }
  } else if (Array.isArray(data)) {
    data.forEach((item, i) => {
      lines.push(`${i + 1}. ${renderValue(item)}`);
    });
  } else {
    lines.push("| Field | Value |");
    lines.push("| --- | --- |");
    for (const [key, value] of Object.entries(data)) {
      lines.push(`| ${tableCell(key)} | ${renderValue(value)} |`);
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
    manifest.options.mode === "schema"
      ? "  extraction.json    The requested fields, in the order requested, with the model's values. A field the model did not return is null here and listed in manifest.json (extraction.missingKeys)."
      : "  extraction.json    The AI-extracted structured data (exactly the model's JSON output).",
  );
  lines.push(
    "  model-output.json  The model's JSON reply exactly as returned (parsed and re-serialized).",
  );
  lines.push(
    "  extraction.md      A human-readable rendering with a provenance header.",
  );
  lines.push(
    "  manifest.json      A structured record of the request (provider, model, request, source stats).",
  );
  lines.push("");
  lines.push("HONEST SCOPE:");
  lines.push("  " + manifest.notice);
  return lines.join("\n");
}

/** Package the extraction data + manifest + README into a real ZIP. */
async function buildPackage(
  data: Record<string, unknown> | unknown[],
  reconciled: SchemaReconciliation | null,
  manifest: ExtractionManifest,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "extraction.json",
    JSON.stringify(reconciled ? reconciled.values : data, null, 2),
  );
  zip.file("model-output.json", JSON.stringify(data, null, 2));
  zip.file("extraction.md", renderMarkdown(data, reconciled, manifest));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt", renderReadme(manifest));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
