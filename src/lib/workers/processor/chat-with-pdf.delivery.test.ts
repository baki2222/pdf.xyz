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
 *
 * ── WHAT THE CAP BOUNDS CHANGED THE SAME DAY (history kept) ─────────────────
 *
 * This fix first made the cap include the conversation, and the engine paid
 * the conversation out of it: "sends the reservation minus the conversation".
 * The per-call pricing of Summarize, Chat and Extract, merged beside it, prices
 * a run as `declared × h` of DOCUMENT plus the options the server measured
 * plus the engine's instructions, and hands the worker `declared × h` alone.
 * Taking the conversation out of THAT would refuse an honest one-page document
 * carrying a long conversation, after charging it. So the two bounds now bound
 * different things (`chatDocumentBudget`):
 *
 *  - the job's cap bounds the DOCUMENT, and nothing is taken out of it;
 *  - the per-question ceiling bounds the document AND the conversation, capped
 *    or not, and the conversation is paid out of it.
 *
 * The tests below that pinned the first shape are inverted in place.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText, ExtractedTextPage } from "@/lib/pdf/text";
import type { JobDeliveryCap } from "@/lib/jobs";
import {
  CHAT_MAX_CHARACTERS_PER_QUESTION,
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
  MAX_TURN_CHARS,
  chatConversationCharacters,
  type ChatTurn,
} from "@/lib/jobs/chat-with-pdf";
import { AI_RUN_PRICING } from "@/lib/jobs/delivery-cap";
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
  it("sends at most the cap's document characters, and discloses the cut", async () => {
    // INVERTED 2026-09-27, history kept: this was "sends at most the
    // reservation minus the conversation" (`cap - conversation`). The cap is
    // now the DOCUMENT bound the route charged for, and the question was
    // charged beside it, so none of it comes out of the document.
    const provider = recordingProvider();
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const cap = 3_000;
    const result = await p.process(job({ characters: cap }));
    expect(result.ok).toBe(true);

    expect(
      documentSent(provider).length,
      "the provider received a different amount of document than this job " +
        "was charged for",
    ).toBe(cap);
    if (result.ok) {
      expect(result.meta?.truncated).toBe(true);
      expect(result.results?.ai?.truncation?.truncated).toBe(true);
    }
  });

  it("counts the carried conversation against the per-question ceiling, not the cap", async () => {
    // The turns are AI text the model reads on this call. INVERTED 2026-09-27,
    // history kept: they were taken out of the job's cap, so "a cap that
    // bounded only the document would let a caller buy 4 characters and send
    // the contract's whole context allowance with them on every request".
    // That caller now PAYS for them: the route charges the options it
    // measured off the body (`api/jobs/per-call-pricing.test.ts`, "the run
    // sent … still has room"). What the turns still come out of is the
    // per-question ceiling, which binds with or without a cap.
    const options = { question: QUESTION, context: CONTEXT };
    const conversation = chatConversationCharacters(options);
    expect(conversation).toBeGreaterThan(QUESTION.length);

    const capped = recordingProvider();
    await createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider: capped,
    }).process(job({ characters: 3_000 }, options));
    expect(documentSent(capped).length).toBe(3_000);

    const long = "x".repeat(CHAT_MAX_CHARACTERS_PER_QUESTION + 500);
    for (const delivery of [undefined, { characters: 1_000_000 }]) {
      const provider = recordingProvider();
      await createChatWithPdfProcessor({
        extract: extractorForPages([long]),
        provider,
      }).process(job(delivery, options));
      expect(
        documentSent(provider).length,
        "a question and its turns were sent on top of a full ceiling of document",
      ).toBe(CHAT_MAX_CHARACTERS_PER_QUESTION - conversation);
    }
  });

  it("a tiny cap buys a tiny read, not a refusal", async () => {
    // INVERTED 2026-09-27, history kept: this was "refuses, before any model
    // call, a conversation larger than the reservation" at a cap of 4 — the
    // cap a declaration of one character buys. The conversation is no longer
    // paid out of the cap, so that caller is read four characters and has
    // paid for them, the question, and the engine's instructions.
    const provider = recordingProvider();
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const result = await p.process(job({ characters: 4 }));
    expect(result.ok).toBe(true);
    expect(documentSent(provider).length).toBe(4);
  });

  it("refuses, before any model call, a conversation that fills the per-question ceiling", async () => {
    // Where the refusal lives now. Unreachable through the API while the 8 KB
    // options limit holds every conversation under the ceiling
    // (`chat-with-pdf.conversation-bound.test.ts`), but the chat parser this
    // processor runs admits 50,000 characters, so a job that reached the
    // worker another way can still carry one.
    const provider = recordingProvider();
    const context: ChatTurn[] = Array.from(
      { length: MAX_CONTEXT_TURNS },
      (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(MAX_TURN_CHARS),
      }),
    );
    const options = { question: "q".repeat(MAX_QUESTION_CHARS), context };
    expect(chatConversationCharacters(options)).toBeGreaterThanOrEqual(
      CHAT_MAX_CHARACTERS_PER_QUESTION,
    );
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const result = await p.process(job({ characters: 3_000 }, options));
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

  it("bounds a chat run in characters: a page count on the cap is not a chat bound", async () => {
    // INVERTED 2026-09-27, history kept: this was "stops at the last declared
    // page, and names that page as complete" — the chat client declared its
    // text pages and the engine stopped there. Chat is now priced per call,
    // and a per-call run is bounded in characters only: the route never puts
    // a page count on its cap (`delivery-cap.pricing.test.ts`, "a page bound
    // was set that no per-call engine enforces") and the client never declares
    // one (`per-call-declared.chain.test.ts`). A page stop no job could reach
    // would be a guard over nothing. The window's page-boundary accounting
    // that test also covered is pinned in `ai/truncation.test.ts`.
    const provider = recordingProvider();
    const p = createChatWithPdfProcessor({
      extract: extractorForPages(THREE_PAGES),
      provider,
    });
    const result = await p.process(job({ characters: 100_000, pages: 2 }));
    expect(result.ok).toBe(true);
    expect(documentSent(provider)).toContain("[Page 3]");
  });

  it("CONTROL: with no cap the engine's own per-question ceiling still binds", async () => {
    // An undeclared question, every question while the running worker has not
    // proved its read cap, a job queued before the cap existed, or the
    // local-dev adapter. Absent is unbounded BY THE CAP — never unbounded
    // outright. The ceiling covers the question too (2026-09-27: it used to
    // read the whole ceiling of document and send the question on top).
    const provider = recordingProvider();
    const long = "x".repeat(CHAT_MAX_CHARACTERS_PER_QUESTION + 500);
    const p = createChatWithPdfProcessor({
      extract: extractorForPages([long]),
      provider,
    });
    await p.process(job(undefined));
    expect(documentSent(provider).length).toBe(
      CHAT_MAX_CHARACTERS_PER_QUESTION -
        chatConversationCharacters({ question: QUESTION }),
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
  it("the pricing's slug is the engine's, and a real catalogue tool", () => {
    // The route prices chat by its slug in `AI_RUN_PRICING`; the worker
    // dispatches on the engine's. Two literals that drift would charge one
    // tool's formula and run another's. (Until 2026-09-27 the route compared
    // against a `CHAT_TOOL_SLUG` in the chat contract, which the per-call
    // pricing replaced.)
    expect(AI_RUN_PRICING[CHAT_TOOL]).toBe("per-call");
    expect(getToolBySlug(CHAT_TOOL)?.processing).toBeDefined();
  });
});
