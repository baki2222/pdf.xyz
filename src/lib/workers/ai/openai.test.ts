import { describe, expect, it, vi } from "vitest";
import {
  OPENAI_DEFAULT_BASE_URL,
  buildChatCompletionsBody,
  createOpenAiProvider,
  isUnsupportedTemperatureError,
} from "./openai";
import type { AiCompletionRequest } from "./provider";

const CONFIG = { apiKey: "sk-test-KEY", model: "gpt-5.6-luna", timeoutMs: 5000 };
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

function completion(text: string, finishReason = "stop", usage?: unknown) {
  return {
    choices: [{ message: { content: text }, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}

/** The body of the Nth fetch call, parsed. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string);
}

describe("buildChatCompletionsBody", () => {
  it("prepends the system instruction as a message (OpenAI has no system field)", () => {
    const body = buildChatCompletionsBody("gpt-5.6-luna", REQUEST, true);
    expect(body.messages).toEqual([
      { role: "system", content: "You summarize." },
      { role: "user", content: "Summarize this." },
    ]);
    expect(body).not.toHaveProperty("system");
  });

  it("omits the system message entirely when the request has none", () => {
    const body = buildChatCompletionsBody("gpt-5.6-luna", {
      messages: [{ role: "user", content: "Hi" }],
      maxOutputTokens: 10,
    }, true);
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("uses max_completion_tokens — the GPT-5 family rejects max_tokens", () => {
    const body = buildChatCompletionsBody("gpt-5.6-luna", REQUEST, true);
    expect(body.max_completion_tokens).toBe(500);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("includes temperature only when asked for and permitted", () => {
    expect(buildChatCompletionsBody("m", REQUEST, true).temperature).toBe(0.2);
    expect(buildChatCompletionsBody("m", REQUEST, false)).not.toHaveProperty("temperature");
    const noTemp = { messages: REQUEST.messages, maxOutputTokens: 10 };
    expect(buildChatCompletionsBody("m", noTemp, true)).not.toHaveProperty("temperature");
  });

  it("preserves multi-turn order for chat", () => {
    const body = buildChatCompletionsBody("m", {
      messages: [
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
        { role: "user", content: "three" },
      ],
      maxOutputTokens: 10,
    }, false);
    expect(body.messages).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
  });
});

describe("isUnsupportedTemperatureError", () => {
  it("matches the parameter-rejection wording the GPT-5 family uses", () => {
    expect(
      isUnsupportedTemperatureError(
        `{"error":{"message":"Unsupported parameter: 'temperature' is not supported with this model."}}`,
      ),
    ).toBe(true);
    expect(
      isUnsupportedTemperatureError(
        `{"error":{"message":"Unsupported value: 'temperature' does not support 0.2"}}`,
      ),
    ).toBe(true);
  });

  it("does NOT match an unrelated 400, so no other error is silently retried", () => {
    expect(isUnsupportedTemperatureError(`{"error":{"message":"Invalid model id"}}`)).toBe(false);
    // Names a different unsupported parameter — must not trigger a temperature retry.
    expect(
      isUnsupportedTemperatureError(
        `{"error":{"message":"Unsupported parameter: 'top_k' is not supported"}}`,
      ),
    ).toBe(false);
    expect(isUnsupportedTemperatureError("")).toBe(false);
  });
});

describe("createOpenAiProvider", () => {
  it("exposes only public id/model and never the API key on an enumerable field", () => {
    const provider = createOpenAiProvider(CONFIG, { fetch: vi.fn() });
    expect(provider.id).toBe("openai");
    expect(provider.model).toBe("gpt-5.6-luna");
    expect(JSON.stringify(provider)).not.toContain("sk-test-KEY");
    expect(Object.values(provider)).not.toContain("sk-test-KEY");
  });

  it("maps a request to Chat Completions and returns real text + usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        completion(" Hello world ", "stop", { prompt_tokens: 42, completion_tokens: 7 }),
      ),
    );
    const provider = createOpenAiProvider(CONFIG, { fetch: fetchMock });

    expect(await provider.complete(REQUEST)).toEqual({
      ok: true,
      text: "Hello world",
      model: "gpt-5.6-luna",
      usage: { inputTokens: 42, outputTokens: 7 },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${OPENAI_DEFAULT_BASE_URL}/v1/chat/completions`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-KEY");
    expect(sentBody(fetchMock)).toMatchObject({
      model: "gpt-5.6-luna",
      max_completion_tokens: 500,
      temperature: 0.2,
    });
  });

  it("omits usage when the provider did not report both counts", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(completion("text", "stop", { prompt_tokens: 5 })),
    );
    const result = await createOpenAiProvider(CONFIG, { fetch: fetchMock }).complete(REQUEST);
    expect(result).toEqual({ ok: true, text: "text", model: "gpt-5.6-luna" });
  });

  it("honours a base-URL override without a trailing slash", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(completion("ok")));
    await createOpenAiProvider(
      { ...CONFIG, baseUrl: "https://gateway.example.com/" },
      { fetch: fetchMock },
    ).complete(REQUEST);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://gateway.example.com/v1/chat/completions");
  });

  it("rejects a malformed request before any network call", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await createOpenAiProvider(CONFIG, { fetch: fetchMock }).complete({
      messages: [],
      maxOutputTokens: 10,
    });
    expect(result).toMatchObject({ ok: false, kind: "invalid_response" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createOpenAiProvider — the temperature compatibility retry", () => {
  const unsupported = () =>
    new Response(
      `{"error":{"message":"Unsupported parameter: 'temperature' is not supported with this model."}}`,
      { status: 400 },
    );

  it("retries once WITHOUT temperature and succeeds, preserving the rest of the body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unsupported())
      .mockResolvedValueOnce(jsonResponse(completion("second try")));

    const result = await createOpenAiProvider(CONFIG, { fetch: fetchMock }).complete(REQUEST);

    expect(result).toMatchObject({ ok: true, text: "second try" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchMock, 0)).toHaveProperty("temperature", 0.2);
    expect(sentBody(fetchMock, 1)).not.toHaveProperty("temperature");
    // Everything else is unchanged — only the offending parameter is dropped.
    expect(sentBody(fetchMock, 1)).toMatchObject({
      model: "gpt-5.6-luna",
      max_completion_tokens: 500,
      messages: [
        { role: "system", content: "You summarize." },
        { role: "user", content: "Summarize this." },
      ],
    });
  });

  it("cannot loop: a second identical rejection fails as `rejected`", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => unsupported());
    const result = await createOpenAiProvider(CONFIG, { fetch: fetchMock }).complete(REQUEST);
    expect(result).toMatchObject({ ok: false, kind: "rejected", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries when the request carried no temperature", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => unsupported());
    const result = await createOpenAiProvider(CONFIG, { fetch: fetchMock }).complete({
      messages: [{ role: "user", content: "x" }],
      maxOutputTokens: 10,
    });
    expect(result).toMatchObject({ ok: false, kind: "rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries an unrelated 400", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(`{"error":{"message":"Unknown model"}}`, { status: 400 }),
    );
    const result = await createOpenAiProvider(CONFIG, { fetch: fetchMock }).complete(REQUEST);
    expect(result).toMatchObject({ ok: false, kind: "rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createOpenAiProvider — honest failure mapping", () => {
  const run = async (respond: () => Response | Promise<Response>) =>
    createOpenAiProvider(CONFIG, { fetch: vi.fn<typeof fetch>(async () => respond()) }).complete(
      REQUEST,
    );

  it("429 is retryable rate_limited", async () => {
    expect(await run(() => new Response("", { status: 429 }))).toMatchObject({
      ok: false,
      kind: "rate_limited",
      retryable: true,
    });
  });

  it("5xx is retryable provider_error and never leaks the body", async () => {
    const result = await run(() => new Response("upstream stack trace", { status: 503 }));
    expect(result).toMatchObject({ ok: false, kind: "provider_error", retryable: true });
    expect((result as { message: string }).message).not.toContain("stack trace");
  });

  it("a context-window overflow is too_long, not a generic rejection", async () => {
    expect(
      await run(
        () =>
          new Response(
            `{"error":{"code":"context_length_exceeded","message":"maximum context length"}}`,
            { status: 400 },
          ),
      ),
    ).toMatchObject({ ok: false, kind: "too_long", retryable: false });
    expect(await run(() => new Response("", { status: 413 }))).toMatchObject({
      ok: false,
      kind: "too_long",
    });
  });

  it("401/403 name the credential problem so an operator can act", async () => {
    for (const status of [401, 403]) {
      const result = await run(() => new Response("", { status }));
      expect(result).toMatchObject({ ok: false, kind: "rejected", retryable: false });
      expect((result as { message: string }).message).toMatch(/API key/i);
    }
  });

  it("a content filter is content_filtered, not a fabricated answer", async () => {
    expect(await run(() => jsonResponse(completion("partial", "content_filter")))).toMatchObject({
      ok: false,
      kind: "content_filtered",
      retryable: false,
    });
  });

  it("a truncated answer fails as incomplete_output rather than publishing half a summary", async () => {
    const result = await run(() =>
      jsonResponse(completion("The document begins by explaining", "length")),
    );
    expect(result).toMatchObject({ ok: false, kind: "incomplete_output", retryable: false });
    // The partial text must not be handed back as if it were the answer.
    expect(result).not.toHaveProperty("text");
  });

  it("an unreadable or textless body is invalid_response", async () => {
    expect(
      await run(() => new Response("not json", { status: 200, headers: { "content-type": "application/json" } })),
    ).toMatchObject({ ok: false, kind: "invalid_response" });
    expect(await run(() => jsonResponse(completion("   ")))).toMatchObject({
      ok: false,
      kind: "invalid_response",
    });
    // `content: null` happens when a model returns only reasoning — not an answer.
    expect(
      await run(() => jsonResponse({ choices: [{ message: { content: null }, finish_reason: "stop" }] })),
    ).toMatchObject({ ok: false, kind: "invalid_response" });
  });

  it("an abort maps to timeout, any other network fault to provider_error", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const aborting = createOpenAiProvider(CONFIG, {
      fetch: vi.fn<typeof fetch>(async () => {
        throw abort;
      }),
    });
    expect(await aborting.complete(REQUEST)).toMatchObject({ ok: false, kind: "timeout", retryable: true });

    const offline = createOpenAiProvider(CONFIG, {
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(await offline.complete(REQUEST)).toMatchObject({
      ok: false,
      kind: "provider_error",
      retryable: true,
    });
  });
});
