/**
 * Server-side configuration for the **AI completion provider** — parsed from the
 * environment, validated for presence and shape only.
 *
 * This is the AI analogue of `../ocr-native-config.ts`: a node-free leaf that turns
 * environment variables into a typed, bounded {@link AiConfig} the Node-only provider
 * (`./anthropic`, wired in `./native`) consumes, and a presence-only
 * {@link AiProviderCapability} the operator tooling and the client UI can surface
 * without ever exposing the API key, endpoint, or any secret value.
 *
 * Security & honesty posture (the load-bearing rules of this module):
 *  - AI tools call an external model, so they are **opt-in**: with nothing declared
 *    the provider is *disabled* and every AI tool stays honestly not-configured. A
 *    provider is enabled only when BOTH the family switch (`PDFXYZ_AI_PROVIDER`) and
 *    its API key (`PDFXYZ_AI_API_KEY`) are present — the same "all pieces or none"
 *    rule the worker backend uses.
 *  - This module reads the API key's **presence only** — it never copies the secret
 *    into the returned config, a variable, a log line, or the client capability. The
 *    one place the key value is read is the Node provider in `./native`, server-side.
 *  - A model or base-URL override is accepted only when it is shape-safe (a bounded
 *    model token; an `https:` URL). A parse failure names the offending **variable**
 *    (never its value) and falls back to a safe *disabled* config, so a
 *    half-configured provider is honestly off rather than half-on.
 *  - Every bound (timeout, max output tokens) is clamped to a hard ceiling so a
 *    misconfigured deployment can never ask for unbounded generation.
 */

import type { FieldError } from "@/lib/jobs";
import type { AiProviderCapability } from "./provider";

type EnvSource = Record<string, string | undefined>;

/** The AI provider families this build knows how to drive. */
export const AI_PROVIDER_FAMILIES = ["anthropic", "openai"] as const;
export type AiProviderFamily = (typeof AI_PROVIDER_FAMILIES)[number];

const AI_PROVIDER_FAMILY_SET: ReadonlySet<string> = new Set(
  AI_PROVIDER_FAMILIES,
);

/**
 * Default public model id per provider family, used when `PDFXYZ_AI_MODEL` is
 * unset. Each is the cost-effective tier for this workload — the AI tools run
 * summarization, translation, extraction, and document QA over already-extracted
 * text, not frontier reasoning. Pinning the model to an environment variable is
 * deliberate: moving to a larger model in the same family is an env change on both
 * tiers, never a code change or a redeploy.
 */
export const DEFAULT_AI_MODEL: Record<AiProviderFamily, string> = {
  // Dormant but deliberately kept: a family default is a lookup value, not a
  // claim — it activates only if an operator selects the family. Production
  // selects `openai` (owner decision, confirmed 2026-08-10).
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.6-luna",
};

/** The environment variables this provider reads (names only; never values). */
export const AI_ENV = {
  /** Master opt-in switch: the provider family (e.g. `openai`). Unset ⇒ disabled. */
  provider: "PDFXYZ_AI_PROVIDER",
  /** The provider API key. Presence gates readiness; its VALUE is read only in ./native. */
  apiKey: "PDFXYZ_AI_API_KEY",
  /** Pin the public model id; unset ⇒ the family default. */
  model: "PDFXYZ_AI_MODEL",
  /** Optional `https:` endpoint override (a proxy / self-host). Non-secret. */
  baseUrl: "PDFXYZ_AI_BASE_URL",
  timeoutMs: "PDFXYZ_AI_TIMEOUT_MS",
} as const;

/** Hard bounds so a misconfigured deployment can never ask for unbounded work. */
export const AI_TIMEOUT_MS_BOUNDS = {
  min: 1_000,
  max: 600_000, // 10 min — a generous ceiling for a long document completion.
  default: 120_000, // 2 min.
} as const;

/** A shape-safe model token: lowercase alphanumerics, dots, and hyphens; bounded. */
const MODEL_TOKEN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/**
 * Parse the provider-family switch. Key-free and order-independent, so both the
 * full config resolver and the key-free {@link resolveAiDeclaration} share exactly
 * one notion of "which families exist". Names only the variable, never its value.
 */
function parseProviderFamily(
  env: EnvSource,
):
  | { state: "absent" }
  | { state: "ok"; family: AiProviderFamily }
  | { state: "invalid"; error: FieldError } {
  const raw = env[AI_ENV.provider];
  if (!present(raw)) return { state: "absent" };
  const provider = raw.trim().toLowerCase();
  if (!AI_PROVIDER_FAMILY_SET.has(provider)) {
    return {
      state: "invalid",
      error: fieldError(
        AI_ENV.provider,
        `must be one of ${AI_PROVIDER_FAMILIES.join(", ")}.`,
      ),
    };
  }
  return { state: "ok", family: provider as AiProviderFamily };
}

/**
 * Resolve the public model id for a family: the optional `PDFXYZ_AI_MODEL`
 * override when it is a shape-safe token, else the family default. Key-free and
 * shared with {@link resolveAiDeclaration}. Names only the variable, never its value.
 */
function parseModel(
  env: EnvSource,
  family: AiProviderFamily,
): { ok: true; model: string } | { ok: false; error: FieldError } {
  const raw = env[AI_ENV.model];
  if (!present(raw)) return { ok: true, model: DEFAULT_AI_MODEL[family] };
  const token = raw.trim().toLowerCase();
  if (!MODEL_TOKEN.test(token)) {
    return {
      ok: false,
      error: fieldError(AI_ENV.model, "must be a bounded model id token."),
    };
  }
  return { ok: true, model: token };
}

/**
 * A validated AI configuration — presence + shape only. It carries the public
 * provider family, the resolved public model id, an optional non-secret base URL,
 * and the bounded limits. It deliberately does NOT carry the API key: `hasApiKey`
 * records only that one is present; the value is read separately, server-side, in
 * `./native`.
 */
export interface AiConfig {
  provider: AiProviderFamily;
  /** Public model id (family default unless `PDFXYZ_AI_MODEL` overrides it). */
  model: string;
  /** Optional `https:` endpoint override; absent ⇒ the provider's default endpoint. */
  baseUrl?: string;
  /** True only when the API-key variable is present and non-empty. */
  hasApiKey: boolean;
  timeoutMs: number;
}

/** The resolved AI configuration state — a validated config, or an honest reason it is off. */
export type AiConfigResolution =
  | { enabled: true; config: AiConfig }
  | { enabled: false; reason: AiDisabledReason; error?: FieldError };

/**
 * Why the AI provider is not enabled. Content-free and closed:
 *  - `not_configured`: the family switch (`PDFXYZ_AI_PROVIDER`) is unset — the safe default.
 *  - `missing_api_key`: a family is named, but its API key is absent — half-configured.
 *  - `invalid`: a variable is present but malformed (shape/bounds). See `error`.
 */
export type AiDisabledReason = "not_configured" | "missing_api_key" | "invalid";

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fieldError(variable: string, message: string): FieldError {
  return { field: variable, message };
}

/** Parse a bounded positive integer env var; returns the default when unset, or a field error. */
function parseBoundedInt(
  raw: string | undefined,
  variable: string,
  bounds: { min: number; max: number; default: number },
): { ok: true; value: number } | { ok: false; error: FieldError } {
  if (!present(raw)) return { ok: true, value: bounds.default };
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    return {
      ok: false,
      error: fieldError(
        variable,
        `must be an integer in [${bounds.min}, ${bounds.max}].`,
      ),
    };
  }
  return { ok: true, value };
}

/**
 * Resolve the AI provider configuration from an environment. Presence + shape only:
 * it never reads the API key value. Returns `enabled: false` with an honest reason
 * when the family switch is unset (`not_configured`), a family is named without a key
 * (`missing_api_key`), or any variable is malformed (`invalid`, naming the offending
 * variable — never its value). `env` is injectable for deterministic tests.
 */
export function resolveAiConfig(
  env: EnvSource = process.env,
): AiConfigResolution {
  const parsedFamily = parseProviderFamily(env);
  if (parsedFamily.state === "absent") {
    return { enabled: false, reason: "not_configured" };
  }
  if (parsedFamily.state === "invalid") {
    return { enabled: false, reason: "invalid", error: parsedFamily.error };
  }
  const family = parsedFamily.family;

  // Key presence is checked before the remaining shape parsing so a deployment
  // that names a family without a key reports the actionable `missing_api_key`
  // rather than a downstream shape complaint.
  const hasApiKey = present(env[AI_ENV.apiKey]);
  if (!hasApiKey) {
    return {
      enabled: false,
      reason: "missing_api_key",
      error: fieldError(
        AI_ENV.apiKey,
        "is required to enable the AI provider.",
      ),
    };
  }

  const parsedModel = parseModel(env, family);
  if (!parsedModel.ok) {
    return { enabled: false, reason: "invalid", error: parsedModel.error };
  }
  const model = parsedModel.model;

  let baseUrl: string | undefined;
  const rawBaseUrl = env[AI_ENV.baseUrl];
  if (present(rawBaseUrl)) {
    const trimmed = rawBaseUrl.trim();
    let parsed: URL | undefined;
    try {
      parsed = new URL(trimmed);
    } catch {
      parsed = undefined;
    }
    if (!parsed || parsed.protocol !== "https:") {
      return {
        enabled: false,
        reason: "invalid",
        error: fieldError(AI_ENV.baseUrl, "must be an https URL."),
      };
    }
    baseUrl = trimmed.replace(/\/+$/, "");
  }

  const timeout = parseBoundedInt(
    env[AI_ENV.timeoutMs],
    AI_ENV.timeoutMs,
    AI_TIMEOUT_MS_BOUNDS,
  );
  if (!timeout.ok)
    return { enabled: false, reason: "invalid", error: timeout.error };

  return {
    enabled: true,
    config: {
      provider: family,
      model,
      ...(baseUrl ? { baseUrl } : {}),
      hasApiKey: true,
      timeoutMs: timeout.value,
    },
  };
}

/**
 * The **key-free** view of the AI configuration: which provider family and public
 * model id this deployment declares, with no opinion on whether an API key is
 * present in *this* process.
 *
 * This exists because the API key is deliberately NOT deployed to the web tier —
 * only the out-of-band worker that actually calls the model holds it (see
 * `docker-compose.worker.yml`: the web service "needs no worker secrets"). The web
 * app still has to decide, up front, whether to offer an AI tool at all, so it
 * reads the non-secret family switch alone. `PDFXYZ_AI_PROVIDER` and
 * `PDFXYZ_AI_MODEL` are both public identifiers, safe to set on both tiers.
 */
export type AiDeclaration =
  | { state: "absent" }
  | { state: "declared"; provider: AiProviderFamily; model: string }
  | { state: "invalid"; error: FieldError };

/**
 * Resolve the key-free {@link AiDeclaration} from an environment. Reads ONLY the
 * two non-secret variables (`PDFXYZ_AI_PROVIDER`, `PDFXYZ_AI_MODEL`) and never
 * touches the API key, so it is safe to evaluate in a process that holds no
 * secret. `env` is injectable for deterministic tests.
 */
export function resolveAiDeclaration(
  env: EnvSource = process.env,
): AiDeclaration {
  const family = parseProviderFamily(env);
  if (family.state === "absent") return { state: "absent" };
  if (family.state === "invalid")
    return { state: "invalid", error: family.error };

  const model = parseModel(env, family.family);
  if (!model.ok) return { state: "invalid", error: model.error };

  return { state: "declared", provider: family.family, model: model.model };
}

/** One-line, client-safe explanation for each disabled reason. Never names a value. */
function disabledDetail(
  resolution: Extract<AiConfigResolution, { enabled: false }>,
): string {
  switch (resolution.reason) {
    case "not_configured":
      return `AI is not configured. An operator enables it by setting ${AI_ENV.provider} (one of ${AI_PROVIDER_FAMILIES.join(", ")}) and ${AI_ENV.apiKey}.`;
    case "missing_api_key":
      return `An AI provider family is selected, but ${AI_ENV.apiKey} is not set, so AI stays disabled.`;
    case "invalid":
      return `The AI configuration is invalid (${resolution.error?.field ?? "a variable"} ${resolution.error?.message ?? "is malformed"}), so AI stays disabled.`;
  }
}

/**
 * Build the presence-only {@link AiProviderCapability} for status/UI from an
 * environment. Names only the provider family and public model id when enabled;
 * never the API key, endpoint, or any value. `ready` here reflects a valid,
 * key-present CONFIG — the wired provider's `capability()` is the runtime truth,
 * but this lets the config layer report the four honest states on its own.
 */
export function nativeAiCapability(
  env: EnvSource = process.env,
): AiProviderCapability {
  const resolution = resolveAiConfig(env);
  if (resolution.enabled) {
    return {
      id: resolution.config.provider,
      ready: true,
      model: resolution.config.model,
      detail: `AI is configured with the ${resolution.config.provider} provider (model ${resolution.config.model}).`,
    };
  }
  return {
    id: "ai",
    ready: false,
    model: null,
    detail: disabledDetail(resolution),
  };
}
