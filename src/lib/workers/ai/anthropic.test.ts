import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_BASE_URL,
  createAnthropicProvider,
} from "./anthropic";
import type { AiCompletionRequest } from "./provider";

const CONFIG = { apiKey: "sk-test-KEY", model: "claude-sonnet-5", timeoutMs: 5000 };
const REQUEST: AiCompletionRequest = {
  system: "You summarize.",
  messages: [{ role: "user", content: "Summarize this." }],
  maxOutputTokens: 500,
  temperature: 0.2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createAnthropicProvider", () => {
  it("exposes only public id/model and never the API key on an enumerable field", () => {
    const provider = createAnthropicProvider(CONFIG, { fetch: vi.fn() });
    expect(provider.id).toBe("anthropic");
    expect(provider.model).toBe("claude-sonnet-5");
    expect(JSON.stringify(provider)).not.toContain("sk-test-KEY");
    expect(Object.values(provider)).not.toContain("sk-test-KEY");
  });

  it("maps a request to the Messages API and returns real text + usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        content: [{ type: "text", text: " Hello world " }],
        stop_reason: "end_turn",
        usage: { input_tokens: 42, output_tokens: 7 },
      }),
    );
    const provider = createAnthropicProvider(CONFIG, { fetch: fetchMock });
    const result = await provider.complete(REQUEST);

    expect(result).toEqual({
      ok: true,
      text: "Hello world",
      model: "claude-sonnet-5",
      usage: { inputTokens: 42, outputTokens: 7 },
    });

    // Correct endpoint, auth header (the key), version pin, and mapped body.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test-KEY");
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: "You summarize.",
      temperature: 0.2,
      messages: [{ role: "user", content: "Summarize this." }],
    });
  });

  it("uses an https base-url override", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }),
    );
    const provider = createAnthropicProvider(
      { ...CONFIG, baseUrl: "https://proxy.example/anthropic" },
      { fetch: fetchMock },
    );
    await provider.complete(REQUEST);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://proxy.example/anthropic/v1/messages");
  });

  it("maps a 429 to a retryable rate_limited failure", async () => {
    const provider = createAnthropicProvider(CONFIG, {
      fetch: vi.fn(async () => jsonResponse({ error: "slow down" }, 429)),
    });
    const result = await provider.complete(REQUEST);
    expect(result).toMatchObject({ ok: false, kind: "rate_limited", retryable: true });
  });

  it("maps a 5xx to a retryable provider_error without leaking the body", async () => {
    const provider = createAnthropicProvider(CONFIG, {
      fetch: vi.fn(async () => jsonResponse({ error: "secret-internal-detail" }, 503)),
    });
    const result = await provider.complete(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("provider_error");
      expect(result.retryable).toBe(true);
      expect(result.message).not.toContain("secret-internal-detail");
    }
  });

  it("maps a refusal stop_reason to content_filtered (not retryable)", async () => {
    const provider = createAnthropicProvider(CONFIG, {
      fetch: vi.fn(async () =>
        jsonResponse({ content: [], stop_reason: "refusal" }),
      ),
    });
    const result = await provider.complete(REQUEST);
    expect(result).toMatchObject({ ok: false, kind: "content_filtered", retryable: false });
  });

  it("maps an abort to a timeout failure", async () => {
    const provider = createAnthropicProvider(CONFIG, {
      fetch: vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    });
    const result = await provider.complete(REQUEST);
    expect(result).toMatchObject({ ok: false, kind: "timeout" });
  });

  it("maps a text-less 200 body to invalid_response", async () => {
    const provider = createAnthropicProvider(CONFIG, {
      fetch: vi.fn(async () =>
        jsonResponse({ content: [{ type: "tool_use" }], stop_reason: "end_turn" }),
      ),
    });
    const result = await provider.complete(REQUEST);
    expect(result).toMatchObject({ ok: false, kind: "invalid_response" });
  });
});
