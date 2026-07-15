/**
 * The provider-agnostic **AI completion abstraction** — the honest seam every
 * pdf.xyz AI tool (summarize, ai-extract, translate, chat) talks to instead of a
 * concrete vendor SDK.
 *
 * This is pure data + a tiny interface: no Next.js, no network, no Node built-ins,
 * so it can be reused unchanged by every AI engine and unit-tested with a
 * deterministic fake. A concrete implementation (today the Anthropic Messages API,
 * `./anthropic`) is constructed server-side ONLY, from a validated config that
 * holds the secret — the secret is never read, logged, serialized, or returned by
 * anything in this module.
 *
 * Honesty rules (load-bearing, mirrored across the worker layer):
 *  - A tool NEVER fabricates an AI answer. When no provider is configured the engine
 *    fails honestly as not-configured with operator requirements; it does not invent
 *    a summary/translation/extraction.
 *  - `complete()` returns REAL model output on success and a typed, content-free
 *    {@link AiCompletionFailure} otherwise — a rate limit, a timeout, or a refusal is
 *    surfaced as such, never smoothed over into a plausible-looking fake.
 *  - `capability()` is presence-only: it says whether a provider can run now and
 *    names only the provider *family* and public *model id* — never an API key,
 *    endpoint, org id, or any secret value.
 */

/** A single conversational turn handed to a provider. `content` is plain text. */
export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * A single completion request. Deliberately minimal and vendor-neutral: a system
 * instruction, an ordered message list (one turn for summarize/extract/translate,
 * many for chat), and the hard output/temperature bounds the caller chooses. The
 * caller owns prompt construction and grounding; the provider only runs it.
 */
export interface AiCompletionRequest {
  /** Optional system instruction that frames the task. */
  system?: string;
  /** Ordered turns; must be non-empty and end with a `user` turn. */
  messages: AiMessage[];
  /** Hard ceiling on generated tokens. Required so a run can never be unbounded. */
  maxOutputTokens: number;
  /** Sampling temperature in [0, 1]; defaults to the provider's choice when omitted. */
  temperature?: number;
}

/** Content-free token accounting a provider MAY report (never required). */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Why a completion did not produce usable text. Content-free and closed so a UI
 * and the job layer can branch without ever surfacing a raw upstream error string.
 *  - `not_configured` : no provider is wired (the honest default). Not retryable.
 *  - `rate_limited`   : the provider throttled the request. Retryable.
 *  - `timeout`        : the request exceeded the deadline. Retryable.
 *  - `content_filtered`: the provider refused to answer (safety). Not retryable.
 *  - `too_long`       : the input exceeded the model/window budget. Not retryable.
 *  - `invalid_response`: the provider replied in an unusable shape. Retryable.
 *  - `provider_error` : any other upstream failure. Retryable.
 */
export type AiFailureKind =
  | "not_configured"
  | "rate_limited"
  | "timeout"
  | "content_filtered"
  | "too_long"
  | "invalid_response"
  | "provider_error";

/** The kinds a retry of the identical request might clear. */
export const RETRYABLE_AI_FAILURES: readonly AiFailureKind[] = [
  "rate_limited",
  "timeout",
  "invalid_response",
  "provider_error",
];

export interface AiCompletionSuccess {
  ok: true;
  /** The model's real generated text (trimmed of surrounding whitespace). */
  text: string;
  /** Public model id that produced it (e.g. "claude-sonnet-5"). Never a secret. */
  model: string;
  /** Token accounting when the provider reported it; omitted otherwise. */
  usage?: AiUsage;
}

export interface AiCompletionFailure {
  ok: false;
  kind: AiFailureKind;
  /** A short, client-safe explanation. Never carries a raw upstream body or key. */
  message: string;
  /** True when retrying the identical request may succeed. Derived from `kind`. */
  retryable: boolean;
}

export type AiCompletionResult = AiCompletionSuccess | AiCompletionFailure;

/**
 * The honest, client-safe capability/status of an AI provider in this environment.
 * Presence-only: names the provider family and public model id, never a secret.
 */
export interface AiProviderCapability {
  /** Provider family id (e.g. "anthropic"). */
  id: string;
  /** True only when the provider can run a completion right now. */
  ready: boolean;
  /** Public model id the provider would use, or null when not configured. */
  model: string | null;
  /** One-line, client-safe explanation. Never a path, key, endpoint, or value. */
  detail: string;
}

/**
 * A configured AI completion provider. Constructed server-side from a validated
 * config; the object itself carries no secret in any enumerable field, so it is
 * safe to pass around the worker layer. `id`/`model` are public identifiers.
 */
export interface AiProvider {
  /** Provider family id (e.g. "anthropic"). Never a secret. */
  readonly id: string;
  /** Public model id this provider runs (e.g. "claude-sonnet-5"). Never a secret. */
  readonly model: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}

/** True when `kind` is one a retry of the identical request might clear. */
export function isRetryableAiFailure(kind: AiFailureKind): boolean {
  return RETRYABLE_AI_FAILURES.includes(kind);
}

/** Build a typed AI failure, deriving `retryable` from the kind so the two never drift. */
export function aiFailure(
  kind: AiFailureKind,
  message: string,
): AiCompletionFailure {
  return { ok: false, kind, message, retryable: isRetryableAiFailure(kind) };
}

/** The honest failure returned when no provider is wired — used by every AI engine. */
export const AI_NOT_CONFIGURED_MESSAGE =
  "No AI provider is configured on this worker. AI tools require an operator to set PDFXYZ_AI_PROVIDER and its API key (see docs/WORKER_ARCHITECTURE.md). No answer is fabricated when a provider is absent.";

/** A shared not-configured failure so every AI engine reports the absence identically. */
export function aiNotConfigured(): AiCompletionFailure {
  return aiFailure("not_configured", AI_NOT_CONFIGURED_MESSAGE);
}

/**
 * Validate a completion request shape before it ever reaches a provider: a
 * non-empty message list that ends with a `user` turn, every turn a non-empty
 * string, and a positive output-token bound. Pure; returns a short reason string
 * on failure so a caller can fail honestly rather than dispatch a doomed request.
 */
export function validateCompletionRequest(
  request: AiCompletionRequest,
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return { ok: false, reason: "A completion needs at least one message." };
  }
  for (const message of request.messages) {
    if (
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      message.content.trim().length === 0
    ) {
      return { ok: false, reason: "Every message must be a non-empty user/assistant turn." };
    }
  }
  if (request.messages[request.messages.length - 1]!.role !== "user") {
    return { ok: false, reason: "The final message must be a user turn." };
  }
  if (
    typeof request.maxOutputTokens !== "number" ||
    !Number.isInteger(request.maxOutputTokens) ||
    request.maxOutputTokens <= 0
  ) {
    return { ok: false, reason: "maxOutputTokens must be a positive integer." };
  }
  if (
    request.temperature !== undefined &&
    (typeof request.temperature !== "number" ||
      !Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 1)
  ) {
    return { ok: false, reason: "temperature must be a number in [0, 1]." };
  }
  return { ok: true };
}
