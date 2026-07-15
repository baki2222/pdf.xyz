import { describe, expect, it, vi } from "vitest";
import { AI_ENV } from "./config";
import { resolveAiProvider } from "./native";

const ENABLED = {
  [AI_ENV.provider]: "anthropic",
  [AI_ENV.apiKey]: "sk-live-KEY",
};

describe("resolveAiProvider", () => {
  it("returns null when AI is not configured (honest not-configured)", () => {
    expect(resolveAiProvider({})).toBeNull();
    expect(resolveAiProvider({ [AI_ENV.provider]: "anthropic" })).toBeNull();
  });

  it("returns null when misconfigured (unknown family)", () => {
    expect(resolveAiProvider({ [AI_ENV.provider]: "openai", [AI_ENV.apiKey]: "x" })).toBeNull();
  });

  it("builds a live Anthropic provider that carries the key only in its closure", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = resolveAiProvider(ENABLED, { fetch: fetchMock });
    expect(provider).not.toBeNull();
    expect(provider!.id).toBe("anthropic");
    // Key is not on the object...
    expect(JSON.stringify(provider)).not.toContain("sk-live-KEY");
    // ...but IS used on the wire.
    await provider!.complete({ messages: [{ role: "user", content: "x" }], maxOutputTokens: 50 });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-live-KEY");
  });
});
