// @vitest-environment node
/**
 * `results.ai.readingOrder` REACHES THE JOB RECORD — read where the reader
 * reads it, not where the engine wrote it.
 *
 * The processor's results pass through `sanitizeJobResults` before they are
 * persisted (the worker's queue calls it), and that runs
 * `buildAiResultMeta`, a WHITELIST. A field the processor sets and the
 * persister drops is a correct value that reaches nobody (CLAUDE.md rule 5),
 * so every case here asserts on the SANITISED record:
 *
 *  - a success carries the reading order, and its literal sent count is no
 *    larger than the window's `charactersSent` (precondition: not truncated —
 *    `charactersSent` is in the calibrated `-layout` unit and covers the
 *    whole document; the relation is not claimed for a truncated window);
 *  - a failure AFTER a provider call carries it, counting the call that
 *    failed and not the segments after it;
 *  - a failure BEFORE any call carries nothing (nothing was sent).
 */
import { describe, expect, it } from "vitest";
import { sanitizeJobResults } from "@/lib/jobs/results";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { ProcessorInput } from "../processor/types";
import { createTranslateProcessor } from "../processor/translate";
import {
  concatReadingOrderPairs,
  discoverReadingOrderPairs,
} from "@/tests/reading-order-pairs";
import { TRANSLATE_CHARS_PER_OUTPUT_TOKEN } from "@/lib/jobs/translate-limits";
import {
  composeReadingOrderExtractor,
  translatePageBlocks,
} from "./reading-order";

const NL = String.fromCharCode(10);
const OPEN = `${NL}---${NL}`;
const CLOSE = `${NL}---`;

const PAIRS = discoverReadingOrderPairs();
const DOC = concatReadingOrderPairs(PAIRS);
const extract = composeReadingOrderExtractor(
  async () => DOC.layout,
  async () => DOC.flow,
);

const input: ProcessorInput = {
  tool: "translate-pdf",
  options: { targetLanguage: "fr" },
  inputs: [
    {
      fileId: "f1",
      filename: "paper.pdf",
      contentType: "application/pdf",
      bytes: new Uint8Array([1]),
    },
  ],
};

const OK: AiCompletionResult = {
  ok: true,
  text: "Traduction.",
  model: "claude-sonnet-5",
  usage: { inputTokens: 50, outputTokens: 10 },
};
const LIMITED: AiCompletionResult = {
  ok: false,
  kind: "rate_limited",
  retryable: true,
  message: "slow down",
  usage: { inputTokens: 40, outputTokens: 0 },
};

/** Answers call i with `script[i]`, recording each delimited segment. */
function scripted(script: AiCompletionResult[]) {
  const segments: string[] = [];
  const provider: AiProvider = {
    id: "anthropic",
    model: "claude-sonnet-5",
    async complete(request) {
      const content = request.messages[0]!.content;
      segments.push(
        content.slice(
          content.indexOf(OPEN) + OPEN.length,
          content.lastIndexOf(CLOSE),
        ),
      );
      return script[Math.min(segments.length - 1, script.length - 1)]!;
    },
  };
  return { provider, segments };
}

/** A per-call ceiling of ~1,000 characters: the document needs several calls. */
const CHUNKED = {
  maxOutputTokens: Math.ceil(1_000 / TRANSLATE_CHARS_PER_OUTPUT_TOKEN),
};

describe("results.ai.readingOrder on the persisted job record", () => {
  it("a success: present, counted from the wire, and within charactersSent", async () => {
    const { provider, segments } = scripted([OK]);
    const result = await createTranslateProcessor({
      extract,
      provider,
      limits: CHUNKED,
    }).process(input);
    expect(result.ok).toBe(true);
    const clean = sanitizeJobResults(result.results);
    const order = clean?.ai?.readingOrder;
    expect(order, "the persister dropped readingOrder").toBeDefined();
    const { tally } = translatePageBlocks(
      (await extract(new Uint8Array())).pages,
    );
    expect(order).toEqual({
      source: "flow",
      flowPages: tally.flowPages,
      layoutPages: tally.layoutPages,
      fellBack: tally.fellBack,
      sentCharacters: segments.reduce((n, s) => n + s.length, 0),
    });
    expect(segments.length, "health: several calls").toBeGreaterThan(2);
    expect(order!.flowPages, "health: flow was sent").toBeGreaterThan(0);
    const window = clean!.ai!.truncation;
    expect(window.truncated).toBe(false);
    expect(order!.sentCharacters).toBeLessThanOrEqual(window.charactersSent);
  });

  it("a failure after the first call carries it, counting that call", async () => {
    const { provider, segments } = scripted([LIMITED]);
    const result = await createTranslateProcessor({
      extract,
      provider,
      limits: CHUNKED,
    }).process(input);
    expect(result.ok).toBe(false);
    const order = sanitizeJobResults(result.results)?.ai?.readingOrder;
    expect(order, "a post-spend failure dropped readingOrder").toBeDefined();
    expect(segments).toHaveLength(1);
    expect(order!.sentCharacters).toBe(segments[0]!.length);
  });

  it("an interruption mid-document counts the failing call, not the segments after it", async () => {
    const { provider, segments } = scripted([OK, LIMITED, OK]);
    const result = await createTranslateProcessor({
      extract,
      provider,
      limits: CHUNKED,
    }).process(input);
    // Earlier parts succeeded, so the job delivers what it has.
    expect(result.ok).toBe(true);
    expect(segments).toHaveLength(2);
    const order = sanitizeJobResults(result.results)?.ai?.readingOrder;
    expect(order, "a partial delivery dropped readingOrder").toBeDefined();
    expect(order!.sentCharacters).toBe(
      segments[0]!.length + segments[1]!.length,
    );
  });

  it("a failure before any call carries no reading order", async () => {
    const { provider, segments } = scripted([OK]);
    const empty = composeReadingOrderExtractor(
      async () => ({
        pageCount: 1,
        pages: [{ pageNumber: 1, text: "", characterCount: 0 }],
        text: "",
        characterCount: 0,
        hasText: false,
      }),
      async () => {
        throw new Error("the flow run must not be made");
      },
    );
    const result = await createTranslateProcessor({
      extract: empty,
      provider,
    }).process(input);
    expect(result.ok).toBe(false);
    expect(segments).toHaveLength(0);
    expect(result.results?.ai?.readingOrder).toBeUndefined();
  });
});
