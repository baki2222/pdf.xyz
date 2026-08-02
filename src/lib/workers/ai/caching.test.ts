// @vitest-environment node
/**
 * Prompt caching across the two provider families.
 *
 * `chat-with-pdf` re-sends the entire extracted document on every follow-up question —
 * it lives in the system instruction, and the system instruction is rebuilt identically
 * each turn. That is the one place in this codebase with a large, byte-stable prefix
 * worth caching.
 *
 * The two providers need opposite things, which is the whole reason
 * `AiCompletionRequest.cacheSystem` is an intent rather than a wire field:
 *  - Anthropic caches only what it is explicitly marked to cache, so the adapter has to
 *    convert the system string into a block carrying `cache_control`.
 *  - OpenAI caches long prefixes on its own, so the adapter must send exactly what it
 *    sent before — adding a field there would be inventing an API.
 *
 * Both must report what was actually served from cache. Caching is a bet: the first
 * request pays a write premium and only a repeat collects. Without the number the bet
 * cannot be checked, and "we added caching" becomes a claim nobody can falsify.
 */
import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import type { AiCompletionRequest } from "./provider";

const REQUEST: AiCompletionRequest = {
  system: "You are a careful assistant.\n--- DOCUMENT START ---\nlong text\n--- DOCUMENT END ---",
  messages: [{ role: "user", content: "What does it say?" }],
  maxOutputTokens: 256,
};

/** Capture the request body an adapter puts on the wire, returning a canned reply. */
function capturing(reply: unknown): { fetch: typeof fetch; body: () => Record<string, unknown> } {
  let seen: Record<string, unknown> = {};
  const fake = (async (_url: string, init?: RequestInit) => {
    seen = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: fake, body: () => seen };
}

const ANTHROPIC_REPLY = {
  content: [{ type: "text", text: "It says hello." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 5, cache_read_input_tokens: 4_000 },
};

const OPENAI_REPLY = {
  choices: [{ message: { content: "It says hello." }, finish_reason: "stop" }],
  usage: {
    prompt_tokens: 12,
    completion_tokens: 5,
    prompt_tokens_details: { cached_tokens: 4_000 },
  },
};

const anthropic = (fetchImpl: typeof fetch) =>
  createAnthropicProvider(
    { model: "claude-sonnet-5", apiKey: "test-key", timeoutMs: 1_000 },
    { fetch: fetchImpl },
  );

const openai = (fetchImpl: typeof fetch) =>
  createOpenAiProvider(
    { model: "gpt-5.6-luna", apiKey: "test-key", timeoutMs: 1_000 },
    { fetch: fetchImpl },
  );

describe("Anthropic — caching must be asked for explicitly", () => {
  it("marks the system instruction as a cacheable prefix when the caller opts in", async () => {
    const cap = capturing(ANTHROPIC_REPLY);
    await anthropic(cap.fetch).complete({ ...REQUEST, cacheSystem: true });

    // A block array, not a string: `cache_control` has nowhere to live otherwise.
    expect(cap.body().system).toEqual([
      { type: "text", text: REQUEST.system, cache_control: { type: "ephemeral" } },
    ]);
  });

  it("sends the plain string when the caller does not, so nothing else changes", async () => {
    // summarize / translate / ai-extract take this path. They ask once per document and
    // never come back, so a cache write would be a premium paid against a second request
    // that never arrives.
    const cap = capturing(ANTHROPIC_REPLY);
    await anthropic(cap.fetch).complete(REQUEST);
    expect(cap.body().system).toBe(REQUEST.system);
  });

  it("puts the marker on the system block, never on the conversation", async () => {
    // Order is tools -> system -> messages. The document is stable and belongs before
    // the breakpoint; the question changes every turn and must stay after it, or every
    // request writes a fresh entry and none is ever read.
    const cap = capturing(ANTHROPIC_REPLY);
    await anthropic(cap.fetch).complete({ ...REQUEST, cacheSystem: true });
    expect(JSON.stringify(cap.body().messages)).not.toContain("cache_control");
  });

  it("reports cache reads, because input_tokens alone hides them", async () => {
    // A cache hit shows up as a SMALL input_tokens plus a large cache_read count.
    // Reading only the first would make a cached request look like a tiny one.
    const result = await anthropic(capturing(ANTHROPIC_REPLY).fetch).complete(REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5, cachedInputTokens: 4_000 });
  });

  it("omits the figure rather than reporting zero when the provider is silent", async () => {
    const reply = { ...ANTHROPIC_REPLY, usage: { input_tokens: 12, output_tokens: 5 } };
    const result = await anthropic(capturing(reply).fetch).complete(REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A missing measurement is not a measured zero — the same rule the OCR confidence
    // fields follow.
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
  });
});

describe("OpenAI — caching is automatic, so the body must not change", () => {
  it("sends an identical body whether or not the caller opts in", async () => {
    // There is no request-side caching parameter on this API. Inventing one would be
    // exactly the kind of confident, wrong claim this codebase keeps removing.
    const plain = capturing(OPENAI_REPLY);
    await openai(plain.fetch).complete(REQUEST);
    const opted = capturing(OPENAI_REPLY);
    await openai(opted.fetch).complete({ ...REQUEST, cacheSystem: true });

    expect(opted.body()).toEqual(plain.body());
    expect(JSON.stringify(opted.body())).not.toContain("cache_control");
  });

  it("keeps the stable system message ahead of the volatile question", async () => {
    // The only thing that governs OpenAI cache hits is that the shared span really is a
    // prefix. If anything volatile were ever ordered ahead of the document, hits would
    // stop silently — no error, just a bill that never falls.
    const cap = capturing(OPENAI_REPLY);
    await openai(cap.fetch).complete({ ...REQUEST, cacheSystem: true });
    const messages = cap.body().messages as { role: string; content: string }[];
    expect(messages[0]?.role).toBe("system");
    expect(messages.at(-1)?.content).toBe("What does it say?");
  });

  it("reports the cached share of the prompt", async () => {
    const result = await openai(capturing(OPENAI_REPLY).fetch).complete(REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5, cachedInputTokens: 4_000 });
  });
});
