/**
 * The **OpenAI** implementation of the {@link AiProvider} abstraction: a thin,
 * honest adapter over the Chat Completions API (`POST /v1/chat/completions`).
 *
 * It is the sibling of `./anthropic` and holds itself to exactly the same rules.
 * The adapter is constructed server-side ONLY from a validated config plus the API
 * key value. The key is captured in the `complete` closure and set on the
 * `Authorization` header — it is never stored on an enumerable field of the
 * returned provider, logged, or echoed into a failure message, so the object is
 * safe to pass around the worker layer. `fetch` is injectable, so the mapping
 * (request → Chat Completions body, response/error → typed
 * {@link AiCompletionResult}) is fully unit-testable without a real network or key.
 *
 * Honesty: every upstream outcome maps to a REAL success or a typed, content-free
 * failure — a 429 is `rate_limited`, an abort is `timeout`, a content filter is
 * `content_filtered`, a truncated answer is `incomplete_output`, an unusable body
 * is `invalid_response`. Nothing here fabricates model text when the call did not
 * produce it, and no upstream body is ever returned to the caller.
 *
 * Two API differences from the Anthropic adapter are load-bearing:
 *  - **`max_completion_tokens`, not `max_tokens`.** The GPT-5 family removed
 *    `max_tokens` from Chat Completions; sending it is rejected outright.
 *  - **The system instruction is a message, not a top-level field.** It is
 *    prepended as a `system` turn rather than sent alongside `messages`.
 *
 * Chat Completions is targeted rather than the Responses API because our request
 * shape (an ordered user/assistant transcript plus one system instruction) maps to
 * it one-to-one, so the adapter stays a translation layer with no state of its own.
 */

import {
  aiFailure,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiProvider,
  validateCompletionRequest,
} from "./provider";

/** The default OpenAI API origin; overridable for a proxy / self-host / gateway. */
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com";

/** Everything the provider needs to make a real call. `apiKey` never leaves the closure. */
export interface OpenAiProviderConfig {
  apiKey: string;
  /** Public model id (e.g. "gpt-5.6-luna"). */
  model: string;
  /** Optional `https:` origin override; defaults to {@link OPENAI_DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Request deadline in milliseconds. */
  timeoutMs: number;
}

/** Injectable seams so the adapter is testable without a real network or timer. */
export interface OpenAiProviderDeps {
  /** Override the fetch used for the API call (tests inject a fake). */
  fetch?: typeof fetch;
}

interface OpenAiChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
}
interface OpenAiResponseBody {
  choices?: unknown;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    /** Cache accounting; `cached_tokens` is the share of the prompt served from cache. */
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
}

/**
 * Does this 400 body say the model rejected `temperature` specifically?
 *
 * Reasoning-tier models in the GPT-5 family reject a non-default `temperature`
 * with `Unsupported parameter: 'temperature' is not supported with this model`,
 * while the chat-tier models in the same family accept it. Support is therefore a
 * per-model fact we cannot know from the model id alone, and guessing either way
 * is worse than detecting: always omitting it would silently discard the
 * determinism `ai-extract` and `chat-with-pdf` deliberately ask for (they pin
 * `temperature: 0`), and always sending it would hard-fail those tools on a
 * reasoning model.
 *
 * So the adapter sends it and, on exactly this error, retries once without it —
 * see {@link createOpenAiProvider}. Matching is deliberately narrow: it requires
 * both the unsupported/not-supported wording AND the parameter name, so an
 * unrelated 400 is never silently retried.
 */
export function isUnsupportedTemperatureError(rawBody: string): boolean {
  return (
    /unsupported[_ ]parameter|not supported with this model|unsupported value/i.test(rawBody) &&
    /temperature/i.test(rawBody)
  );
}

/**
 * Classify a 4xx that is not a 429. Every branch here is NON-retryable, so a
 * misclassification can only change the wording a user sees — never whether a doomed
 * request is replayed. That property is deliberate: it lets us read the upstream error
 * type/message to tell "your document is too long" apart from "your API key is wrong"
 * without making retry behaviour depend on an upstream string we do not control.
 *
 * The body is inspected ONLY to pick one of our own fixed messages; no upstream text is
 * ever returned to the caller. OpenAI reports a context-window overflow as a
 * `400 invalid_request_error` with code `context_length_exceeded` (413 is the separate
 * request-body-size limit), which is why the length check cannot key on the status alone.
 */
function classifyClientError(status: number, rawBody: string): AiCompletionResult {
  if (status === 413) {
    return aiFailure("too_long", "The document is too large for the AI model's context window.");
  }
  if (
    status === 400 &&
    /context_length_exceeded|maximum context length|too many tokens|reduce the length/i.test(rawBody)
  ) {
    return aiFailure("too_long", "The document is too large for the AI model's context window.");
  }
  if (status === 401 || status === 403) {
    return aiFailure(
      "rejected",
      "The AI provider rejected this worker's credentials. An operator must check the configured API key.",
    );
  }
  return aiFailure(
    "rejected",
    "The AI provider rejected the request. An operator must check the AI configuration.",
  );
}

/** The assistant text of the first choice, trimmed; empty when the shape is unusable. */
export function extractText(body: OpenAiResponseBody): string {
  if (!Array.isArray(body.choices)) return "";
  const first = (body.choices as OpenAiChoice[])[0];
  const content = first?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

/** The first choice's finish reason, or `undefined` when absent/unusable. */
function finishReason(body: OpenAiResponseBody): string | undefined {
  if (!Array.isArray(body.choices)) return undefined;
  const reason = (body.choices as OpenAiChoice[])[0]?.finish_reason;
  return typeof reason === "string" ? reason : undefined;
}

function coerceCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/**
 * Build the Chat Completions request body. The system instruction becomes a leading
 * `system` turn (OpenAI has no top-level system field), and the output ceiling uses
 * `max_completion_tokens` because the GPT-5 family removed `max_tokens`.
 * `temperature` is included only when the caller asked for one AND this attempt is
 * allowed to send it — see {@link isUnsupportedTemperatureError}.
 */
export function buildChatCompletionsBody(
  model: string,
  request: AiCompletionRequest,
  withTemperature: boolean,
): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  if (request.system !== undefined) {
    messages.push({ role: "system", content: request.system });
  }
  for (const message of request.messages) {
    messages.push({ role: message.role, content: message.content });
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    max_completion_tokens: request.maxOutputTokens,
  };
  if (withTemperature && request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  return body;
}

/**
 * Build a real OpenAI-backed {@link AiProvider}. The returned object exposes only
 * the public `id` ("openai") and `model`; the API key lives solely in the `complete`
 * closure. Every call validates the request shape first, then maps the Chat
 * Completions result to a typed success/failure — never a fabricated answer.
 */
export function createOpenAiProvider(
  config: OpenAiProviderConfig,
  deps: OpenAiProviderDeps = {},
): AiProvider {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const baseUrl = (config.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseUrl}/v1/chat/completions`;

  return {
    id: "openai",
    model: config.model,

    async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
      const valid = validateCompletionRequest(request);
      if (!valid.ok) return aiFailure("invalid_response", valid.reason);

      if (typeof doFetch !== "function") {
        return aiFailure("provider_error", "No fetch implementation is available on this worker.");
      }

      /**
       * One attempt. Returns a completed {@link AiCompletionResult}, or the sentinel
       * `"retry_without_temperature"` for the single, narrowly-matched compatibility
       * case. Each attempt gets its own deadline: the retry is a fresh request, so
       * charging it the remainder of the first attempt's budget would make an
       * otherwise-fine call fail on a slow first response.
       */
      const attempt = async (
        withTemperature: boolean,
      ): Promise<AiCompletionResult | "retry_without_temperature"> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);

        let response: Response;
        try {
          response = await doFetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(
              buildChatCompletionsBody(config.model, request, withTemperature),
            ),
            signal: controller.signal,
          });
        } catch (error) {
          const name = (error as { name?: string } | null)?.name;
          if (name === "AbortError" || name === "TimeoutError") {
            return aiFailure("timeout", "The AI provider did not respond before the deadline.");
          }
          return aiFailure("provider_error", "The AI provider could not be reached.");
        } finally {
          clearTimeout(timer);
        }

        if (response.status === 429) {
          return aiFailure(
            "rate_limited",
            "The AI provider is rate limiting requests. Try again shortly.",
          );
        }
        if (!response.ok) {
          // Server (5xx) errors are transient, so they stay retryable. Every 4xx is a
          // permanent rejection — a bad key, a revoked permission, an unknown model, an
          // over-long prompt — and is classified below so the job layer stops instead of
          // replaying a request that cannot succeed. Neither path leaks the upstream body.
          if (response.status >= 500) {
            return aiFailure("provider_error", "The AI provider returned a server error.");
          }
          let rawBody = "";
          try {
            rawBody = await response.text();
          } catch {
            rawBody = "";
          }
          if (
            withTemperature &&
            response.status === 400 &&
            isUnsupportedTemperatureError(rawBody)
          ) {
            return "retry_without_temperature";
          }
          return classifyClientError(response.status, rawBody);
        }

        let body: OpenAiResponseBody;
        try {
          body = (await response.json()) as OpenAiResponseBody;
        } catch {
          return aiFailure("invalid_response", "The AI provider returned an unreadable response.");
        }

        const reason = finishReason(body);
        if (reason === "content_filter") {
          return aiFailure("content_filtered", "The AI model declined to answer this request.");
        }

        // The model ran into its output ceiling and stopped mid-answer. There IS text
        // here, and returning it would look like a success — but a summary that stops
        // mid-sentence or a translation missing its final pages is a wrong answer, not a
        // short one. Fail honestly instead of letting a truncated artifact be published
        // as complete. (Mirrors the Anthropic adapter's `max_tokens` branch.)
        if (reason === "length") {
          return aiFailure(
            "incomplete_output",
            "The AI model reached its output limit before finishing, so the answer would have been cut off. Try a shorter document or a briefer output.",
          );
        }

        const text = extractText(body);
        if (text.length === 0) {
          return aiFailure("invalid_response", "The AI provider returned no text.");
        }

        const inputTokens = coerceCount(body.usage?.prompt_tokens);
        const outputTokens = coerceCount(body.usage?.completion_tokens);
        // OpenAI caches long prompt prefixes on its own — there is no request-side
        // parameter to set, which is why `AiCompletionRequest.cacheSystem` changes
        // nothing about the body this adapter sends. What the flag still buys here is
        // this reading: without it a caller has no way to tell a cached request from
        // an uncached one, and the caching bet stays unfalsifiable.
        //
        // The one thing that DOES matter on this side is ordering, and it is already
        // right: the system message carrying the document is built first and the
        // question last, so the stable span is a genuine prefix. Moving anything
        // volatile ahead of it would silently end the cache hits.
        const cachedInputTokens = coerceCount(body.usage?.prompt_tokens_details?.cached_tokens);
        const usage =
          inputTokens !== undefined && outputTokens !== undefined
            ? {
                inputTokens,
                outputTokens,
                ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
              }
            : undefined;

        return { ok: true, text, model: config.model, ...(usage ? { usage } : {}) };
      };

      const first = await attempt(request.temperature !== undefined);
      if (first !== "retry_without_temperature") return first;

      // Exactly one compatibility retry, and only for the narrowly-matched
      // "this model does not take temperature" 400. `attempt(false)` can never
      // return the sentinel again, so this cannot loop.
      const second = await attempt(false);
      return second === "retry_without_temperature"
        ? aiFailure(
            "rejected",
            "The AI provider rejected the request. An operator must check the AI configuration.",
          )
        : second;
    },
  };
}
