import {
  MAX_CONTEXT_TURNS,
  MAX_TURN_CHARS,
  type ChatTurn,
} from "@/lib/jobs/chat-with-pdf";
import { JOB_LIMITS } from "@/lib/jobs/types";

/**
 * Browser-side conversation state for `chat-with-pdf`.
 *
 * The job contract, the client driver, the engine and both AI providers have always
 * accepted prior conversation turns — only the UI never produced any, so every request
 * shipped with `contextTurns: 0`. That made two things untrue at once: a tool called
 * "Chat with PDF" that could not hold a conversation, and a prompt-cache write premium
 * (`cacheSystem: true`, justified in the engine as "the only AI tool that takes prior
 * turns") that nothing could ever collect. This module is the missing half.
 *
 * It is deliberately pure and provider-free so it can be unit-tested against the REAL
 * contract validator rather than a restatement of it: {@link buildChatContext}'s output
 * is fed through `parseChatOptions` in the tests, so if the contract's bounds move, the
 * test fails instead of the user's follow-up question.
 *
 * WHAT IS BOUNDED, AND WHY IT IS REPORTED RATHER THAN HIDDEN
 *   - `MAX_CONTEXT_TURNS` (12) caps the wire payload, so only the most recent 6
 *     exchanges travel. Older ones are DROPPED, and the count is returned.
 *   - `MAX_TURN_CHARS` (4000) caps one turn, and a long grounded answer can exceed it.
 *     Such a turn is shortened with a visible marker, and the count is returned.
 * Both counts exist so the panel can say plainly what the model was and was not told.
 * Silently sending less context than the transcript shows would be the same shape of
 * lie as a capability reported from wiring instead of from behaviour.
 */

/** One completed round trip: what the user asked, and the answer that came back. */
export interface ChatExchange {
  question: string;
  answer: string;
}

/** Prior turns for a follow-up, plus an honest account of what did not fit. */
export interface ChatContext {
  /** Complete user/assistant pairs, oldest first — exactly what the contract wants. */
  turns: ChatTurn[];
  /** Older exchanges left out entirely, by turn count or by the byte budget. */
  droppedExchanges: number;
  /** Turns shortened to fit `MAX_TURN_CHARS`. */
  shortenedTurns: number;
}

/** Most recent exchanges that fit within the contract's turn budget (2 turns each). */
const MAX_CONTEXT_EXCHANGES = Math.floor(MAX_CONTEXT_TURNS / 2);

/**
 * Byte budget for the serialized `context` — the limit that actually binds.
 *
 * The chat contract counts UTF-16 CHARACTERS (`MAX_TURN_CHARS`), but `POST /api/jobs`
 * rejects the whole `options` object by UTF-8 BYTES before any tool-specific parsing
 * runs, so a context the contract accepts can still be refused by the API in front of
 * it. At the contract's own maximum the payload measures ~48 KB against an 8 KB cap,
 * and the gap is worse for any non-Latin script: a Bengali character costs three bytes,
 * so a conversation in Bangla would die a full turn earlier than the same one in
 * English.
 *
 * Unbudgeted, the failure is silent and permanent — the context is rebuilt from the same
 * transcript on every attempt, so each retry reproduces the identical oversized body and
 * the only escape is discarding the conversation.
 *
 * The reserve leaves room for `question` and the JSON scaffolding travelling in the same
 * object, so this is what remains for `context` rather than the whole cap.
 */
const OPTIONS_BYTE_RESERVE = 2 * 1024;
const CONTEXT_BYTE_BUDGET = JOB_LIMITS.maxOptionsBytes - OPTIONS_BYTE_RESERVE;

/** Serialized UTF-8 size of a turn as it will travel inside `options`. */
function turnBytes(turn: ChatTurn): number {
  return new TextEncoder().encode(JSON.stringify(turn)).length;
}

/**
 * Shorten `text` until its serialized turn fits `limit` bytes.
 *
 * The character clamp alone cannot keep the newest exchange inside the budget: one pair
 * at the contract's 4,000-character maximum serializes to about 8 KB, so without this a
 * single long answer would leave the next question with NO context at all — honest, but
 * the feature would quietly stop working exactly when a conversation got substantive.
 *
 * Cuts by code point, never by byte, so a multi-byte character is never split into
 * invalid UTF-8, and re-appends the marker the character clamp uses so a byte-shortened
 * turn reads to the model exactly like a character-shortened one.
 */
function clampTurnBytes(
  role: ChatTurn["role"],
  text: string,
  limit: number,
): string {
  if (turnBytes({ role, content: text }) <= limit) return text;
  const chars = [...text];
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join("").trimEnd()}${SHORTENED_MARKER}`;
    if (turnBytes({ role, content: candidate }) <= limit) low = mid;
    else high = mid - 1;
  }
  return `${chars.slice(0, low).join("").trimEnd()}${SHORTENED_MARKER}`;
}

/**
 * Appended when a turn is clipped, so a shortened answer never reads as a complete one
 * to the model. Counted against `MAX_TURN_CHARS` rather than added on top of it.
 */
const SHORTENED_MARKER = "\n\n[…shortened for context]";

/**
 * C0 control characters and DEL, tolerating newline and tab.
 *
 * This mirrors the contract's own rule (`src/lib/jobs/chat-with-pdf.ts`), which rejects
 * a turn containing them. A question has already survived that check to become an
 * exchange, but a model's answer has not — so it is scrubbed here rather than allowed
 * to make an otherwise valid follow-up bounce with a validation error the user cannot
 * act on. The contract stays the authority; this only keeps input inside it.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Bring one turn's text inside the contract: scrubbed, trimmed, and length-bounded. */
function clampTurn(text: string): { content: string; shortened: boolean } {
  const clean = text.replace(CONTROL_CHARS, "").trim();
  if (clean.length <= MAX_TURN_CHARS)
    return { content: clean, shortened: false };
  const head = clean
    .slice(0, MAX_TURN_CHARS - SHORTENED_MARKER.length)
    .trimEnd();
  return { content: `${head}${SHORTENED_MARKER}`, shortened: true };
}

/**
 * Turn a transcript into contract-valid prior turns for the next question.
 *
 * Exchanges whose question or answer is empty after scrubbing are skipped: the contract
 * requires non-empty content on both halves of a pair, and a half-pair would break the
 * strict user/assistant alternation for every turn after it.
 */
export function buildChatContext(
  exchanges: readonly ChatExchange[],
): ChatContext {
  const usable = exchanges.filter(
    (exchange) =>
      clampTurn(exchange.question).content.length > 0 &&
      clampTurn(exchange.answer).content.length > 0,
  );

  const capped = usable.slice(-MAX_CONTEXT_EXCHANGES);

  // Newest-first, so the byte budget is spent on the exchanges nearest the question
  // being asked; reversed at the end because the contract wants oldest first.
  const pairs: ChatTurn[][] = [];
  let shortenedTurns = 0;
  let bytes = 0;

  for (let i = capped.length - 1; i >= 0; i -= 1) {
    const exchange = capped[i]!;
    const question = clampTurn(exchange.question);
    const answer = clampTurn(exchange.answer);
    let questionText = question.content;
    let answerText = answer.content;

    // The newest exchange is shortened to fit rather than dropped, so a follow-up always
    // carries at least its immediate predecessor. Older ones are dropped whole: squeezing
    // several long exchanges into one budget leaves each too mangled to be worth sending.
    if (pairs.length === 0) {
      const half = Math.floor(CONTEXT_BYTE_BUDGET / 2);
      questionText = clampTurnBytes("user", questionText, half);
      answerText = clampTurnBytes("assistant", answerText, half);
    }

    const pair: ChatTurn[] = [
      { role: "user", content: questionText },
      { role: "assistant", content: answerText },
    ];
    const pairBytes = pair.reduce((total, turn) => total + turnBytes(turn), 0);
    // A pair is kept whole or not at all: half of one would break the strict
    // user/assistant alternation the contract requires for every turn after it.
    if (bytes + pairBytes > CONTEXT_BYTE_BUDGET) break;
    bytes += pairBytes;
    if (questionText.endsWith(SHORTENED_MARKER)) shortenedTurns += 1;
    if (answerText.endsWith(SHORTENED_MARKER)) shortenedTurns += 1;
    pairs.push(pair);
  }

  const turns = pairs.reverse().flat();
  // Everything the transcript held that this context does not carry, however it was
  // excluded — the user only needs to know how much of their conversation the model saw.
  return {
    turns,
    droppedExchanges: usable.length - pairs.length,
    shortenedTurns,
  };
}

/**
 * Read the model's answer back out of the ZIP package the worker returned.
 *
 * The answer text is needed to carry the conversation forward, and this is the only
 * honest place to get it: the worker's result metadata is deliberately content-free
 * (counts, never the answer body), and that invariant is worth more than the
 * convenience of widening it. The package is already in the browser's memory, so
 * reading it locally sends nothing new anywhere.
 *
 * `answer.txt` is generated by the engine as exactly `Q: {question}\n\nA: {answer}\n`
 * with the same trimmed question this caller sent, so the answer is recovered by
 * removing a KNOWN prefix — not by pattern-matching a delimiter that a question
 * containing "A:" could forge. If the prefix is not there, the shape is not what we
 * think it is, and this returns `null` so the caller stops rather than carrying a
 * mis-parsed turn into the next prompt.
 *
 * JSZip is imported lazily so a ~100 KB reader is fetched only once an answer actually
 * arrives, instead of loading on every tool page.
 */
export async function readAnswerFromPackage(
  output: Uint8Array,
  question: string,
): Promise<string | null> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(output);
    const entry = zip.file("answer.txt");
    if (!entry) return null;
    const text = await entry.async("string");
    const prefix = `Q: ${question.trim()}\n\nA: `;
    if (!text.startsWith(prefix)) return null;
    const answer = text.slice(prefix.length).trimEnd();
    return answer.length > 0 ? answer : null;
  } catch {
    return null;
  }
}
