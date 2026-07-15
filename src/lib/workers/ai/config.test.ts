import { describe, expect, it } from "vitest";
import {
  AI_ENV,
  AI_MAX_OUTPUT_TOKENS_BOUNDS,
  DEFAULT_AI_MODEL,
  nativeAiCapability,
  resolveAiConfig,
} from "./config";

const ENABLED = {
  [AI_ENV.provider]: "anthropic",
  [AI_ENV.apiKey]: "sk-secret-value-never-read-here",
} as const;

describe("resolveAiConfig", () => {
  it("is not_configured when the provider switch is unset (the safe default)", () => {
    const r = resolveAiConfig({});
    expect(r.enabled).toBe(false);
    if (!r.enabled) expect(r.reason).toBe("not_configured");
  });

  it("is missing_api_key when a family is named without a key", () => {
    const r = resolveAiConfig({ [AI_ENV.provider]: "anthropic" });
    expect(r.enabled).toBe(false);
    if (!r.enabled) {
      expect(r.reason).toBe("missing_api_key");
      expect(r.error?.field).toBe(AI_ENV.apiKey);
    }
  });

  it("rejects an unknown provider family (invalid, naming the variable not the value)", () => {
    const r = resolveAiConfig({ [AI_ENV.provider]: "openai", [AI_ENV.apiKey]: "x" });
    expect(r.enabled).toBe(false);
    if (!r.enabled) {
      expect(r.reason).toBe("invalid");
      expect(r.error?.field).toBe(AI_ENV.provider);
    }
  });

  it("enables with the family default model when only provider + key are set", () => {
    const r = resolveAiConfig({ ...ENABLED });
    expect(r.enabled).toBe(true);
    if (r.enabled) {
      expect(r.config.provider).toBe("anthropic");
      expect(r.config.model).toBe(DEFAULT_AI_MODEL.anthropic);
      expect(r.config.hasApiKey).toBe(true);
      expect(r.config.maxOutputTokens).toBe(AI_MAX_OUTPUT_TOKENS_BOUNDS.default);
    }
  });

  it("NEVER copies the API key value into the resolved config", () => {
    const r = resolveAiConfig({ ...ENABLED });
    expect(r.enabled).toBe(true);
    if (r.enabled) {
      const serialized = JSON.stringify(r.config);
      expect(serialized).not.toContain("sk-secret-value-never-read-here");
    }
  });

  it("honors a shape-safe model override and rejects a malformed one", () => {
    const ok = resolveAiConfig({ ...ENABLED, [AI_ENV.model]: "claude-opus-4-8" });
    expect(ok.enabled && ok.config.model).toBe("claude-opus-4-8");

    const bad = resolveAiConfig({ ...ENABLED, [AI_ENV.model]: "bad model!" });
    expect(bad.enabled).toBe(false);
    if (!bad.enabled) expect(bad.error?.field).toBe(AI_ENV.model);
  });

  it("accepts an https base URL and rejects a non-https one", () => {
    const ok = resolveAiConfig({ ...ENABLED, [AI_ENV.baseUrl]: "https://proxy.example/v1/" });
    expect(ok.enabled && ok.config.baseUrl).toBe("https://proxy.example/v1");

    const bad = resolveAiConfig({ ...ENABLED, [AI_ENV.baseUrl]: "http://insecure.example" });
    expect(bad.enabled).toBe(false);
    if (!bad.enabled) expect(bad.error?.field).toBe(AI_ENV.baseUrl);
  });

  it("clamps out-of-range numeric bounds to an invalid config, naming the variable", () => {
    const r = resolveAiConfig({ ...ENABLED, [AI_ENV.maxOutputTokens]: "999999" });
    expect(r.enabled).toBe(false);
    if (!r.enabled) {
      expect(r.reason).toBe("invalid");
      expect(r.error?.field).toBe(AI_ENV.maxOutputTokens);
    }
  });
});

describe("nativeAiCapability", () => {
  it("reports not-ready with a null model and no secret when disabled", () => {
    const cap = nativeAiCapability({});
    expect(cap.ready).toBe(false);
    expect(cap.model).toBeNull();
    expect(cap.detail).toContain(AI_ENV.provider);
  });

  it("reports ready with the family + public model when enabled, never the key", () => {
    const cap = nativeAiCapability({ ...ENABLED });
    expect(cap.ready).toBe(true);
    expect(cap.id).toBe("anthropic");
    expect(cap.model).toBe(DEFAULT_AI_MODEL.anthropic);
    expect(JSON.stringify(cap)).not.toContain("sk-secret-value-never-read-here");
  });
});
