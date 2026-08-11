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
 * So this drives the REAL processors with a provider that reports usage, and
 * asserts the counts arrive on the far side of `sanitizeJobResults` — the value
 * a job record actually carries.
 *
 * All four AI tools are covered rather than the one the measurement is for.
 * A field populated by one of four callers is the defect this codebase keeps
 * finding, not a smaller version of the feature.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { sanitizeJobResults } from "@/lib/jobs/results";
import type { AiProvider, AiUsage } from "../ai/provider";
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

const USAGE: AiUsage = {
  inputTokens: 8_100,
  outputTokens: 7_400,
  cachedInputTokens: 2_048,
};

function provider(text: string, usage: AiUsage | undefined): AiProvider {
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    async complete() {
      return {
        ok: true as const,
        text,
        model: "claude-sonnet-5",
        ...(usage ? { usage } : {}),
      };
    },
  };
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
    input: { tool: "translate-pdf", options: { targetLanguage: "fr" } },
  },
  {
    name: "summarize-pdf",
    reply: "An invoice for 1200 euros, payable in thirty days.",
    make: (p: AiProvider) => createSummarizeProcessor({ extract, provider: p }),
    input: { tool: "summarize-pdf", options: {} },
  },
  {
    name: "ai-extract",
    reply: '{"total":"1200 euros"}',
    make: (p: AiProvider) => createAiExtractProcessor({ extract, provider: p }),
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
    input: {
      tool: "chat-with-pdf",
      options: { question: "What is the total?" },
    },
  },
] as const;

const runFor = async (
  tool: (typeof TOOLS)[number],
  usage: AiUsage | undefined,
) => {
  const processor = tool.make(provider(tool.reply, usage));
  return processor.process({ ...tool.input, inputs: [file] } as ProcessorInput);
};

describe("provider token usage reaches the job record", () => {
  it.each(TOOLS.map((t) => [t.name, t] as const))(
    "%s carries usage through the processor and the persistence boundary",
    async (name, tool) => {
      const result = await runFor(tool, USAGE);
      expect(result.ok, `${name} did not complete`).toBe(true);
      if (!result.ok) return;

      const persisted = sanitizeJobResults(result.results);
      expect(
        persisted?.ai?.usage,
        `${name} produced usage at the provider but the job record has none — ` +
          "check that the processor threads run.meta.usage into the ai block; " +
          "the seam and the engine can both be correct while this is not",
      ).toEqual({
        inputTokens: USAGE.inputTokens,
        outputTokens: USAGE.outputTokens,
        cachedInputTokens: USAGE.cachedInputTokens,
        model: "claude-sonnet-5",
      });
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
