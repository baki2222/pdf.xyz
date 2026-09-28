/**
 * One well-formed option bag per AI tool — for tests that need a job the route
 * will ADMIT, now that `POST /api/jobs` checks AI options before it charges
 * (see `./ai-tool-options`).
 *
 * Keyed by {@link AiOptionTool}, so a new AI parser without an example fails to
 * compile rather than leaving a chain test quietly posting a job the route now
 * refuses with 400 — which would make every allowance assertion downstream of
 * it pass or fail for the wrong reason. `ai-tool-options.test.ts` proves each
 * example parses.
 */
import type { AiOptionTool } from "./ai-tool-options";

export const AI_TOOL_OPTION_EXAMPLES: Record<
  AiOptionTool,
  Record<string, unknown>
> = {
  "ai-extract": { mode: "schema", schema: [{ name: "total", type: "number" }] },
  "chat-with-pdf": { question: "What is the total?" },
  "summarize-pdf": { length: "brief", format: "bullets" },
  "translate-pdf": { targetLanguage: "fr", sourceLanguage: "auto" },
};

/** The example for `slug`, or `undefined` for a tool with no AI parser. */
export function aiToolOptionExample(
  slug: string,
): Record<string, unknown> | undefined {
  return Object.prototype.hasOwnProperty.call(AI_TOOL_OPTION_EXAMPLES, slug)
    ? AI_TOOL_OPTION_EXAMPLES[slug as AiOptionTool]
    : undefined;
}

/**
 * One option bag per AI tool that its parser REFUSES — the other half of the
 * corpus, so "the route and the worker agree" is asked of a refusal and not
 * only of bags both sides wave through. ai-extract's is the finding's own
 * case: two fields that differ only in case and spacing.
 */
export const AI_TOOL_OPTION_COUNTEREXAMPLES: Record<
  AiOptionTool,
  Record<string, unknown>
> = {
  "ai-extract": {
    mode: "schema",
    schema: [
      { name: "Total", type: "number" },
      { name: " total", type: "number" },
    ],
  },
  "chat-with-pdf": { question: "" },
  "summarize-pdf": { length: "epic" },
  "translate-pdf": { targetLanguage: "not-a-language" },
};
