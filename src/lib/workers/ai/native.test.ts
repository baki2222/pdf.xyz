import { describe, expect, it, vi } from "vitest";
import { AI_ENV } from "./config";
import { resolveAiProvider } from "./native";

const ANTHROPIC = {
  [AI_ENV.provider]: "anthropic",
  [AI_ENV.apiKey]: "sk-live-KEY",
};
const OPENAI = {
  [AI_ENV.provider]: "openai",
  [AI_ENV.apiKey]: "sk-live-KEY",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("resolveAiProvider", () => {
  it("returns null when AI is not configured (honest not-configured)", () => {
    expect(resolveAiProvider({})).toBeNull();
    expect(resolveAiProvider({ [AI_ENV.provider]: "anthropic" })).toBeNull();
    expect(resolveAiProvider({ [AI_ENV.provider]: "openai" })).toBeNull();
  });

  it("returns null for a family this build cannot drive", () => {
    expect(
      resolveAiProvider({ [AI_ENV.provider]: "notaprovider", [AI_ENV.apiKey]: "x" }),
    ).toBeNull();
  });

  it("builds a live Anthropic provider that carries the key only in its closure", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }),
    );
    const provider = resolveAiProvider(ANTHROPIC, { fetch: fetchMock });
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("anthropic");
    // Key is not on the object...
    expect(JSON.stringify(provider)).not.toContain("sk-live-KEY");
    // ...but IS used on the wire.
    await provider!.complete({ messages: [{ role: "user", content: "x" }], maxOutputTokens: 50 });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-live-KEY");
  });

  it("builds a live OpenAI provider that carries the key only in its closure", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }),
    );
    const provider = resolveAiProvider(OPENAI, { fetch: fetchMock });
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("openai");
    expect(provider!.model).toBe("gpt-5.6-luna");
    expect(JSON.stringify(provider)).not.toContain("sk-live-KEY");

    await provider!.complete({ messages: [{ role: "user", content: "x" }], maxOutputTokens: 50 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-live-KEY");
  });

  it("routes to the family the environment names, not a hardcoded default", () => {
    expect(resolveAiProvider(ANTHROPIC, { fetch: vi.fn() })!.id).toBe("anthropic");
    expect(resolveAiProvider(OPENAI, { fetch: vi.fn() })!.id).toBe("openai");
  });

  it("passes a base-URL override through to whichever family is selected", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }),
    );
    const provider = resolveAiProvider(
      { ...OPENAI, [AI_ENV.baseUrl]: "https://gateway.example.com" },
      { fetch: fetchMock },
    );
    await provider!.complete({ messages: [{ role: "user", content: "x" }], maxOutputTokens: 50 });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://gateway.example.com/v1/chat/completions");
  });
});
