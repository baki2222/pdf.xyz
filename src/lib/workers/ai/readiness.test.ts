import { describe, expect, it } from "vitest";
import { AI_ENV } from "./config";
import { resolveAiReadiness } from "./readiness";

/** A key value never leaves this file; it exists only to prove presence handling. */
const FAKE_KEY = "sk-ant-EXAMPLE-not-a-real-key-0000000000";

describe("resolveAiReadiness", () => {
  it("is not ready and honestly explains itself with nothing declared", () => {
    const readiness = resolveAiReadiness({});
    expect(readiness.ready).toBe(false);
    expect(readiness.declared).toBe(false);
    expect(readiness.provider).toBeNull();
    expect(readiness.model).toBeNull();
    expect(readiness.configuredHere).toBe(false);
    expect(readiness.detail).toMatch(/no ai provider is declared/i);
    // Actionable without naming a variable: this detail is serialized to clients,
    // which by invariant carry no `PDFXYZ_` names. It must still tell an operator
    // what to do — declare a family, give the worker a key.
    expect(readiness.detail).toMatch(/anthropic/);
    expect(readiness.detail).toMatch(/api key/i);
    expect(readiness.detail).toMatch(/secure worker/i);
  });

  it("is ready from the family switch alone, with no key in this process", () => {
    // This is the correct production web tier: it declares AI but holds no secret.
    const readiness = resolveAiReadiness({ [AI_ENV.provider]: "anthropic" });
    expect(readiness.ready).toBe(true);
    expect(readiness.declared).toBe(true);
    expect(readiness.provider).toBe("anthropic");
    expect(readiness.model).toBe("claude-sonnet-5");
    expect(readiness.configuredHere).toBe(false);
    // It must not imply a verified key; it must say the worker holds it.
    expect(readiness.detail).toMatch(/out-of-band secure worker/i);
    expect(readiness.detail).toMatch(/not observable/i);
  });

  it("reports configuredHere on a tier that holds the whole config", () => {
    const readiness = resolveAiReadiness({
      [AI_ENV.provider]: "anthropic",
      [AI_ENV.apiKey]: FAKE_KEY,
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.configuredHere).toBe(true);
    expect(readiness.detail).toMatch(/configured in this process/i);
  });

  it("carries a pinned public model id into the readiness", () => {
    const readiness = resolveAiReadiness({
      [AI_ENV.provider]: "anthropic",
      [AI_ENV.model]: "claude-opus-5",
    });
    expect(readiness.model).toBe("claude-opus-5");
    expect(readiness.detail).toContain("claude-opus-5");
  });

  it("is honestly off — not half-on — for an unknown provider family", () => {
    const readiness = resolveAiReadiness({ [AI_ENV.provider]: "not-a-vendor" });
    expect(readiness.ready).toBe(false);
    expect(readiness.declared).toBe(false);
    expect(readiness.detail).toMatch(/invalid/i);
    // The offending setting is identified by its human name, not its variable.
    expect(readiness.detail).toContain("the AI provider family");
  });

  it("is honestly off for a malformed model override, naming the setting", () => {
    const readiness = resolveAiReadiness({
      [AI_ENV.provider]: "anthropic",
      [AI_ENV.model]: "not a valid token!",
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.detail).toContain("the AI model id");
    // Pointing at the setting is required; echoing its value is not.
    expect(readiness.detail).not.toContain("not a valid token!");
  });

  it("never leaks the API key into any field, even when fully configured", () => {
    const readiness = resolveAiReadiness({
      [AI_ENV.provider]: "anthropic",
      [AI_ENV.apiKey]: FAKE_KEY,
      [AI_ENV.baseUrl]: "https://proxy.internal.example",
    });
    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain(FAKE_KEY);
    // The endpoint is non-secret but still has no business in a client payload.
    expect(serialized).not.toContain("proxy.internal.example");
  });

  it("never names an environment variable, in any state", () => {
    // This readiness is serialized into the client-facing worker status, which
    // must carry no `PDFXYZ_` names (../deploy/honesty.test.ts). Guard it here too,
    // so a regression fails in the module that owns the wording.
    const envs = [
      {},
      { [AI_ENV.provider]: "anthropic" },
      { [AI_ENV.provider]: "anthropic", [AI_ENV.apiKey]: FAKE_KEY },
      { [AI_ENV.provider]: "not-a-vendor" },
      { [AI_ENV.provider]: "anthropic", [AI_ENV.model]: "not a valid token!" },
    ];
    for (const env of envs) {
      expect(JSON.stringify(resolveAiReadiness(env))).not.toMatch(/PDFXYZ_/);
    }
  });

  it("stays keyless-ready even when an invalid key-adjacent bound is set", () => {
    // A malformed *bound* disables the full config, but the declaration itself is
    // still valid, so the web tier keeps offering the tool and the worker fails
    // honestly if its own config is broken.
    const readiness = resolveAiReadiness({
      [AI_ENV.provider]: "anthropic",
      [AI_ENV.apiKey]: FAKE_KEY,
      [AI_ENV.timeoutMs]: "-5",
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.configuredHere).toBe(false);
  });
});
