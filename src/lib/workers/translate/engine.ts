import JSZip from "jszip";
import {
  PAGE_JOIN,
  pageTextChunks,
  type ExtractedPdfText,
} from "@/lib/pdf/text";
import {
  capPagesToDelivery,
  missingPageMarker,
  nothingDeliverableMessage,
  withheldPagesMarker,
  type DeliveryLimit,
  type TranslatePlan,
} from "./chunking";
import {
  describeWindow,
  modelTruncationNotice,
  pageStartsFor,
  userTruncationNotice,
  type TruncationWindow,
} from "../ai/truncation";
import {
  LANGUAGE_NAMES,
  TRANSLATE_SOURCE_AUTO,
  type TranslateLanguage,
  type TranslateOptions,
  type TranslateSourceLanguage,
} from "@/lib/jobs/translate-pdf";
import type { AiProvider, AiCompletionResult, AiUsage } from "../ai/provider";
import {
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  TRANSLATE_NO_TEXT_MESSAGE,
  translateEveryPageTooLongMessage,
  translateMaxInputChars,
  translateTooLongMessage,
} from "@/lib/jobs/translate-limits";
import { AI_INPUT_LIMITS } from "@/lib/jobs/types";
import type { AiDeliveryMeta, AiUsageMeta } from "@/lib/jobs/ai-results";
import type { JobDeliveryCap } from "@/lib/jobs/delivery-cap";

/**
 * Translate PDF engine for the `translate-pdf` AI tool.
 *
 * This is a real, honest AI translation engine — never a fabricated "here is your
 * translation" result. Given a PDF and validated options it:
 *   1. extracts the PDF's SELECTABLE text only (no OCR — a scanned/image-only PDF is
 *      honestly rejected as `no_text` and pointed at the OCR tool), then
 *   2. asks a configured {@link AiProvider} to translate ONLY that text into the
 *      requested language, then
 *   3. packages the model's real translation as a ZIP (translation.md +
 *      translation.txt + manifest.json + README.txt) recording the provider, model,
 *      languages, and honest scope.
 *
 * HONESTY (load-bearing):
 *   - No provider ⇒ `ai_unconfigured` with operator requirements. The engine NEVER
 *     invents a translation when no model is configured.
 *   - No selectable text ⇒ `no_text` (run OCR first). The engine never translates an
 *     empty/scanned document by guessing.
 *   - The system prompt constrains the model to the document text; the translation
 *     that ships is exactly the model's output, unedited and unfabricated.
 *   - The text extractor and AI provider are injected, so this module stays node-free
 *     and unit-testable: production wires the real pdfjs extractor + Anthropic
 *     provider (`./native`), tests wire deterministic fakes.
 *
 * SCOPE NOTE: this produces translated TEXT (Markdown + plain text), not a
 * layout-preserving re-typeset PDF. The package and UI say so plainly rather than
 * implying a pixel-faithful translated PDF the engine does not produce.
 */

export const TRANSLATE_TOOL = "translate-pdf" as const;
export const TRANSLATE_ENGINE = "ai-text-translation" as const;

/** Extract selectable text from a PDF; throws on an unreadable PDF. */
export type PdfTextExtractor = (bytes: Uint8Array) => Promise<ExtractedPdfText>;

export interface TranslateLimits {
  maxInputBytes?: number;
  maxOutputBytes?: number;
  /** Max source characters sent to the model; longer input is truncated (never silently). */
  maxInputChars?: number;
  /** Ceiling on the model's generated tokens; the default budget is clamped to it. */
  maxOutputTokens?: number;
  /**
   * What THIS JOB may deliver, as the route decided when it charged the
   * caller's allowance.
   *
   * Distinct from `maxInputChars`, which is a property of the tool. This is a
   * property of one submission, and absent means unbounded — every job queued
   * before the cap existed, and every direct call in a test.
   */
  delivery?: JobDeliveryCap;
}

export interface TranslateDeps {
  extract?: PdfTextExtractor;
  /** A configured AI provider. Absent ⇒ the engine fails honestly as `ai_unconfigured`. */
  provider?: AiProvider;
  /** ISO timestamp source; defaults to the wall clock. Injected for deterministic tests. */
  now?: () => string;
  limits?: TranslateLimits;
}

/** Content-free metrics a successful run reports. Never carries document text. */
export interface TranslateMeta {
  engine: typeof TRANSLATE_ENGINE;
  tool: typeof TRANSLATE_TOOL;
  /** AI provider family id (e.g. "anthropic"). Never a key. */
  provider: string;
  /** Public model id (e.g. "claude-sonnet-5"). Never a secret. */
  model: string;
  /** The requested target language code (e.g. "fr"). */
  targetLanguage: TranslateLanguage;
  /** The source language code or "auto". */
  sourceLanguage: TranslateSourceLanguage;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
  /** Character count of the extracted source text (a COUNT, never the text). */
  sourceCharacters: number;
  /** Character count of the produced translation (a COUNT, never the text). */
  translationCharacters: number;
  /** True when the source exceeded `maxInputChars` and only a prefix was translated. */
  truncated: boolean;
  /**
   * The one-line disclosure to show beside the result when `truncated` — e.g.
   * "Only pages 1-131 of 400 could be read, cut mid-page - ...". `null` when the
   * whole document was read. The UI renders THIS, not the model's words.
   */
  truncationNotice: string | null;
  /**
   * What the model actually saw, structurally — the block the job record
   * carries to the browser so the panel can state the bound.
   */
  window: TruncationWindow;
  /**
   * Provider-reported token usage, absent when the provider did not report it.
   * Carried to the job record so an AI run's cost is measurable after the fact.
   */
  usage?: AiUsageMeta;
  /**
   * What the delivery cap withheld, when it withheld anything.
   *
   * Absent means the whole document was delivered. It is carried on the meta
   * — not left only in the artifact's positioned gap — because the panel says
   * "completed" and a surface may not assert something the system contradicts.
   */
  delivery?: AiDeliveryMeta;
}

export type TranslateFailureKind =
  | "unsupported"
  | "ai_unconfigured"
  | "no_text"
  | "too_large"
  /**
   * The document has more TEXT than the model may write back. Distinct from
   * `too_large`, which is about bytes: conflating them would tell a user to
   * shrink a file that is already small, when what they need is fewer pages.
   */
  | "too_much_text"
  /**
   * The document holds more than THIS JOB reserved. Distinct from
   * `too_much_text`, which is about what the tool can do at all: the same
   * document submitted with an honest declaration would succeed, so telling the
   * caller their file is too big would be false.
   */
  | "over_reservation"
  | "rate_limited"
  | "content_filtered"
  | "failed";

export type TranslateRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "zip";
      contentType: "application/zip";
      meta: TranslateMeta;
    }
  | {
      ok: false;
      kind: TranslateFailureKind;
      limitBytes?: number;
      /** Source characters found, on `too_much_text` only. */
      characters?: number;
      /** What this run could have handled, on `too_much_text` only. */
      ceilingCharacters?: number;
      retryable?: boolean;
      message: string;
      /**
       * Token usage when the failure came AFTER a provider call. Absent when no
       * call happened.
       *
       * `incomplete_output` is why this exists: it is non-retryable precisely
       * because the model hit its output ceiling, so it burned the maximum
       * budget and is the most expensive outcome in the system. A ceiling fed
       * only by successes would be blind to exactly its largest expenses.
       */
      usage?: AiUsageMeta;
      /**
       * What the model was given, when there was a call to give it to.
       *
       * SEPARATELY OPTIONAL from `usage` even though the two co-occur in
       * practice — the window is computed before the call, so a failure that
       * spent tokens always has both and a pre-extraction failure has neither.
       * Encoding "both or neither" as one object would make that invariant
       * UNFALSIFIABLE: the test could not construct the broken state to prove it
       * is rejected. Optional-and-tested beats structurally-impossible-and-
       * unproven, the same reason `hadNotes` stayed separate from `notes.length`.
       */
      window?: TruncationWindow;
    };

/**
 * A generous default generation budget. Translation output is roughly proportional to
 * the input, so unlike summarization there is no per-length plan — the budget is a
 * fixed default the operator's `maxOutputTokens` limit can only lower, never raise.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS;
const DEFAULT_MAX_INPUT_CHARS = AI_INPUT_LIMITS.maxInputCharacters;

/**
 * The limit a job with no cap runs under.
 *
 * Not a sentinel the walk special-cases: it is a real budget nothing can
 * exceed, so the capped and uncapped paths are the same code with different
 * numbers. `boundBy` is therefore `null` for an uncapped job by arithmetic
 * rather than by a branch that could be forgotten.
 */
const UNBOUNDED_DELIVERY: DeliveryLimit = {
  characters: Number.POSITIVE_INFINITY,
};

/** The honesty-critical system prompt: translate ONLY the provided text; invent nothing. */
function buildSystemPrompt(
  options: TranslateOptions,
  window: TruncationWindow,
): string {
  const target = LANGUAGE_NAMES[options.targetLanguage];
  const parts = [
    "You are a precise, faithful document translator for pdf.xyz.",
    `Translate ONLY the document text provided by the user into ${target}.`,
    options.sourceLanguage === TRANSLATE_SOURCE_AUTO
      ? "Detect the source language automatically."
      : `The source language is ${LANGUAGE_NAMES[options.sourceLanguage]}.`,
    "Preserve the document's meaning, structure, headings, lists, and any Markdown formatting.",
    "Do not add, remove, summarize, or explain content — translate what is present, nothing more.",
    "Keep names, numbers, code, and URLs intact unless translation is clearly required.",
    "If a passage is untranslatable or unintelligible, leave it as-is rather than guessing.",
    `Output ONLY the ${target} translation, with no preamble or commentary.`,
  ];
  if (options.instructions) {
    parts.push(`Follow this additional instruction: ${options.instructions}.`);
  }
  // A translator's wrong claim is not a denial and not a mislabelled summary: it
  // is a fifth of a document handed back with nothing marking where it stops —
  // because the instruction a few lines above says "Output ONLY the translation,
  // with no preamble or commentary." That is the instruction this revokes.
  const notice = modelTruncationNotice(
    window,
    (upTo) =>
      `You were given only ${upTo}. Translate all of it, then end with one final line saying the translation covers only the pages you were given (${upTo}).\n` +
      "That closing line is REQUIRED and overrides the instruction to output no commentary. Never present the result as a translation of the whole document.",
  );
  if (notice) parts.push(notice);
  return parts.join(" ");
}

/** Map a provider completion failure to an honest, typed run failure. */
function mapProviderFailure(
  result: Extract<AiCompletionResult, { ok: false }>,
  window: TruncationWindow,
  model: string,
): Extract<TranslateRun, { ok: false }> {
  // A provider CALL happened, so both travel with every branch below: the spend
  // is real even though the run failed.
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
 * Run the translation flow honestly: reject oversized input, fail `unsupported` when
 * no text extractor is wired, `ai_unconfigured` when no provider is configured,
 * `no_text` when the PDF has no selectable text (run OCR first), and map every
 * provider failure to a typed run failure — never a fabricated translation. On
 * success, return a real ZIP package (translation.md + translation.txt +
 * manifest.json + README.txt).
 */
/**
 * Token counts summed across every provider call one job made.
 *
 * A chunked job that reported only the last call's usage would under-count what
 * it spent, and the AI spend ceiling reads exactly this number — so the error
 * would be silent, cumulative, and in the one direction a cost control must
 * never be wrong in. `reported` stays false until some call actually reports,
 * so "the provider told us nothing" is still distinguishable from "it cost
 * nothing".
 */
class UsageTally {
  calls = 0;
  reported = false;
  private input = 0;
  private output = 0;
  private cachedIn: number | undefined;
  private cacheWrite: number | undefined;

  add(usage: AiUsage | undefined): void {
    this.calls += 1;
    if (!usage) return;
    this.reported = true;
    this.input += usage.inputTokens;
    this.output += usage.outputTokens;
    if (usage.cachedInputTokens !== undefined)
      this.cachedIn = (this.cachedIn ?? 0) + usage.cachedInputTokens;
    if (usage.cacheWriteInputTokens !== undefined)
      this.cacheWrite = (this.cacheWrite ?? 0) + usage.cacheWriteInputTokens;
  }

  totals(): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
  } {
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      ...(this.cachedIn !== undefined
        ? { cachedInputTokens: this.cachedIn }
        : {}),
      ...(this.cacheWrite !== undefined
        ? { cacheWriteInputTokens: this.cacheWrite }
        : {}),
    };
  }
}

/**
 * Weave the translated parts and the untranslatable gaps back into one
 * document, in plan order.
 *
 * The gaps are POSITIONED — each one sits where its page sat, between the parts
 * that surround it — rather than listed at the end. A reader who meets a note
 * about page 7 after reading to the end has already believed the document was
 * complete; a reader who meets it in place has not.
 */
function assembleTranslation(
  parts: readonly string[],
  plan: TranslatePlan | null,
  segmentCount: number,
  interruptedPages: readonly number[],
  withheld: { pages: readonly number[]; marker: string } | null,
): string {
  if (plan === null) return parts.join("\n\n");

  // Interleave by document position: a chunk's pages and an oversize page both
  // know where they belong, so ordering is read off the plan rather than
  // reconstructed from arrival.
  const placed: { at: number; body: string }[] = [];
  for (const [i, chunk] of plan.chunks.entries()) {
    const body = parts[i];
    if (body !== undefined) placed.push({ at: chunk.pages[0]!, body });
  }
  for (const page of plan.oversize) {
    placed.push({ at: page.pageNumber, body: missingPageMarker(page) });
  }
  if (interruptedPages.length > 0) {
    placed.push({
      at: interruptedPages[0]!,
      body: interruptedNotice(interruptedPages),
    });
  }
  // Positioned like every other gap: at the page where delivery stopped, not
  // appended at the end. A reader who meets it after finishing has already
  // believed the document was complete.
  if (withheld && withheld.pages.length > 0) {
    placed.push({ at: withheld.pages[0]!, body: withheld.marker });
  }
  void segmentCount;
  placed.sort((a, b) => a.at - b.at);
  return placed.map((p) => p.body).join("\n\n");
}

/** The gap left where a chunk failed part-way through a document. */
function interruptedNotice(pages: readonly number[]): string {
  const list =
    pages.length === 1
      ? `Page ${pages[0]}`
      : `Pages ${pages[0]}–${pages[pages.length - 1]}`;
  return [
    "",
    `> ⚠️ **${list} could not be translated.**`,
    "> The AI provider stopped part-way through this document. Everything above was translated; this part was not. Try translating the remaining pages again — the rest of this file is unaffected.",
    "",
  ].join("\n");
}

export async function runTranslate(
  input: Uint8Array,
  options: TranslateOptions,
  deps: TranslateDeps,
): Promise<TranslateRun> {
  const { extract, provider } = deps;
  if (!extract) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "Translate PDF requires the PDF text extractor, which is not available in this environment.",
    };
  }

  // No provider is the biggest blocker and needs no file work to detect — fail first,
  // honestly, with operator requirements. Never fabricate a translation without a model.
  if (!provider) {
    return {
      ok: false,
      kind: "ai_unconfigured",
      retryable: false,
      message:
        "Translating a PDF requires a configured AI provider (operator setup: PDFXYZ_AI_PROVIDER + PDFXYZ_AI_API_KEY). No provider is configured on this worker, so no translation can be produced. See docs/WORKER_ARCHITECTURE.md.",
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
      // Shared with the browser's pre-upload check, which refuses a scan with
      // this exact sentence before anything is uploaded or charged.
      message: TRANSLATE_NO_TEXT_MESSAGE,
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

  // THE CEILING IS A PROPERTY OF ONE CALL, NOT OF THE JOB. Translate's binding
  // constraint is the OUTPUT budget — its output is as long as its input — so
  // no single call may exceed it. Measured on production: a 135,280-character
  // document was accepted, extracted, sent, billed, and rejected after 49
  // seconds with "reached its output limit".
  //
  // Applying that per-call bound to the whole document refused work it could
  // do: a twelve-page document of ordinary pages was rejected outright, and the
  // caller spent one of three daily AI runs on nothing. It is now split at PAGE
  // boundaries and delivered as far as it can go.
  const ceilingCharacters = translateMaxInputChars(maxOutputTokens);

  // The page blocks the extractor joined, WITH their real page numbers — the
  // same chunks the truncation window is described from, so a gap this engine
  // names is a page the reader can go and check.
  const pageBlocks = pageTextChunks(extracted.pages);

  // NO PAGE STRUCTURE ⇒ NO SAFE SPLIT. Some callers hand over text with no
  // per-page breakdown (and a browser extractor may too). Splitting that at an
  // arbitrary offset would cut mid-sentence and produce a fluent translation of
  // a fragment, which is the failure mode this whole feature keeps having. So
  // the old whole-document refusal stands for exactly that case, and it stays
  // the honest answer rather than a guess.
  /**
   * What this job may deliver — ONE code path whether or not a cap was set.
   *
   * An unbounded job runs the same walk with an infinite character budget
   * rather than skipping it. Two paths would mean the uncapped path (every job
   * queued before the cap existed, every direct call in a test) never exercises
   * the code that every capped job depends on, and the two would drift exactly
   * as `pageStartsFor` and the planner would have if the truncation window were
   * computed twice.
   */
  const limit: DeliveryLimit = deps.limits?.delivery ?? UNBOUNDED_DELIVERY;
  const capped =
    pageBlocks.length > 0
      ? capPagesToDelivery(pageBlocks, ceilingCharacters, limit)
      : null;
  const plan = capped?.plan ?? null;

  // NOTHING WAS COVERED BY THE RESERVATION. Refuse rather than package a
  // document that is only an apology: the caller has already paid the
  // reservation, and handing back a ZIP with no translation in it would spend
  // their download on nothing. No provider call has happened at this point, so
  // the refusal costs nothing on top.
  if (
    capped &&
    capped.boundBy !== null &&
    capped.plan.chunks.length === 0 &&
    capped.plan.oversize.length === 0
  ) {
    return {
      ok: false,
      kind: "over_reservation",
      retryable: false,
      message: nothingDeliverableMessage(capped.boundBy, limit),
    };
  }

  if (plan === null) {
    if (sourceText.length > ceilingCharacters) {
      return {
        ok: false,
        kind: "too_much_text",
        characters: sourceText.length,
        ceilingCharacters,
        message: translateTooLongMessage(sourceText.length, ceilingCharacters),
      };
    }
  } else if (plan.chunks.length === 0) {
    // Every page individually exceeds one call, so there is nothing to deliver.
    // Refusing here costs the caller nothing; a partial delivery of zero pages
    // would cost them an allowance for an empty package.
    //
    // NAME THE PAGES, and do not say "split it into smaller files": pages are
    // already the unit this engine splits at, so a smaller file holds the same
    // page at the same length. That advice shipped here, and in the browser,
    // until the two were given one sentence. It applies only when nothing was
    // withheld by the delivery cap — then every page with text is oversize and
    // "every page" is true; with a cap in play the old wording stands.
    const everyPageOversize =
      capped !== null &&
      capped.withheldPages.length === 0 &&
      plan.oversize.length > 0;
    return {
      ok: false,
      kind: "too_much_text",
      characters: sourceText.length,
      ceilingCharacters,
      message: everyPageOversize
        ? translateEveryPageTooLongMessage(plan.oversize, ceilingCharacters)
        : translateTooLongMessage(sourceText.length, ceilingCharacters),
    };
  }

  // One segment per provider call, in document order. The unchunked path is a
  // single segment carrying the whole (possibly truncated) text, so both paths
  // run the same loop and neither can drift from the other.
  const segments: { text: string; pages: readonly number[] }[] =
    plan === null
      ? [{ text: promptText, pages: [] }]
      : plan.chunks.map((chunk) => ({ text: chunk.text, pages: chunk.pages }));

  const parts: string[] = [];
  const translatedPages: number[] = [];
  const usage = new UsageTally();
  let model = provider.model;
  /** Pages a chunk failure left untranslated, in document order. */
  let interruptedPages: number[] = [];
  let interruption: TranslateRun | null = null;

  for (const [i, segment] of segments.entries()) {
    const many = segments.length > 1;
    const completion = await provider.complete({
      system: buildSystemPrompt(options, window),
      messages: [
        {
          role: "user",
          content: `Translate the following document.${
            truncated
              ? " (Only the first part of a long document is included.)"
              : ""
          }${
            many
              ? ` (This is part ${i + 1} of ${segments.length} of one document; translate only the text given, and do not add any note about it being a part.)`
              : ""
          }\n\n---\n${segment.text}\n---`,
        },
      ],
      maxOutputTokens,
      temperature: 0.2,
    });

    if (!completion.ok) {
      // A failure part-way through is NOT the whole job's failure if earlier
      // parts succeeded: the caller has already paid, and the pages that were
      // translated are worth more than a clean error. Stop here, keep what is
      // done, and name the rest — the first failure is reported verbatim when
      // nothing at all was translated.
      interruption = mapProviderFailure(completion, window, provider.model);
      interruptedPages = segments.slice(i).flatMap((s) => [...s.pages]);
      break;
    }
    model = completion.model;
    usage.add(completion.usage);
    const text = completion.text.trim();
    if (text.length > 0) {
      parts.push(text);
      translatedPages.push(...segment.pages);
    } else if (!many) {
      return {
        ok: false,
        kind: "failed",
        retryable: true,
        message: "The AI provider returned an empty translation.",
      };
    } else {
      // An empty part in a multi-part document is a hole, not a total failure.
      interruptedPages.push(...segment.pages);
    }
  }

  if (parts.length === 0) {
    return (
      interruption ?? {
        ok: false,
        kind: "failed",
        retryable: true,
        message: "The AI provider returned an empty translation.",
      }
    );
  }

  // Assembled BY PLAN INDEX, never by arrival: `parts` is appended in the loop
  // above, which runs the segments in order, so the order is structural rather
  // than incidental. Gaps are woven in where the pages they replace sat.
  const withheld =
    capped && capped.boundBy !== null && capped.withheldPages.length > 0
      ? {
          pages: capped.withheldPages,
          marker: withheldPagesMarker(
            capped.withheldPages,
            capped.boundBy,
            limit,
          ),
        }
      : null;

  const translation = assembleTranslation(
    parts,
    plan,
    segments.length,
    interruptedPages,
    withheld,
  );

  const createdAt = now();
  const manifest: TranslationManifest = {
    schema: "pdfxyz.translation/v1",
    tool: TRANSLATE_TOOL,
    engine: TRANSLATE_ENGINE,
    createdAt,
    provider: provider.id,
    model,
    options: {
      targetLanguage: options.targetLanguage,
      targetLanguageName: LANGUAGE_NAMES[options.targetLanguage],
      sourceLanguage: options.sourceLanguage,
      ...(options.instructions ? { instructions: options.instructions } : {}),
    },
    source: {
      pageCount: extracted.pageCount,
      characters: sourceText.length,
      truncatedToCharacters: truncated ? maxChars : null,
      truncationNotice: userTruncationNotice(window) || null,
    },
    translation: { characters: translation.length },
    notice:
      "This translation was generated by an AI model from the SELECTABLE TEXT of the source PDF only. It produces translated text (Markdown + plain text), not a layout-preserving PDF, and may contain errors — verify against the original before relying on it. No content was fabricated beyond the model's translation of the provided text.",
  };

  const output = await buildPackage(translation, manifest);
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: "The translation package exceeds the worker size limit.",
    };
  }

  return {
    ok: true,
    output,
    filenameExt: "zip",
    contentType: "application/zip",
    meta: {
      engine: TRANSLATE_ENGINE,
      tool: TRANSLATE_TOOL,
      provider: provider.id,
      model,
      // Token counts travel to the job record so the per-page cost of an AI run
      // is measurable after the fact. Absent when the provider did not report.
      // SUMMED ACROSS EVERY CALL a chunked job made, with `calls` recording how
      // many — a chunked job that reported one call's tokens would under-count
      // the spend ceiling in the one direction it must never be wrong in.
      ...(usage.reported
        ? { usage: { ...usage.totals(), calls: usage.calls, model } }
        : {}),
      targetLanguage: options.targetLanguage,
      sourceLanguage: options.sourceLanguage,
      pageCount: extracted.pageCount,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
      sourceCharacters: sourceText.length,
      translationCharacters: translation.length,
      truncated,
      truncationNotice: userTruncationNotice(window) || null,
      window,
      ...(withheld
        ? {
            delivery: {
              deliveredPages: translatedPages.length,
              withheldPages: withheld.pages.length,
              boundBy: capped!.boundBy!,
            },
          }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest / package types + serialization
// ---------------------------------------------------------------------------

interface TranslationManifest {
  schema: string;
  tool: string;
  engine: string;
  createdAt: string;
  provider: string;
  model: string;
  options: {
    targetLanguage: TranslateLanguage;
    targetLanguageName: string;
    sourceLanguage: TranslateSourceLanguage;
    instructions?: string;
  };
  source: {
    pageCount: number;
    characters: number;
    truncatedToCharacters: number | null;
    /** The page-named disclosure, or null when the whole document was read. */
    truncationNotice: string | null;
  };
  translation: { characters: number };
  notice: string;
}

/** Render the translation.md with an honest provenance header + the model's translation. */
function renderMarkdown(
  translation: string,
  manifest: TranslationManifest,
): string {
  const lines: string[] = [];
  lines.push(`# Translation — ${manifest.options.targetLanguageName}`);
  lines.push("");
  lines.push(
    `> Generated by ${manifest.provider} (${manifest.model}) from the selectable text of the source PDF.`,
  );
  lines.push(
    `> Pages: ${manifest.source.pageCount} · Source characters: ${manifest.source.characters}${manifest.source.truncatedToCharacters !== null ? ` (truncated to ${manifest.source.truncatedToCharacters} for translation)` : ""}`,
  );
  // The header directly above says this came from the source PDF. Without
  // this line it says so over a translation of the first fifth of it.
  if (manifest.source.truncationNotice) {
    lines.push(`>`);
    lines.push(`> **${manifest.source.truncationNotice}**`);
  }
  lines.push("");
  lines.push(translation);
  lines.push("");
  lines.push("---");
  lines.push(`_${manifest.notice}_`);
  return lines.join("\n");
}

/** Render a plain-text README describing the package and its honest scope. */
function renderReadme(manifest: TranslationManifest): string {
  const source =
    manifest.options.sourceLanguage === TRANSLATE_SOURCE_AUTO
      ? "auto-detected"
      : manifest.options.sourceLanguage;
  const lines: string[] = [];
  lines.push("pdf.xyz — AI Translation Package");
  lines.push("================================");
  lines.push("");
  lines.push(`Generated: ${manifest.createdAt}`);
  lines.push(`Provider: ${manifest.provider}`);
  lines.push(`Model: ${manifest.model}`);
  lines.push(
    `Target language: ${manifest.options.targetLanguageName} (${manifest.options.targetLanguage})`,
  );
  lines.push(`Source language: ${source}`);
  if (manifest.options.instructions)
    lines.push(`Instruction: ${manifest.options.instructions}`);
  lines.push("");
  lines.push("Contents:");
  lines.push(
    "  translation.md   The AI translation (markdown) with a provenance header.",
  );
  lines.push("  translation.txt  The AI translation as plain text.");
  lines.push(
    "  manifest.json    A structured record of the request (provider, model, languages, source stats).",
  );
  lines.push("");
  lines.push("HONEST SCOPE:");
  lines.push("  " + manifest.notice);
  return lines.join("\n");
}

/** Package the translation + manifest + README into a real ZIP. */
async function buildPackage(
  translation: string,
  manifest: TranslationManifest,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("translation.md", renderMarkdown(translation, manifest));
  zip.file("translation.txt", translation);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt", renderReadme(manifest));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
