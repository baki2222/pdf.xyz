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
import { parseCreateJobRequest } from "@/lib/jobs/validation";
import {
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
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

const exchange = (question: string, answer: string): ChatExchange => ({
  question,
  answer,
});

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
    pages: pages.map((text, i) => ({
      pageNumber: i + 1,
      text,
      characterCount: text.length,
    })),
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
      return {
        ok: true,
        text,
        model: "claude-sonnet-5",
        usage: { inputTokens: 9, outputTokens: 4 },
      };
    },
  };
}

/** Run the real engine and hand back the real ZIP it packaged. */
async function realPackage(
  question: string,
  answer = ANSWER,
): Promise<Uint8Array> {
  const run = await runChatWithPdf(
    new Uint8Array([1, 2, 3]),
    { question },
    {
      extract: extractor(["Invoice total: $1,240.00"]),
      provider: provider(answer),
    },
  );
  if (!run.ok) throw new Error(`engine failed: ${run.message}`);
  return run.output;
}

describe("readAnswerFromPackage — recovers the answer the engine actually shipped", () => {
  it("reads the answer back out of a real engine package", async () => {
    const question = "What is the total?";
    expect(
      await readAnswerFromPackage(await realPackage(question), question),
    ).toBe(ANSWER);
  });

  it("survives an answer spanning several lines", async () => {
    const question = "Summarise the charges.";
    const multi = "Line one [p.1].\n\nLine two [p.2].\n- a bullet";
    expect(
      await readAnswerFromPackage(await realPackage(question, multi), question),
    ).toBe(multi);
  });

  it("is not fooled by a question that itself looks like the delimiter", async () => {
    // The prefix is KNOWN, not sniffed — a question containing "A:" cannot forge it.
    const question = "In the table, what does row A: Freight say?";
    expect(
      await readAnswerFromPackage(await realPackage(question), question),
    ).toBe(ANSWER);
  });

  it("returns null when the package is not the shape we think it is", async () => {
    // Better to stop the conversation than to carry a mis-parsed turn into the next
    // prompt, where it would look exactly like something the model really said.
    expect(
      await readAnswerFromPackage(new Uint8Array([0, 1, 2]), "q"),
    ).toBeNull();
    const question = "What is the total?";
    expect(
      await readAnswerFromPackage(
        await realPackage(question),
        "a different question",
      ),
    ).toBeNull();
  });
});

describe("the whole follow-up round trip", () => {
  it("carries a real answer into a second request the contract accepts", async () => {
    const first = "What is the total?";
    const answer = await readAnswerFromPackage(await realPackage(first), first);
    expect(answer).not.toBeNull();

    const { context, parsed } = validate("And when is it due?", [
      exchange(first, answer!),
    ]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The point of the whole exercise: a request that carries prior turns. Before this
    // existed, `contextTurns` was 0 on every request the product had ever made.
    expect(parsed.value.context).toHaveLength(2);
    expect(context.turns[1]?.content).toBe(ANSWER);
  });
});

/**
 * The limit that actually binds, tested against the validator that actually rejects.
 *
 * The rest of this file rounds context through `parseChatOptions`, the tool contract —
 * and that check passed while the feature was broken, because `POST /api/jobs` refuses
 * the whole `options` object by UTF-8 BYTES *before* any tool-specific parsing runs.
 * The contract counts UTF-16 characters, so a context it happily accepts could still be
 * 2x over the API cap, and every follow-up after the first would fail permanently with
 * an error the user could do nothing about.
 *
 * Driving `parseCreateJobRequest` here is the point: it is the real gate, and it is the
 * one the previous tests never touched.
 */
describe("context fits the request the API will actually accept", () => {
  const submit = (turns: ReturnType<typeof buildChatContext>["turns"]) =>
    parseCreateJobRequest({
      tool: "chat-with-pdf",
      inputs: ["f_1234567890"],
      inputNames: ["doc.pdf"],
      options: {
        question: "What does section 4 say?",
        ...(turns.length > 0 ? { context: turns } : {}),
      },
    });

  const exchanges = (count: number, text: string) =>
    Array.from({ length: count }, (_, i) => ({
      question: `Question ${i}? ${text}`,
      answer: text,
    }));

  it.each([
    ["a long English conversation", 12, "x".repeat(MAX_TURN_CHARS)],
    ["a long Bengali conversation", 6, "ক".repeat(3000)],
    ["one enormous Bengali exchange", 1, "ক".repeat(MAX_TURN_CHARS)],
    ["many short exchanges", 24, "A short grounded answer."],
  ])("%s is accepted", (_label, count, text) => {
    const built = buildChatContext(exchanges(count, text));
    const parsed = submit(built.turns);
    // Bengali is the case that matters most here: UTF-8 spends three bytes on each
    // character, so a conversation in Bangla hits the byte cap a full turn earlier than
    // the same conversation in English.
    expect(parsed.ok, JSON.stringify(parsed.ok ? {} : parsed.error)).toBe(true);
  });

  it("still sends the most recent exchange rather than giving up on context", () => {
    // Dropping everything would keep the request valid and make the feature pointless —
    // a follow-up that carries no context is just a new question.
    const built = buildChatContext(exchanges(8, "y".repeat(MAX_TURN_CHARS)));
    expect(built.turns.length).toBeGreaterThanOrEqual(2);
    expect(built.turns.at(-1)?.role).toBe("assistant");
    expect(submit(built.turns).ok).toBe(true);
  });

  it("reports every exchange it left out, however it was excluded", () => {
    // The panel repeats this number to the user. Counting only the turn-cap drops and
    // silently omitting the byte-budget ones would understate what the model was told.
    const built = buildChatContext(exchanges(8, "z".repeat(MAX_TURN_CHARS)));
    expect(built.droppedExchanges).toBe(8 - built.turns.length / 2);
  });
});

/**
 * The question travels in the SAME `options` object as the context, so the byte budget
 * has to be sized from the question actually being asked.
 *
 * Until 2026-11-06 (audit #19) the context was budgeted against a fixed 2 KB reserve for
 * the question, while the box accepts `MAX_QUESTION_CHARS` characters — and a Bengali,
 * Hindi or CJK character is three UTF-8 bytes. A follow-up of ~700 Bengali characters
 * after a long exchange was refused with 413 "`options` is larger than 8 KB" AFTER the
 * PDF had been uploaded, and every retry rebuilt the identical body. The test above only
 * ever asked "What does section 4 say?", so it never composed a long question with a
 * full context.
 */
describe("context leaves room for the question actually being asked", () => {
  const longBengaliExchange = [
    exchange("নোটিশ ".repeat(300), "উত্তর ".repeat(1000)),
  ];

  const submit = (question: string, exchanges: readonly ChatExchange[]) => {
    const built = buildChatContext(exchanges, question);
    const parsed = parseCreateJobRequest({
      tool: "chat-with-pdf",
      inputs: ["f_1234567890"],
      inputNames: ["doc.pdf"],
      options: {
        question,
        ...(built.turns.length > 0 ? { context: built.turns } : {}),
      },
    });
    return { built, parsed };
  };

  it.each([
    ["700 Bengali characters (the audit's repro)", "ক".repeat(700)],
    ["the box's maximum, in Bengali", "ক".repeat(MAX_QUESTION_CHARS)],
    ["the box's maximum, in CJK", "漢".repeat(MAX_QUESTION_CHARS)],
    ["the box's maximum, in English", "q".repeat(MAX_QUESTION_CHARS)],
    ["the box's maximum, all escaped quotes", '"'.repeat(MAX_QUESTION_CHARS)],
  ])(
    "a follow-up of %s after a long exchange is accepted, with context",
    (_label, question) => {
      const { built, parsed } = submit(question, longBengaliExchange);
      expect(parsed.ok, JSON.stringify(parsed.ok ? {} : parsed.error)).toBe(
        true,
      );
      // Still a follow-up: the newest exchange travels, shortened if it must be.
      expect(built.turns).toHaveLength(2);
    },
  );

  it("a short question keeps the context it had before (no budget is lost)", () => {
    const short = buildChatContext(longBengaliExchange, "Why?");
    const none = buildChatContext(longBengaliExchange);
    expect(short.turns).toEqual(none.turns);
  });
});
