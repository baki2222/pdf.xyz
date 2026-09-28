// @vitest-environment node
/**
 * THE PROPERTY: every chat request the API accepts leaves room for document
 * text inside what one question may read.
 *
 * The chat engine refuses a question (`conversation_too_long`) when the
 * conversation alone uses up the per-question ceiling,
 * `CHAT_MAX_CHARACTERS_PER_QUESTION` (41,032), because the conversation is paid
 * out of it (`chatDocumentBudget`) — so a conversation of 41,032 characters or
 * more would be refused on EVERY question, however small its document, after
 * being charged. The chat parser alone does not prevent that: it accepts a
 * 2,000-character question plus 12 turns of 4,000, i.e. 50,000 characters.
 * What prevents it is the 8 KB options limit in `validation.ts`, a constant in
 * a different file with no relationship to the chat ceiling. A comment was the
 * only guard; this is the test that replaces it.
 *
 * Until 2026-09-27 (history kept) the conversation was paid out of the job's
 * RESERVATION, which the route capped at the same number. The per-call pricing
 * of Summarize, Chat and Extract made the job's cap a DOCUMENT bound, charged
 * the conversation beside it, and the ceiling is where the conversation is
 * paid from now — with or without a cap, declared or not, proven or not.
 *
 * Run through the real request parser, the real route pricing
 * (`aiReservationFor`) and the engine's own budget function, not by restating
 * the arithmetic.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_CHARACTERS_PER_QUESTION,
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
  MAX_TURN_CHARS,
  chatConversationCharacters,
  chatDocumentBudget,
  parseChatOptions,
  type ChatOptions,
} from "./chat-with-pdf";
import { aiReservationFor } from "./delivery-cap";
import { CHAT_TOOL } from "@/lib/workers/chat-with-pdf/engine";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "./translate-limits";
import { JOB_LIMITS } from "./types";
import { parseCreateJobRequest } from "./validation";

const FILE_ID = "f_conversationbound01";

/** A chat conversation of `total` characters, shaped as the parser requires. */
function conversationOf(total: number, char = "a"): ChatOptions {
  const question = char.repeat(Math.min(total, MAX_QUESTION_CHARS));
  let remaining = total - question.length;
  const context: ChatOptions["context"] = [];
  while (remaining > 0 && context.length < MAX_CONTEXT_TURNS) {
    const user = char.repeat(Math.min(remaining, MAX_TURN_CHARS));
    remaining -= user.length;
    const assistant = char.repeat(
      Math.max(1, Math.min(remaining, MAX_TURN_CHARS)),
    );
    remaining -= assistant.length;
    context.push({ role: "user", content: user });
    context.push({ role: "assistant", content: assistant });
  }
  return context.length > 0 ? { question, context } : { question };
}

/** The chat job body the route receives for `options`. */
function parseJob(options: ChatOptions, declaredCharacters?: number) {
  return parseCreateJobRequest({
    tool: CHAT_TOOL,
    inputs: [FILE_ID],
    options,
    ...(declaredCharacters !== undefined ? { declaredCharacters } : {}),
  });
}

/**
 * What the route and the worker would do with this chat request: accept it,
 * price it (with or without a worker proving its read cap), and how much
 * document text the engine may then send with it.
 */
async function throughTheRoute(
  options: ChatOptions,
  declaredCharacters: number | undefined,
  proven: boolean,
) {
  const parsed = parseJob(options, declaredCharacters);
  if (!parsed.ok) return { accepted: false as const };
  const reservation = await aiReservationFor(CHAT_TOOL, parsed.value, {
    fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
    headroom: TRANSLATE_EXTRACTOR_HEADROOM,
    readCapEnforced: async () => proven,
  });
  // What the worker holds: the options as the processor validates them.
  const validated = parseChatOptions(
    parsed.value.options as Record<string, unknown>,
  );
  if (!validated.ok) throw new Error("the route accepted what chat refuses");
  return {
    accepted: true as const,
    conversation: chatConversationCharacters(validated.value),
    documentBudget: chatDocumentBudget(validated.value, reservation.delivery),
  };
}

/** The longest ASCII conversation the request parser accepts — found, not computed. */
function longestAccepted(char: string): number {
  let lo = 1;
  let hi = MAX_QUESTION_CHARS + MAX_CONTEXT_TURNS * MAX_TURN_CHARS;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (parseJob(conversationOf(mid, char), 1).ok) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

describe("the conversation can never consume a chat question's whole reservation", () => {
  it("control: the chat parser ALONE admits a conversation over the per-question ceiling", () => {
    // Without this, the tests below could pass because the parser bounds the
    // conversation — and the day someone raises the options limit, nothing
    // would say which of the two bounds had been load-bearing.
    const maximal = conversationOf(
      MAX_QUESTION_CHARS + MAX_CONTEXT_TURNS * MAX_TURN_CHARS,
    );
    const parsed = parseChatOptions(
      maximal as unknown as Record<string, unknown>,
    );
    expect(parsed.ok).toBe(true);
    expect(chatConversationCharacters(maximal)).toBeGreaterThan(
      CHAT_MAX_CHARACTERS_PER_QUESTION,
    );
    // …and the request parser refuses it, which is the bound doing the work.
    expect(parseJob(maximal, 1).ok).toBe(false);
  });

  it("health check: the search finds a conversation that IS accepted, near the byte limit", () => {
    // A search that returned 1 would make the assertion below vacuous.
    const longest = longestAccepted("a");
    expect(longest).toBeGreaterThan(JOB_LIMITS.maxOptionsBytes / 2);
    expect(longest).toBeLessThanOrEqual(JOB_LIMITS.maxOptionsBytes);
  });

  it.each([
    ["ASCII", "a"],
    // One UTF-16 unit, three UTF-8 bytes: fewer characters fit, never more.
    ["Bengali", "ক"],
  ])(
    "the longest %s conversation the API accepts still leaves document room, declared or not, proven or not",
    async (_label, char) => {
      const longest = longestAccepted(char);
      const options = conversationOf(longest, char);
      for (const declared of [1, undefined]) {
        for (const proven of [true, false]) {
          const routed = await throughTheRoute(options, declared, proven);
          expect(routed.accepted).toBe(true);
          if (!routed.accepted) continue;
          expect(
            routed.documentBudget,
            `a ${routed.conversation.toLocaleString("en-US")}-character conversation ` +
              "is accepted by the API but leaves no document text inside the " +
              `${CHAT_MAX_CHARACTERS_PER_QUESTION.toLocaleString("en-US")}-character ` +
              "per-question ceiling — every such question is charged, then " +
              "refused (conversation_too_long)",
          ).toBeGreaterThan(0);
        }
      }
    },
  );

  it("the relationship itself: the options byte limit sits below the per-question ceiling", () => {
    // A string's UTF-16 length never exceeds its UTF-8 byte length, so the
    // byte limit bounds the conversation's character count from above.
    expect(JOB_LIMITS.maxOptionsBytes).toBeLessThan(
      CHAT_MAX_CHARACTERS_PER_QUESTION,
    );
  });
});
