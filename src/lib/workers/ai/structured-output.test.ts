// @vitest-environment node
/**
 * Structured output: the schema subset, the strict transform, and what each
 * adapter puts on the wire - proved against mocked HTTP bodies, never a real
 * call. The engine's side (AI Extract) is `../ai-extract/strict-json.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EXTRACTION_FIELD_TYPES,
  type ExtractionField,
} from "@/lib/jobs/ai-extract";
import { extractionJsonSchema } from "../ai-extract/engine";
import {
  STRUCTURED_SCHEMA_LIMITS,
  restoreOptionalNulls,
  structuredSchemaProblem,
  toStrictJsonSchema,
  type AiJsonSchema,
} from "./structured-output";
import { buildChatCompletionsBody, createOpenAiProvider } from "./openai";
import { buildMessagesBody, createAnthropicProvider } from "./anthropic";
import type { AiCompletionRequest } from "./provider";

const fields = (n: number, type: ExtractionField["type"] = "string") =>
  Array.from({ length: n }, (_, i) => ({ name: `f${i + 1}`, type }));

const SCHEMA: AiJsonSchema = extractionJsonSchema([
  { name: "invoice_number", type: "string" },
  { name: "total", type: "number", description: "grand total" },
]);

const REQUEST: AiCompletionRequest = {
  system: "Return ONLY a single JSON object.",
  messages: [{ role: "user", content: "Extract." }],
  maxOutputTokens: 400,
  temperature: 0,
};
const WITH_SCHEMA: AiCompletionRequest = { ...REQUEST, jsonSchema: SCHEMA };

const USAGE_OPENAI = { prompt_tokens: 812, completion_tokens: 400 };
const USAGE_ANTHROPIC = { input_tokens: 812, output_tokens: 400 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The body of the Nth fetch call, parsed. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(
    (fetchMock.mock.calls[call]![1] as RequestInit).body as string,
  ) as Record<string, unknown>;
}

describe("the structured-output subset", () => {
  it("accepts the AI Extract schema for every field type the job contract allows", () => {
    // DERIVED from the contract's own list, so a new field type is checked
    // the day it is added, not the day someone remembers this file.
    expect(EXTRACTION_FIELD_TYPES.length).toBeGreaterThanOrEqual(5);
    for (const type of EXTRACTION_FIELD_TYPES) {
      expect(
        structuredSchemaProblem(extractionJsonSchema([{ name: "x", type }])),
        type,
      ).toBeNull();
    }
    expect(
      structuredSchemaProblem(
        extractionJsonSchema(
          EXTRACTION_FIELD_TYPES.map((type) => ({ name: type, type })),
        ),
      ),
    ).toBeNull();
  });

  it("refuses what one provider or the other rejects", () => {
    const one = (node: Record<string, unknown>): AiJsonSchema => ({
      name: "s",
      schema: { type: "object", properties: { a: node }, required: ["a"] },
    });
    const refused: [string, AiJsonSchema][] = [
      ["minLength", one({ type: "string", minLength: 1 })],
      ["minimum", one({ type: "number", minimum: 0 })],
      ["format", one({ type: "string", format: "date" })],
      ["$ref", one({ $ref: "#/$defs/x" })],
      [
        "open object",
        {
          name: "s",
          schema: {
            type: "object",
            properties: {},
            additionalProperties: true,
          },
        },
      ],
      [
        "array root",
        { name: "s", schema: { type: "array", items: { type: "string" } } },
      ],
      ["bad name", { name: "has space", schema: SCHEMA.schema }],
      ["unknown type", one({ type: "date" })],
      ["array without items", one({ type: "array" })],
      [
        "required names a ghost",
        {
          name: "s",
          schema: { type: "object", properties: {}, required: ["ghost"] },
        },
      ],
    ];
    for (const [why, schema] of refused)
      expect(structuredSchemaProblem(schema), why).not.toBeNull();
    // Positive control: the same shapes without the offending keyword pass.
    expect(structuredSchemaProblem(one({ type: "string" }))).toBeNull();
    expect(structuredSchemaProblem(one({ type: "number" }))).toBeNull();
  });

  it("counts unions on the WIRE form: the bound is met at exactly the limit", () => {
    const limit = STRUCTURED_SCHEMA_LIMITS.maxUnions;
    expect(
      structuredSchemaProblem(extractionJsonSchema(fields(limit))),
    ).toBeNull();
    expect(
      structuredSchemaProblem(extractionJsonSchema(fields(limit + 1))),
    ).toMatch(/union/);
    // An array field is two unions (the field and its items).
    expect(
      structuredSchemaProblem(extractionJsonSchema(fields(limit / 2, "array"))),
    ).toBeNull();
    expect(
      structuredSchemaProblem(
        extractionJsonSchema(fields(limit / 2 + 1, "array")),
      ),
    ).toMatch(/union/);
    // An OPTIONAL non-null property is no union in the caller's schema but is
    // one on the wire; the count must see it.
    const optional: AiJsonSchema = {
      name: "s",
      schema: {
        type: "object",
        properties: Object.fromEntries(
          fields(limit + 1).map((f) => [f.name, { type: "string" }]),
        ),
      },
    };
    expect(structuredSchemaProblem(optional)).toMatch(/union/);
  });
});

describe("the strict transform and its inverse", () => {
  it("leaves the AI Extract schema exactly as it is (already strict)", () => {
    expect(toStrictJsonSchema(SCHEMA.schema)).toEqual(SCHEMA.schema);
  });

  it("closes objects, requires every property, and makes the optional ones nullable", () => {
    const strict = toStrictJsonSchema({
      type: "object",
      properties: {
        id: { type: "string" },
        note: { type: "string" },
        kind: { type: "string", enum: ["a", "b"] },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { qty: { type: "integer" }, sku: { type: "string" } },
            required: ["sku"],
          },
        },
      },
      required: ["id"],
    });
    expect(strict).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        note: { type: ["string", "null"] },
        kind: { type: ["string", "null"], enum: ["a", "b", null] },
        lines: {
          type: ["array", "null"],
          items: {
            type: "object",
            properties: {
              qty: { type: ["integer", "null"] },
              sku: { type: "string" },
            },
            required: ["qty", "sku"],
            additionalProperties: false,
          },
        },
      },
      required: ["id", "note", "kind", "lines"],
      additionalProperties: false,
    });
  });

  it("maps the nulls of OPTIONAL properties back out, and keeps a required null", () => {
    const original = {
      type: "object",
      properties: {
        id: { type: ["string", "null"] },
        note: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { qty: { type: "integer" }, sku: { type: "string" } },
            required: ["sku"],
          },
        },
      },
      required: ["id"],
    };
    const reply = {
      id: null,
      note: null,
      lines: [
        { qty: null, sku: "A" },
        { qty: 2, sku: "B" },
      ],
    };
    expect(restoreOptionalNulls(reply, original)).toEqual({
      id: null,
      lines: [{ sku: "A" }, { qty: 2, sku: "B" }],
    });
    // The input is not modified.
    expect(reply.note).toBeNull();
    // For the AI Extract schema (every field required) it changes nothing:
    // a null there is the model's "not in the text".
    const extraction = { invoice_number: null, total: 12 };
    expect(restoreOptionalNulls(extraction, SCHEMA.schema)).toEqual(extraction);
  });
});

describe("OpenAI puts the schema on the wire as strict json_schema", () => {
  it("adds response_format only when the request carries a schema", () => {
    const body = buildChatCompletionsBody("gpt-5.6-luna", WITH_SCHEMA, true);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "extraction",
        schema: toStrictJsonSchema(SCHEMA.schema),
        strict: true,
      },
    });
    // Without a schema the body is the pre-existing body, byte for byte.
    expect(
      JSON.stringify(buildChatCompletionsBody("gpt-5.6-luna", REQUEST, true)),
    ).toBe(
      JSON.stringify((({ response_format: _drop, ...rest }) => rest)(body)),
    );
    expect(
      buildChatCompletionsBody("m", WITH_SCHEMA, true, false),
    ).not.toHaveProperty("response_format");
  });

  it("a reply produced under the schema says so", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: { content: '{"invoice_number":"INV-1","total":3}' },
            finish_reason: "stop",
          },
        ],
        usage: USAGE_OPENAI,
      }),
    );
    const provider = createOpenAiProvider(
      { apiKey: "sk-test", model: "gpt-5.6-luna", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    const result = await provider.complete(WITH_SCHEMA);
    expect(result).toMatchObject({ ok: true, jsonSchemaApplied: true });
    expect(sentBody(fetchMock).response_format).toBeDefined();
    // Control: no schema asked, no flag.
    const plain = await provider.complete(REQUEST);
    expect(plain.ok && "jsonSchemaApplied" in plain).toBe(false);
  });

  it("a 400 naming response_format is retried ONCE without it, and the success says the schema did not apply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message:
                "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.",
              type: "invalid_request_error",
              param: "response_format",
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          usage: USAGE_OPENAI,
        }),
      );
    const provider = createOpenAiProvider(
      { apiKey: "sk-test", model: "gpt-old", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    const result = await provider.complete(WITH_SCHEMA);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchMock, 0)).toHaveProperty("response_format");
    expect(sentBody(fetchMock, 1)).not.toHaveProperty("response_format");
    // The retry kept the temperature: only the refused parameter was dropped.
    expect(sentBody(fetchMock, 1).temperature).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.ok && "jsonSchemaApplied" in result).toBe(false);
  });

  it("temperature and schema refusals each get their one retry, never a loop", async () => {
    const reject = (message: string) =>
      jsonResponse({ error: { message, type: "invalid_request_error" } }, 400);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reject(
          "Unsupported parameter: 'temperature' is not supported with this model.",
        ),
      )
      .mockResolvedValueOnce(
        reject("Invalid schema for response_format 'extraction'."),
      )
      .mockResolvedValue(
        reject("Invalid schema for response_format 'extraction'."),
      );
    const provider = createOpenAiProvider(
      { apiKey: "sk-test", model: "gpt-x", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    const result = await provider.complete(WITH_SCHEMA);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      ok: false,
      kind: "rejected",
      retryable: false,
    });
  });

  it("a refusal under the schema is content_filtered, not retryable, and keeps its tokens", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: { content: null, refusal: "I can't help with that." },
            finish_reason: "stop",
          },
        ],
        usage: USAGE_OPENAI,
      }),
    );
    const provider = createOpenAiProvider(
      { apiKey: "sk-test", model: "gpt-5.6-luna", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(await provider.complete(WITH_SCHEMA)).toMatchObject({
      ok: false,
      kind: "content_filtered",
      retryable: false,
      usage: { inputTokens: 812, outputTokens: 400 },
    });
  });

  it("a reply cut at the output ceiling under the schema is incomplete_output with its tokens", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: { content: '{"invoice_number":"INV-' },
            finish_reason: "length",
          },
        ],
        usage: USAGE_OPENAI,
      }),
    );
    const provider = createOpenAiProvider(
      { apiKey: "sk-test", model: "gpt-5.6-luna", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(await provider.complete(WITH_SCHEMA)).toMatchObject({
      ok: false,
      kind: "incomplete_output",
      retryable: false,
      usage: { inputTokens: 812, outputTokens: 400 },
    });
  });
});

describe("Anthropic puts the schema on the wire as output_config.format", () => {
  it("adds output_config only when the request carries a schema", () => {
    const body = buildMessagesBody("claude-sonnet-5", WITH_SCHEMA);
    expect(body.output_config).toEqual({
      format: {
        type: "json_schema",
        schema: toStrictJsonSchema(SCHEMA.schema),
      },
    });
    expect(JSON.stringify(buildMessagesBody("claude-sonnet-5", REQUEST))).toBe(
      JSON.stringify((({ output_config: _drop, ...rest }) => rest)(body)),
    );
    expect(buildMessagesBody("m", WITH_SCHEMA, false)).not.toHaveProperty(
      "output_config",
    );
  });

  it("a reply produced under the schema says so; a 400 naming output_config is retried once without it", async () => {
    const ok = () =>
      jsonResponse({
        content: [
          { type: "text", text: '{"invoice_number":"INV-1","total":3}' },
        ],
        stop_reason: "end_turn",
        usage: USAGE_ANTHROPIC,
      });
    const direct = vi.fn(async () => ok());
    const provider = createAnthropicProvider(
      { apiKey: "sk-ant-test", model: "claude-sonnet-5", timeoutMs: 5000 },
      { fetch: direct as unknown as typeof fetch },
    );
    expect(await provider.complete(WITH_SCHEMA)).toMatchObject({
      ok: true,
      jsonSchemaApplied: true,
    });
    expect(sentBody(direct)).toHaveProperty("output_config");

    const fallback = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "output_config.format: structured outputs are not supported for this model.",
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(ok());
    const old = createAnthropicProvider(
      { apiKey: "sk-ant-test", model: "claude-old", timeoutMs: 5000 },
      { fetch: fallback as unknown as typeof fetch },
    );
    const result = await old.complete(WITH_SCHEMA);
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(sentBody(fallback, 1)).not.toHaveProperty("output_config");
    expect(result.ok).toBe(true);
    expect(result.ok && "jsonSchemaApplied" in result).toBe(false);
  });

  it("an unrelated 400 is NOT retried (the match is narrow)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "prompt is too long",
          },
        },
        400,
      ),
    );
    const provider = createAnthropicProvider(
      { apiKey: "sk-ant-test", model: "claude-sonnet-5", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(await provider.complete(WITH_SCHEMA)).toMatchObject({
      ok: false,
      kind: "too_long",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("max_tokens under the schema is incomplete_output with its tokens", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        content: [{ type: "text", text: '{"invoice_number":"INV-' }],
        stop_reason: "max_tokens",
        usage: USAGE_ANTHROPIC,
      }),
    );
    const provider = createAnthropicProvider(
      { apiKey: "sk-ant-test", model: "claude-sonnet-5", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(await provider.complete(WITH_SCHEMA)).toMatchObject({
      ok: false,
      kind: "incomplete_output",
      retryable: false,
      usage: { inputTokens: 812, outputTokens: 400 },
    });
  });
});

describe("a schema outside the subset never reaches a provider", () => {
  it("is refused by request validation before any fetch", async () => {
    const fetchMock = vi.fn();
    const provider = createOpenAiProvider(
      { apiKey: "sk-test", model: "gpt-5.6-luna", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    const result = await provider.complete({
      ...REQUEST,
      jsonSchema: extractionJsonSchema(
        fields(STRUCTURED_SCHEMA_LIMITS.maxUnions + 1),
      ),
    });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
