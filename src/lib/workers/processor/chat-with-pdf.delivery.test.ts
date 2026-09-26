// @vitest-environment node
/**
 * A Chat with PDF job delivers what it reserved, and no more — read at the
 * point of consumption: the text the PROVIDER is handed.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * The route charged every chat question a reservation (`deliveryCapFor`) and
 * queued the cap with the job, and the chat processor never read it: only
 * `processor/translate.ts` did. The engine sent up to
 * `AI_INPUT_LIMITS.maxInputCharacters` — 500,000 characters — whatever the job
 * had paid for. So `declaredCharacters: 1` from any API caller bought four
 * characters of allowance and half a million characters of model input, and
 * an honest 400,000-character PDF was read in full on a 41,032 charge.
 *
 * It is the defect `delivery-cap.ts` exists to prevent ("a reservation nothing
 * enforces looks enforced") in the one AI tool that re-sends its document on
 * every turn. Nothing caught it because the cap's chain tests follow it from the
 * route to the queue to the CLAIM — and stop at the processor that drops it.
 *
 * So these tests run the real processor with a job-shaped input, record the
 * request the provider receives, and measure the document inside it.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText, ExtractedTextPage } from "@/lib/pdf/text";
import type { JobDeliveryCap } from "@/lib/jobs";
import {
  CHAT_MAX_CHARACTERS_PER_QUESTION,
  CHAT_TOOL_SLUG,
  chatConversationCharacters,
  type ChatTurn,
} from "@/lib/jobs/chat-with-pdf";
import { getToolBySlug } from "@/lib/tools";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import { CHAT_TOOL, type PdfTextExtractor } from "../chat-with-pdf/engine";
import type { ProcessorInput } from "./types";
import { createChatWithPdfProcessor } from "./chat-with-pdf";

const QUESTION = "What is the total amount due?";
const CONTEXT: ChatTurn[] = [
  { role: "user", content: "Who issued it?" },
  { role: "assistant", content: "Northwind Ltd issued the invoice [p.1]." },
];

function extractorForPages(pageTexts: string[]): PdfTextExtractor {
  const pages: ExtractedTextPage[] = pageTexts.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const joined = pageTexts.join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount: pageTexts.length,
    pages,
    text: joined,
    characterCount: joined.length,
    hasText: true,
  };
  return async () => extracted;
}

function recordingProvider(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  const success: AiCompletionResult = {
    ok: true,
    text: "The total is 1,200 dollars [p.1].",
    model: "claude-sonnet-5",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      return success;
    },
  };
}

/**
 * The document text the model was actually handed, cut out of the system
 * prompt between the engine's own delimiters.
 *
 * Read from the REQUEST rather than from `meta.window.charactersSent`: the
 * window is the engine's account of what it sent, and an account is the
 * author's artifact. The request is what the consumer receives.
 */
function documentSent(provider: { calls: AiCompletionRequest[] }): string {
  expect(provider.calls, "the provider was never called").toHaveLength(1);
  const system = provider.calls[0]!.system ?? "";
  const start = system.indexOf("--- DOCUMENT START ---\n");
  const end = system.indexOf("\n--- DOCUMENT END ---");
  expect(start, "no document block in the system prompt").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return system.slice(start + "--- DOCUMENT START ---\n".length, end);
}

function job(
  delivery: unknown,
  options: Record<string, unknown> = { question: QUESTION },
): ProcessorInput {
  return {
    tool: "chat-with-pdf",
    options,
    inputs: [
      {
        fileId: "f1",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array([1]),
      },
    ],
    ...(delivery !== undefined ? { delivery: delivery as JobDeliveryCap } : {}),
  };
}

const PAGE = "Line of invoice text that goes on for a while. ".repeat(60);
const THREE_PAGES = [PAGE, PAGE, PAGE];

describe("the chat processor honours the job's delivery cap", () => {
  it("sends at most the reservation minus the conversation, and discloses the cut", async () => {
    const provider = recordingProvider();
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const cap = 3_000;
    const result = await p.process(job({ characters: cap }));
    expect(result.ok).toBe(true);

    const conversation = chatConversationCharacters({ question: QUESTION });
    expect(
      documentSent(provider).length,
      "the provider received more document text than this job reserved",
    ).toBe(cap - conversation);
    if (result.ok) {
      expect(result.meta?.truncated).toBe(true);
      expect(result.results?.ai?.truncation?.truncated).toBe(true);
    }
  });

  it("counts the carried conversation against the same reservation", async () => {
    // The turns are AI text the model reads on this call; a cap that bounded
    // only the document would let a caller buy 4 characters and send the
    // contract's whole context allowance with them on every request.
    const provider = recordingProvider();
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const cap = 3_000;
    const options = { question: QUESTION, context: CONTEXT };
    await p.process(job({ characters: cap }, options));
    const conversation = chatConversationCharacters({
      question: QUESTION,
      context: CONTEXT,
    });
    expect(conversation).toBeGreaterThan(QUESTION.length);
    expect(documentSent(provider).length).toBe(cap - conversation);
  });

  it("refuses, before any model call, a conversation larger than the reservation", async () => {
    const provider = recordingProvider();
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const result = await p.process(job({ characters: 4 }));
    expect(result.ok).toBe(false);
    expect(provider.calls, "the provider was paid for a refused job").toEqual(
      [],
    );
    if (!result.ok) {
      expect(result.error.code).toBe("unprocessable_entity");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("fails CLOSED on a malformed cap rather than reading it as 'no cap'", async () => {
    for (const bad of [
      { characters: -1 },
      { characters: "lots" },
      "cap",
      { characters: 100, pages: 0 },
    ]) {
      const provider = recordingProvider();
      const p = createChatWithPdfProcessor({
        extract: extractorForPages(THREE_PAGES),
        provider,
      });
      const result = await p.process(job(bad));
      expect(result.ok, `${JSON.stringify(bad)} was honoured`).toBe(false);
      expect(provider.calls).toEqual([]);
      if (!result.ok) expect(result.error.code).toBe("internal_error");
    }
  });

  it("stops at the last declared page, and names that page as complete", async () => {
    // The exact half of the cap. Both extractors agree on which pages carry
    // text, so for an honest caller this never binds; when it does, the
    // document is not the one that was declared, and the reader is told how
    // far it got in pages — correctly, including the page the cut landed after.
    const provider = recordingProvider();
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const result = await p.process(job({ characters: 100_000, pages: 2 }));
    expect(result.ok).toBe(true);
    const sent = documentSent(provider);
    expect(sent).toContain("[Page 2]");
    expect(sent).not.toContain("[Page 3]");
    expect(sent.endsWith(PAGE.trim())).toBe(true);
    if (result.ok) {
      const window = result.results?.ai?.truncation;
      expect(window?.truncated).toBe(true);
      expect(window?.lastCompletePage).toBe(2);
      expect(window?.cutMidPage).toBe(false);
    }
  });

  it("CONTROL: with no cap the engine's own per-question ceiling still binds", async () => {
    // A job queued before the cap existed, or the local-dev adapter. Absent is
    // unbounded BY THE CAP — never unbounded outright.
    const provider = recordingProvider();
    const long = "x".repeat(CHAT_MAX_CHARACTERS_PER_QUESTION + 500);
    const p = createChatWithPdfProcessor({
      extract: extractorForPages([long]),
      provider,
    });
    await p.process(job(undefined));
    expect(documentSent(provider).length).toBe(
      CHAT_MAX_CHARACTERS_PER_QUESTION,
    );
  });

  it("CONTROL: a cap larger than the document leaves it whole", async () => {
    const provider = recordingProvider();
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const result = await p.process(job({ characters: 100_000, pages: 3 }));
    expect(result.ok).toBe(true);
    expect(documentSent(provider)).toContain("[Page 3]");
    if (result.ok) expect(result.meta?.truncated).toBe(false);
  });
});

describe("the route and the worker name the same tool", () => {
  it("the contract's slug is the engine's, and a real catalogue tool", () => {
    // The route adds chat's reservation terms by comparing against the
    // contract's slug; the worker dispatches on the engine's. Two literals that
    // drift would charge one tool's formula and run another's.
    expect(CHAT_TOOL_SLUG).toBe(CHAT_TOOL);
    expect(getToolBySlug(CHAT_TOOL_SLUG)?.processing).toBeDefined();
  });
});
