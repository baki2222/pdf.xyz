/**
 * The start-up proof, published on the heartbeat as `aiReadCap`, that every
 * `per-call` AI processor in THIS image reads no more than the cap it is handed.
 *
 * The route honours a declared character count for summarize, chat and extract
 * only while the running worker publishes this as `true` — see
 * `aiReservationFor`. The worker image is built by hand, so a merged processor
 * change says nothing about the image that will run the job; this proof is run
 * BY that image, and an image built before it existed publishes no such key,
 * which the reader parses as `false`.
 */

import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { createSummarizeProcessor } from "./summarize";
import { createChatWithPdfProcessor } from "./chat-with-pdf";
import { createAiExtractProcessor } from "./ai-extract";
import type { Processor } from "./types";

/**
 * A character no prompt, instruction or option of these three tools contains,
 * so counting it in what the provider received counts DOCUMENT text and
 * nothing else.
 */
const MARK = "\u2591";
const PROOF_CHARACTERS = 20_000;
const PROOF_CAP = 400;

function proofExtraction(): ExtractedPdfText {
  const text = MARK.repeat(PROOF_CHARACTERS);
  return {
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
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

/** How many document characters reached the provider across a request. */
function markedCharacters(request: AiCompletionRequest): number {
  const parts = [
    request.system ?? "",
    ...request.messages.map((message) => message.content),
  ];
  let count = 0;
  for (const part of parts) {
    for (const ch of part) if (ch === MARK) count += 1;
  }
  return count;
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
    }
  >
> = {
  "summarize-pdf": {
    create: (deps) => createSummarizeProcessor(deps),
    options: { length: "brief", format: "paragraphs" },
  },
  "chat-with-pdf": {
    create: (deps) => createChatWithPdfProcessor(deps),
    options: { question: "Probe?" },
  },
  "ai-extract": {
    create: (deps) => createAiExtractProcessor(deps),
    options: { mode: "prompt", prompt: "Probe." },
  },
};

/**
 * Document characters one per-call processor sent to the provider for the
 * proof document, under `delivery` — or `null` when the run did not complete.
 *
 * Driven through the PROCESSOR, the seam the executor calls, not through the
 * engine or `perCallReadLimit`: a processor that stopped passing the bound on
 * would pass a probe of either and fail this one.
 */
export async function documentCharactersSent(
  tool: string,
  delivery?: { characters: number },
): Promise<number | null> {
  const entry = PER_CALL_PROCESSORS[tool];
  if (!entry) return null;
  const seen: AiCompletionRequest[] = [];
  const extracted = proofExtraction();
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
    options: entry.options,
    ...(delivery ? { delivery } : {}),
  });
  if (!result.ok || seen.length === 0) return null;
  return seen.reduce((sum, request) => sum + markedCharacters(request), 0);
}

/**
 * Does every per-call processor in this image read no more than its cap?
 *
 * Measured as a REDUCTION against the same document uncapped, per tool: the
 * uncapped run must send the whole proof document (the positive control — a
 * stub that sent nothing would otherwise "honour" every cap), and the capped
 * run must send no more than the cap. One tool failing fails the capability,
 * because the route prices all of them by the same answer.
 */
export async function provesAiReadCap(): Promise<boolean> {
  try {
    const tools = Object.keys(PER_CALL_PROCESSORS);
    if (tools.length === 0) return false;
    for (const tool of tools) {
      const uncapped = await documentCharactersSent(tool);
      if (uncapped === null || uncapped < PROOF_CHARACTERS) return false;
      const capped = await documentCharactersSent(tool, {
        characters: PROOF_CAP,
      });
      if (capped === null || capped > PROOF_CAP) return false;
    }
    return true;
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}
