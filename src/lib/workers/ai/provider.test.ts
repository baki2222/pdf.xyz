import { describe, expect, it } from "vitest";
import {
  AI_NOT_CONFIGURED_MESSAGE,
  aiFailure,
  aiNotConfigured,
  isRetryableAiFailure,
  validateCompletionRequest,
  type AiCompletionRequest,
} from "./provider";

describe("aiFailure", () => {
  it("derives retryable from the kind so the two never drift", () => {
    expect(aiFailure("rate_limited", "slow down")).toEqual({
      ok: false,
      kind: "rate_limited",
      message: "slow down",
      retryable: true,
    });
    expect(aiFailure("content_filtered", "refused").retryable).toBe(false);
    expect(aiFailure("not_configured", "nope").retryable).toBe(false);
  });
});

describe("isRetryableAiFailure", () => {
  it("treats transient failures as retryable and terminal ones as not", () => {
    expect(isRetryableAiFailure("timeout")).toBe(true);
    expect(isRetryableAiFailure("provider_error")).toBe(true);
    expect(isRetryableAiFailure("invalid_response")).toBe(true);
    expect(isRetryableAiFailure("too_long")).toBe(false);
    expect(isRetryableAiFailure("content_filtered")).toBe(false);
  });
});

describe("aiNotConfigured", () => {
  it("is a non-retryable, honest not-configured failure naming the operator env", () => {
    const failure = aiNotConfigured();
    expect(failure.ok).toBe(false);
    expect(failure.kind).toBe("not_configured");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toBe(AI_NOT_CONFIGURED_MESSAGE);
    expect(failure.message).toContain("PDFXYZ_AI_PROVIDER");
  });
});

describe("validateCompletionRequest", () => {
  const base: AiCompletionRequest = {
    messages: [{ role: "user", content: "hello" }],
    maxOutputTokens: 100,
  };

  it("accepts a well-formed request", () => {
    expect(validateCompletionRequest(base)).toEqual({ ok: true });
  });

  it("rejects an empty message list", () => {
    expect(validateCompletionRequest({ ...base, messages: [] }).ok).toBe(false);
  });

  it("rejects a blank turn", () => {
    expect(
      validateCompletionRequest({
        ...base,
        messages: [{ role: "user", content: "   " }],
      }).ok,
    ).toBe(false);
  });

  it("requires the final turn to be a user turn", () => {
    expect(
      validateCompletionRequest({
        ...base,
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      }).ok,
    ).toBe(false);
  });

  it("requires a positive integer maxOutputTokens", () => {
    expect(validateCompletionRequest({ ...base, maxOutputTokens: 0 }).ok).toBe(
      false,
    );
    expect(
      validateCompletionRequest({ ...base, maxOutputTokens: 1.5 }).ok,
    ).toBe(false);
  });

  it("rejects an out-of-range temperature", () => {
    expect(validateCompletionRequest({ ...base, temperature: 2 }).ok).toBe(
      false,
    );
    expect(validateCompletionRequest({ ...base, temperature: -0.1 }).ok).toBe(
      false,
    );
    expect(validateCompletionRequest({ ...base, temperature: 0.5 }).ok).toBe(
      true,
    );
  });
});
