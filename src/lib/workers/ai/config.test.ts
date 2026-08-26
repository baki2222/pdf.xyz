import { describe, expect, it } from "vitest";
import {
  AI_ENV,
  DEFAULT_AI_MODEL,
  nativeAiCapability,
  resolveAiConfig,
  resolveAiDeclaration,
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
    const r = resolveAiConfig({
      [AI_ENV.provider]: "notaprovider",
      [AI_ENV.apiKey]: "x",
    });
    expect(r.enabled).toBe(false);
    if (!r.enabled) {
      expect(r.reason).toBe("invalid");
      expect(r.error?.field).toBe(AI_ENV.provider);
      // The offending VALUE is never echoed back — only the variable is named.
      expect(JSON.stringify(r)).not.toContain("notaprovider");
    }
  });

  it("enables the openai family with its own default model", () => {
    const r = resolveAiConfig({
      [AI_ENV.provider]: "openai",
      [AI_ENV.apiKey]: "sk-secret-VALUE",
    });
    expect(r.enabled).toBe(true);
    if (r.enabled) {
      expect(r.config.provider).toBe("openai");
      expect(r.config.model).toBe("gpt-5.6-luna");
      expect(r.config.hasApiKey).toBe(true);
      // Presence only — the key VALUE never reaches the resolved config.
      expect(JSON.stringify(r.config)).not.toContain("sk-secret-VALUE");
    }
  });

  it("accepts a model pin on either family, so switching models needs no code change", () => {
    for (const [provider, model] of [
      ["openai", "gpt-5.6-sol"],
      ["anthropic", "claude-opus-5"],
    ] as const) {
      const r = resolveAiConfig({
        [AI_ENV.provider]: provider,
        [AI_ENV.apiKey]: "k",
        [AI_ENV.model]: model,
      });
      expect(r.enabled).toBe(true);
      if (r.enabled) expect(r.config.model).toBe(model);
    }
  });

  it("enables with the family default model when only provider + key are set", () => {
    const r = resolveAiConfig({ ...ENABLED });
    expect(r.enabled).toBe(true);
    if (r.enabled) {
      expect(r.config.provider).toBe("anthropic");
      expect(r.config.model).toBe(DEFAULT_AI_MODEL.anthropic);
      expect(r.config.hasApiKey).toBe(true);
      // INVERTED 2026-08-25. This used to assert the resolved config carried
      // `maxOutputTokens: AI_MAX_OUTPUT_TOKENS_BOUNDS.default` — true, and
      // true about a field NOTHING read: no native.ts ever passed it into an
      // engine's limits. The assertion made an inert knob look wired, which is
      // how it survived. The knob is deleted; this pins its absence so a future
      // "resolve it now, consume it later" cannot re-enter quietly.
      expect(r.config).not.toHaveProperty("maxOutputTokens");
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
    const ok = resolveAiConfig({
      ...ENABLED,
      [AI_ENV.model]: "claude-opus-4-8",
    });
    expect(ok.enabled && ok.config.model).toBe("claude-opus-4-8");

    const bad = resolveAiConfig({ ...ENABLED, [AI_ENV.model]: "bad model!" });
    expect(bad.enabled).toBe(false);
    if (!bad.enabled) expect(bad.error?.field).toBe(AI_ENV.model);
  });

  it("accepts an https base URL and rejects a non-https one", () => {
    const ok = resolveAiConfig({
      ...ENABLED,
      [AI_ENV.baseUrl]: "https://proxy.example/v1/",
    });
    expect(ok.enabled && ok.config.baseUrl).toBe("https://proxy.example/v1");

    const bad = resolveAiConfig({
      ...ENABLED,
      [AI_ENV.baseUrl]: "http://insecure.example",
    });
    expect(bad.enabled).toBe(false);
    if (!bad.enabled) expect(bad.error?.field).toBe(AI_ENV.baseUrl);
  });

  it("clamps out-of-range numeric bounds to an invalid config, naming the variable", () => {
    // RETARGETED 2026-08-25, from PDFXYZ_AI_MAX_OUTPUT_TOKENS to the timeout.
    // The bounds check itself is worth keeping — a misconfigured deployment
    // must fail loudly and be told which variable — but it was demonstrated on
    // the ONE variable whose value nothing consumed, so the only thing that
    // knob could still do was break a boot. `timeoutMs` is read on every
    // provider call (native.ts `shared`), so this now exercises the rule on a
    // variable that matters.
    const r = resolveAiConfig({
      ...ENABLED,
      [AI_ENV.timeoutMs]: "999999999",
    });
    expect(r.enabled).toBe(false);
    if (!r.enabled) {
      expect(r.reason).toBe("invalid");
      expect(r.error?.field).toBe(AI_ENV.timeoutMs);
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
    expect(JSON.stringify(cap)).not.toContain(
      "sk-secret-value-never-read-here",
    );
  });
});

describe("resolveAiDeclaration", () => {
  it("is absent when the family switch is unset", () => {
    expect(resolveAiDeclaration({})).toEqual({ state: "absent" });
  });

  it("declares a family WITHOUT requiring the API key", () => {
    // The whole point: the web tier holds no secret but must still know whether
    // this deployment runs AI at all.
    const declaration = resolveAiDeclaration({
      [AI_ENV.provider]: "anthropic",
    });
    expect(declaration).toEqual({
      state: "declared",
      provider: "anthropic",
      model: DEFAULT_AI_MODEL.anthropic,
    });
  });

  it("agrees with resolveAiConfig on the resolved public model id", () => {
    const env = { ...ENABLED, [AI_ENV.model]: "claude-opus-5" };
    const config = resolveAiConfig(env);
    const declaration = resolveAiDeclaration(env);
    expect(config.enabled).toBe(true);
    expect(declaration.state).toBe("declared");
    if (config.enabled && declaration.state === "declared") {
      expect(declaration.model).toBe(config.config.model);
      expect(declaration.provider).toBe(config.config.provider);
    }
  });

  it("rejects an unknown family, naming the variable and not its value", () => {
    const declaration = resolveAiDeclaration({
      [AI_ENV.provider]: "totally-made-up",
    });
    expect(declaration.state).toBe("invalid");
    if (declaration.state === "invalid") {
      expect(declaration.error.field).toBe(AI_ENV.provider);
      expect(declaration.error.message).not.toContain("totally-made-up");
    }
  });

  it("rejects a malformed model override", () => {
    const declaration = resolveAiDeclaration({
      [AI_ENV.provider]: "anthropic",
      [AI_ENV.model]: "NOT A TOKEN",
    });
    expect(declaration.state).toBe("invalid");
    if (declaration.state === "invalid") {
      expect(declaration.error.field).toBe(AI_ENV.model);
    }
  });

  it("never reads the API key, so its presence cannot change the result", () => {
    const withoutKey = resolveAiDeclaration({ [AI_ENV.provider]: "anthropic" });
    const withKey = resolveAiDeclaration({ ...ENABLED });
    expect(withKey).toEqual(withoutKey);
  });
});
