// @vitest-environment node
/**
 * The follow-up path for `chat-with-pdf`, tested across the seam it has to survive.
 *
 * Every layer below the UI already accepted prior turns; the UI never produced any, so
 * `contextTurns` was 0 on every request ever made. A test that only restated this
 * module's own rules would pass just as happily with the feature broken, so these tests
 * use the REAL pieces on both sides:
 *
 *   - the answer is read out of a package built by the REAL engine, so a change to the
 *     package format fails here instead of silently returning `null` in a browser, and
 *   - the built context is validated by the REAL `parseChatOptions`, so if the
 *     contract's bounds move, this fails instead of the user's follow-up question.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_CONTEXT_TURNS,
  MAX_TURN_CHARS,
  parseChatOptions,
} from "@/lib/jobs/chat-with-pdf";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiProvider } from "./ai/provider";
import { runChatWithPdf } from "./chat-with-pdf/engine";
import {
  buildChatContext,
  readAnswerFromPackage,
  type ChatExchange,
} from "./chat-with-pdf-conversation";

const exchange = (question: string, answer: string): ChatExchange => ({ question, answer });

/** Round-trip the built context through the contract exactly as the worker will. */
function validate(question: string, exchanges: readonly ChatExchange[]) {
  const context = buildChatContext(exchanges);
  const parsed = parseChatOptions({ question, context: context.turns });
  return { context, parsed };
}

describe("buildChatContext — produces what the contract accepts", () => {
  it("pairs each exchange into alternating user/assistant turns", () => {
    const { context, parsed } = validate("And the due date?", [
      exchange("What is the total?", "The total is $1,240.00 [p.2]."),
    ]);

    expect(context.turns).toEqual([
      { role: "user", content: "What is the total?" },
      { role: "assistant", content: "The total is $1,240.00 [p.2]." },
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.context).toHaveLength(2);
  });

  it("sends no context at all for a first question", () => {
    const context = buildChatContext([]);
    expect(context.turns).toEqual([]);
    expect(context.droppedExchanges).toBe(0);
  });

  it("keeps the most recent exchanges and reports the ones it dropped", () => {
    // One more exchange than the contract's turn budget allows.
    const overflow = Array.from({ length: MAX_CONTEXT_TURNS / 2 + 3 }, (_, i) =>
      exchange(`question ${i}`, `answer ${i}`),
    );
    const { context, parsed } = validate("next", overflow);

    expect(parsed.ok).toBe(true);
    expect(context.turns).toHaveLength(MAX_CONTEXT_TURNS);
    expect(context.droppedExchanges).toBe(3);
    // The RECENT end is what survives — dropping the newest turns would strand the
    // follow-up from the thing it is following up on.
    expect(context.turns.at(-1)?.content).toBe(`answer ${overflow.length - 1}`);
    expect(context.turns[0]?.content).toBe(`question ${3}`);
  });

  it("shortens an over-long answer visibly rather than letting the request bounce", () => {
    const long = "x".repeat(MAX_TURN_CHARS + 500);
    const { context, parsed } = validate("next", [exchange("q", long)]);

    expect(parsed.ok).toBe(true);
    expect(context.shortenedTurns).toBe(1);
    const assistant = context.turns[1]!.content;
    expect(assistant.length).toBeLessThanOrEqual(MAX_TURN_CHARS);
    // A clipped answer must not read to the model as a complete one.
    expect(assistant).toContain("shortened for context");
  });

  it("scrubs control characters an answer could carry, which the contract rejects", () => {
    const { context, parsed } = validate("next", [
      exchange("q", "line one\x07 and two\nkept"),
    ]);

    expect(parsed.ok).toBe(true);
    expect(context.turns[1]?.content).toBe("line one and two\nkept");
  });

  it("skips an exchange with an empty half instead of breaking the alternation", () => {
    // A half-pair would shift every later turn's role and the contract would reject the
    // whole conversation — losing the good turns along with the bad one.
    const { context, parsed } = validate("next", [
      exchange("real question", "real answer"),
      exchange("orphan", "   "),
    ]);

    expect(parsed.ok).toBe(true);
    expect(context.turns).toEqual([
      { role: "user", content: "real question" },
      { role: "assistant", content: "real answer" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Reading the answer back out of a package the real engine produced
// ---------------------------------------------------------------------------

const ANSWER = "The total is $1,240.00 [p.1].";

function extractor(pages: string[]) {
  const joined = pages.join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text, characterCount: text.length })),
    text: joined,
    characterCount: joined.length,
    hasText: true,
  };
  return vi.fn(async () => extracted);
}

function provider(text: string): AiProvider {
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    async complete() {
      return { ok: true, text, model: "claude-sonnet-5", usage: { inputTokens: 9, outputTokens: 4 } };
    },
  };
}

/** Run the real engine and hand back the real ZIP it packaged. */
async function realPackage(question: string, answer = ANSWER): Promise<Uint8Array> {
  const run = await runChatWithPdf(new Uint8Array([1, 2, 3]), { question }, {
    extract: extractor(["Invoice total: $1,240.00"]),
    provider: provider(answer),
  });
  if (!run.ok) throw new Error(`engine failed: ${run.message}`);
  return run.output;
}

describe("readAnswerFromPackage — recovers the answer the engine actually shipped", () => {
  it("reads the answer back out of a real engine package", async () => {
    const question = "What is the total?";
    expect(await readAnswerFromPackage(await realPackage(question), question)).toBe(ANSWER);
  });

  it("survives an answer spanning several lines", async () => {
    const question = "Summarise the charges.";
    const multi = "Line one [p.1].\n\nLine two [p.2].\n- a bullet";
    expect(await readAnswerFromPackage(await realPackage(question, multi), question)).toBe(multi);
  });

  it("is not fooled by a question that itself looks like the delimiter", async () => {
    // The prefix is KNOWN, not sniffed — a question containing "A:" cannot forge it.
    const question = "In the table, what does row A: Freight say?";
    expect(await readAnswerFromPackage(await realPackage(question), question)).toBe(ANSWER);
  });

  it("returns null when the package is not the shape we think it is", async () => {
    // Better to stop the conversation than to carry a mis-parsed turn into the next
    // prompt, where it would look exactly like something the model really said.
    expect(await readAnswerFromPackage(new Uint8Array([0, 1, 2]), "q")).toBeNull();
    const question = "What is the total?";
    expect(await readAnswerFromPackage(await realPackage(question), "a different question")).toBeNull();
  });
});

describe("the whole follow-up round trip", () => {
  it("carries a real answer into a second request the contract accepts", async () => {
    const first = "What is the total?";
    const answer = await readAnswerFromPackage(await realPackage(first), first);
    expect(answer).not.toBeNull();

    const { context, parsed } = validate("And when is it due?", [exchange(first, answer!)]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The point of the whole exercise: a request that carries prior turns. Before this
    // existed, `contextTurns` was 0 on every request the product had ever made.
    expect(parsed.value.context).toHaveLength(2);
    expect(context.turns[1]?.content).toBe(ANSWER);
  });
});
