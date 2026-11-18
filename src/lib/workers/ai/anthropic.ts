/**
 * The **Anthropic** reference implementation of the {@link AiProvider} abstraction:
 * a thin, honest adapter over the Anthropic Messages API (`POST /v1/messages`).
 *
 * It is the one concrete provider this build ships, constructed server-side ONLY
 * from a validated config plus the API key value. The key is captured in the
 * `complete` closure and set on the `x-api-key` request header — it is never stored
 * on an enumerable field of the returned provider, logged, or echoed into a failure
 * message, so the object is safe to pass around the worker layer. `fetch` is
 * injectable, so the mapping (request → Anthropic body, response/error → typed
 * {@link AiCompletionResult}) is fully unit-testable without a real network call or key.
 *
 * Honesty: every upstream outcome maps to a REAL success or a typed, content-free
 * failure — a 429 is `rate_limited`, an abort is `timeout`, a refusal is
 * `content_filtered`, an unusable body is `invalid_response`. Nothing here ever
 * fabricates model text when the call did not produce it.
 */

import {
  aiFailure,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiProvider,
  type AiUsage,
  validateCompletionRequest,
} from "./provider";
import { toStrictJsonSchema } from "./structured-output";

/** The Anthropic API version pin the Messages API requires. */
export const ANTHROPIC_API_VERSION = "2023-06-01";
/** The default Anthropic API origin; overridable for a proxy / self-host. */
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

/** Everything the provider needs to make a real call. `apiKey` never leaves the closure. */
export interface AnthropicProviderConfig {
  apiKey: string;
  /** Public model id (e.g. "claude-sonnet-5"). */
  model: string;
  /** Optional `https:` origin override; defaults to {@link ANTHROPIC_DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Request deadline in milliseconds. */
  timeoutMs: number;
}

/** Injectable seams so the adapter is testable without a real network or timer. */
export interface AnthropicProviderDeps {
  /** Override the fetch used for the API call (tests inject a fake). */
  fetch?: typeof fetch;
}

interface AnthropicContentBlock {
  type?: unknown;
  text?: unknown;
}
interface AnthropicResponseBody {
  content?: unknown;
  stop_reason?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    /** Tokens billed at the cache-read rate; absent when nothing was cached. */
    cache_read_input_tokens?: unknown;
    /**
     * Tokens billed at the cache-WRITE rate — the premium paid to put a prompt
     * into the cache. Absent when nothing was written.
     *
     * Declared since 2026-08-11, and its absence was a live under-count: turn
     * one of every `cacheSystem` request is a cache write, so the entire
     * document landed here and nowhere we read. A 50-page document recorded as
     * 20 input tokens.
     */
    cache_creation_input_tokens?: unknown;
  };
}

/**
 * Does this 400 body say the model rejected the structured-output parameter?
 * A model without structured outputs, or a schema the API will not compile,
 * answers with an `invalid_request_error` naming `output_config` / the format
 * / the schema. The adapter then retries ONCE without the parameter, which is
 * the request the tool sent before structured output existed. A 400 costs
 * nothing, so the retry spends nothing extra. Narrow on purpose: the body
 * must name the parameter, so an over-long prompt is never retried.
 */
export function isAnthropicStructuredOutputRejection(rawBody: string): boolean {
  return /output_config|output_format|structured[ _-]?outputs?|json_schema/i.test(
    rawBody,
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
 * ever returned to the caller. Anthropic reports a context-window overflow as a plain
 * `400 invalid_request_error` (413 is the separate request-body-size limit), which is why
 * the length check cannot key on the status code alone.
 */
function classifyClientError(
  status: number,
  rawBody: string,
): AiCompletionResult {
  if (status === 413) {
    return aiFailure(
      "too_long",
      "The document is too large for the AI model's context window.",
    );
  }
  if (
    status === 400 &&
    /too long|exceed|maximum.*token|context window/i.test(rawBody)
  ) {
    return aiFailure(
      "too_long",
      "The document is too large for the AI model's context window.",
    );
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

/** Pull the concatenated text of every `text` block from a Messages API response. */
function extractText(body: AnthropicResponseBody): string {
  if (!Array.isArray(body.content)) return "";
  let text = "";
  for (const block of body.content as AnthropicContentBlock[]) {
    if (block && block.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }
  return text.trim();
}

function coerceCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/**
 * The token accounting a parsed Messages-API body reports, or `undefined`.
 *
 * Hoisted out of the success path so a FAILURE can carry it too. `input_tokens`
 * is the UNCACHED REMAINDER ONLY — the prompt total is
 * `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, billed
 * at three different rates (fresh, ~1.25x to write, ~0.1x to read), so reading
 * fewer than three makes a cached request look like a tiny one.
 *
 * `undefined` when the body carried no usable counts. That is a MEASUREMENT GAP,
 * never a free call, and every caller keeps it absent rather than zeroing it.
 */
function usageFrom(body: AnthropicResponseBody): AiUsage | undefined {
  const inputTokens = coerceCount(body.usage?.input_tokens);
  const outputTokens = coerceCount(body.usage?.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const cachedInputTokens = coerceCount(body.usage?.cache_read_input_tokens);
  const cacheWriteInputTokens = coerceCount(
    body.usage?.cache_creation_input_tokens,
  );
  return {
    inputTokens,
    outputTokens,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
  };
}

/**
 * Build the Messages API request body. Exported so a test can pin the wire
 * shape without a network. `output_config.format` is included only when the
 * request carries a `jsonSchema` AND this attempt may send it; without a
 * `jsonSchema` the body is exactly what it was before structured output.
 */
export function buildMessagesBody(
  model: string,
  request: AiCompletionRequest,
  withSchema = true,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    max_tokens: request.maxOutputTokens,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
  if (request.system !== undefined) {
    // Anthropic caches only what it is told to. `cache_control` marks the end of a
    // reusable prefix; the API hashes the bytes up to that point and a later
    // request whose prefix matches exactly is billed at roughly a tenth of the
    // input rate. Render order is tools -> system -> messages, so a marker on the
    // system block covers the whole document the caller framed the task with,
    // while the growing conversation stays after it and is priced normally.
    //
    // `ephemeral` is the 5-minute TTL. That is the right window here: it costs
    // ~1.25x to write (the 1-hour TTL costs 2x) and follow-up questions in a chat
    // arrive in seconds, not hours.
    //
    // Below roughly a thousand tokens the API declines to cache and says nothing —
    // no error, no field, just a request that quietly never gets cheaper. Only the
    // document makes the system prompt big enough to clear that bar; the fixed
    // instructions are a few lines and would never cache on their own.
    payload.system = request.cacheSystem
      ? [
          {
            type: "text",
            text: request.system,
            cache_control: { type: "ephemeral" },
          },
        ]
      : request.system;
  }
  if (request.temperature !== undefined)
    payload.temperature = request.temperature;
  if (withSchema && request.jsonSchema !== undefined) {
    // Structured outputs: the reply is decoded against the schema. Anthropic
    // needs every object closed; the strict form (shared with OpenAI) also
    // lists every property as required, optional ones nullable.
    payload.output_config = {
      format: {
        type: "json_schema",
        schema: toStrictJsonSchema(request.jsonSchema.schema),
      },
    };
  }
  return payload;
}

/**
 * Build a real Anthropic-backed {@link AiProvider}. The returned object exposes only
 * the public `id` ("anthropic") and `model`; the API key lives solely in the
 * `complete` closure. Every call validates the request shape first, then maps the
 * Messages API result to a typed success/failure — never a fabricated answer.
 */
export function createAnthropicProvider(
  config: AnthropicProviderConfig,
  deps: AnthropicProviderDeps = {},
): AiProvider {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const baseUrl = (config.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const endpoint = `${baseUrl}/v1/messages`;

  return {
    id: "anthropic",
    model: config.model,

    async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
      const valid = validateCompletionRequest(request);
      if (!valid.ok) return aiFailure("invalid_response", valid.reason);

      if (typeof doFetch !== "function") {
        return aiFailure(
          "provider_error",
          "No fetch implementation is available on this worker.",
        );
      }

      /**
       * One attempt, with or without the structured-output parameter. Returns a
       * completed result, or the sentinel for the one narrowly-matched case: a
       * 400 that names the parameter (see {@link isAnthropicStructuredOutputRejection}).
       */
      const attempt = async (
        withSchema: boolean,
      ): Promise<AiCompletionResult | "retry_without_schema"> => {
        const payload = buildMessagesBody(config.model, request, withSchema);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);

        let response: Response;
        try {
          response = await doFetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": config.apiKey,
              "anthropic-version": ANTHROPIC_API_VERSION,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } catch (error) {
          const name = (error as { name?: string } | null)?.name;
          if (name === "AbortError" || name === "TimeoutError") {
            return aiFailure(
              "timeout",
              "The AI provider did not respond before the deadline.",
            );
          }
          return aiFailure(
            "provider_error",
            "The AI provider could not be reached.",
          );
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
            return aiFailure(
              "provider_error",
              "The AI provider returned a server error.",
            );
          }
          let rawBody = "";
          try {
            rawBody = await response.text();
          } catch {
            rawBody = "";
          }
          if (
            withSchema &&
            response.status === 400 &&
            isAnthropicStructuredOutputRejection(rawBody)
          ) {
            return "retry_without_schema";
          }
          return classifyClientError(response.status, rawBody);
        }

        let body: AnthropicResponseBody;
        try {
          body = (await response.json()) as AnthropicResponseBody;
        } catch {
          return aiFailure(
            "invalid_response",
            "The AI provider returned an unreadable response.",
          );
        }

        // USAGE IS READ HERE, ABOVE THE FAILURE BRANCHES, and that placement is the
        // point. It used to be computed below them, so `max_tokens` — the branch
        // that exists BECAUSE the model spent its entire output budget — returned
        // with the counts sitting in scope, one expression from the `return`, and
        // dropped them. The most expensive outcome in the system recorded as free.
        const parsedUsage = usageFrom(body);

        if (body.stop_reason === "refusal") {
          return aiFailure(
            "content_filtered",
            "The AI model declined to answer this request.",
            parsedUsage,
          );
        }

        // The model ran into `max_tokens` and stopped mid-answer. There IS text here, and
        // returning it would look like a success — but a summary that stops mid-sentence or
        // a translation missing its final pages is a wrong answer, not a short one. Fail
        // honestly instead of letting a truncated artifact be published as complete.
        if (body.stop_reason === "max_tokens") {
          return aiFailure(
            "incomplete_output",
            "The AI model reached its output limit before finishing, so the answer would have been cut off. Try a shorter document or a briefer output.",
            parsedUsage,
          );
        }

        const text = extractText(body);
        if (text.length === 0) {
          return aiFailure(
            "invalid_response",
            "The AI provider returned no text.",
            parsedUsage,
          );
        }

        const usage = parsedUsage;

        return {
          ok: true,
          text,
          model: config.model,
          ...(usage ? { usage } : {}),
          ...(withSchema && request.jsonSchema !== undefined
            ? { jsonSchemaApplied: true as const }
            : {}),
        };
      };

      const first = await attempt(request.jsonSchema !== undefined);
      if (first !== "retry_without_schema") return first;
      // Exactly one retry, without the parameter: the request this tool sent
      // before structured output existed. `attempt(false)` cannot return the
      // sentinel, so this cannot loop.
      const second = await attempt(false);
      return second === "retry_without_schema"
        ? aiFailure(
            "rejected",
            "The AI provider rejected the request. An operator must check the AI configuration.",
          )
        : second;
    },
  };
}
