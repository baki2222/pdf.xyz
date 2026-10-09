/**
 * The start-up proof, published on the heartbeat as `aiReadCap`, that every
 * `per-call` AI processor in THIS image sends the provider no more than the
 * route charged for: no more of the DOCUMENT than the cap it is handed, and no
 * more in total than that cap, plus the options, plus
 * `AI_PER_CALL_INSTRUCTION_CHARACTERS`.
 *
 * The route honours a declared character count for summarize, chat and extract
 * only while the running worker publishes this as `true` — see
 * `aiReservationFor`. The worker image is built by hand, so a merged processor
 * change says nothing about the image that will run the job; this proof is run
 * BY that image, and an image built before it existed publishes no such key,
 * which the reader parses as `false`.
 *
 * ⚠️ UNTIL THE REVIEW OF 2026-09-27 IT COUNTED ONLY THE DOCUMENT. The read cap
 * bounds the document, and the route charged the declared document alone, so
 * the chat question and turns, the extract prompt or schema and the summarize
 * focus went to the model uncharged, and a proof that counted `MARK` alone was
 * blind to all of it. The route now charges them, and this now counts every
 * character, so the instruction allowance the route charges is checked by the
 * image whose instructions it describes.
 */

import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import {
  AI_PER_CALL_INSTRUCTION_CHARACTERS,
  optionCharacters,
} from "@/lib/jobs/delivery-cap";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { createSummarizeProcessor } from "./summarize";
import { createChatWithPdfProcessor } from "./chat-with-pdf";
import { createAiExtractProcessor } from "./ai-extract";
import type { Processor } from "./types";
import { JOB_LIMITS } from "@/lib/jobs/types";
import {
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
  MAX_TURN_CHARS,
} from "@/lib/jobs/chat-with-pdf";
import { MAX_SUMMARY_FOCUS_CHARS } from "@/lib/jobs/summarize-pdf";
import {
  MAX_EXTRACTION_FIELDS,
  MAX_EXTRACTION_PROMPT_CHARS,
  MAX_FIELD_DESCRIPTION_CHARS,
  MAX_FIELD_NAME_CHARS,
} from "@/lib/jobs/ai-extract";

/**
 * A character no prompt, instruction or option of these three tools contains,
 * so counting it in what the provider received counts DOCUMENT text and
 * nothing else.
 */
const MARK = "\u2591";
const PROOF_CHARACTERS = 20_000;
const PROOF_CAP = 400;
/**
 * The page counts the proof document is cut into. More than one, because the
 * engines tell the model which pages it saw, and that notice grows with the
 * page numbers it names.
 */
export const PROOF_PAGE_COUNTS: readonly number[] = [1, 300];

/** `PROOF_CHARACTERS` of document text, spread evenly over `pageCount` pages. */
function proofExtraction(pageCount: number): ExtractedPdfText {
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const size =
      Math.floor(PROOF_CHARACTERS / pageCount) +
      (i < PROOF_CHARACTERS % pageCount ? 1 : 0);
    const text = MARK.repeat(size);
    return { pageNumber: i + 1, text, characterCount: text.length };
  });
  const text = pages.map((page) => page.text).join("\n\n");
  return {
    pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

/** A provider that answers instantly and records every request it was sent. */
function recordingProvider(seen: AiCompletionRequest[]): AiProvider {
  return {
    id: "anthropic",
    model: "capability-probe",
    async complete(request) {
      seen.push(request);
      return {
        ok: true,
        // Valid for all three tools: a summary, an answer, and a JSON object
        // the extract engine can parse.
        text: '{"probe": "probe"}',
        model: "capability-probe",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

/** Every piece of text a request puts in front of the model. */
function requestParts(request: AiCompletionRequest): string[] {
  return [
    request.system ?? "",
    ...request.messages.map((message) => message.content),
  ];
}

/** How many document characters reached the provider across a request. */
function markedCharacters(request: AiCompletionRequest): number {
  let count = 0;
  for (const part of requestParts(request)) {
    for (const ch of part) if (ch === MARK) count += 1;
  }
  return count;
}

/**
 * EVERY character that reached the provider across a request (document,
 * options, the engine's own instructions), in the unit the allowance counts:
 * UTF-16 code units, `String.length`.
 */
function totalCharacters(request: AiCompletionRequest): number {
  return requestParts(request).reduce((sum, part) => sum + part.length, 0);
}

/**
 * The options `build(n)` for the largest `n` in 1..max that still fits the
 * byte cap `POST /api/jobs` applies to every job's options, so a sample built
 * with it is a body the route accepts, not a contract maximum it refuses.
 */
function largestWithinOptionsCap(
  max: number,
  build: (n: number) => Record<string, unknown>,
): Record<string, unknown> {
  const fits = (n: number) =>
    new TextEncoder().encode(JSON.stringify(build(n))).length <=
    JOB_LIMITS.maxOptionsBytes;
  let low = 1;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return build(low);
}

/** `count` distinct field names, each at least `length` characters long. */
function fieldNames(count: number, length: number): string[] {
  return Array.from({ length: count }, (_, i) => `f${i}`.padEnd(length, "x"));
}

/**
 * The per-call processors, each with options its contract accepts.
 *
 * Keyed by tool slug so `read-cap-proof.test.ts` can hold this set equal to the
 * `per-call` entries of `AI_RUN_PRICING` — a tool priced per call that is not
 * probed here would be charged by its declaration while nothing proved its
 * worker reads only that much.
 */
export const PER_CALL_PROCESSORS: Readonly<
  Record<
    string,
    {
      readonly create: (deps: {
        extract: (bytes: Uint8Array) => Promise<ExtractedPdfText>;
        provider: AiProvider;
        now: () => string;
      }) => Processor;
      readonly options: Record<string, unknown>;
      /**
       * Bodies that put the MOST non-document text in front of the provider:
       * each at its contract's bounds and within the byte cap the route
       * applies to every job's options, so each is a body the route accepts.
       *
       * The document is not the only input a per-call run sends. The chat
       * question and carried turns, the extract prompt or schema, and the
       * summarize focus all travel in `options` and reach the model verbatim,
       * and a read cap on the document bounds none of them.
       */
      readonly heavyOptions: readonly Record<string, unknown>[];
    }
  >
> = {
  "summarize-pdf": {
    create: (deps) => createSummarizeProcessor(deps),
    options: { length: "brief", format: "paragraphs" },
    heavyOptions: [
      {
        length: "detailed",
        format: "outline",
        focus: "x".repeat(MAX_SUMMARY_FOCUS_CHARS),
      },
    ],
  },
  "chat-with-pdf": {
    create: (deps) => createChatWithPdfProcessor(deps),
    options: { question: "Probe?" },
    heavyOptions: [
      // The longest question, and every turn the contract allows, as long as
      // they fit together.
      largestWithinOptionsCap(MAX_TURN_CHARS, (n) => ({
        question: "x".repeat(MAX_QUESTION_CHARS),
        context: Array.from({ length: MAX_CONTEXT_TURNS }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: "x".repeat(n),
        })),
      })),
    ],
  },
  "ai-extract": {
    create: (deps) => createAiExtractProcessor(deps),
    options: { mode: "prompt", prompt: "Probe." },
    heavyOptions: [
      { mode: "prompt", prompt: "x".repeat(MAX_EXTRACTION_PROMPT_CHARS) },
      // Every field, each described as fully as fits.
      largestWithinOptionsCap(MAX_FIELD_DESCRIPTION_CHARS, (n) => ({
        mode: "schema",
        schema: fieldNames(MAX_EXTRACTION_FIELDS, MAX_FIELD_NAME_CHARS).map(
          (name) => ({ name, type: "string", description: "x".repeat(n) }),
        ),
      })),
      // Every field with its name alone. The engine renders a type the body
      // never sent, so this is the shape where the prompt outgrows the JSON.
      {
        mode: "schema",
        schema: fieldNames(MAX_EXTRACTION_FIELDS, 1).map((name) => ({ name })),
      },
    ],
  },
};

/** What one per-call run put in front of the provider, in characters. */
export interface ProviderCharacters {
  /** Characters of the DOCUMENT (the proof text), and nothing else. */
  readonly document: number;
  /** Every character: document, options, the engine's own instructions. */
  readonly total: number;
}

/**
 * What one per-call processor sent to the provider for the proof document (on
 * `pageCount` pages), under `delivery` and with `options` (the tool's minimal
 * body by default), or `null` when the run did not complete.
 *
 * Driven through the PROCESSOR, the seam the executor calls, not through the
 * engine or `perCallReadLimit`: a processor that stopped passing the bound on
 * would pass a probe of either and fail this one.
 */
export async function providerCharactersSent(
  tool: string,
  delivery?: { characters: number },
  options?: Record<string, unknown>,
  pageCount = 1,
): Promise<ProviderCharacters | null> {
  const entry = PER_CALL_PROCESSORS[tool];
  if (!entry) return null;
  const seen: AiCompletionRequest[] = [];
  const extracted = proofExtraction(pageCount);
  const processor = entry.create({
    extract: async () => extracted,
    provider: recordingProvider(seen),
    now: () => "1970-01-01T00:00:00.000Z",
  });
  const result = await processor.process({
    tool,
    inputs: [
      {
        fileId: "f_readcapprobe",
        filename: "probe.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ],
    options: options ?? entry.options,
    ...(delivery ? { delivery } : {}),
  });
  if (!result.ok || seen.length === 0) return null;
  return {
    document: seen.reduce((sum, request) => sum + markedCharacters(request), 0),
    total: seen.reduce((sum, request) => sum + totalCharacters(request), 0),
  };
}

/** Document characters only; see {@link providerCharactersSent}. */
export async function documentCharactersSent(
  tool: string,
  delivery?: { characters: number },
): Promise<number | null> {
  return (await providerCharactersSent(tool, delivery))?.document ?? null;
}

/**
 * The most a capped per-call run may put in front of the provider: what the
 * route charges it below the whole-run clamp (`aiReservationFor`).
 */
export function chargedCharacters(
  cap: number,
  options: Readonly<Record<string, unknown>>,
): number {
  return cap + optionCharacters(options) + AI_PER_CALL_INSTRUCTION_CHARACTERS;
}

/**
 * Does every per-call processor in this image send no more than it was
 * charged for?
 *
 * Measured as a REDUCTION against the same document uncapped, per tool: the
 * uncapped run must send the whole proof document (the positive control — a
 * stub that sent nothing would otherwise "honour" every cap), and the capped
 * run must send no more of the document than the cap. Then, for the minimal
 * body and every heavy one, on every proof page count, the capped run must
 * send no more IN TOTAL than {@link chargedCharacters}. One tool failing fails
 * the capability, because the route prices all of them by the same answer.
 */
export async function provesAiReadCap(): Promise<boolean> {
  try {
    const tools = Object.keys(PER_CALL_PROCESSORS);
    if (tools.length === 0) return false;
    for (const tool of tools) {
      const entry = PER_CALL_PROCESSORS[tool]!;
      const uncapped = await documentCharactersSent(tool);
      if (uncapped === null || uncapped < PROOF_CHARACTERS) return false;
      if (entry.heavyOptions.length === 0) return false;
      for (const options of [entry.options, ...entry.heavyOptions]) {
        for (const pageCount of PROOF_PAGE_COUNTS) {
          const capped = await providerCharactersSent(
            tool,
            { characters: PROOF_CAP },
            options,
            pageCount,
          );
          if (capped === null || capped.document > PROOF_CAP) return false;
          if (capped.total > chargedCharacters(PROOF_CAP, options)) {
            return false;
          }
        }
      }
    }
    return true;
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}
