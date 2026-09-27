// @vitest-environment node
/**
 * THE PROPERTY: every chat request the API accepts leaves room for document
 * text inside its own reservation.
 *
 * The chat engine refuses a question with `over_reservation` when the
 * conversation alone uses up `delivery.characters`, and its comment says only
 * "a cap the route did not make" can reach that branch. That holds for one
 * reason nothing named: the route caps a chat reservation at
 * `CHAT_MAX_CHARACTERS_PER_QUESTION` (41,032), and the conversation is paid out
 * of it — so a conversation of 41,032 characters or more would be refused on
 * EVERY question, however small its document, after being charged a third of
 * the day. The chat parser alone does not prevent that: it accepts a
 * 2,000-character question plus 12 turns of 4,000, i.e. 50,000 characters.
 * What prevents it is the 8 KB options limit in `validation.ts`, a constant in
 * a different file with no relationship to the chat ceiling. A comment was the
 * only guard; this is the test that replaces it.
 *
 * Run through the real request parser and the real reservation formula, not
 * by restating the arithmetic.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_CHARACTERS_PER_QUESTION,
  CHAT_TOOL_SLUG,
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
  MAX_TURN_CHARS,
  chatConversationCharacters,
  chatReservationTerms,
  parseChatOptions,
  type ChatOptions,
} from "./chat-with-pdf";
import { deliveryCapFor } from "./delivery-cap";
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

/** What the route would do with this chat request: accept it, and reserve what. */
function throughTheRoute(options: ChatOptions, declaredCharacters?: number) {
  const parsed = parseCreateJobRequest({
    tool: CHAT_TOOL_SLUG,
    inputs: [FILE_ID],
    options,
    ...(declaredCharacters !== undefined ? { declaredCharacters } : {}),
  });
  if (!parsed.ok) return { accepted: false as const };
  const delivery = deliveryCapFor(parsed.value, {
    fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
    headroom: TRANSLATE_EXTRACTOR_HEADROOM,
    ...chatReservationTerms(parsed.value.options),
  });
  const conversation = chatConversationCharacters(options);
  return {
    accepted: true as const,
    conversation,
    documentBudget: delivery.characters - conversation,
  };
}

/** The longest ASCII conversation the request parser accepts — found, not computed. */
function longestAccepted(char: string): number {
  let lo = 1;
  let hi = MAX_QUESTION_CHARS + MAX_CONTEXT_TURNS * MAX_TURN_CHARS;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (throughTheRoute(conversationOf(mid, char), 1).accepted) lo = mid;
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
    expect(throughTheRoute(maximal, 1).accepted).toBe(false);
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
    "the longest %s conversation the API accepts still leaves document room, declared or not",
    (_label, char) => {
      const longest = longestAccepted(char);
      const options = conversationOf(longest, char);
      for (const declared of [1, undefined]) {
        const routed = throughTheRoute(options, declared);
        expect(routed.accepted).toBe(true);
        if (!routed.accepted) continue;
        expect(
          routed.documentBudget,
          `a ${routed.conversation.toLocaleString("en-US")}-character conversation ` +
            "is accepted by the API but leaves no document text inside the " +
            `${CHAT_MAX_CHARACTERS_PER_QUESTION.toLocaleString("en-US")}-character ` +
            "cap — every such question is charged, then refused (over_reservation)",
        ).toBeGreaterThan(0);
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
