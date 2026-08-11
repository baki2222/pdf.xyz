// @vitest-environment node
/**
 * Token usage survives the whole chain: engine → processor → persistence.
 *
 * THE ASSERTION THAT MUST NOT BE A UNIT TEST. `results.test.ts` proves the seam
 * clamps and drops correctly, and each engine returns `meta.usage` — and both
 * could pass while the four processors quietly failed to thread it, which is
 * exactly how a corrected path rule stayed inert for a commit once already
 * (fed in 9, survived the worker 9, survived persistence 0).
 *
 * So this drives the REAL processors and the REAL Anthropic adapter — only
 * `fetch` is faked — and asserts the counts arrive on the far side of
 * `sanitizeJobResults`, the value a job record actually carries.
 *
 * THE STARTING POINT IS THE POINT. The first version of this file built its own
 * `AiProvider` returning a ready-made `AiUsage`, so the corpus began downstream
 * of the wire mapping — and the wire mapping was where a whole document was
 * being lost, because the adapter never read `cache_creation_input_tokens`.
 * A chain test that starts after the seam it is meant to cover is a unit test
 * wearing a chain test's docblock, which is what this one was.
 *
 * All four AI tools are covered rather than the one the measurement is for.
 * A field populated by one of four callers is the defect this codebase keeps
 * finding, not a smaller version of the feature.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { createAnthropicProvider } from "../ai/anthropic";
import type { AiProvider } from "../ai/provider";
import type { ProcessorInput } from "./types";
import { createTranslateProcessor } from "./translate";
import { createSummarizeProcessor } from "./summarize";
import { createAiExtractProcessor } from "./ai-extract";
import { createChatWithPdfProcessor } from "./chat-with-pdf";

const SOURCE = "Total due is 1200 euros. Payment terms are thirty days.";

const extract = async (): Promise<ExtractedPdfText> => ({
  pageCount: 2,
  pages: [
    { pageNumber: 1, text: SOURCE, characterCount: SOURCE.length },
    { pageNumber: 2, text: "Second page.", characterCount: 12 },
  ],
  text: `${SOURCE}\n\nSecond page.`,
  characterCount: SOURCE.length + 14,
  hasText: true,
});

/** No selectable text — every engine refuses BEFORE it reaches the model. */
const emptyExtract = async (): Promise<ExtractedPdfText> => ({
  pageCount: 2,
  pages: [],
  text: "   ",
  characterCount: 3,
  hasText: false,
});

/**
 * The wire shape, not a pre-formed `AiUsage`.
 *
 * THE CORPUS STARTS HERE ON PURPOSE. The first version of this file built a
 * hand-written `AiProvider` that returned an `AiUsage` object — so its chain
 * began DOWNSTREAM of the wire mapping, which is exactly where the loss was: the
 * adapter never read `cache_creation_input_tokens`, and a test whose corpus
 * starts after that mapping can never see it. The file called itself "the
 * assertion that must not be a unit test" and then made the same mistake one
 * layer up.
 *
 * `input_tokens` is Anthropic's UNCACHED REMAINDER. These numbers describe a
 * cache write of a whole document: 20 fresh, 40,000 written, 0 read.
 */
const WIRE_USAGE = {
  input_tokens: 20,
  output_tokens: 300,
  cache_creation_input_tokens: 40_000,
  cache_read_input_tokens: 0,
};

/** What the whole chain must persist for {@link WIRE_USAGE}. */
const EXPECTED = {
  inputTokens: 20,
  outputTokens: 300,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 40_000,
  calls: 1,
  model: "claude-sonnet-5",
};

/** The REAL Anthropic adapter, with only `fetch` faked. */
function provider(text: string, usage: unknown): AiProvider {
  const fake = (async () =>
    new Response(
      JSON.stringify({
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        ...(usage ? { usage } : {}),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

  return createAnthropicProvider(
    { model: "claude-sonnet-5", apiKey: "test-key", timeoutMs: 1_000 },
    { fetch: fake },
  );
}

const file = {
  fileId: "f1",
  filename: "invoice.pdf",
  contentType: "application/pdf",
  bytes: new Uint8Array([1]),
};

/** Each tool with the model reply and options its own engine accepts. */
const TOOLS = [
  {
    name: "translate-pdf",
    reply: "Le total dû est de 1200 euros.",
    make: (p: AiProvider) => createTranslateProcessor({ extract, provider: p }),
    makeEmpty: (p: AiProvider) =>
      createTranslateProcessor({ extract: emptyExtract, provider: p }),
    input: { tool: "translate-pdf", options: { targetLanguage: "fr" } },
  },
  {
    name: "summarize-pdf",
    reply: "An invoice for 1200 euros, payable in thirty days.",
    make: (p: AiProvider) => createSummarizeProcessor({ extract, provider: p }),
    makeEmpty: (p: AiProvider) =>
      createSummarizeProcessor({ extract: emptyExtract, provider: p }),
    input: { tool: "summarize-pdf", options: {} },
  },
  {
    name: "ai-extract",
    reply: '{"total":"1200 euros"}',
    make: (p: AiProvider) => createAiExtractProcessor({ extract, provider: p }),
    makeEmpty: (p: AiProvider) =>
      createAiExtractProcessor({ extract: emptyExtract, provider: p }),
    input: {
      tool: "ai-extract",
      options: { mode: "prompt", prompt: "Extract totals" },
    },
  },
  {
    name: "chat-with-pdf",
    reply: "The total is 1200 euros [p.1].",
    make: (p: AiProvider) =>
      createChatWithPdfProcessor({ extract, provider: p }),
    makeEmpty: (p: AiProvider) =>
      createChatWithPdfProcessor({ extract: emptyExtract, provider: p }),
    input: {
      tool: "chat-with-pdf",
      options: { question: "What is the total?" },
    },
  },
] as const;

const runFor = async (tool: (typeof TOOLS)[number], usage: unknown) => {
  const processor = tool.make(provider(tool.reply, usage));
  return processor.process({ ...tool.input, inputs: [file] } as ProcessorInput);
};

describe("provider token usage reaches the job record", () => {
  it.each(TOOLS.map((t) => [t.name, t] as const))(
    "%s carries usage through the processor and the persistence boundary",
    async (name, tool) => {
      const result = await runFor(tool, WIRE_USAGE);
      expect(result.ok, `${name} did not complete`).toBe(true);
      if (!result.ok) return;

      const persisted = sanitizeJobResults(result.results);
      expect(
        persisted?.ai?.usage,
        `${name} produced usage at the provider but the job record has none — ` +
          "check that the processor threads run.meta.usage into the ai block; " +
          "the seam and the engine can both be correct while this is not",
      ).toEqual(EXPECTED);
    },
  );

  it.each(TOOLS.map((t) => [t.name, t] as const))(
    "%s persists no usage block when the provider reported none",
    async (name, tool) => {
      // The negative control. Without it the test above passes for a chain that
      // fabricates zeroes, and a fabricated zero is what would drag a measured
      // per-page price toward free.
      const result = await runFor(tool, undefined);
      expect(result.ok, `${name} did not complete`).toBe(true);
      if (!result.ok) return;

      const persisted = sanitizeJobResults(result.results);
      expect(
        persisted?.ai?.truncation,
        `${name} lost its window`,
      ).toBeDefined();
      expect(
        persisted?.ai?.usage,
        `${name} invented a usage block the provider never reported`,
      ).toBeUndefined();
    },
  );
});

/**
 * THE CLAIM THE WHOLE CEILING RESTS ON: a run that FAILED after spending
 * tokens still reports them to the job record.
 *
 * Per-tool rather than one shared case, for the same reason the guard controls
 * are per-guard: the four have different failure mappers, and a merged assertion
 * can pass on one tool's data while another drops it silently.
 *
 * `incomplete_output` is the case, and it is the case on purpose. It is
 * classified non-retryable PRECISELY because the model hit its output ceiling —
 * so it burned the maximum budget and is the most expensive outcome in the
 * system. Until 2026-08-11 the counts were discarded at three separate layers on
 * the way here, and a spend hook reading only successes would have been blind to
 * exactly the largest expenses while appearing to work.
 */
describe("a FAILED run's spend reaches the job record", () => {
  /** `stop_reason: max_tokens` — the branch that exists because the budget went. */
  const MAX_TOKENS = {
    input_tokens: 20,
    output_tokens: 8_000,
    cache_creation_input_tokens: 40_000,
    cache_read_input_tokens: 0,
  };

  it.each(TOOLS.map((t) => [t.name, t] as const))(
    "%s carries usage on incomplete_output, through to sanitizeJobResults",
    async (name, tool) => {
      const fake = (async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "half an ans" }],
            stop_reason: "max_tokens",
            usage: MAX_TOKENS,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch;

      const processor = tool.make(
        createAnthropicProvider(
          { model: "claude-sonnet-5", apiKey: "test-key", timeoutMs: 1_000 },
          { fetch: fake },
        ),
      );
      const result = await processor.process({
        ...tool.input,
        inputs: [file],
      } as ProcessorInput);

      expect(result.ok, `${name} unexpectedly succeeded`).toBe(false);
      if (result.ok) return;

      const persisted = sanitizeJobResults(result.results);
      expect(
        persisted?.ai?.usage,
        `${name} spent 48,020 tokens and failed, and the job record has none — ` +
          "the ceiling cannot see the calls that cost the most. Check that the " +
          "engine's mapProviderFailure carries usage+window and the processor " +
          "passes aiResultsFromFailure(run) to processorFail",
      ).toEqual({
        inputTokens: 20,
        outputTokens: 8_000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 40_000,
        calls: 1,
        model: "claude-sonnet-5",
      });
    },
  );

  it.each(TOOLS.map((t) => [t.name, t] as const))(
    "%s reports NOTHING when the failure preceded any provider call",
    async (name, tool) => {
      // The invariant's other direction: `usage` present ⟺ a call happened.
      // A scanned/empty document fails before the model is reached, so a block
      // here would invent a spend and the ceiling would over-count silently.
      const processor = tool.makeEmpty({
        id: "anthropic",
        model: "claude-sonnet-5",
        async complete() {
          throw new Error("must not be called");
        },
      });
      const result = await processor.process({
        ...tool.input,
        inputs: [file],
        // No extractable text ⇒ the engines refuse before prompting.
      } as ProcessorInput);
      if (result.ok) return;
      const persisted = sanitizeJobResults(result.results);
      expect(
        persisted?.ai?.usage,
        `${name} reported a spend for a call that never happened`,
      ).toBeUndefined();
    },
  );
});
