// @vitest-environment node
/**
 * AI Extract's schema mode through structured output - the COMPOSED chain:
 * the engine, a real adapter, and a mocked `fetch` holding recorded-shape
 * bodies (never a real call), then the processor that turns a run into the
 * job record. Units are in `../ai/structured-output.test.ts`; this file proves
 * the path through them keeps the schema, the retry rule and the token counts.
 *
 * THE PROPERTIES:
 *  - schema mode sends the requested fields as a strict schema; prompt mode
 *    and an unrepresentable schema send exactly what they sent before;
 *  - a reply produced UNDER the schema that is still unusable is NOT
 *    retryable (the same constrained request decodes the same way, and
 *    every retry is paid), while the prompt-only path keeps its retry;
 *  - EVERY failure arm after the call carries the tokens it spent, all the
 *    way to the job record (CLAUDE.md rule 3).
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { ExtractOptions } from "@/lib/jobs/ai-extract";
import { createOpenAiProvider } from "../ai/openai";
import { createAnthropicProvider } from "../ai/anthropic";
import { STRUCTURED_SCHEMA_LIMITS } from "../ai/structured-output";
import {
  STRICT_REPLY_UNUSABLE,
  extractionJsonSchema,
  extractionSchemaFor,
  runAiExtract,
  type AiExtractRun,
} from "./engine";
import { createAiExtractProcessor } from "../processor/ai-extract";
import aiExtractContent from "@/lib/tools/content/ai-extract";

const INPUT = new Uint8Array([1, 2, 3, 4]);
const SCHEMA_OPTIONS: ExtractOptions = {
  mode: "schema",
  schema: [
    { name: "invoice_number", type: "string" },
    { name: "total", type: "number" },
  ],
};
const PROMPT_OPTIONS: ExtractOptions = {
  mode: "prompt",
  prompt: "Extract the invoice number.",
};

function extractor() {
  const text = "Invoice INV-42. Total 1200.";
  const extracted: ExtractedPdfText = {
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
    text,
    characterCount: text.length,
    hasText: true,
  };
  return async () => extracted;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const USAGE = { prompt_tokens: 900, completion_tokens: 37 };

/** A recorded-shape Chat Completions body. */
function chat(content: string, finish = "stop") {
  return {
    id: "chatcmpl-fixture",
    object: "chat.completion",
    model: "gpt-5.6-luna",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        finish_reason: finish,
      },
    ],
    usage: USAGE,
  };
}

function openai(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  const provider = createOpenAiProvider(
    { apiKey: "sk-test", model: "gpt-5.6-luna", timeoutMs: 5000 },
    { fetch: fetchMock as unknown as typeof fetch },
  );
  return { fetchMock, provider };
}

function sent(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(
    (fetchMock.mock.calls[call]![1] as RequestInit).body as string,
  ) as Record<string, unknown>;
}

const SPENT = {
  inputTokens: 900,
  outputTokens: 37,
  calls: 1,
  model: "gpt-5.6-luna",
};

function failure(run: AiExtractRun) {
  if (run.ok) throw new Error("expected a failure");
  return run;
}

describe("schema mode sends the requested fields as a strict schema", () => {
  it("puts the fields on the wire and records the format in the manifest", async () => {
    const { fetchMock, provider } = openai(
      jsonResponse(chat('{"invoice_number":"INV-42","total":1200}')),
    );
    const run = await runAiExtract(INPUT, SCHEMA_OPTIONS, {
      extract: extractor(),
      provider,
      now: () => "2026-11-17T00:00:00.000Z",
    });
    const body = sent(fetchMock);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "extraction",
        schema: extractionJsonSchema(SCHEMA_OPTIONS.schema!).schema,
        strict: true,
      },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.extraction.replyFormat).toBe("json-schema");
    expect(
      JSON.parse(await zip.file("extraction.json")!.async("string")),
    ).toEqual({ invoice_number: "INV-42", total: 1200 });
  });

  it("prompt mode and an over-limit schema send no schema at all", async () => {
    const over: ExtractOptions = {
      mode: "schema",
      schema: Array.from(
        { length: STRUCTURED_SCHEMA_LIMITS.maxUnions + 1 },
        (_, i) => ({ name: `field_${i + 1}`, type: "string" as const }),
      ),
    };
    // Positive control for the bound: one field fewer IS sent.
    expect(
      extractionSchemaFor({ ...over, schema: over.schema!.slice(1) }),
    ).toBeDefined();
    expect(extractionSchemaFor(over)).toBeUndefined();
    expect(extractionSchemaFor(PROMPT_OPTIONS)).toBeUndefined();
    for (const options of [PROMPT_OPTIONS, over]) {
      const { fetchMock, provider } = openai(
        jsonResponse(chat('{"invoice_number":"INV-42"}')),
      );
      const run = await runAiExtract(INPUT, options, {
        extract: extractor(),
        provider,
      });
      expect(run.ok, options.mode).toBe(true);
      expect(sent(fetchMock), options.mode).not.toHaveProperty(
        "response_format",
      );
      if (run.ok && options.mode === "schema") {
        const zip = await JSZip.loadAsync(run.output);
        const manifest = JSON.parse(
          await zip.file("manifest.json")!.async("string"),
        );
        expect(manifest.extraction.replyFormat).toBe("prompt");
      }
    }
  });

  it("the Anthropic adapter carries the same schema as output_config.format", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: '{"invoice_number":"INV-42","total":1200}' },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 900, output_tokens: 37 },
      }),
    );
    const provider = createAnthropicProvider(
      { apiKey: "sk-ant-test", model: "claude-sonnet-5", timeoutMs: 5000 },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    const run = await runAiExtract(INPUT, SCHEMA_OPTIONS, {
      extract: extractor(),
      provider,
    });
    expect(run.ok).toBe(true);
    expect(sent(fetchMock).output_config).toEqual({
      format: {
        type: "json_schema",
        schema: extractionJsonSchema(SCHEMA_OPTIONS.schema!).schema,
      },
    });
  });
});

describe("an unusable reply: retry only where a retry can help, tokens on every arm", () => {
  const BROKEN = '{"invoice_number": "INV-42", "total": ';

  it("under the schema: NOT retryable, carries its tokens to the job record", async () => {
    const { provider } = openai(jsonResponse(chat(BROKEN)));
    const run = failure(
      await runAiExtract(INPUT, SCHEMA_OPTIONS, {
        extract: extractor(),
        provider,
      }),
    );
    expect(run).toMatchObject({
      kind: "failed",
      retryable: false,
      message: STRICT_REPLY_UNUSABLE,
      usage: SPENT,
    });
    expect(run.window).toBeDefined();
  });

  it("CONTROL - the same reply on the prompt-only path keeps its retry and its tokens", async () => {
    const { provider } = openai(jsonResponse(chat(BROKEN)));
    expect(
      failure(
        await runAiExtract(INPUT, PROMPT_OPTIONS, {
          extract: extractor(),
          provider,
        }),
      ),
    ).toMatchObject({ kind: "failed", retryable: true, usage: SPENT });
  });

  it("CONTROL - when the model refused the parameter, the reply was prompt-only, so the retry stays", async () => {
    const { fetchMock, provider } = openai(
      jsonResponse(
        {
          error: {
            message:
              "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.",
            type: "invalid_request_error",
          },
        },
        400,
      ),
      jsonResponse(chat(BROKEN)),
    );
    const run = failure(
      await runAiExtract(INPUT, SCHEMA_OPTIONS, {
        extract: extractor(),
        provider,
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(run).toMatchObject({ retryable: true, usage: SPENT });
  });

  it("a list reply under the schema is not retryable either", async () => {
    const { provider } = openai(jsonResponse(chat('["INV-42", 1200]')));
    expect(
      failure(
        await runAiExtract(INPUT, SCHEMA_OPTIONS, {
          extract: extractor(),
          provider,
        }),
      ),
    ).toMatchObject({
      retryable: false,
      message: STRICT_REPLY_UNUSABLE,
      usage: SPENT,
    });
  });

  it("cut at the output ceiling: not retryable, tokens kept", async () => {
    const { provider } = openai(jsonResponse(chat(BROKEN, "length")));
    expect(
      failure(
        await runAiExtract(INPUT, SCHEMA_OPTIONS, {
          extract: extractor(),
          provider,
        }),
      ),
    ).toMatchObject({ kind: "failed", retryable: false, usage: SPENT });
  });

  it("a package over the size limit still carries the tokens the call spent", async () => {
    const { provider } = openai(
      jsonResponse(chat('{"invoice_number":"INV-42","total":1200}')),
    );
    expect(
      failure(
        await runAiExtract(INPUT, SCHEMA_OPTIONS, {
          extract: extractor(),
          provider,
          limits: { maxOutputBytes: 10 },
        }),
      ),
    ).toMatchObject({ retryable: false, usage: SPENT });
  });

  it("the processor turns the strict failure into a terminal job error that still records the spend", async () => {
    const { provider } = openai(jsonResponse(chat(BROKEN)));
    const processor = createAiExtractProcessor({
      extract: extractor(),
      provider,
    });
    const result = await processor.process({
      tool: "ai-extract",
      inputs: [
        { filename: "a.pdf", bytes: INPUT, contentType: "application/pdf" },
      ],
      options: SCHEMA_OPTIONS,
    } as unknown as Parameters<typeof processor.process>[0]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: "unprocessable_entity",
      retryable: false,
      message: STRICT_REPLY_UNUSABLE,
    });
    expect(result.results?.ai?.usage).toEqual(SPENT);
  });
});

/**
 * The FAQ "Why did my extraction fail" describes BOTH arms above. It shipped
 * (until 2026-11-18) saying, with no condition, that the server "can put the
 * job back in its queue" and that the failure message says "a retry may
 * succeed" - true of the prompt-only arm, false of the strict one. The copy
 * now promises only what both arms do: the job MAY go back, and the message
 * says WHETHER trying again could help. This pins that clause to each arm's
 * real flag and message, so a third arm (or a reworded message) that says
 * neither turns this red.
 */
describe("the FAQ's failure clause is true of both arms", () => {
  const BROKEN = '{"invoice_number": "INV-42", "total": ';
  const answer = (): string => {
    const entry = aiExtractContent.faqs.find((f) =>
      f.q.startsWith("Why did my extraction fail"),
    );
    if (!entry) throw new Error("the FAQ entry is gone - health check");
    return entry.a;
  };
  /** What each arm's message says about trying again: the FAQ's promise. */
  const VERDICT = {
    retry: /Retrying may succeed\.$/,
    noRetry: /so it was not retried\.$/,
  };

  it("the FAQ promises a conditional requeue and a message that says which", () => {
    const a = answer();
    expect(a).toContain(
      "When the model's reply is not valid JSON, the job may go back in its queue for another attempt by itself.",
    );
    expect(a).toContain(
      "If it still fails, there is nothing to download, and the message says whether trying again could help.",
    );
    // Neither arm's verdict is quoted as if it were the only one.
    expect(a).not.toMatch(/retry may succeed|can put the job back/i);
  });

  it("prompt-only arm: retryable, and its message says a retry may help", async () => {
    const { provider } = openai(jsonResponse(chat(BROKEN)));
    const run = failure(
      await runAiExtract(INPUT, PROMPT_OPTIONS, {
        extract: extractor(),
        provider,
      }),
    );
    expect(run.retryable).toBe(true);
    expect(run.message).toMatch(VERDICT.retry);
    expect(run.message).not.toMatch(VERDICT.noRetry);
  });

  it("strict arm: not retryable, and its message says it was not retried", async () => {
    const { provider } = openai(jsonResponse(chat(BROKEN)));
    const run = failure(
      await runAiExtract(INPUT, SCHEMA_OPTIONS, {
        extract: extractor(),
        provider,
      }),
    );
    expect(run.retryable).toBe(false);
    expect(run.message).toBe(STRICT_REPLY_UNUSABLE);
    expect(run.message).toMatch(VERDICT.noRetry);
    expect(run.message).not.toMatch(VERDICT.retry);
  });
});
