// @vitest-environment jsdom
/**
 * The relevance window at the POINT OF CONSUMPTION (rule 5): the sentence a
 * reader sees above the answer, reached through every hop a real job takes.
 *
 *   processor (real engine, recording provider, the job's delivery cap)
 *     → `sanitizeJobResults` (the writer the WORKER IMAGE runs on complete)
 *     → JSON.stringify / parse (the Redis record the web reads raw)
 *     → `<TruncationNotice job>` (what the panel renders)
 *
 * `buildAiResultMeta` rebuilds the window from a literal, so a field it
 * forgets never reaches the browser — and the unit tests of the engine and of
 * the notice would both stay green. Only this chain sees it: drop
 * `selection`/`pagesSent` in the writer and the reader gets a page-free
 * sentence (or main's "pages 1–N", which is false of page 30).
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { Job, JobDeliveryCap } from "@/lib/jobs";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { TruncationNotice } from "@/components/tools/truncation-notice";
import type { AiProvider } from "../ai/provider";
import { createChatWithPdfProcessor } from "../processor/chat-with-pdf";
import type { ProcessorInput } from "../processor/types";

const WORDS =
  "alpha bravo cobalt delta ember fjord granite harbor island juniper kestrel lumen meadow nickel orchard pewter quarry russet saffron timber umber velvet willow xenon yarrow zinc".split(
    " ",
  );

function contract(plantPage: number, plant: string): ExtractedPdfText {
  let a = 5;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const texts = Array.from({ length: 40 }, (_, i) => {
    const body = Array.from(
      { length: 60 },
      () => WORDS[Math.floor(next() * WORDS.length)]!,
    );
    if (i + 1 === plantPage) body.splice(30, 0, plant);
    return body.join(" ");
  });
  const joined = texts.join("\n\n");
  return {
    pageCount: texts.length,
    pages: texts.map((text, i) => ({
      pageNumber: i + 1,
      text,
      characterCount: text.length,
    })),
    text: joined,
    characterCount: joined.length,
    hasText: true,
  };
}

const provider: AiProvider = {
  id: "openai",
  model: "gpt-fixture",
  async complete() {
    return {
      ok: true,
      text: "It says so [p.30].",
      model: "gpt-fixture",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
};

function input(question: string): ProcessorInput {
  return {
    tool: "chat-with-pdf",
    options: { question },
    inputs: [
      {
        fileId: "f1",
        filename: "contract.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array([1]),
      },
    ],
    delivery: { characters: 3_000 } as JobDeliveryCap,
  };
}

/** Run the chain and return the sentence the reader sees. */
async function readerSees(question: string): Promise<string> {
  const extracted = contract(30, "Zephyrine");
  const processor = createChatWithPdfProcessor({
    extract: async () => extracted,
    provider,
  });
  const outcome = await processor.process(input(question));
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return "";
  const stored = JSON.parse(
    JSON.stringify(sanitizeJobResults({ ai: outcome.results?.ai })),
  ) as Job["results"];
  const job: Job = {
    jobId: "job_test000001",
    tool: "chat-with-pdf",
    capability: "ai",
    status: "completed",
    progress: 100,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt: "2100-01-01T00:00:00.000Z",
    retention: {
      inputTtlMinutes: 60,
      outputTtlMinutes: 60,
      persistsAfterJob: false,
    },
    ...(stored ? { results: stored } : {}),
  };
  const { container, unmount } = render(
    createElement(TruncationNotice, { job, consequence: "CONSEQUENCE." }),
  );
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("the pages a question was sent reach the reader", () => {
  it("names page 30, never a prefix range", async () => {
    const text = await readerSees("What does the Zephyrine clause say?");
    expect(text).toMatch(/pages were read: pages [\d–, ]*\b30\b/);
    expect(text).not.toMatch(/pages 1–\d+ of/);
    expect(text).not.toMatch(/first part/);
    expect(text).toContain("CONSEQUENCE.");
  });

  it("CONTROL: a question nothing matches renders main's prefix sentence", async () => {
    // The same chain, the prefix branch: proves the reader is not blind to
    // the window (a notice that never rendered would pass the test above's
    // negative assertions).
    const text = await readerSees("What is the governing currency?");
    expect(text).toMatch(/^Only pages 1–\d+ of 40 could be read/);
    expect(text).not.toMatch(/\b30\b/);
  });
});
